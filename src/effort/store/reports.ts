/**
 * The task-report writer: one row in the store's `task_reports` table for
 * each task session whose output carried a report the loop could read,
 * holding the report's `status` beside the loop's outcome.
 *
 * A report's `status` is the session's claim for its task. The outcome is
 * what the loop made of the task. They are two readings and they can
 * disagree: a session can exit cleanly having written `status: blocked`.
 * The findings, blockers and out-of-scope bugs tables carry the outcome on
 * every row and the claim on none, so {@link writeTaskReport} keeps the
 * claim, one row per session, where a query can set it beside the outcome.
 *
 * ## The row
 *
 * | Column | From |
 * | --- | --- |
 * | `id` | generated, `randomUUID` unless a seam replaces it |
 * | `session_id`, `plan_stub`, `task_line` | the dispatch |
 * | `status` | the report: `done`, `blocked`, or NULL when it gave no usable status |
 * | `outcome` | the loop: `done`, `blocked` or `failed` |
 * | `collected_at` | the write's time, ISO 8601 |
 *
 * `seq` comes first, the append order, as in every table of the store.
 * `session_id` joins the row to the findings, blockers and out-of-scope
 * bugs the same report filled, and to the session row `effort collect`
 * reads from the session's log. An output that carried no report is a
 * `report_absences` row, never a row here.
 *
 * `status` is NULL when the report left it out or wrote a value outside
 * the set: `parseReport` answers null for both, with an issue saying
 * which. The report is still a report, so its row is still written. NULL
 * is never defaulted to `done`, because a claim the session did not make
 * is not one to set beside the outcome.
 *
 * The table sits in the SQLite store's file, created by the fifth entry of
 * `SQLITE_MIGRATIONS`, whichever backend the `store` setting selects.
 * `findings.ts` says why a report's tables are not kinds. A write always
 * has its one row, and passes `writeSqliteStore` a count of one, which
 * opens the store, creating it when absent, as `absences.ts` opens it
 * through `withSqliteStore`.
 *
 * ## One row per session
 *
 * A session has one output, so it has at most one report. `session_id` is
 * UNIQUE, and a second write for a session already recorded adds nothing
 * and answers `skipped: 1`, whatever status or outcome it carries: the
 * first row stays. Only that conflict is absorbed: the insert names
 * `session_id` as its conflict target, so an id generated twice still
 * throws `UNIQUE constraint failed: task_reports.id`.
 *
 * ## What is refused
 *
 * Everything this writer is handed comes from code: the dispatch and the
 * outcome from the loop, the report from `parseReport`. So every refusal
 * refuses the WHOLE write, thrown before the store is opened, leaving no
 * file behind and no byte of one changed:
 *
 *   - The dispatch and the outcome, by the findings writer's rule
 *     (`checkDispatch`).
 *   - A status that is neither null nor one of `REPORT_STATUSES`.
 *
 * `status` has a CHECK and `outcome` has none. `status` is the report's
 * own closed set, which the task prompt spells out, as the findings
 * table's kinds and signals are; the suite pins the migration's set to
 * `REPORT_STATUSES`, and widening it is a new migration. The CHECK lets
 * NULL through, as every CHECK does, and NULL is what a report with no
 * usable status stores. `outcome` stays open for the reason `findings.ts`
 * gives.
 */
import type {
  FindingOutcome,
  FindingsDispatch,
  FindingsWriterSeams,
} from './findings.js';
import type { TaskReport } from '../../report/parse.js';

import { randomUUID } from 'node:crypto';

import { REPORT_STATUSES } from '../../report/parse.js';

import { checkDispatch, describeValue } from './findings.js';
import { sqliteStorePath, writeSqliteStore } from './sqlite.js';

/** One write: a report's status, the dispatch it came from, and the outcome. */
export interface TaskReportWrite {
  readonly dispatch: FindingsDispatch;
  readonly outcome: FindingOutcome;
  /**
   * The report the session's output carried, as `parseReport` answered
   * it. Only its `status` is stored.
   */
  readonly report: Pick<TaskReport, 'status'>;
}

/** What one write did. */
export interface TaskReportWriteResult {
  /** The store's file, whether or not anything was written to it. */
  readonly path: string;
  /** 1 when the row was written, else 0. */
  readonly appended: number;
  /** 1 when the session already had a row, else 0. */
  readonly skipped: number;
}

/** A column value, as it is bound. */
type Bound = string | null;

/** Every write has exactly one row to insert. */
const ROWS_PER_WRITE = 1;

/**
 * The insert. Its one conflict target is the session, so no other
 * constraint is absorbed.
 */
const INSERT_REPORT = `
  INSERT INTO task_reports (
    id, session_id, plan_stub, task_line,
    status,
    outcome, collected_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (session_id) DO NOTHING
`;

/** A whole-write refusal, thrown before the store is opened. */
function refusedWrite(reason: string): Error {
  return new Error(`effort store: task report write ${reason}; nothing written`);
}

/** Throws unless a status is null or one a report can claim. */
function checkStatus(status: unknown): void {
  if (status === null || (REPORT_STATUSES as readonly unknown[]).includes(status)) return;
  const expected = REPORT_STATUSES.join(', ');
  throw refusedWrite(`has status ${describeValue(status)}, not null or one of ${expected}`);
}

/**
 * Records the status one dispatch's session reported, beside the loop's
 * outcome, unless that session already has a row.
 *
 * Throws, having opened nothing, when the dispatch, the outcome or the
 * status cannot be stored. See the module note for each refusal.
 */
export function writeTaskReport(
  repoRoot: string,
  write: TaskReportWrite,
  seams: FindingsWriterSeams = {},
): TaskReportWriteResult {
  checkDispatch('task report', write.dispatch, write.outcome);
  checkStatus(write.report.status);
  const path = sqliteStorePath(repoRoot);

  const { sessionId, planStub, taskLine } = write.dispatch;
  const collectedAt = (seams.now ?? (() => new Date()))().toISOString();
  const id = (seams.newId ?? randomUUID)();
  const values: Bound[] = [
    id, sessionId, planStub, taskLine,
    write.report.status,
    write.outcome, collectedAt,
  ];

  const appended = writeSqliteStore(
    path,
    ROWS_PER_WRITE,
    0,
    (db) => db.query<unknown, Bound[]>(INSERT_REPORT).run(...values).changes,
  );
  return { path, appended, skipped: ROWS_PER_WRITE - appended };
}
