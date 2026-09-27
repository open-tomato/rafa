/**
 * The plan CI writer and reader: the store's `plan_ci` table, which says
 * what a pull request's checks read, for which plan, on which head, when.
 *
 * `rafa effort report --skills` asks whether a plan whose sessions used a
 * skill still landed red. Nothing else the store holds says how a plan's
 * pull request fared under CI: `task_reports` is the session's own claim,
 * and the checks are read by `pr triage` and `pr merge` and then
 * forgotten. {@link recordPlanCi} is the one helper both commands call
 * with the pull request they read and the `CheckRow`s its checks
 * answered; the command modules only call it.
 *
 * ## The row
 *
 * | Column | From |
 * | --- | --- |
 * | `plan_stub` | the plan the head branch resolves to, see below |
 * | `pr` | the pull request's number |
 * | `head_sha` | `headRefOid`, the commit the checks ran on |
 * | `verdict` | `green`, `red` or `none`, as `verdictOf` reads the rows |
 * | `failing` | the failing checks' names, a JSON array, `[]` unless red |
 * | `read_at` | when the checks were read, ISO 8601 |
 *
 * `seq` comes first, the append order, as in every table of the store. A
 * CHECK keeps `failing` non-empty exactly when the verdict is `red`. The
 * table sits in the SQLite store's file, created by the thirteenth entry
 * of `SQLITE_MIGRATIONS`, whichever backend the `store` setting selects.
 *
 * ## A pending reading has no row
 *
 * `verdictOf` answers `pending` while any check is still running, and the
 * table's CHECK admits only `green`, `red` and `none`: a reading taken
 * mid-run says nothing about how the plan landed, and storing it would
 * count the same head twice once it settles. {@link planCiReading}
 * answers no row for it, and {@link writePlanCi} refuses one.
 *
 * ## The plan stub
 *
 * The head branch is read as `<type>/<stub>` by `attributeBranch`, and
 * the stub resolved against the plan roster by `resolvePlanStub`, as
 * `effort collect` resolves a session's branch. A stub the roster does
 * not hold is taken verbatim, as `release status` takes it: the plans
 * directory is untracked by default, so a checkout holding no plan
 * files would otherwise record nothing for the plan it is merging. A
 * branch naming no stub (`main`, a branch with no `/`) or a queue id
 * reaching two plans records nothing, since `plan_stub` is never NULL
 * and nothing is guessed.
 *
 * ## One reading of one head at one time
 *
 * The key is `(pr, head_sha, read_at)`: the same head read twice at two
 * times is two rows, which is what lets a reader see a head go from red
 * to green on a rerun, while the same reading written twice is stored
 * once, the second counted as skipped.
 *
 * ## Reading it back
 *
 * {@link readPlanCi} answers every row, or one plan's, in append order.
 * It opens and creates nothing when the store file does not exist. A
 * store that exists is opened through `withSqliteStore`, so its schema is
 * brought forward, or refused, as it is for a write.
 *
 * ## What is refused, and what is only warned about
 *
 * {@link writePlanCi} is handed values from code, so each refusal below
 * throws before the store is opened, leaving no file behind: a plan stub,
 * head sha, failing name or read time that is not non-blank text SQLite
 * can hold, a number that is not a whole number above zero, a verdict
 * outside `green`, `red` and `none`, and a failing list that is not a
 * list or is empty on a red verdict and not on another.
 *
 * {@link recordPlanCi} never throws. A triage or a merge is not failed by
 * its bookkeeping: whatever goes wrong, from the plans directory to the
 * store, is handed to `warn` and answered as the record's `problem`.
 */
import type { CheckRow } from '../../pr/checks.js';
import type { PullRequestDetail } from '../../pr/types.js';

import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { failingRows, verdictOf } from '../../pr/checks.js';
import { attributeBranch, planStubsFromFileNames, resolvePlanStub } from '../attribution.js';

import { describeValue, textProblem } from './findings.js';
import { sqliteStorePath, withSqliteStore, writeSqliteStore } from './sqlite.js';

/** A settled verdict: what the table stores, `pending` left out. */
export type PlanCiVerdict = 'green' | 'red' | 'none';

/** The verdicts the table admits, in the order its CHECK lists them. */
export const PLAN_CI_VERDICTS: readonly PlanCiVerdict[] = ['green', 'red', 'none'];

/** What of a pull request a reading needs. */
export type PlanCiPullRequest = Pick<PullRequestDetail, 'number' | 'headRefName' | 'headRefOid'>;

