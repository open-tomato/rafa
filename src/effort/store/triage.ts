/**
 * The triage writer: one row in the store's `blockers` table for each
 * entry of a task report's blockers list, and one in its
 * `out_of_scope_bugs` table for each entry of its out-of-scope bugs.
 *
 * This phase stores both lists and acts on neither. Phase 1 triages them
 * once the Tracker port has an adapter: a blocker marks its task
 * blocked, and a bug is filed through the tracker, or commented on where
 * the tracker already holds one for its artifact. {@link writeTriage}
 * keeps both lists, entry for entry, until then.
 *
 * ## The rows
 *
 * Both tables carry the findings table's provenance, so the three tables
 * one report fills are read the same way and join on `session_id`:
 *
 * | Column | From |
 * | --- | --- |
 * | `id` | generated, `randomUUID` unless a seam replaces it |
 * | `session_id`, `plan_stub`, `task_line` | the dispatch |
 * | `what`, `artifact` | the report entry, as parsed |
 * | `security`, bugs only | the report entry: 1, 0, or NULL for no flag |
 * | `outcome` | the loop: `done`, `blocked` or `failed` |
 * | `collected_at` | the write's time, ISO 8601, one per write |
 *
 * `seq` comes first, the append order, as in every table of the store.
 * An entry's `extras` are not stored.
 *
 *   - `security` is NULL when the report gave no usable flag. The parser
 *     never defaults it to false, and neither does this writer: the flag
 *     is what decides whether a bug may be looked up in a public tracker
 *     at all, and a report's silence is not a `false`.
 *   - `outcome` is the loop's verdict beside the report's lists, so a
 *     blocker listed by a session the loop counted `done` stays apart
 *     from one listed by a session it marked `blocked`. It has no CHECK,
 *     for the reason `findings.ts` gives: the spec widens the set with
 *     the CI verdict, and SQLite cannot widen a CHECK in place.
 *   - Neither table has a `tracker_ref`. Phase 1's spec writes the
 *     reference it files into the `findings` row, and a bug is matched
 *     against the tracker by `tracker.find` on its artifact, not against
 *     this table. Measured on SQLite 3.51.0, a nullable column added by
 *     `ALTER TABLE ... ADD COLUMN` keeps the rows and the unique index in
 *     force, so a later migration can add one if phase 1 wants it here.
 *
 * ## Where the tables live
 *
 * In the SQLite store's file, created by the third entry of
 * `SQLITE_MIGRATIONS` and written through `writeSqliteStore`, whichever
 * backend the `store` setting selects, as the findings table is.
 * `findings.ts` says why a table like these is not a kind.
 *
 * ## Deduplication
 *
 * Within one session and one table, an entry duplicates an earlier one
 * only when every field the table stores from the report matches:
 * `what`, `artifact` and, for a bug, `security`. The earlier row stays,
 * whether it is on disk or earlier in the same write, and the later
 * entry adds nothing. A report written twice writes its rows once.
 *
 *   - This is narrower than the findings rule on purpose. A finding is a
 *     sighting, and sightings are deduplicated by artifact. A blocker or
 *     a bug is something phase 1 acts on, each entry once. Two bugs that
 *     share an artifact but are described apart are two rows, and it is
 *     phase 1's `tracker.find` on that artifact that turns the second
 *     into a comment on the first. Merged here, the second would never
 *     reach it.
 *   - `security` is part of the key so that a `security: true` bug is
 *     never dropped as the duplicate of a `false` or unflagged one.
 *   - The match is exact, as for findings: byte for byte, no trimming, no
 *     case folding. A missing artifact matches a missing artifact, and a
 *     missing flag a missing flag.
 *   - The scope is the SESSION, never the table, so a blocker or a bug
 *     reported again by a later session is stored again.
 *
 * One unique index per table enforces it, over `ifnull(artifact, '')`
 * and, for bugs, `ifnull(security, -1)` rather than the bare columns: a
 * unique index treats every NULL as distinct, so a repeat of an entry
 * with no artifact would otherwise be stored twice. Neither stand-in can
 * be a stored value, because the tables refuse an empty artifact and a
 * flag other than 0 or 1. Measured with bun 1.3.14 on SQLite 3.51.0:
 *
 *   - The insert's conflict target has to repeat the index's
 *     expressions. `IFNULL(artifact,'')` still matches it, but the bare
 *     columns, or `coalesce` in place of `ifnull`, throw `ON CONFLICT
 *     clause does not match any PRIMARY KEY or UNIQUE constraint`.
 *   - Only that conflict is absorbed. An id generated twice throws
 *     `UNIQUE constraint failed` and rolls the whole write back, both
 *     tables, since both lists are inserted in one transaction.
 *
 * ## What is refused, and at which level
 *
 * The loop's own inputs refuse the WHOLE write, by the findings writer's
 * rule (`checkDispatch`): an empty session id, an outcome outside
 * `FINDING_OUTCOMES`, or dispatch text holding a lone UTF-16 surrogate.
 * The write throws before the store is opened, even with both lists
 * empty, and leaves no file behind and no byte of one changed.
 *
 * A report ENTRY is refused alone, and the rest of both lists are
 * written. A refused entry is never stored, and is answered in its
 * list's {@link TriageListResult.rejected}:
 *
 *   - `missing-field`: no `what`. The parser reports it missing, and an
 *     entry that does not say what blocked or broke gives phase 1
 *     nothing to act on and this table nothing to deduplicate by.
 *   - `unstorable-field`: a value `parseReport` never answers. A `what`
 *     or `artifact` that is not a string, is blank, or holds a lone
 *     UTF-16 surrogate, or a `security` flag that is neither a boolean
 *     nor null. The flag is checked here and not left to the table,
 *     because SQLite's integer affinity stores the string `'1'` as the
 *     integer 1 (measured), which the CHECK then accepts.
 *
 * The tables refuse what they can themselves, through NOT NULL and CHECK
 * constraints, so a row written from outside cannot hold a missing or
 * empty `what`, an empty artifact, or a flag other than 0 or 1.
 *
 * ## Writing nothing writes nothing, and still checks the schema
 *
 * A write left with no entry to insert in either list, because both were
 * empty or every entry was refused, inserts no row. On a store that does
 * not exist it opens nothing, and creates no file and no directory. On
 * one that exists it still opens the store, through `writeSqliteStore`,
 * as the findings writer does: a store past this rafa's version is
 * refused with no byte changed, one below it is brought forward, and one
 * already at this version changes no byte.
 */
