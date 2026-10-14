/**
 * The stale-doc writer and reader: one row in the store's `stale_docs`
 * table for each documentation line a report named as no longer
 * matching the code, and every row one plan's sessions wrote read back
 * under its stub.
 *
 * {@link writeStaleDocs} stores a report's `stale_docs` entries under
 * the kind its caller names, and files nothing anywhere: a stale line is
 * no bug, and reaches no tracker from here. {@link readStaleDocsForPlan}
 * answers a plan's rows back, one per entry stored.
 *
 * ## The rows
 *
 * The table carries the findings table's provenance, as `blockers` and
 * `out_of_scope_bugs` do, so the tables one report fills are read the
 * same way and join on `session_id`:
 *
 * | Column | Field | From |
 * | --- | --- | --- |
 * | `id` | `id` | generated, `randomUUID` unless a seam replaces it |
 * | `session_id`, `plan_stub`, `task_line` | `sessionId`, `planStub`, `taskLine` | the dispatch |
 * | `kind` | `kind` | the write: `sighting` or `unsettled` |
 * | `where_at`, `what` | `where`, `what` | the report entry, as parsed |
 * | `outcome` | `outcome` | the loop's verdict on the session |
 * | `collected_at` | `collectedAt` | the write's time, ISO 8601, one per write |
 * | `origin_store`, `origin_seq` | none | the store's origin and the row's own `seq`, NULL in both when unminted (`origins.ts`) |
 *
 * `seq` comes first, the append order, as in every table of the store.
 * An entry's `extras` are not stored.
 *
 *   - The column is `where_at` and the field `where`: WHERE is an SQL
 *     keyword, and the report's key is `where`. It is NULL for an entry
 *     that named no place, which the report parser keeps.
 *   - `kind` is the one column no report holds. A `sighting` is an entry
 *     a task reported; an `unsettled` row is an entry the plan's doc task
 *     could not settle. The table's CHECK admits {@link STALE_DOC_KINDS}
 *     and nothing else.
 *   - `plan_stub` is NULL for a row written under no plan.
 *   - `outcome` has no CHECK, for the reason `findings.ts` gives, so a
 *     row read back holds whatever text the store does.
 *
 * ## Where the table lives
 *
 * In the SQLite store's file, created by the migration `stale-docs` of
 * `SQLITE_MIGRATIONS` and written through `writeSqliteStore`, whichever
 * backend the `store` setting selects. `findings.ts` says why a table a
 * report fills is not a kind, so the port's row map and the NDJSON
 * backend hold nothing of it.
 *
 * ## One entry, one row, per session and kind
 *
 * The unique index `stale_docs_by_entry` covers `session_id`, `kind`,
 * `ifnull(where_at, '')` and `what`. The two fields copied from the
 * report are in it, so a report written twice writes its rows once, and
 * two entries naming no place collide through the `ifnull`, which a bare
 * NULL column would not make them do. `kind` is in it as well: without
 * it, a session's unsettled row for an entry it also holds as a sighting
 * would be dropped as that sighting's duplicate, and the row kept would
 * say whichever kind was written first.
 *
 * The insert's conflict target repeats the index's expressions, which is
 * what lets SQLite match it (`triage.ts` records the measured readings
 * behind that). The earlier row stays, whether it is on disk or earlier
 * in the same write, and the later entry adds nothing. The match is
 * exact, byte for byte, and its scope is the session: the same line
 * named by a later session is stored again. Only that conflict is
 * absorbed: an id generated twice throws `UNIQUE constraint failed:
 * stale_docs.id` and rolls the whole write back.
 *
 * ## What is refused, and at which level
 *
 * The loop's own inputs refuse the WHOLE write: the dispatch and the
 * outcome by the findings writer's rule (`checkDispatch`), and a `kind`
 * outside {@link STALE_DOC_KINDS}. The write throws before the store is
 * opened, even with the list empty, and leaves no file behind and no
 * byte of one changed. The kind is checked here and not left to the
 * table's CHECK, which is read only once a row is inserted. Measured
 * with the check removed, on bun 1.3.14: a write with an entry throws
 * `CHECK constraint failed: kind IN ('sighting', 'unsettled')` and
 * leaves behind the store file it created, and a write with no entry
 * throws nothing and answers zero rows under a kind no row can hold.
 *
 * A report ENTRY is refused alone, and the rest are written. A refused
 * entry is never stored, and is answered in
 * {@link StaleDocsWriteResult.rejected}:
 *
 *   - `missing-field`: a `what` of null. `parseReport` drops such an
 *     entry itself, so this is an entry built by hand.
 *   - `unstorable-field`: a value `parseReport` never answers. A `what`
 *     or `where` that is not a string, is blank, or holds a lone UTF-16
 *     surrogate (bound lossily, see `sqlite.ts`).
 *
 * ## Reading a plan's rows back
 *
 * {@link readStaleDocsForPlan} answers every row stored under one plan
 * stub, of both kinds, in append order. `plan_stub` is matched with
 * `IS`, so the stub null reads the rows written under no plan rather
 * than none at all, as `readPlanChanges` matches its own.
 *
 * Append order is `ACROSS_STORES_ORDER` (`origins.ts`): `collected_at`,
 * then the origin pair, then `seq`, never `seq` alone, for the reason
 * `changes.ts` gives. A merge gives the other store's rows new local
 * `seq` values after its own, and the write's time is the same on both
 * sides. One write stamps its rows with one time, and `origin_seq` then
 * keeps them in the order the report listed them.
 *
 * It opens and creates nothing when the store file does not exist, and
 * answers none. A store that exists is opened through `withSqliteStore`
 * for a read, so it is brought forward, or refused, as `sqlite.ts` says
 * a read's is. `kind` is typed {@link StaleDocKind} rather than checked
 * on the way out: the table's CHECK is what bounds it.
 *
 * ## Writing nothing writes nothing, and still checks the schema
 *
 * A write left with no entry to insert, because the list was empty or
 * every entry was refused, inserts no row. On a store that does not
 * exist it opens nothing, and creates no file and no directory. On one
 * that exists it still opens the store, through `writeSqliteStore`, as
 * the findings writer does.
 *
 * ## In a merge
 *
 * The table is `merged` in `MERGE_RULES`, append-only and matched by
 * `id`, and one of the `ORIGIN_TABLES`, the tables whose inserts stamp
 * their origin pair (`origins.ts`).
 */
