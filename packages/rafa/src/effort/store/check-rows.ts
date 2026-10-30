/**
 * The check rows of a pull request and the verdict over them, which the
 * store's plan CI writer (`./plan-ci.ts`) reads and `packages/rafa-pr/src/pr/checks.ts`
 * re-exports for the poll and the provider that parse and wait on them.
 *
 * They sit in core so the store reads a verdict without importing the
 * `pr` module above it.
 */

/** Whether a single check has passed, failed, or is still in flight. */
export type CheckOutcome = 'pass' | 'fail' | 'pending';

/** One row of `gh pr checks --json name,state,link`. */
export interface CheckRow {
  name: string;
  /** GitHub's raw state, kept verbatim so an unknown one stays reportable. */
  state: string;
  link: string;
  outcome: CheckOutcome;
}

/**
 * The verdict over every row: `none` when the PR has no checks at all,
 * which is the shape a conflicting PR produces, and the shape of a head
 * pushed seconds ago whose first check has not registered yet.
 */
export type ChecksVerdict = 'green' | 'red' | 'pending' | 'none';

/**
 * Reduces rows to one verdict. Pending outranks failure so a run that is
 * still going is never reported as red on a partial reading.
 */
export function verdictOf(rows: readonly CheckRow[]): ChecksVerdict {
  if (rows.length === 0) return 'none';
  if (rows.some((r) => r.outcome === 'pending')) return 'pending';
  if (rows.some((r) => r.outcome === 'fail')) return 'red';
  return 'green';
}

/** Rows the caller should act on: the failing ones, for a repair prompt. */
export function failingRows(rows: readonly CheckRow[]): CheckRow[] {
  return rows.filter((r) => r.outcome === 'fail');
}
