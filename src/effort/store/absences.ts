/**
 * The report-absence writer: one telemetry row in the store's
 * `report_absences` table for each task session whose output held no
 * report the loop could read.
 *
 * The task prompt asks a session to end its output with a `rafa:report`
 * block, and the loop has to live without one. `parseReport` answers an
 * absence instead of throwing, and {@link writeReportAbsence} keeps that
 * answer. How often sessions leave the block out, cut it short or write
 * it unreadably is then a count over rows, not something that scrolled
 * past in an operator's terminal.
 *
 * ## The row
 *
 * | Column | From |
 * | --- | --- |
 * | `id` | generated, `randomUUID` unless a seam replaces it |
 * | `session_id`, `plan_stub`, `task_line` | the dispatch |
 * | `reason` | the absence: `no-block`, `unclosed-block` or `malformed-block` |
 * | `detail` | the absence's sentence, which quotes a malformed block's YAML error |
 * | `block_body` | the unread block's raw body, or NULL for `no-block` |
 * | `outcome` | the loop: `done`, `blocked` or `failed` |
 * | `collected_at` | the write's time, ISO 8601 |
 *
 * `seq` comes first, the append order, as in every table of the store.
 * `session_id` is the id the loop spawned the session under, which is
 * also its log's basename, so the row joins the session row `effort
 * collect` reads from that log. A session that died before it could
 * report and one that finished without reporting are told apart by
 * `outcome`, beside `reason`.
 *
 * The table sits in the SQLite store's file, created by the fourth entry
 * of `SQLITE_MIGRATIONS`, whichever backend the `store` setting selects.
 * `findings.ts` says why a report's tables are not kinds.
 *
 * ## One row per session
 *
 * A session has one output, so it has at most one absence. `session_id`
 * is UNIQUE, and a second write for a session already recorded adds
 * nothing and answers `skipped: 1`. Only that conflict is absorbed: the
 * insert names `session_id` as its conflict target, so an id generated
 * twice still throws `UNIQUE constraint failed: report_absences.id`.
 *
 * ## What is refused
 *
 * Everything this writer is handed comes from code: the dispatch and the
 * outcome from the loop, the absence from `parseReport`. So every refusal
 * refuses the WHOLE write, thrown before the store is opened, leaving no
 * file behind and no byte of one changed:
 *
 *   - The dispatch and the outcome, by the findings writer's rule
 *     (`checkDispatch`).
 *   - A reason outside {@link REPORT_ABSENCE_REASONS}.
 *   - A detail that is not a string, is blank, or holds a lone UTF-16
 *     surrogate.
 *   - A block body that is not a string, or holds a lone UTF-16
 *     surrogate. An empty body is stored: a block opened and never
 *     filled is still the block the session wrote. A `no-block` absence
 *     carries no block, and its row's body is NULL.
 *
 * The surrogate rules never refuse a session's own output. Measured on
 * bun 1.3.14, `TextDecoder` decodes the bytes a lone surrogate would be
 * (`ed a0 80`) as three U+FFFD, and a captured session's stdout is
 * decoded by one (`utils/claude.ts`).
 *
 * `reason` and `outcome` have no CHECK. `outcome` stays open for the
 * reason `findings.ts` gives. `reason` is the parser's set, which can
 * grow with the parser, and SQLite cannot widen a CHECK in place. Both
 * are checked here instead.
 */
import type {
  FindingOutcome,
  FindingsDispatch,
  FindingsWriterSeams,
} from './findings.js';
import type { ReportAbsenceReason, ReportAbsent } from '../../report/parse.js';

import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';

import { checkDispatch, describeValue, textProblem } from './findings.js';
import { LONE_SURROGATE, sqliteStorePath, withSqliteStore } from './sqlite.js';

/**
 * Every absence reason `parseReport` answers, keyed by the parser's own
 * type, so a reason added there fails to compile here until it is named.
 */
const ABSENCE_REASONS: Readonly<Record<ReportAbsenceReason, true>> = {
  'no-block': true,
  'unclosed-block': true,
  'malformed-block': true,
};

/** The reasons an absence row may record: every one `parseReport` gives. */
export const REPORT_ABSENCE_REASONS: readonly ReportAbsenceReason[] = Object.freeze(
  Object.keys(ABSENCE_REASONS) as ReportAbsenceReason[],
);

/** One write: an absence, the dispatch it came from, and the outcome. */
export interface ReportAbsenceWrite {
  readonly dispatch: FindingsDispatch;
  readonly outcome: FindingOutcome;
  /** Why the session's output answers no report, as `parseReport` said. */
  readonly absence: ReportAbsent;
}

/** What one write did. */
export interface ReportAbsenceWriteResult {
  /** The store's file, whether or not anything was written to it. */
  readonly path: string;
  /** 1 when the row was written, else 0. */
  readonly appended: number;
  /** 1 when the session already had a row, else 0. */
  readonly skipped: number;
}

/** A column value, as it is bound. */
type Bound = string | null;

/**
 * The insert. Its one conflict target is the session, so no other
 * constraint is absorbed.
 */
const INSERT_ABSENCE = `
  INSERT INTO report_absences (
    id, session_id, plan_stub, task_line,
    reason, detail, block_body,
    outcome, collected_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (session_id) DO NOTHING
`;

/** A whole-write refusal, thrown before the store is opened. */
function refusedWrite(reason: string): Error {
  return new Error(`effort store: report absence write ${reason}; nothing written`);
}

/** Throws unless an absence can be stored as one row. */
function checkAbsence(absence: ReportAbsent): void {
  const { reason, text, block } = absence;
  if (!(REPORT_ABSENCE_REASONS as readonly unknown[]).includes(reason)) {
    const expected = REPORT_ABSENCE_REASONS.join(', ');
    throw refusedWrite(`has reason ${describeValue(reason)}, not one of ${expected}`);
  }

  if (typeof text !== 'string') {
    throw refusedWrite(`has detail ${describeValue(text)}, not a string`);
  }
  const detailProblem = textProblem(text);
  if (detailProblem !== null) throw refusedWrite(`has a detail that ${detailProblem}`);

  if (block === null) return;
  if (typeof block.body !== 'string') {
    throw refusedWrite(`has block body ${describeValue(block.body)}, not a string`);
  }
  if (LONE_SURROGATE.test(block.body)) {
    throw refusedWrite('has a block body holding a lone UTF-16 surrogate');
  }
}

/**
 * Records that one dispatch's session answered no report, unless that
 * session already has a row.
 *
 * Throws, having opened nothing, when the dispatch, the outcome or the
 * absence cannot be stored. See the module note for each refusal.
 */
export function writeReportAbsence(
  repoRoot: string,
  write: ReportAbsenceWrite,
  seams: FindingsWriterSeams = {},
): ReportAbsenceWriteResult {
  checkDispatch('report absence', write.dispatch, write.outcome);
  checkAbsence(write.absence);
  const path = sqliteStorePath(repoRoot);

  const { sessionId, planStub, taskLine } = write.dispatch;
  const { reason, text, block } = write.absence;
  const collectedAt = (seams.now ?? (() => new Date()))().toISOString();
  const id = (seams.newId ?? randomUUID)();
  const values: Bound[] = [
    id, sessionId, planStub, taskLine,
    reason, text, block?.body ?? null,
    write.outcome, collectedAt,
  ];

  const appended = withSqliteStore(
    path,
    !existsSync(path),
    (db) => db.query<unknown, Bound[]>(INSERT_ABSENCE).run(...values).changes,
  );
  return { path, appended, skipped: 1 - appended };
}