/** One reading of a pull request's checks, as it is stored and read back. */
export interface PlanCiRow {
  /** The plan the head branch resolved to. */
  readonly planStub: string;
  /** The pull request's number. */
  readonly pr: number;
  /** The head commit the checks ran on. */
  readonly headSha: string;
  /** The settled verdict over every check. */
  readonly verdict: PlanCiVerdict;
  /** The failing checks' names, in the order the checks listed them. */
  readonly failing: readonly string[];
  /** When the checks were read, ISO 8601. */
  readonly readAt: string;
}

/** A row to store, or why a reading stores none. */
export type PlanCiReading =
  | { readonly row: PlanCiRow; readonly skipped: null }
  | { readonly row: null; readonly skipped: string };

/** What one write did. */
export interface PlanCiWriteResult {
  /** The store's file. */
  readonly path: string;
  /** 1 when the row was added, 0 when the same reading was already held. */
  readonly appended: number;
}

/** What {@link recordPlanCi} did, never thrown. */
export interface PlanCiRecord {
  /** The row it meant to store, or null when the reading stores none. */
  readonly row: PlanCiRow | null;
  /** Why no row was meant, or null when one was. */
  readonly skipped: string | null;
  /** The rows added: 0 when skipped, held already, or failed. */
  readonly appended: number;
  /** What failed, as it was warned about, or null when nothing did. */
  readonly problem: string | null;
}

/** What {@link recordPlanCi} is handed. */
export interface PlanCiRecordInput {
  /** The project root the store sits under. */
  readonly repoRoot: string;
  /** `plan.dir`, relative to `repoRoot` or absolute. */
  readonly planDir: string;
  /** The pull request whose checks were read. */
  readonly pullRequest: PlanCiPullRequest;
  /** The rows the checks answered. */
  readonly rows: readonly CheckRow[];
  /** Where a failure is reported; the command's own warning output. */
  readonly warn: (message: string) => void;
  /** The reading's time; the clock by default. */
  readonly now?: () => Date;
}

/** A row as the query answers it. */
interface StoredPlanCi {
  readonly plan_stub: string;
  readonly pr: number;
  readonly head_sha: string;
  readonly verdict: PlanCiVerdict;
  readonly failing: string;
  readonly read_at: string;
}

/** The insert; the same reading of the same head is absorbed as held. */
const INSERT_PLAN_CI = `
  INSERT INTO plan_ci (plan_stub, pr, head_sha, verdict, failing, read_at)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT (pr, head_sha, read_at) DO NOTHING
`;

/** The columns a reading answers, without the filter and order. */
const SELECT_COLUMNS = 'SELECT plan_stub, pr, head_sha, verdict, failing, read_at FROM plan_ci';

/** A whole-write refusal, thrown before the store is opened. */
function refusedWrite(reason: string): Error {
  return new Error(`effort store: plan CI write ${reason}; nothing written`);
}

/** Throws unless `value` is a non-blank string SQLite can hold. */
function checkText(name: string, value: unknown): void {
  const problem = value === null
    ? 'is null'
    : textProblem(value);
  if (problem !== null) throw refusedWrite(`has a ${name} that ${problem}`);
}

/** Throws, having opened nothing, unless `row` can be stored. */
function checkRow(row: PlanCiRow): void {
  checkText('plan stub', row.planStub);
  checkText('head sha', row.headSha);
  checkText('read time', row.readAt);
  if (!Number.isSafeInteger(row.pr) || row.pr <= 0) {
    throw refusedWrite(`has pull request ${describeValue(row.pr)}, not a whole number above zero`);
  }
  const verdict: unknown = row.verdict;
  if (!PLAN_CI_VERDICTS.some((known) => known === verdict)) {
    throw refusedWrite(`has verdict ${describeValue(verdict)}, not one of ${PLAN_CI_VERDICTS.join(', ')}`);
  }
  const failing: unknown = row.failing;
  if (!Array.isArray(failing)) throw refusedWrite(`has failing ${describeValue(failing)}, not a list`);
  for (const name of failing) checkText('failing check name', name);
  if ((row.verdict === 'red') !== (failing.length > 0)) {
    throw refusedWrite(`has verdict ${row.verdict} beside ${failing.length} failing checks`);
  }
}

/**
 * The plan a head branch belongs to: the roster's stub when the branch
 * stub resolves, the branch stub verbatim when the roster holds none,
 * and null when the branch names no stub or reaches two plans. See the
 * module note.
 */