import type {
  FindingOutcome,
  FindingsDispatch,
  FindingsWriterSeams,
} from './findings.js';
import type { ReportBlocker, ReportBug } from '../../report/parse.js';
import type { Database } from 'bun:sqlite';

import { randomUUID } from 'node:crypto';

import { checkDispatch, describeValue, textProblem } from './findings.js';
import { sqliteStorePath, writeSqliteStore } from './sqlite.js';

/** One write: a report's blockers and bugs, their dispatch, and the outcome. */
export interface TriageWrite {
  readonly dispatch: FindingsDispatch;
  readonly outcome: FindingOutcome;
  /** The report's blockers list, as `parseReport` answers it. */
  readonly blockers: readonly ReportBlocker[];
  /** The report's out-of-scope bugs list, as `parseReport` answers it. */
  readonly outOfScopeBugs: readonly ReportBug[];
}

/** Why one entry was not written. */
export type TriageRejectionReason =
  /** No `what`: nothing says what blocked the task or what broke. */
  | 'missing-field'
  /** A field holds a value `parseReport` never answers. */
  | 'unstorable-field';

/** One entry that was not written, and why. */
export interface TriageRejection {
  /** The entry's index in its list. */
  readonly index: number;
  readonly reason: TriageRejectionReason;
  /** The field at fault, by its report key. */
  readonly field: string;
  /** One sentence for an operator to read, naming the entry by its report path. */
  readonly text: string;
}

/** What one write did to one list's table. */
export interface TriageListResult {
  /** Rows written. */
  readonly appended: number;
  /** Entries the session already held, on disk or earlier in the write. */
  readonly skipped: number;
  /**
   * Entries refused, in list order. With these, `appended + skipped +
   * rejected.length` is the list's length.
   */
  readonly rejected: readonly TriageRejection[];
}

/** What one write did. */
export interface TriageWriteResult {
  /** The store's file, whether or not anything was written to it. */
  readonly path: string;
  readonly blockers: TriageListResult;
  readonly outOfScopeBugs: TriageListResult;
}

/** A column value, as it is bound. */
type Bound = string | number | null;

/** Why a field's value cannot be stored. */
interface FieldProblem {
  readonly reason: TriageRejectionReason;
  /** The problem, worded to follow the field's report path. */
  readonly problem: string;
}

/** A field's check: its problem, or null when the value can be stored. */
type FieldCheck = (value: unknown) => FieldProblem | null;

/** One report list and the table it is written to. */
interface TriageTable<E> {
  /** The list's report key, which is also the table's name. */
  readonly key: 'blockers' | 'out_of_scope_bugs';
  /** Each field's check, in the order a report entry lists its fields. */
  readonly checks: readonly (readonly [keyof E & string, FieldCheck])[];
  /** The insert. Its conflict target repeats the table's index. */
  readonly insert: string;
  /** An entry's own column values, in the insert's order. */
  readonly values: (entry: E) => Bound[];
}

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

/** A flag that may be null, and is otherwise a boolean. */
function optionalFlag(value: unknown): FieldProblem | null {
  return value === null || typeof value === 'boolean'
    ? null
    : { reason: 'unstorable-field', problem: `is ${describeValue(value)}, not a boolean` };
}

/** The blockers list and its table. */
const BLOCKERS: TriageTable<ReportBlocker> = {
  key: 'blockers',
  checks: [['what', requiredText], ['artifact', optionalText]],
  insert: `
    INSERT INTO blockers (
      id, session_id, plan_stub, task_line,
      what, artifact,
      outcome, collected_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (session_id, what, ifnull(artifact, '')) DO NOTHING
  `,
  values: ({ what, artifact }) => [what, artifact],
};

