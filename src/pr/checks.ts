/**
 * The check-row readers of a pull request: raw `gh pr checks` output in,
 * one verdict out.
 *
 * A PR is not finished until CI has spoken about it, and two failure
 * shapes made that worth automating rather than leaving to the session's
 * judgement:
 *
 *  - A CONFLICTING PR schedules no workflow run at all, because GitHub
 *    cannot build `refs/pull/<n>/merge` for a branch that does not merge
 *    cleanly. The loop would report a finished plan whose code had never
 *    been through CI once.
 *  - A resolved conflict can still red the whole battery at its first
 *    step (a lockfile out of step with the merged manifests fails
 *    `bun install --frozen-lockfile`, and nothing downstream runs).
 *
 * Both are invisible from inside the session that pushed.
 *
 * ## Zero rows is two readings, and the head's age tells them apart
 *
 * GitHub registers a push's runs some seconds after the push, so a poll
 * in that gap reads zero rows off a pull request whose checks are about
 * to appear. Zero rows on an OLD head is the settled reading above: no
 * run is coming. So a caller that knows when the head was committed
 * hands that time over ({@link WaitOptions.headCommittedAtMs}), and zero
 * rows on a head younger than {@link FIRST_CHECK_GRACE_MS} is polled
 * again like a pending reading. A caller that hands over no time gets
 * `none` on the first poll, as every caller did before the grace
 * existed: the loop's CI gate and `pr triage --resolve` hand over none.
 *
 * The time is the head commit's COMMITTED date, which is not the push
 * time: a commit made an hour ago and pushed just now reads as old and
 * gets no grace. A provider answers a committed date and no push time,
 * and the wrong direction of that error is the cheap one, since it is
 * the behaviour there was before.
 *
 * Everything here is pure: the only effect {@link waitForChecks} has is
 * the `probe` handed to it, and its clock and its wait are injected too,
 * so the polling logic is testable without a network or a timer. The
 * `gh` invocations that feed it live with the rest of the port, not
 * here, which is what keeps `checks.test.ts` free of a process spawn.
 *
 * {@link waitForChecks} polls ROWS rather than stdout, so the poll runs
 * over `PullRequests.checks` (`./types.ts`) without either side naming
 * the CLI. {@link parseChecks} is what turns one provider's stdout into
 * those rows, and the `gh` adapter is its only caller.
 *
 * The row type, the verdict type, {@link verdictOf} and `failingRows`
 * are core's (`packages/rafa/src/effort/store/check-rows.ts`), where the store's plan
 * CI writer reads them; this file re-exports them under the same names.
 */

import type { CheckOutcome, CheckRow, ChecksVerdict } from '@open-tomato/rafa/store/check-rows';

import { verdictOf } from '@open-tomato/rafa/store/check-rows';

export type { CheckOutcome, CheckRow, ChecksVerdict } from '@open-tomato/rafa/store/check-rows';
export { failingRows, verdictOf } from '@open-tomato/rafa/store/check-rows';

const PASSING_STATES = new Set(['SUCCESS', 'SKIPPED', 'NEUTRAL']);

const FAILING_STATES = new Set([
  'FAILURE',
  'CANCELLED',
  'TIMED_OUT',
  'ACTION_REQUIRED',
  'STARTUP_FAILURE',
  'STALE',
  'ERROR',
]);

/**
 * Maps a GitHub check state onto an outcome.
 *
 * An UNRECOGNISED state counts as pending on purpose: the alternative is
 * declaring a run green on a state nobody classified, and a wrong green
 * here lands a plan whose CI never agreed. Waiting is recoverable — the
 * deadline ends it and the raw state is printed in the summary.
 */
export function classifyState(state: string): CheckOutcome {
  const upper = state.trim().toUpperCase();
  if (PASSING_STATES.has(upper)) return 'pass';
  if (FAILING_STATES.has(upper)) return 'fail';
  return 'pending';
}

function readString(value: unknown, fallback: string): string {
  return typeof value === 'string'
    ? value
    : fallback;
}

function toRow(entry: Record<string, unknown>): CheckRow {
  const state = readString(entry['state'], '');
  return {
    name: readString(entry['name'], '(unnamed)'),
    state,
    link: readString(entry['link'], ''),
    outcome: classifyState(state),
  };
}

/**
 * Parses `gh pr checks --json name,state,link` output into rows.
 *
 * Returns an empty list for anything that is not a JSON array — `gh`
 * writes a plain `no checks reported` message and exits non-zero when a
 * PR has none, and that is a verdict here rather than an error.
 */
