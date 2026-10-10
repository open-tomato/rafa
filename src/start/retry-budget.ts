/**
 * The run's retry budget: how many times in a row `start()` re-enters
 * its own task loop after a retry-safe stop instead of returning, and
 * which retry of how many each re-entry is.
 *
 * `--retry=<n>` outranks `loop.retries` for one run
 * ({@link resolveRunRetries}), and `false`, the key's default, opens an
 * empty budget: every stop then halts as it always did. Each retry-safe
 * stop asks {@link takeRetry} for one, and a refusal is the halt the
 * stop made before this module existed. The budget is a value: taking a
 * retry answers a new one and leaves the old one as it was, so the
 * count lives in the one `let` of `start()` that holds it.
 *
 * ## In a row
 *
 * The count is of retries in a row, not per run. A task that finishes
 * `done` sets the spent count back to 0 ({@link settleOnDone}), except
 * in two cases, which keep it:
 *
 *   - the finished task is the task of the last stop: failing and
 *     passing the same task again is that stop's own way out, not
 *     progress past it;
 *   - the finished task is a repair task (`isRepairTask` in
 *     `start/suite-blocker.ts`): a repair is the red step's own fix.
 *
 * So a red task step after a plan task, its repair done, the repair's
 * own step red again, and the repair done again spend on toward the
 * cap, and only the next plan task done starts the count over; a task
 * that keeps failing never resets its own count, and the cap ends it.
 * A task is told apart by {@link retryTaskOf}: its text without its
 * declaration and blocker, and which copy of that text it is
 * (`taskRefIn` in `start/pass-over.ts`), so a repair inserted above it
 * moves nothing. A stop with no task of its own, a red suite step
 * before a session, keeps no task, and the next task done resets.
 *
 * ## Asking
 *
 * {@link createRunRetries} is the one `start()` asks: once per run, and
 * then at each retry-safe stop, where a grant writes one warning line
 * ({@link retryLine}) and one `retry` loop event (`start/loop-events.ts`)
 * and `start()` goes back to the top of its loop with `continue`, while
 * a refusal writes nothing and `start()` halts as it did before; and
 * once each task is done ({@link RunRetries.taskDone}). A run
 * SIGINT has interrupted is refused at once and spends nothing. So is a
 * run whose checkout has moved from the loop's last commit, read only
 * once a retry is left, which writes one warning line ({@link movedLine})
 * and no event: a session that committed and then exited
 * nonzero leaves HEAD past an expectation only the loop's own commits
 * advance, and a retry would halt at the loop guard of the next pass,
 * blocking the task on `checkout moved` in place of its own stop.
 *
 * Which stops are retry-safe is not this module's to say: its caller
 * asks only at a stop that a blind re-run with nothing changed was
 * measured to pass. `start()` asks at four: a red suite step before a
 * session and one after a task, a task session that exited nonzero
 * (past the budget exit and the interrupt, which are never asked), and
 * a clean exit held only on what it left behind. The two readings that
 * tell such a stop apart are
 * `stoppedOnSignal` in `start/suite-steps-run.ts`, true for a suite
 * stop SIGINT made and false for a red step, and
 * `heldOnNothingLeftBehind` in `start/commit.ts`, true for a clean exit
 * held only because its session left neither a report nor a commit.
 * A report that blocks its own task, a refused commit, a moved
 * checkout, a pause and an interrupt are never retried: a blind re-run
 * repeats each of them.
 */
import type { LoopRetries } from '../config-schema-loop-retries.js';
import type { TaskInfo } from '../utils/tracker.js';

import { activeOutput } from '../adapters/output/active.js';

import { emitLoopEvent } from './loop-events.js';
import { taskRefIn } from './pass-over.js';
import { isRepairTask } from './suite-blocker.js';

/** What a run may still retry in a row: `of` granted in all, `used` taken since the count last started over. */
export interface RetryBudget {
  readonly of: number;
  readonly used: number;
}

/** What {@link takeRetry} answers: a retry, numbered, or a refusal; each with the budget after it. */
export type RetryGrant =
  | { readonly granted: true; readonly attempt: number; readonly of: number; readonly budget: RetryBudget }
  | { readonly granted: false; readonly budget: RetryBudget };

/**
 * The retries one run makes: `--retry=<n>` when the line names it
 * (`start/run-setup.ts` has refused any other value by then), and
 * `loop.retries` otherwise.
 */
export function resolveRunRetries(flag: number | undefined, configured: LoopRetries): LoopRetries {
  return flag ?? configured;
}

/** A budget of `retries` retries with none used; `false` opens one of none. */
export function openRetryBudget(retries: LoopRetries): RetryBudget {
  return Object.freeze({
    of: retries === false
      ? 0
      : retries,
    used: 0,
  });
}

/**
 * Takes one retry off `budget`: granted and numbered from 1 while one is
 * left, refused once all `of` are used. Answers a new budget either way
 * and never edits the one handed in.
 */
