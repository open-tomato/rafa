/**
 * The findings writer: one row in the store's `findings` table for each
 * entry of a task report's findings list.
 *
 * A task session ends its output with a `rafa:report` block,
 * `parseReport` reads its findings list entry for entry, and
 * {@link writeFindings} stores it. Each row is the `Sighting` a later
 * phase promotes instincts from, and what the loop renders
 * `progress.txt` from at dispatch.
 *
 * ## The row
 *
 * | Column | From |
 * | --- | --- |
 * | `id` | generated, `randomUUID` unless a seam replaces it |
 * | `session_id`, `plan_stub`, `task_line` | the dispatch |
 * | `kind`, `trigger`, `what`, `cause`, `resolution`, `artifact`, `signal` | the report entry, as parsed |
 * | `outcome` | the loop: `done`, `blocked` or `failed` |
 * | `tracker_ref` | null on every row this phase writes; phase 1 fills it |
 * | `collected_at` | the write's time, ISO 8601, one per write |
 *
 * `seq` comes first, the append order, as in every table of the store.
 * An entry's `extras` are not stored: the table has a column for each
 * field the report defines, and none for a key it does not.
 *
 * ## Where the table lives, and why it is not a kind
 *
 * In the SQLite store's file, created by the second entry of
 * `SQLITE_MIGRATIONS` and opened through `withSqliteStore`, as every
 * kind's table is. It is written there whichever backend the `store`
 * setting selects: the NDJSON backend has no findings file. The table
 * stays outside the port's row map on purpose, because a finding breaks
 * three things the port holds of a kind:
 *
 *   - A kind is deduplicated by one key, which is also what a collector
 *     skips by. A finding is deduplicated by one of two keys, and nothing
 *     collects it.
 *   - A kind's row is stored whole as JSON, so both backends hold it
 *     byte for byte. A finding has a column per field, which is what the
 *     spec names and what a query filters on.
 *   - A kind's row is the same however often it is collected. A finding
 *     row carries a generated id and the time it was written.
 *
 * ## Deduplication
 *
 * Within one session, an entry duplicates an earlier one when it carries
 * the same `artifact`, or, carrying none, the same `trigger` and `what`.
 * The earlier row stays, whether it is on disk or earlier in the same
 * write, and nothing of the later entry is kept: two entries differing
 * only in `resolution` are one row.
 *
 *   - The match is exact: byte for byte, no trimming, no case folding.
 *     `artifact` is the string a recurrence is matched on, and a looser
 *     match here would merge findings the report kept apart.
 *   - An entry with an artifact never duplicates one without, even with
 *     the same trigger and what. Each is keyed by its own rule, and the
 *     two keys never meet.
 *   - The scope is the SESSION, never the table. Promotion keys on one
 *     artifact sighted by different tasks or sessions, and phase 1
 *     comments on the issue a recurrence in a later task already filed.
 *     A table-wide dedupe would keep one row per artifact ever, and
 *     nothing could recur. Within a session, a report written twice
 *     writes its rows once.
 *
 * Two partial unique indexes enforce it, one per rule, and the insert
 * names both as conflict targets. Measured with bun 1.3.14 on SQLite
 * 3.51.0:
 *
 *   - A target has to repeat its index's `WHERE`. Without it the insert
 *     throws `ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE
 *     constraint`.
 *   - Only those two conflicts are absorbed. An id generated twice
 *     throws `UNIQUE constraint failed: findings.id` and rolls the whole
 *     write back, where a bare `ON CONFLICT DO NOTHING` would drop the
 *     second entry as if it were a duplicate.
 *
 * ## What is refused, and at which level
 *
 * The loop's own inputs refuse the WHOLE write: an empty session id, an
 * outcome outside {@link FINDING_OUTCOMES}, or dispatch text holding a
 * lone UTF-16 surrogate. The write throws before the store is opened,
 * so it leaves no file behind and changes no byte of one that exists.
 * Code supplies these, and a wrong one is a bug to surface, not a row to
 * store. The check runs even when the findings list is empty.
 *
 * A report ENTRY is refused alone, and the rest are written. A model
 * wrote the entries, and one it got wrong must not cost the findings it
 * got right. That is where this writer departs from the port, which
 * refuses a whole batch for one keyless row. A refused entry is never
 * stored, and is answered in {@link FindingsWriteResult.rejected}:
 *
 *   - `unstorable-field`: a value `parseReport` never answers. A text
 *     field that is not a string, is blank, or holds a lone UTF-16
 *     surrogate, or a kind or signal outside its closed set. A blank key
 *     would merge every blank one, and a lone surrogate is bound lossily
 *     (see `sqlite.ts`), merging distinct keys.
 *   - `unkeyed`: no artifact, and no trigger or no what. Nothing could
 *     deduplicate the row, so every rewrite would add it again.
 *
 * The table refuses those rows itself, through its CHECK constraints, so
 * a row written from outside cannot hold what this writer rejects. The
 * kind and signal sets are spelled in the migration, which never changes
 * once shipped: widening either is a new migration, and the suite pins
 * the migration's sets to `FINDING_KINDS` and `FINDING_SIGNALS`.
 *
 * `outcome` has no CHECK. The spec adds the CI verdict to it once one is
 * known, and SQLite cannot change a CHECK in place: measured, `ALTER
 * TABLE ... ADD CHECK` is a syntax error, so a widened set would mean
 * rebuilding the table. The closed set is enforced here instead.
 *
 * ## Writing nothing writes nothing
 *
 * A write left with no entry to insert, because the list was empty or
 * every entry was refused, never opens the store, and creates no file
 * and no directory.
 */
