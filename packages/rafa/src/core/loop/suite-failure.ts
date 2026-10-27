/**
 * The record of one failing test, as `packages/rafa/src/suite/run.ts`
 * reads it from a JUnit report and a session record keeps it among a
 * suite step's failures (`sessions.ts`).
 *
 * It sits in core so `sessions.ts` reads it without importing above
 * core; `packages/rafa/src/suite/run.ts` re-exports it under the same
 * name.
 */

/** One failing test: its file, relative to the run's directory, and its full name. */
export interface SuiteFailure {
  readonly file: string;
  /** Its describe names, outermost first, and its own, joined by ` > `. */
  readonly name: string;
  /**
   * The first line of its JUnit failure's message; absent when the
   * report gave none. Compared by `src/triage/inherited.ts` when present to
   * identify inherited failures.
   */
  readonly message?: string;
  /**
   * The first lines of the error Bun printed for it on stderr, trimmed;
   * absent when it printed none. See the module note of
   * `packages/rafa/src/suite/run.ts`.
   */
  readonly errorLines?: readonly string[];
}