export function takeRetry(budget: RetryBudget): RetryGrant {
  if (budget.used >= budget.of) return { granted: false, budget };
  const used = budget.used + 1;
  return {
    granted: true,
    attempt: used,
    of: budget.of,
    budget: Object.freeze({ of: budget.of, used }),
  };
}

/** A task as the retries tell tasks apart; see the module note. */
export interface RetryTask {
  /** The task's text and its copy among the lines of that text, as `<ordinal>:<text>`. */
  readonly key: string;
  /** True for a repair task, whose finish keeps the count. */
  readonly repair: boolean;
}

/** The {@link RetryTask} of `taskInfo`, read in `trackerContent`, the tracker its line number counts in. */
export function retryTaskOf(taskInfo: Pick<TaskInfo, 'task' | 'lineNum'>, trackerContent: string): RetryTask {
  const ref = taskRefIn(taskInfo, trackerContent);
  return Object.freeze({ key: `${String(ref.ordinal)}:${ref.task}`, repair: isRepairTask(ref.task) });
}

/**
 * The budget once `done` is done: the count set back to 0 when `done`
 * is neither a repair nor the task whose key `stoppedOn` holds, the last
 * stop's, and `budget` as it was otherwise. Never edits `budget`.
 */
export function settleOnDone(budget: RetryBudget, stoppedOn: string | null, done: RetryTask): RetryBudget {
  if (done.repair || done.key === stoppedOn) return budget;
  return Object.freeze({ of: budget.of, used: 0 });
}

/** A retry {@link takeRetry} granted: which one, of how many. */
export type GrantedRetry = Pick<Extract<RetryGrant, { granted: true }>, 'attempt' | 'of'>;

/** The warning a granted retry writes: that it retries, which retry in a row of how many, and the stop. */
export function retryLine(grant: GrantedRetry, reason: string): string {
  return `🔁 Retrying (retry ${grant.attempt} of ${grant.of} in a row) after the stop: ${reason}.`
    + ' The loop goes on without a new rafa loop start.';
}

/**
 * The warning a retry refused for a moved checkout writes: that no retry
 * is taken after the stop, and why.
 */
export function movedLine(reason: string): string {
  return `⚠️  No retry after the stop: ${reason}. The checkout has moved from the loop's last commit,`
    + ' so the task keeps its own stop.';
}

/** What {@link createRunRetries} needs: the run's count, its SIGINT flag and its checkout's reading. */
export interface RunRetriesOptions {
  /** The retries the run makes, as {@link resolveRunRetries} answers them. */
  readonly retries: LoopRetries;
  /** True once the run has received SIGINT. */
  readonly isInterrupted: () => boolean;
  /**
   * True while the checkout is where the loop's last commit left it,
   * read without marking or printing anything (`guardCheckout` in
   * `start/checkout-guard.ts`); asked only once a retry is left.
   */
  readonly isCheckoutHeld: () => boolean;
}

/** Why {@link RunRetries.retry} refused: the run was interrupted, its budget is spent, or its checkout moved. */
export type RetryRefusal = 'interrupted' | 'spent' | 'checkout moved';

/** The run's retries, asked at each retry-safe stop and told of each task done. */
export interface RunRetries {
  /**
   * True when the run retries after the stop `reason` names, having
   * written its warning line and its `retry` event; false when the run
   * halts, with nothing written. `stopped` is the stop's task, or null
   * for a stop with none of its own; it becomes the last stop's task
   * either way.
   */
  readonly retry: (reason: string, stopped: RetryTask | null) => boolean;
  /** Notes that `done` finished `done`, which starts the count over unless the module note says not. */
  readonly taskDone: (done: RetryTask) => void;
  /** The retries in a row still left to take. */
  readonly left: () => number;
  /**
   * Why the last {@link RunRetries.retry} refused, or null when it
   * granted or none was asked. A `--continue` run decides at a
   * retry-safe stop only once the answer is `spent`
   * (`start/continue-run.ts`).
   */
  readonly lastRefusal: () => RetryRefusal | null;
}

/** The retries of one run; see the module note. */
export function createRunRetries(options: RunRetriesOptions): RunRetries {
  let budget = openRetryBudget(options.retries);
  let refusal: RetryRefusal | null = null;
  let stoppedOn: string | null = null;
  const refuse = (why: RetryRefusal): false => {
    refusal = why;
    return false;
  };
  const retry = (reason: string, stopped: RetryTask | null): boolean => {
    stoppedOn = stopped?.key ?? null;
    if (options.isInterrupted()) return refuse('interrupted');
    const grant = takeRetry(budget);
    if (!grant.granted) return refuse('spent');
    if (!options.isCheckoutHeld()) {
      activeOutput().warn(movedLine(reason));
      return refuse('checkout moved');
    }
    budget = grant.budget;
    refusal = null;
    activeOutput().warn(retryLine(grant, reason));
    emitLoopEvent({ kind: 'retry', attempt: grant.attempt, of: grant.of, reason });
    return true;
  };
  return {
    retry,
    taskDone: (done: RetryTask) => {
      budget = settleOnDone(budget, stoppedOn, done);
    },
    left: () => budget.of - budget.used,
    lastRefusal: () => refusal,
  };
}
