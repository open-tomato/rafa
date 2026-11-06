/**
 * The clock the Tracker adapter contract runs a case under.
 *
 * The `filedIssues` cut-off case needs time to pass between two issues
 * by more than one second, since a GitHub issue is dated to the second.
 * Under {@link realContractClock} that time passes on the wall clock;
 * under {@link advanceableContractClock} the case moves the clock
 * forward and nothing waits. A tracker under contract reads its
 * `createdAt` from the clock it is handed, so both readings agree.
 *
 * This is a clock for the contract alone, not a suite-wide fake: no
 * timer outside the case that holds it is touched.
 */

/** The time a contract case reads, and the way it lets time pass. */
export interface ContractClock {
  /** The current time, in milliseconds since the epoch. */
  now(): number;
  /**
   * Lets `ms` milliseconds pass, resolving once {@link ContractClock.now}
   * reads at least that much later.
   */
  advance(ms: number): Promise<void>;
}

/**
 * The wall clock: `now` reads `Date.now()` and `advance` awaits a real
 * `setTimeout`. The contract's default, so a caller that hands it no
 * clock waits as it always did.
 */
export function realContractClock(): ContractClock {
  return {
    now: () => Date.now(),
    advance: (ms) => new Promise((resolve) => {
      setTimeout(resolve, ms);
    }),
  };
}

/**
 * A clock that moves only when advanced: `now` answers `startMs` plus
 * every millisecond advanced so far, frozen between advances, and
 * `advance` resolves at once without waiting.
 *
 * @param startMs - The time `now` answers before any advance, in
 *   milliseconds since the epoch; the wall clock's time by default.
 */
export function advanceableContractClock(startMs: number = Date.now()): ContractClock {
  let advancedMs = 0;

  return {
    now: () => startMs + advancedMs,
    advance: (ms) => {
      advancedMs += ms;

      return Promise.resolve();
    },
  };
}
