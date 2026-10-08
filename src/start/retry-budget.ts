/**
 * The run's retry budget: how many times `start()` re-enters its own
 * task loop after a retry-safe stop instead of returning, and which
 * retry of how many each re-entry is.
 *
 * `--retry=<n>` outranks `loop.retries` for one run
 * ({@link resolveRunRetries}), and `false`, the key's default, opens an
 * empty budget: every stop then halts as it always did. Each retry-safe
 * stop asks {@link takeRetry} for one, and a refusal is the halt the
 * stop made before this module existed. The budget is a value: taking a
 * retry answers a new one and leaves the old one as it was, so the
 * count lives in the one `let` of `start()` that holds it.
 *
 * {@link createRunRetries} is the one `start()` asks: once per run, and
 * then at each retry-safe stop, where a grant writes one warning line
 * ({@link retryLine}) and one `retry` loop event (`start/loop-events.ts`)
 * and `start()` goes back to the top of its loop with `continue`, while
 * a refusal writes nothing and `start()` halts as it did before. A run
 * SIGINT has interrupted is refused at once and spends nothing. So is a
 * run whose checkout has moved from the loop's last commit, read only
 * once a retry is left: a session that committed and then exited
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

import { activeOutput } from '../adapters/output/active.js';

import { emitLoopEvent } from './loop-events.js';

/** What one run may still retry: `of` granted in all, `used` taken so far. */
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

/** A retry {@link takeRetry} granted: which one, of how many. */
export type GrantedRetry = Pick<Extract<RetryGrant, { granted: true }>, 'attempt' | 'of'>;

/** The warning a granted retry writes: that it retries, which retry of how many, and the stop. */
export function retryLine(grant: GrantedRetry, reason: string): string {
  return `🔁 Retrying (retry ${grant.attempt} of ${grant.of}) after the stop: ${reason}.`
    + ' The loop goes on without a new rafa loop start.';
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

/** The run's retries, asked at each retry-safe stop. */
export interface RunRetries {
  /**
   * True when the run retries after the stop `reason` names, having
   * written its warning line and its `retry` event; false when the run
   * halts, with nothing written.
   */
  readonly retry: (reason: string) => boolean;
}

/** The retries of one run; see the module note. */
export function createRunRetries(options: RunRetriesOptions): RunRetries {
  let budget = openRetryBudget(options.retries);
  const retry = (reason: string): boolean => {
    if (options.isInterrupted()) return false;
    const grant = takeRetry(budget);
    if (!grant.granted || !options.isCheckoutHeld()) return false;
    budget = grant.budget;
    activeOutput().warn(retryLine(grant, reason));
    emitLoopEvent({ kind: 'retry', attempt: grant.attempt, of: grant.of, reason });
    return true;
  };
  return { retry };
}