/** The out-of-scope bugs list and its table. */
const OUT_OF_SCOPE_BUGS: TriageTable<ReportBug> = {
  key: 'out_of_scope_bugs',
  checks: [['what', requiredText], ['artifact', optionalText], ['security', optionalFlag]],
  insert: `
    INSERT INTO out_of_scope_bugs (
      id, session_id, plan_stub, task_line,
      what, artifact, security,
      outcome, collected_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (session_id, what, ifnull(artifact, ''), ifnull(security, -1)) DO NOTHING
  `,
  values: ({ what, artifact, security }) => [
    what,
    artifact,
    security === null
      ? null
      : Number(security),
  ],
};

/** A list, split into the entries to store and the ones refused. */
interface CheckedList<E> {
  readonly stored: readonly E[];
  readonly rejected: readonly TriageRejection[];
}

/** Why one entry cannot be written, or null when it can. */
function rejectionOf<E>(table: TriageTable<E>, entry: E, index: number): TriageRejection | null {
  for (const [field, check] of table.checks) {
    const found = check(entry[field]);
    if (found !== null) {
      const text = `${table.key}[${index}].${field} ${found.problem}; not written`;
      return { index, reason: found.reason, field, text };
    }
  }
  return null;
}

/** Splits one list into the entries to store and the ones refused. */
function checkList<E>(table: TriageTable<E>, entries: readonly E[]): CheckedList<E> {
  const stored: E[] = [];
  const rejected: TriageRejection[] = [];
  for (const [index, entry] of entries.entries()) {
    const rejection = rejectionOf(table, entry, index);
    if (rejection === null) stored.push(entry);
    else rejected.push(rejection);
  }
  return { stored, rejected };
}

/** One list's stored entries as column values, in the insert's order. */
function rowsOf<E>(
  table: TriageTable<E>,
  entries: readonly E[],
  write: TriageWrite,
  newId: () => string,
  collectedAt: string,
): Bound[][] {
  const { sessionId, planStub, taskLine } = write.dispatch;
  return entries.map((entry) => [
    newId(), sessionId, planStub, taskLine,
    ...table.values(entry),
    write.outcome, collectedAt,
  ]);
}

/** Inserts one list's rows and answers how many were added. */
function insertList(db: Database, sql: string, rows: readonly Bound[][]): number {
  const insert = db.query<unknown, Bound[]>(sql);
  return rows.reduce((appended, values) => appended + insert.run(...values).changes, 0);
}

/**
 * Inserts both lists' rows in one transaction, and answers how many each
 * added. A row whose entry the session already holds, on disk or earlier
 * in the write, adds nothing.
 */
function insertBoth(
  db: Database,
  blockerRows: readonly Bound[][],
  bugRows: readonly Bound[][],
): readonly [number, number] {
  const insertAll = db.transaction((): readonly [number, number] => [
    insertList(db, BLOCKERS.insert, blockerRows),
    insertList(db, OUT_OF_SCOPE_BUGS.insert, bugRows),
  ]);
  return insertAll.immediate();
}

/** One list's result, given how many of its stored entries were added. */
function listResult<E>(checked: CheckedList<E>, appended: number): TriageListResult {
  return { appended, skipped: checked.stored.length - appended, rejected: checked.rejected };
}

/**
 * Writes one report's blockers and out-of-scope bugs for one dispatch,
 * one row per entry the session does not already hold, both lists in one
 * transaction.
 *
 * Throws, having opened nothing, when the dispatch or the outcome cannot
 * be stored. Throws the store's own refusal of a schema past this rafa's
 * version whenever the store exists, even with both lists left with
 * nothing to insert. An entry that cannot be stored is left out and
 * answered in its list's `rejected`, and the others are written. See the
 * module note for the dedupe rule and each refusal.
 */
export function writeTriage(
  repoRoot: string,
  write: TriageWrite,
  seams: FindingsWriterSeams = {},
): TriageWriteResult {
  checkDispatch('triage', write.dispatch, write.outcome);
  const path = sqliteStorePath(repoRoot);

  const blockers = checkList(BLOCKERS, write.blockers);
  const bugs = checkList(OUT_OF_SCOPE_BUGS, write.outOfScopeBugs);

  const collectedAt = (seams.now ?? (() => new Date()))().toISOString();
  const newId = seams.newId ?? randomUUID;
  const blockerRows = rowsOf(BLOCKERS, blockers.stored, write, newId, collectedAt);
  const bugRows = rowsOf(OUT_OF_SCOPE_BUGS, bugs.stored, write, newId, collectedAt);

  const [blockersAdded, bugsAdded] = writeSqliteStore<readonly [number, number]>(
    path,
    blockerRows.length + bugRows.length,
    [0, 0],
    (db) => insertBoth(db, blockerRows, bugRows),
  );
  return {
    path,
    blockers: listResult(blockers, blockersAdded),
    outOfScopeBugs: listResult(bugs, bugsAdded),
  };
}
