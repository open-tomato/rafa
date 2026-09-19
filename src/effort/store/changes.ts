/**
 * The change-note writer: one row in the store's `changes` table for
 * each entry of a task report's `changes` list.
 *
 * A task session ends its output with a `rafa:report` block, and its
 * `changes` list is what the task says its own diff is worth to a user
 * of the project: a `level`, an optional `area` heading, and one
 * `summary` line. {@link writeChanges} stores each entry as written.
 * Nothing here turns them into a changelog; this table is what a later
 * release step reads a plan's notes back out of, one row per note.
 *
 * ## The row
 *
 * | Column | From |
 * | --- | --- |
 * | `id` | generated, `randomUUID` unless a seam replaces it |
 * | `session_id`, `plan_stub`, `task_line` | the dispatch |
 * | `level`, `area`, `summary` | the report entry, as parsed |
 * | `collected_at` | the write's time, ISO 8601, one per write |
 *
 * `seq` comes first, the append order, as in every table of the store.
 * An entry's `extras` are not stored: the table has a column for each
 * field a change note defines, and none for a key it does not.
 *
 * `plan_stub` is what a release reads by. Every note a plan's sessions
 * wrote shares it, so the notes for one pull request are one query, and
 * `task_line` is what names the task a note came from inside it.
 *
 * `level` and `summary` are NOT NULL because a note missing either is
 * refused here before it reaches the table: a note with no level says
 * nothing about the release it belongs in, and a note with no summary
 * has no line to print. `area` is nullable, because the parser leaves it
 * null for a note that named no heading.
 *
 * **No column holds an outcome.** The findings, blockers and
 * out-of-scope-bug tables carry the loop's verdict on every row, because
 * what phase 1 does with a sighting depends on how the task ended. A
 * change note is about the DIFF, and the diff a session left is in the
 * commit whatever the loop made of the task; the session's own verdict
 * is in `task_reports` under the same `session_id` when a reader wants
 * it. So this writer takes no outcome, and passes null to the shared
 * `checkDispatch`, which then checks the dispatch alone.
 *
 * ## Where the table lives
 *
 * In the SQLite store's file, created by the eighth entry of
 * `SQLITE_MIGRATIONS` and written through `writeSqliteStore`, whichever
 * backend the `store` setting selects, as the findings table is.
 * `findings.ts` says why a table a report fills is not a kind.
 *
 * ## Deduplication
 *
 * Within one session, an entry duplicates an earlier one only when every
 * field the table stores from the report matches: `level`, `area` and
 * `summary`. The earlier row stays, whether it is on disk or earlier in
 * the same write, and the later entry adds nothing, so recording one
 * session's output twice writes its notes once.
 *
 *   - This is the triage rule, not the findings one. A note is a line a
 *     changelog prints, and two notes that differ in any stored field are
 *     two lines. Nothing here is a sighting to merge by artifact.
 *   - The match is exact: byte for byte, no trimming, no case folding.
 *     Two summaries differing by a trailing space are two rows, as the
 *     parser kept them.
 *   - The scope is the SESSION, never the table or the plan. Two tasks
 *     of one plan that each claim the same note are two rows, because a
 *     release has to see that both said it; whatever renders the
 *     changelog decides what to do with a repeat.
 *
 * One unique index enforces it, over `ifnull(area, '')` rather than the
 * bare column: a unique index treats every NULL as distinct, so a repeat
 * of a note with no area would otherwise be stored twice, and the empty
 * string cannot be a stored value because the table refuses a blank
 * area. The insert's conflict target repeats the index's expression,
 * which is what lets SQLite match it (`triage.ts` records the measured
 * readings behind that). Only that conflict is absorbed: an id generated
 * twice throws `UNIQUE constraint failed: changes.id` and rolls the
 * whole write back.
 *
 * ## What is refused, and at which level
 *
 * The loop's own inputs refuse the WHOLE write, by the findings writer's
 * rule (`checkDispatch`): an empty session id, or dispatch text holding
 * a lone UTF-16 surrogate. The write throws before the store is opened,
 * even with the list empty, and leaves no file behind and no byte of one
 * changed.
 *
 * A report ENTRY is refused alone, and the rest are written. A model
 * wrote the entries, and one it got wrong must not cost the notes it got
 * right. A refused entry is never stored, and is answered in
 * {@link ChangesWriteResult.rejected}:
 *
 *   - `missing-field`: no `level`, or no `summary`. The parser reports
 *     each missing, and neither can be invented here.
 *   - `unstorable-field`: a value `parseReport` never answers. A
 *     `summary` or `area` that is not a string, is blank, or holds a lone
 *     UTF-16 surrogate (bound lossily, see `sqlite.ts`), or a `level`
 *     outside {@link CHANGE_LEVELS}.
 *
 * The table refuses those rows itself, through its NOT NULL and CHECK
 * constraints, so a row written from outside cannot hold what this
 * writer rejects. The level set is spelled in the migration, which never
 * changes once shipped: widening it is a new migration, and the suite
 * pins the migration's set to `CHANGE_LEVELS`.
 *
 * ## Writing nothing writes nothing, and still checks the schema
 *
 * A write left with no entry to insert, because the list was empty or
 * every entry was refused, inserts no row. On a store that does not
 * exist it opens nothing, and creates no file and no directory. On one
 * that exists it still opens the store, through `writeSqliteStore`, as
 * the findings writer does: a store past this rafa's version is refused
 * with no byte changed, one below it is brought forward, and one already
 * at this version changes no byte.
 */