import type {
  FindingOutcome,
  FindingsDispatch,
  FindingsWriterSeams,
} from './findings.js';
import type { ReportStaleDoc } from '../../report/parse.js';
import type { Database } from 'bun:sqlite';

import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';

import { checkDispatch, describeValue, textProblem } from './findings.js';
import { ACROSS_STORES_ORDER, STAMPED_COLUMNS, stampedValues } from './origins.js';
import { sqliteStorePath, withSqliteStore, writeSqliteStore } from './sqlite.js';

/** Who wrote a row: a task's report, or the doc task that could not settle it. */
export const STALE_DOC_KINDS = ['sighting', 'unsettled'] as const;

/** One of the {@link STALE_DOC_KINDS}. */
export type StaleDocKind = (typeof STALE_DOC_KINDS)[number];

/** One `stale_docs` row, as a reader answers it. */
export interface StaleDocRow {
  /** The row's own id, unique in the table. */
  readonly id: string;
  /** The session whose report named the line. */
  readonly sessionId: string;
  /** The plan's stub, or null for a row written under no plan. */
  readonly planStub: string | null;
  /** The task line, as the dispatch quoted it. */
  readonly taskLine: string;
  /** Whether a task reported the line or the doc task left it unsettled. */
  readonly kind: StaleDocKind;
  /** The file, with the line when known, or null when the entry named none. */
  readonly where: string | null;
  /** What no longer matches. */
  readonly what: string;
  /** The loop's verdict on the session, as stored. */
  readonly outcome: string;
  /** When the row's write was stamped, ISO 8601. */
  readonly collectedAt: string;
}