import type { ReportFinding } from '../../report/parse.js';
import type { Database } from 'bun:sqlite';

import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';

import { FINDING_KINDS, FINDING_SIGNALS } from '../../report/parse.js';

import { LONE_SURROGATE, sqliteStorePath, withSqliteStore } from './sqlite.js';

/**
 * What the loop made of a task, as its findings rows record it. The
 * report's own `status` is the session's claim; this is the loop's.
 */
export const FINDING_OUTCOMES = ['done', 'blocked', 'failed'] as const;

/** One of the loop's outcomes. */
export type FindingOutcome = (typeof FINDING_OUTCOMES)[number];

/** The dispatch a report came from. */
export interface FindingsDispatch {
  /** The task session's id. Non-empty: it scopes deduplication. */
  readonly sessionId: string;
  /** The plan's stub, or null when the dispatch resolved none. */
  readonly planStub: string | null;
  /** The task line, as the dispatch quoted it. */
  readonly taskLine: string;
}

/** One write: a report's findings, where they came from, and the outcome. */
export interface FindingsWrite {
  readonly dispatch: FindingsDispatch;
  readonly outcome: FindingOutcome;
  /** The report's findings list, as `parseReport` answers it. */
  readonly findings: readonly ReportFinding[];
}

/** Seams for the two values a write generates. */
export interface FindingsWriterSeams {
  /** The write's time. Called once per write. Defaults to the clock. */
  readonly now?: () => Date;
  /** One row's id. Called once per stored entry. Defaults to `randomUUID`. */
  readonly newId?: () => string;
}

/** Why one entry was not written. */
export type FindingRejectionReason =
  /** A field holds a value `parseReport` never answers. */
  | 'unstorable-field'
  /** No artifact, and no trigger or no what, to deduplicate it by. */
  | 'unkeyed';

/** One entry that was not written, and why. */
export interface FindingRejection {
  /** The entry's index in the findings list. */
  readonly index: number;
  readonly reason: FindingRejectionReason;
  /** The field at fault, by its report key, or null for `unkeyed`. */
  readonly field: string | null;
  /** One sentence for an operator to read. */
  readonly text: string;
}

/** What one write did. */
export interface FindingsWriteResult {
  /** The store's file, whether or not anything was written to it. */
  readonly path: string;
  /** Rows written. */
  readonly appended: number;
  /** Entries the session already held, on disk or earlier in the write. */
  readonly skipped: number;
  /**
   * Entries refused, in list order. With these, `appended + skipped +
   * rejected.length` is the findings list's length.
   */
  readonly rejected: readonly FindingRejection[];
}

/** A finding field, by its report key. */
type FindingField = Exclude<keyof ReportFinding, 'extras'>;

/** Why a field's value cannot be stored, or null when it can. */
type FieldCheck = (value: unknown) => string | null;

/** A column value, as it is bound. */
type Bound = string | null;

/**
 * The insert. `tracker_ref` is the literal NULL: nothing this phase
 * writes has a tracker reference. Each conflict target repeats its
 * index's `WHERE`, which is what lets SQLite match it.
 */
const INSERT_FINDING = `
  INSERT INTO findings (
    id, session_id, plan_stub, task_line,
    kind, trigger, what, cause, resolution, artifact, signal,
    outcome, tracker_ref, collected_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
  ON CONFLICT (session_id, artifact) WHERE artifact IS NOT NULL DO NOTHING
  ON CONFLICT (session_id, trigger, what) WHERE artifact IS NULL DO NOTHING
`;

/** A value as a refusal quotes it. Never serialises an object. */
function describeValue(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'object' && value !== null) return 'an object';
  return String(value);
}

/** Why a text value cannot be stored, or null when it is null or can be. */
function textProblem(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') return `is ${describeValue(value)}, not a string`;
  if (value.trim().length === 0) return 'is blank';
  if (LONE_SURROGATE.test(value)) {
    return 'holds a lone UTF-16 surrogate, which SQLite text cannot hold';
  }
  return null;
}

/** A check that a value is null or one of a closed set. */
function choiceCheck(choices: readonly string[]): FieldCheck {
  return (value) => value === null || (choices as readonly unknown[]).includes(value)
    ? null
    : `is ${describeValue(value)}, not one of ${choices.join(', ')}`;
}