export function planStubOfBranch(headRefName: string, planStubs: readonly string[]): string | null {
  const branchStub = attributeBranch(headRefName).stub;
  if (branchStub === null) return null;
  const resolution = resolvePlanStub(branchStub, planStubs);
  if (resolution.stub !== null) return resolution.stub;
  return resolution.match === 'ambiguous'
    ? null
    : branchStub;
}

/**
 * The row one reading of a pull request's checks stores, or why it
 * stores none: a pending verdict, or a head branch that resolves to no
 * plan. Pure; the time is handed in.
 */
export function planCiReading(
  pullRequest: PlanCiPullRequest,
  rows: readonly CheckRow[],
  planStubs: readonly string[],
  readAt: string,
): PlanCiReading {
  const verdict = verdictOf(rows);
  if (verdict === 'pending') {
    return { row: null, skipped: `the checks of #${pullRequest.number} are still running` };
  }
  const planStub = planStubOfBranch(pullRequest.headRefName, planStubs);
  if (planStub === null) {
    return { row: null, skipped: `the branch "${pullRequest.headRefName}" of #${pullRequest.number} resolves to no plan` };
  }
  const failing = failingRows(rows).map(({ name }) => name);
  return {
    row: { planStub, pr: pullRequest.number, headSha: pullRequest.headRefOid, verdict, failing, readAt },
    skipped: null,
  };
}

/**
 * Records one reading, absorbing the same reading already held.
 *
 * Throws, having opened nothing, when a value cannot be stored. See the
 * module note for each refusal.
 */
export function writePlanCi(repoRoot: string, row: PlanCiRow): PlanCiWriteResult {
  checkRow(row);
  const path = sqliteStorePath(repoRoot);
  const values = [row.planStub, row.pr, row.headSha, row.verdict, JSON.stringify(row.failing), row.readAt];
  const appended = writeSqliteStore(path, 1, 0, (db) => db.query<unknown, (string | number)[]>(INSERT_PLAN_CI).run(...values).changes);
  return { path, appended };
}

/** One stored row as a reading answers it. */
function rowOf(stored: StoredPlanCi): PlanCiRow {
  const failing: unknown = JSON.parse(stored.failing);
  return {
    planStub: stored.plan_stub,
    pr: stored.pr,
    headSha: stored.head_sha,
    verdict: stored.verdict,
    failing: Array.isArray(failing)
      ? failing.map(String)
      : [],
    readAt: stored.read_at,
  };
}

/**
 * Every stored reading, or only `planStub`'s when one is named, in the
 * order they were written.
 *
 * Answers none, opening and creating nothing, when the store file does
 * not exist. Throws when it exists and cannot be read.
 */
export function readPlanCi(repoRoot: string, planStub?: string): PlanCiRow[] {
  const path = sqliteStorePath(repoRoot);
  if (!existsSync(path)) return [];

  const rows = withSqliteStore(path, false, (db) => (planStub === undefined
    ? db.query<StoredPlanCi, []>(`${SELECT_COLUMNS} ORDER BY seq`).all()
    : db.query<StoredPlanCi, [string]>(`${SELECT_COLUMNS} WHERE plan_stub = ? ORDER BY seq`).all(planStub)));
  return rows.map(rowOf);
}

/** The plan stubs `planDir` holds, none when it is not there. */
function planStubsUnder(repoRoot: string, planDir: string): string[] {
  const dir = resolve(repoRoot, planDir);
  return existsSync(dir)
    ? planStubsFromFileNames(readdirSync(dir))
    : [];
}

/** An error's message, however it was thrown. */
function messageOf(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error);
}

/**
 * Stores what a pull request's checks read, for `pr triage` and `pr
 * merge`. Never throws: a failure is handed to `warn` and answered as the
 * record's `problem`. See the module note.
 */
export function recordPlanCi(input: PlanCiRecordInput): PlanCiRecord {
  const now = input.now ?? (() => new Date());
  let row: PlanCiRow | null = null;
  try {
    const planStubs = planStubsUnder(input.repoRoot, input.planDir);
    const reading = planCiReading(input.pullRequest, input.rows, planStubs, now().toISOString());
    if (reading.row === null) return { row: null, skipped: reading.skipped, appended: 0, problem: null };
    row = reading.row;
    const { appended } = writePlanCi(input.repoRoot, row);
    return { row, skipped: null, appended, problem: null };
  } catch (error) {
    const problem = `the CI reading of #${input.pullRequest.number} was not stored: ${messageOf(error)}`;
    input.warn(problem);
    return { row, skipped: null, appended: 0, problem };
  }
}