/** One write: a report's stale-doc entries, their dispatch, the outcome, and the kind they are stored under. */
export interface StaleDocsWrite {
  readonly dispatch: FindingsDispatch;
  readonly outcome: FindingOutcome;
  /** What every row of this write is: a task's sighting, or a line the doc task left unsettled. */
  readonly kind: StaleDocKind;
  /** The report's `stale_docs` list, as `parseReport` answers it. */
  readonly staleDocs: readonly ReportStaleDoc[];
}

/** Why one entry was not written. */
export type StaleDocRejectionReason =
  /** No `what`: nothing says what no longer matches. */
  | 'missing-field'
  /** A field holds a value `parseReport` never answers. */
  | 'unstorable-field';

/** One entry that was not written, and why. */
export interface StaleDocRejection {
  /** The entry's index in the `stale_docs` list. */
  readonly index: number;
  readonly reason: StaleDocRejectionReason;
  /** The field at fault, by its report key. */
  readonly field: string;
  /** One sentence for an operator to read, naming the entry by its report path. */
  readonly text: string;
}

/** What one write did. */
export interface StaleDocsWriteResult {
  /** The store's file, whether or not anything was written to it. */
  readonly path: string;
  /** Rows written. */
  readonly appended: number;
  /** Entries the session already held under the kind, on disk or earlier in the write. */
  readonly skipped: number;
  /**
   * Entries refused, in list order. With these, `appended + skipped +
   * rejected.length` is the `stale_docs` list's length.
   */
  readonly rejected: readonly StaleDocRejection[];
}

/** A stale-doc field, by its report key. */
type StaleDocField = Exclude<keyof ReportStaleDoc, 'extras'>;

/** A column value, as it is bound. */
type Bound = string | null;

/** Why a field's value cannot be stored. */
interface FieldProblem {
  readonly reason: StaleDocRejectionReason;
  /** The problem, worded to follow the field's report path. */
  readonly problem: string;
}

/** A field's check: its problem, or null when the value can be stored. */
type FieldCheck = (value: unknown) => FieldProblem | null;

/**
 * The insert. Its conflict target repeats the index's `ifnull`, which is
 * what lets SQLite match it.
 */
