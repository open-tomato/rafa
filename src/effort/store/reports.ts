/**
 * The task-report writer: one row in the store's `task_reports` table for
 * each task session whose output carried a report the loop could read,
 * holding the report's `status` beside the loop's outcome.
 *
 * A report's `status` is the session's claim for its task. The outcome is
 * what the loop made of the task. They are two readings and they can
 * disagree: a session that writes `status: done` beside a listed blocker,
 * whose commit git refuses, or that exits nonzero is stored as `blocked`
 * or `failed` beside its `done`, and a report with no usable status
 * stores NULL beside whatever the loop made of its task.
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
 * | `skills_used` | the report's `skills_used`, a JSON array, or NULL when not recorded |
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
 * `SQLITE_MIGRATIONS`, whichever backend the `store` setting selects; the
 * twelfth added `skills_used`, which is why it is the last column.
 * `findings.ts` says why a report's tables are not kinds. A write always
 * has its one row, and passes `writeSqliteStore` a count of one, which
 * opens the store, creating it when absent, as `absences.ts` opens it
 * through `withSqliteStore`.
 *
 * ## The skills a report says it used
 *
 * `skills_used` holds the report's own list, as `parseReport` answered
 * it: every usable entry, in the order written, duplicates kept and no
 * name rewritten. It is the session's claim, as `status` is, and it is
 * compared with what the session's log shows (`skill_invocations`) under
 * `bareSkillName` by whoever reads the two together, never here.
 *
 * NULL means not recorded, and never an empty list. A row a version-11
 * store held reads NULL, as does a write that leaves the list out or
 * passes null; a report that listed no skill stores `[]`. The migration's
 * CHECK holds the column to NULL or a JSON array. A name holding a lone
 * UTF-16 surrogate is stored too: `JSON.stringify` writes it as a `\u`
 * escape, so the column's text holds none, and `JSON.parse` reads it back.
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
 * ## Reading it back
 *
 * {@link readReportedSkills} answers every row's session, plan, task line,
 * outcome and `skills_used`, in append order, the list parsed and NULL
 * answered as null, so a caller cannot read an unrecorded list as an
 * empty one. It opens the store as the tallies below do.
 *
 * {@link readTaskReportTallies} is what `rafa effort report` reads: one
 * tally per plan stub, status and outcome, counting the rows that share
 * all three, ordered by those three with NULL first in each. It opens
 * and creates nothing when the store file does not exist, and answers
 * none. A store that exists is opened through `withSqliteStore`, as
 * `readProgressFindings` opens it (`utils/progress.ts`), so its schema
 * is brought forward, or refused, as it is for a write.
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
 *   - A `skillsUsed` that is neither left out, null nor a list of
 *     non-blank strings.
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
import type { ReportStatus, TaskReport } from '../../report/parse.js';

import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';

import { REPORT_STATUSES } from '../../report/parse.js';

import { checkDispatch, describeValue } from './findings.js';
import { sqliteStorePath, withSqliteStore, writeSqliteStore } from './sqlite.js';

/** One write: a report's status, the dispatch it came from, and the outcome. */
export interface TaskReportWrite {
  readonly dispatch: FindingsDispatch;
  readonly outcome: FindingOutcome;
  /**
   * The report the session's output carried, as `parseReport` answered
   * it. Only its `status` and `skillsUsed` are stored; a `skillsUsed`
   * left out or null stores NULL, not recorded.
   */
  readonly report: Pick<TaskReport, 'status'> & {
    readonly skillsUsed?: TaskReport['skillsUsed'] | null;
  };
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
    outcome, collected_at,
    skills_used
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
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

/** Throws unless `skills` is left out, null or a list of non-blank strings. */
function checkSkillsUsed(skills: unknown): void {
  if (skills === undefined || skills === null) return;
  const isName = (name: unknown): boolean => typeof name === 'string' && name.trim().length > 0;
  if (Array.isArray(skills) && skills.every(isName)) return;
  throw refusedWrite(`has skills used ${describeValue(skills)}, not null or a list of non-blank strings`);
}

/** The JSON `skills_used` holds, or null when the list was not recorded. */
function skillsUsedJson(skills: readonly string[] | null | undefined): string | null {
  return skills === undefined || skills === null
    ? null
    : JSON.stringify(skills);
}

/**
 * Records the status and the skills one dispatch's session reported, beside the loop's
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
  checkSkillsUsed(write.report.skillsUsed);
  const path = sqliteStorePath(repoRoot);

  const { sessionId, planStub, taskLine } = write.dispatch;
  const collectedAt = (seams.now ?? (() => new Date()))().toISOString();
  const id = (seams.newId ?? randomUUID)();
  const values: Bound[] = [
    id, sessionId, planStub, taskLine,
    write.report.status,
    write.outcome, collectedAt,
    skillsUsedJson(write.report.skillsUsed),
  ];

  const appended = writeSqliteStore(
    path,
    ROWS_PER_WRITE,
    0,
    (db) => db.query<unknown, Bound[]>(INSERT_REPORT).run(...values).changes,
  );
  return { path, appended, skipped: ROWS_PER_WRITE - appended };
}

/** The stored task reports sharing one plan stub, status and outcome. */
export interface TaskReportTally {
  /** The plan stub they were dispatched under, or null for none. */
  readonly planStub: string | null;
  /** The status they claimed, or null for reports that gave none usable. */
  readonly status: ReportStatus | null;
  /** What the loop made of their tasks. Open, as the column is. */
  readonly outcome: string;
  /** How many rows share all three. */
  readonly reports: number;
}

/** A tally, as the query answers it. */
interface TallyRow {
  readonly plan_stub: string | null;
  readonly status: ReportStatus | null;
  readonly outcome: string;
  readonly reports: number;
}

/** Every row counted once, under its plan stub, status and outcome. */
const SELECT_TALLIES = `
  SELECT plan_stub, status, outcome, COUNT(*) AS reports
  FROM task_reports
  GROUP BY plan_stub, status, outcome
  ORDER BY plan_stub, status, outcome
`;

/**
 * Tallies the stored task reports by plan stub, status and outcome.
 *
 * Answers none, opening and creating nothing, when the store file does
 * not exist. Throws when it exists and cannot be read. See the module
 * note.
 */
export function readTaskReportTallies(repoRoot: string): TaskReportTally[] {
  const path = sqliteStorePath(repoRoot);
  if (!existsSync(path)) return [];

  const rows = withSqliteStore(path, false, (db) => db.query<TallyRow, []>(SELECT_TALLIES).all());
  return rows.map((row) => ({
    planStub: row.plan_stub,
    status: row.status,
    outcome: row.outcome,
    reports: row.reports,
  }));
}

/** One stored task report's session, and the skills its report said it used. */
export interface ReportedSkills {
  /** The session's id, which joins its dispatch and its skill invocations. */
  readonly sessionId: string;
  /** The plan stub it was dispatched under, or null for none. */
  readonly planStub: string | null;
  /** The task line it was dispatched for. */
  readonly taskLine: string;
  /** What the loop made of its task. Open, as the column is. */
  readonly outcome: string;
  /**
   * The report's `skills_used`, in the order written, `[]` when it listed
   * none; null when the row holds none recorded, never read as `[]`.
   */
  readonly skillsUsed: readonly string[] | null;
}

/** A row, as the query answers it. */
interface ReportedSkillsRow {
  readonly session_id: string;
  readonly plan_stub: string | null;
  readonly task_line: string;
  readonly outcome: string;
  readonly skills_used: string | null;
}

/** Every row, in append order. */
const SELECT_REPORTED_SKILLS = `
  SELECT session_id, plan_stub, task_line, outcome, skills_used
  FROM task_reports
  ORDER BY seq
`;

/** The list a stored `skills_used` holds. Throws for one no write stores. */
function parseSkillsUsed(sessionId: string, json: string | null): readonly string[] | null {
  if (json === null) return null;
  const list: unknown = JSON.parse(json);
  if (Array.isArray(list) && list.every((name) => typeof name === 'string')) return list;
  throw new Error(`effort store: task report of session ${sessionId} holds skills_used ${json}, not a list of names`);
}

/**
 * The skills each stored task report said its session used, in the order
 * the rows were stored, with a list not recorded answered as null.
 *
 * Answers none, opening and creating nothing, when the store file does
 * not exist. Throws when it exists and cannot be read, or when a row
 * holds a `skills_used` that is not a list of strings. See the module
 * note.
 */
export function readReportedSkills(repoRoot: string): ReportedSkills[] {
  const path = sqliteStorePath(repoRoot);
  if (!existsSync(path)) return [];

  const rows = withSqliteStore(
    path,
    false,
    (db) => db.query<ReportedSkillsRow, []>(SELECT_REPORTED_SKILLS).all(),
  );
  return rows.map((row) => ({
    sessionId: row.session_id,
    planStub: row.plan_stub,
    taskLine: row.task_line,
    outcome: row.outcome,
    skillsUsed: parseSkillsUsed(row.session_id, row.skills_used),
  }));
}
