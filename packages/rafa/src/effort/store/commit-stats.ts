/**
 * The commit row of the effort store and the gap arithmetic its rows
 * carry.
 *
 * Moved down from `packages/rafa-effort/src/effort/commits.ts`, which parses `git log` into
 * these rows and re-exports both names under the same names: the
 * store's row types (`types.ts`), the merge's gap recompute
 * (`merge-commit-gaps.ts`) and its scenario fixtures
 * (`testdata/merge-scenarios.ts`) need the row and the arithmetic but
 * not the parser, so they import them here and the store imports
 * nothing above core for them. The parser's module note in
 * `commits.ts` still describes how each field is read from the log.
 */

/** Milliseconds in a minute, so the conversion is not a bare literal. */
const MS_PER_MINUTE = 60_000;

/**
 * Decimal places kept on an elapsed-minute gap.
 *
 * A store row is JSON, so an unrounded quotient makes a row's bytes
 * depend on how a runtime formats a repeating float. Three places is a
 * tenth of a second — finer than anything a cost report reads, and
 * stable across the two runtimes this repo runs under.
 */
const ELAPSED_DECIMALS = 3;

/** One row per commit. */
export interface CommitStats {
  /** Full 40-character sha, and the store's key projection. */
  sha: string;
  /** Author date, ISO 8601 with offset, as `%aI` emits it. */
  timestamp: string;
  /** Subject line only. No commit message body reaches the row. */
  subject: string;
  /** Author name, as `%an` emits it. */
  author: string;
  /** Ref the walk reached this commit from, or null for `HEAD`. */
  branch: string | null;
  /** Numstat lines attributed to the commit, binary files included. */
  filesChanged: number;
  /** Summed added lines; a binary file contributes zero. */
  insertions: number;
  /** Summed removed lines; a binary file contributes zero. */
  deletions: number;
  /** Parents. Two or more is a merge, which prints no diff. */
  parentCount: number;
  /** Minutes since the preceding commit in time order, or null. */
  minutesSincePrevious: number | null;
}

/**
 * Minutes between two ISO timestamps, or null when either fails to
 * parse. Rounded to {@link ELAPSED_DECIMALS}; never negative, because
 * the caller orders the pair before asking.
 */
export function minutesBetween(
  earlier: string,
  later: string,
): number | null {
  const from = Date.parse(earlier);
  const to = Date.parse(later);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;

  const minutes = (to - from) / MS_PER_MINUTE;
  return Number(minutes.toFixed(ELAPSED_DECIMALS));
}