/** Each field's check, in the order a report entry lists its fields. */
const FIELD_CHECKS: readonly (readonly [FindingField, FieldCheck])[] = [
  ['trigger', textProblem],
  ['kind', choiceCheck(FINDING_KINDS)],
  ['what', textProblem],
  ['cause', textProblem],
  ['resolution', textProblem],
  ['artifact', textProblem],
  ['signal', choiceCheck(FINDING_SIGNALS)],
];

/** A whole-write refusal, thrown before the store is opened. */
function refusedWrite(reason: string): Error {
  return new Error(`effort store: findings write ${reason}; nothing written`);
}

/** Throws unless the dispatch and outcome can be stored on every row. */
function checkWrite(write: FindingsWrite): void {
  const { sessionId, planStub, taskLine } = write.dispatch;
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    throw refusedWrite(`has session id ${describeValue(sessionId)}, not a non-empty string`);
  }
  if (!(FINDING_OUTCOMES as readonly unknown[]).includes(write.outcome)) {
    const expected = FINDING_OUTCOMES.join(', ');
    throw refusedWrite(`has outcome ${describeValue(write.outcome)}, not one of ${expected}`);
  }
  if (typeof taskLine !== 'string') {
    throw refusedWrite(`has task line ${describeValue(taskLine)}, not a string`);
  }
  if (planStub !== null && typeof planStub !== 'string') {
    throw refusedWrite(`has plan stub ${describeValue(planStub)}, not a string or null`);
  }

  const texts: readonly (readonly [string, string | null])[] = [
    ['session id', sessionId],
    ['plan stub', planStub],
    ['task line', taskLine],
  ];
  for (const [name, text] of texts) {
    if (text !== null && LONE_SURROGATE.test(text)) {
      throw refusedWrite(`has a ${name} holding a lone UTF-16 surrogate`);
    }
  }
}

/** Why one entry cannot be written, or null when it can. */
function rejectionOf(finding: ReportFinding, index: number): FindingRejection | null {
  for (const [field, problemOf] of FIELD_CHECKS) {
    const problem = problemOf(finding[field]);
    if (problem !== null) {
      const text = `findings[${index}].${field} ${problem}; not written`;
      return { index, reason: 'unstorable-field', field, text };
    }
  }

  if (finding.artifact === null && (finding.trigger === null || finding.what === null)) {
    const text = `findings[${index}] has no artifact, and no trigger and what`
      + ' to deduplicate it by; not written';
    return { index, reason: 'unkeyed', field: null, text };
  }
  return null;
}

/** One stored entry's column values, in the insert's order. */
function rowValues(
  finding: ReportFinding,
  write: FindingsWrite,
  id: string,
  collectedAt: string,
): Bound[] {
  const { sessionId, planStub, taskLine } = write.dispatch;
  const { kind, trigger, what, cause, resolution, artifact, signal } = finding;
  return [
    id, sessionId, planStub, taskLine,
    kind, trigger, what, cause, resolution, artifact, signal,
    write.outcome, collectedAt,
  ];
}

/**
 * Inserts every row in one transaction and answers how many were added.
 * A row whose key the session already holds, on disk or earlier in the
 * write, adds nothing.
 */
function insertRows(db: Database, rows: readonly Bound[][]): number {
  const insert = db.query<unknown, Bound[]>(INSERT_FINDING);
  const insertAll = db.transaction(() => rows.reduce(
    (appended, values) => appended + insert.run(...values).changes,
    0,
  ));
  return insertAll.immediate();
}

/**
 * Writes one report's findings for one dispatch, one row per entry the
 * session does not already hold.
 *
 * Throws, having opened nothing, when the dispatch or the outcome cannot
 * be stored. An entry that cannot be stored is left out and answered in
 * `rejected`, and the others are written. See the module note for the
 * dedupe rule and each refusal.
 */
export function writeFindings(
  repoRoot: string,
  write: FindingsWrite,
  seams: FindingsWriterSeams = {},
): FindingsWriteResult {
  checkWrite(write);
  const path = sqliteStorePath(repoRoot);

  const rejected: FindingRejection[] = [];
  const stored: ReportFinding[] = [];
  for (const [index, finding] of write.findings.entries()) {
    const rejection = rejectionOf(finding, index);
    if (rejection === null) stored.push(finding);
    else rejected.push(rejection);
  }
  if (stored.length === 0) return { path, appended: 0, skipped: 0, rejected };

  const collectedAt = (seams.now ?? (() => new Date()))().toISOString();
  const newId = seams.newId ?? randomUUID;
  const rows = stored.map((finding) => rowValues(finding, write, newId(), collectedAt));

  const appended = withSqliteStore(path, !existsSync(path), (db) => insertRows(db, rows));
  return { path, appended, skipped: stored.length - appended, rejected };
}