import type {
  FindingsDispatch,
  FindingsWriterSeams,
} from './findings.js';
import type { ReportChange } from '../../report/parse.js';
import type { Database } from 'bun:sqlite';

import { randomUUID } from 'node:crypto';

import { CHANGE_LEVELS } from '../../report/parse.js';

import { checkDispatch, describeValue, textProblem } from './findings.js';
import { sqliteStorePath, writeSqliteStore } from './sqlite.js';

/** One write: a report's change notes and the dispatch they came from. */
export interface ChangesWrite {
  readonly dispatch: FindingsDispatch;
  /** The report's `changes` list, as `parseReport` answers it. */
  readonly changes: readonly ReportChange[];
}

/** Why one entry was not written. */
export type ChangeRejectionReason =
  /** No `level`, or no `summary`: the entry is not a changelog line. */
  | 'missing-field'
  /** A field holds a value `parseReport` never answers. */
  | 'unstorable-field';

/** One entry that was not written, and why. */
export interface ChangeRejection {
  /** The entry's index in the `changes` list. */
  readonly index: number;
  readonly reason: ChangeRejectionReason;
  /** The field at fault, by its report key. */
  readonly field: string;
  /** One sentence for an operator to read, naming the entry by its report path. */
  readonly text: string;
}

/** What one write did. */
export interface ChangesWriteResult {
  /** The store's file, whether or not anything was written to it. */
  readonly path: string;
  /** Rows written. */
  readonly appended: number;
  /** Entries the session already held, on disk or earlier in the write. */
  readonly skipped: number;
  /**
   * Entries refused, in list order. With these, `appended + skipped +
   * rejected.length` is the `changes` list's length.
   */
  readonly rejected: readonly ChangeRejection[];
}

/** A change field, by its report key. */
type ChangeField = Exclude<keyof ReportChange, 'extras'>;

/** A column value, as it is bound. */
type Bound = string | null;

/** Why a field's value cannot be stored. */
interface FieldProblem {
  readonly reason: ChangeRejectionReason;
  /** The problem, worded to follow the field's report path. */
  readonly problem: string;
}

/** A field's check: its problem, or null when the value can be stored. */
type FieldCheck = (value: unknown) => FieldProblem | null;

/**
 * The insert. Its conflict target repeats the index's `ifnull`, which is
 * what lets SQLite match it.
 */
