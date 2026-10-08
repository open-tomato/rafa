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
 * Which stops are retry-safe is not this module's to say: its caller
 * asks only at a stop that a blind re-run with nothing changed was
 * measured to pass. The two readings that tell such a stop apart are
 * `stoppedOnSignal` in `start/suite-steps-run.ts`, true for a suite
 * stop SIGINT made and false for a red step, and
 * `heldOnNothingLeftBehind` in `start/commit.ts`, true for a clean exit
 * held only because its session left neither a report nor a commit.
 * A report that blocks its own task, a refused commit, a moved
 * checkout, a pause and an interrupt are never retried: a blind re-run
 * repeats each of them.
 */
import type { LoopRetries } from '../config-schema-loop-retries.js';

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