export function parseChecks(stdout: string): CheckRow[] {
  const trimmed = stdout.trim();
  if (!trimmed.startsWith('[')) return [];

  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];

  const rows: CheckRow[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    rows.push(toRow(entry as Record<string, unknown>));
  }
  return rows;
}

/** One line per check, for the console and for a repair prompt. */
export function formatRows(rows: readonly CheckRow[]): string {
  if (rows.length === 0) return '   (no checks reported)';
  const lines = rows.map((r) => {
    const suffix = r.link === ''
      ? ''
      : ` (${r.link})`;
    return `   ${r.outcome.padEnd(7)} ${r.name} — ${r.state}${suffix}`;
  });
  return lines.join('\n');
}

/**
 * How long after a head commit zero rows still reads as "no check has
 * registered yet" rather than "no check is coming": two minutes.
 *
 * Measured from the head commit's committed date, by the clock
 * {@link waitForChecks} was handed. It is a ceiling on one wait as well:
 * a head dated ahead of that clock is held no longer than this from the
 * wait's own first poll.
 */
export const FIRST_CHECK_GRACE_MS = 120_000;

export interface WaitOptions {
  /**
   * The rows of one poll. A caller on the port hands
   * `PullRequests.checks` here, and a caller holding raw
   * `gh pr checks --json ...` stdout hands {@link parseChecks} of it.
   */
  probe: () => Promise<readonly CheckRow[]>;
  timeoutMs: number;
  intervalMs: number;
  /** Injected for tests; defaults to the real clock. */
  now?: () => number;
  /** Injected for tests; defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
  /**
   * Called after every poll, for progress output. The verdict is the one
   * the wait acts on, so a poll of zero rows the grace holds is reported
   * `pending`, which is why it is polled again.
   */
  onPoll?: (rows: readonly CheckRow[], verdict: ChecksVerdict, elapsedMs: number) => void;
  /**
   * When the pull request's head was committed, in the milliseconds
   * `now` answers in. Handed over, zero rows on a head younger than
   * {@link FIRST_CHECK_GRACE_MS} is polled again; left out, or a value
   * that is no finite number, zero rows ends `none` on the first poll.
   */
  headCommittedAtMs?: number;
}

export interface WaitResult {
  /** `timeout` means the deadline passed while checks were still running. */
  verdict: ChecksVerdict | 'timeout';
  rows: readonly CheckRow[];
  elapsedMs: number;
  polls: number;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Whether zero rows read at `at` are still inside the grace: the head is
 * younger than {@link FIRST_CHECK_GRACE_MS}, and this wait has not itself
 * run that long. The second half is what bounds a head dated ahead of
 * the clock, whose age reads negative for as long as the date is wrong.
 */
function insideGrace(headCommittedAtMs: number | undefined, at: number, elapsedMs: number): boolean {
  if (headCommittedAtMs === undefined || !Number.isFinite(headCommittedAtMs)) return false;
  return at - headCommittedAtMs < FIRST_CHECK_GRACE_MS && elapsedMs < FIRST_CHECK_GRACE_MS;
}

/**
 * Polls a PR's checks until they settle, the deadline passes, or the PR
 * reports no checks at all.
 *
 * `none` returns rather than waiting out the deadline: a PR with no
 * checks is conflicting, has no workflow matching its changed paths, or
 * was pushed so recently that none has registered. Only the last
 * resolves by waiting, and only for {@link FIRST_CHECK_GRACE_MS}, so
 * zero rows is polled again while {@link WaitOptions.headCommittedAtMs}
 * says the head is that young and ends `none` otherwise. The caller
 * tells the first two apart, since only it knows the merge state.
 *
 * A deadline that passes inside the grace ends `timeout`, with no rows,
 * as it does for any reading that was still being polled.
 */
export async function waitForChecks(options: WaitOptions): Promise<WaitResult> {
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? defaultSleep;
  const started = now();

  let polls = 0;

  while (true) {
    const rows = await options.probe();
    polls += 1;
    const at = now();
    const elapsedMs = at - started;
    const read = verdictOf(rows);
    const verdict = read === 'none' && insideGrace(options.headCommittedAtMs, at, elapsedMs)
      ? 'pending'
      : read;
    options.onPoll?.(rows, verdict, elapsedMs);

    if (verdict !== 'pending') return { verdict, rows, elapsedMs, polls };
    if (elapsedMs + options.intervalMs >= options.timeoutMs) {
      return { verdict: 'timeout', rows, elapsedMs, polls };
    }
    await sleep(options.intervalMs);
  }
}