const INSERT_CHANGE = `
  INSERT INTO changes (
    id, session_id, plan_stub, task_line,
    level, area, summary,
    collected_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (session_id, level, ifnull(area, ''), summary) DO NOTHING
`;

/** A text field that may be null. */
function optionalText(value: unknown): FieldProblem | null {
  const problem = textProblem(value);
  return problem === null
    ? null
    : { reason: 'unstorable-field', problem };
}

/** A text field that has to be present. */
function requiredText(value: unknown): FieldProblem | null {
  return value === null
    ? { reason: 'missing-field', problem: 'is missing' }
    : optionalText(value);
}

/** The level: present, and one of the closed set. */
function requiredLevel(value: unknown): FieldProblem | null {
  if (value === null) return { reason: 'missing-field', problem: 'is missing' };
  if ((CHANGE_LEVELS as readonly unknown[]).includes(value)) return null;
  const expected = CHANGE_LEVELS.join(', ');
  return {
    reason: 'unstorable-field',
    problem: `is ${describeValue(value)}, not one of ${expected}`,
  };
}

/** Each field's check, in the order a report entry lists its fields. */
const FIELD_CHECKS: readonly (readonly [ChangeField, FieldCheck])[] = [
  ['level', requiredLevel],
  ['area', optionalText],
  ['summary', requiredText],
];

/** Why one entry cannot be written, or null when it can. */
function rejectionOf(change: ReportChange, index: number): ChangeRejection | null {
  for (const [field, check] of FIELD_CHECKS) {
    const found = check(change[field]);
    if (found !== null) {
      const text = `changes[${index}].${field} ${found.problem}; not written`;
      return { index, reason: found.reason, field, text };
    }
  }
  return null;
}

/** One stored entry's column values, in the insert's order. */
function rowValues(
  change: ReportChange,
  dispatch: FindingsDispatch,
  id: string,
  collectedAt: string,
): Bound[] {
  const { sessionId, planStub, taskLine } = dispatch;
  const { level, area, summary } = change;
  return [id, sessionId, planStub, taskLine, level, area, summary, collectedAt];
}

/**
 * Inserts every row in one transaction and answers how many were added.
 * A row whose entry the session already holds, on disk or earlier in the
 * write, adds nothing.
 */
function insertRows(db: Database, rows: readonly Bound[][]): number {
  const insert = db.query<unknown, Bound[]>(INSERT_CHANGE);
  const insertAll = db.transaction(() => rows.reduce(
    (appended, values) => appended + insert.run(...values).changes,
    0,
  ));
  return insertAll.immediate();
}

/**
 * Writes one report's change notes for one dispatch, one row per entry
 * the session does not already hold.
 *
 * Throws, having opened nothing, when the dispatch cannot be stored.
 * Throws the store's own refusal of a schema past this rafa's version
 * whenever the store exists, even with nothing to insert. An entry that
 * cannot be stored is left out and answered in `rejected`, and the
 * others are written. See the module note for the dedupe rule and each
 * refusal.
 */
export function writeChanges(
  repoRoot: string,
  write: ChangesWrite,
  seams: FindingsWriterSeams = {},
): ChangesWriteResult {
  checkDispatch('changes', write.dispatch, null);
  const path = sqliteStorePath(repoRoot);

  const rejected: ChangeRejection[] = [];
  const stored: ReportChange[] = [];
  for (const [index, change] of write.changes.entries()) {
    const rejection = rejectionOf(change, index);
    if (rejection === null) stored.push(change);
    else rejected.push(rejection);
  }

  const collectedAt = (seams.now ?? (() => new Date()))().toISOString();
  const newId = seams.newId ?? randomUUID;
  const rows = stored.map(
    (change) => rowValues(change, write.dispatch, newId(), collectedAt),
  );

  const appended = writeSqliteStore(path, rows.length, 0, (db) => insertRows(db, rows));
  return { path, appended, skipped: stored.length - appended, rejected };
}