const INSERT_STALE_DOC = `
  INSERT INTO stale_docs (
    id, session_id, plan_stub, task_line,
    kind, where_at, what,
    outcome, collected_at,
    ${STAMPED_COLUMNS}
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ${stampedValues('stale_docs')})
  ON CONFLICT (session_id, kind, ifnull(where_at, ''), what) DO NOTHING
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

/** Each field's check, in the order a report entry lists its fields. */
const FIELD_CHECKS: readonly (readonly [StaleDocField, FieldCheck])[] = [
  ['where', optionalText],
  ['what', requiredText],
];

/** Why one entry cannot be written, or null when it can. */
function rejectionOf(entry: ReportStaleDoc, index: number): StaleDocRejection | null {
  for (const [field, check] of FIELD_CHECKS) {
    const found = check(entry[field]);
    if (found !== null) {
      const text = `stale_docs[${index}].${field} ${found.problem}; not written`;
      return { index, reason: found.reason, field, text };
    }
  }
  return null;
}

/**
 * Throws unless `kind` is one of the {@link STALE_DOC_KINDS}, in the
 * words `checkDispatch` refuses a write in.
 */
function checkKind(kind: unknown): void {
  if ((STALE_DOC_KINDS as readonly unknown[]).includes(kind)) return;
  const expected = STALE_DOC_KINDS.join(', ');
  throw new Error(
    `effort store: stale docs write has kind ${describeValue(kind)}, not one of ${expected}; nothing written`,
  );
}

/** One stored entry's column values, in the insert's order. */
function rowValues(
  entry: ReportStaleDoc,
  write: StaleDocsWrite,
  id: string,
  collectedAt: string,
): Bound[] {
  const { sessionId, planStub, taskLine } = write.dispatch;
  return [
    id, sessionId, planStub, taskLine,
    write.kind, entry.where, entry.what,
    write.outcome, collectedAt,
  ];
}

/**
 * Inserts every row in one transaction and answers how many were added.
 * A row whose entry the session already holds under the kind, on disk or
 * earlier in the write, adds nothing.
 */
function insertRows(db: Database, rows: readonly Bound[][]): number {
  const insert = db.query<unknown, Bound[]>(INSERT_STALE_DOC);
  const insertAll = db.transaction(() => rows.reduce(
    (appended, values) => appended + insert.run(...values).changes,
    0,
  ));
  return insertAll.immediate();
}

/**
 * Writes one report's stale-doc entries for one dispatch under
 * `write.kind`, one row per entry the session does not already hold
 * under that kind.
 *
 * Throws, having opened nothing, when the dispatch, the outcome or the
 * kind cannot be stored. Throws the store's own refusal of a schema past
 * this rafa's version whenever the store exists, even with nothing to
 * insert. An entry that cannot be stored is left out and answered in
 * `rejected`, and the others are written. See the module note for the
 * dedupe rule and each refusal.
 */
export function writeStaleDocs(
  repoRoot: string,
  write: StaleDocsWrite,
  seams: FindingsWriterSeams = {},
): StaleDocsWriteResult {
  checkDispatch('stale docs', write.dispatch, write.outcome);
  checkKind(write.kind);
  const path = sqliteStorePath(repoRoot);

  const rejected: StaleDocRejection[] = [];
  const stored: ReportStaleDoc[] = [];
  for (const [index, entry] of write.staleDocs.entries()) {
    const rejection = rejectionOf(entry, index);
    if (rejection === null) stored.push(entry);
    else rejected.push(rejection);
  }

  const collectedAt = (seams.now ?? (() => new Date()))().toISOString();
  const newId = seams.newId ?? randomUUID;
  const rows = stored.map((entry) => rowValues(entry, write, newId(), collectedAt));

  const appended = writeSqliteStore(path, rows.length, 0, (db) => insertRows(db, rows));
  return { path, appended, skipped: stored.length - appended, rejected };
}

/** A `stale_docs` row, as the read's query answers it. */
interface StoredStaleDoc {
  readonly id: string;
  readonly session_id: string;
  readonly plan_stub: string | null;
  readonly task_line: string;
  readonly kind: StaleDocKind;
  readonly where_at: string | null;
  readonly what: string;
  readonly outcome: string;
  readonly collected_at: string;
}

/** Every row under one plan stub, in the append order every store holding them reads. */
const SELECT_PLAN_STALE_DOCS = `
  SELECT id, session_id, plan_stub, task_line, kind, where_at, what, outcome, collected_at
  FROM stale_docs
  WHERE plan_stub IS ?
  ORDER BY ${ACROSS_STORES_ORDER}
`;

/**
 * Every `stale_docs` row stored under one plan stub, of both kinds, in
 * append order. Pass null for the rows written under no plan.
 *
 * Answers none, opening nothing, when the store file does not exist, and
 * throws when it exists and cannot be read. See the module note.
 */
export function readStaleDocsForPlan(repoRoot: string, planStub: string | null): StaleDocRow[] {
  const path = sqliteStorePath(repoRoot);
  if (!existsSync(path)) return [];

  const rows = withSqliteStore(
    path,
    'read',
    false,
    (db) => db.query<StoredStaleDoc, [string | null]>(SELECT_PLAN_STALE_DOCS).all(planStub),
  );
  return rows.map((row) => ({
    id: row.id,
    sessionId: row.session_id,
    planStub: row.plan_stub,
    taskLine: row.task_line,
    kind: row.kind,
    where: row.where_at,
    what: row.what,
    outcome: row.outcome,
    collectedAt: row.collected_at,
  }));
}
