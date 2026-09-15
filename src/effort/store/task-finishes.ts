/**
 * When the tasks of one plan finished, as the store holds it: the
 * `collected_at` of each task session the loop stored with the outcome
 * `done`, which the rough ETA of `rafa loop status` is read from
 * (`commands/loop/loop-sessions.ts`).
 *
 * ## Where a finish is read
 *
 * The loop stores every task session once it knows what became of the
 * task (`start/dispatch.ts`): a session whose output carried a report it
 * could read as one `task_reports` row (`reports.ts`), and any other as
 * one `report_absences` row (`absences.ts`). Rows of both tables carry the
 * plan stub, the outcome and `collected_at`, the time of the store write,
 * so a finish is a row of either table whose outcome is `done`. A task
 * the loop marks blocked or failed ends its run, so the `done` rows of a
 * run are the tasks it got through.
 *
 * {@link readTaskFinishes} answers the times, oldest first, of the rows
 * holding the plan stub asked for, NULL for a plan with none, collected at
 * or after `since`. The times are ISO 8601 in UTC as `toISOString` writes
 * them, and so is a session record's `startedAt`, so they compare as
 * text.
 *
 * ## The store it reads
 *
 * Both tables sit in the SQLite store's file whatever `store` selects. It
 * opens and creates nothing when that file does not exist, and answers no
 * time. A store that exists is opened through `withSqliteStore`, as
 * `readTaskReportTallies` opens it, so a store past the last schema
 * version is refused as it is for a write.
 */
import { existsSync } from 'node:fs';

import { sqliteStorePath, withSqliteStore } from './sqlite.js';

/** Which finishes to read. */
export interface TaskFinishQuery {
  /** The plan stub the tasks were dispatched under, or null for a plan with none. */
  readonly planStub: string | null;
  /** The earliest `collected_at` read, as an ISO 8601 timestamp in UTC. */
  readonly since: string;
}

/** A finish, as the query answers it. */
interface FinishRow {
  readonly collected_at: string;
}

/** A value bound to the query. */
type Bound = string | null;

/** Every `done` row of either table for one plan from one time on, oldest first. */
const SELECT_FINISHES = `
  SELECT collected_at FROM task_reports
  WHERE plan_stub IS ? AND outcome = 'done' AND collected_at >= ?
  UNION ALL
  SELECT collected_at FROM report_absences
  WHERE plan_stub IS ? AND outcome = 'done' AND collected_at >= ?
  ORDER BY collected_at
`;

/**
 * The times the plan's tasks finished from `since` on, oldest first.
 * Answers none, opening nothing, when the store file does not exist, and
 * throws when it exists and cannot be read. See the module note.
 */
export function readTaskFinishes(repoRoot: string, query: TaskFinishQuery): string[] {
  const path = sqliteStorePath(repoRoot);
  if (!existsSync(path)) return [];

  const bound: Bound[] = [query.planStub, query.since, query.planStub, query.since];
  const rows = withSqliteStore(path, false, (db) => db.query<FinishRow, Bound[]>(SELECT_FINISHES).all(...bound));
  return rows.map((row) => row.collected_at);
}
