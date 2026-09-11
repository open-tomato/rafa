import { spawnSync } from 'child_process';

/**
 * Pull-request check-status helpers for the wrap-up stage.
 *
 * The loop's last stage opens or updates the PR, and a PR is not finished
 * until CI has spoken about it. Two failure shapes made that worth
 * automating rather than leaving to the session's judgement:
 *
 *  - A CONFLICTING PR schedules no workflow run at all, because GitHub
 *    cannot build `refs/pull/<n>/merge` for a branch that does not merge
 *    cleanly. The loop would report a finished plan whose code had never
 *    been through CI once.
 *  - A resolved conflict can still red the whole battery at its first
 *    step (a lockfile out of step with the merged manifests fails
 *    `bun install --frozen-lockfile`, and nothing downstream runs).
 *
 * Both are invisible from inside the session that pushed. Everything here
 * except `probeChecks` / `findOpenPullRequest` is pure so the polling
 * logic is testable without a network or a clock.
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
 * which is the shape a conflicting PR produces.
 */
export type ChecksVerdict = 'green' | 'red' | 'pending' | 'none';

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

/**
 * Parses `gh pr checks --json name,state,link` output into rows.
 *
 * Returns an empty list for anything that is not a JSON array — `gh`
 * writes a plain `no checks reported` message and exits non-zero when a
 * PR has none, and that is a verdict here rather than an error.
 */
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

/**
 * Reduces rows to one verdict. Pending outranks failure so a run that is
 * still going is never reported as red on a partial reading.
 */
export function verdictOf(rows: CheckRow[]): ChecksVerdict {
  if (rows.length === 0) return 'none';
  if (rows.some((r) => r.outcome === 'pending')) return 'pending';
  if (rows.some((r) => r.outcome === 'fail')) return 'red';
  return 'green';
}

/** Rows the caller should act on: the failing ones, for a repair prompt. */
export function failingRows(rows: CheckRow[]): CheckRow[] {
  return rows.filter((r) => r.outcome === 'fail');
}

/** One line per check, for the console and for a repair prompt. */
export function formatRows(rows: CheckRow[]): string {
  if (rows.length === 0) return '   (no checks reported)';
  const lines = rows.map((r) => {
    const suffix = r.link === ''
      ? ''
      : ` (${r.link})`;
    return `   ${r.outcome.padEnd(7)} ${r.name} — ${r.state}${suffix}`;
  });
  return lines.join('\n');
}

export interface WaitOptions {
  /** Returns raw `gh pr checks --json ...` stdout for one poll. */
  probe: () => Promise<string>;
  timeoutMs: number;
  intervalMs: number;
  /** Injected for tests; defaults to the real clock. */
  now?: () => number;
  /** Injected for tests; defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
  /** Called after every poll, for progress output. */
  onPoll?: (rows: CheckRow[], verdict: ChecksVerdict, elapsedMs: number) => void;
}

export interface WaitResult {
  /** `timeout` means the deadline passed while checks were still running. */
  verdict: ChecksVerdict | 'timeout';
  rows: CheckRow[];
  elapsedMs: number;
  polls: number;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Polls a PR's checks until they settle, the deadline passes, or the PR
 * reports no checks at all.
 *
 * `none` returns immediately rather than waiting out the deadline: a PR
 * with no checks is either conflicting or has no workflow matching its
 * changed paths, and neither resolves by waiting. The caller distinguishes
 * the two, since only it knows the merge state.
 */
export async function waitForChecks(options: WaitOptions): Promise<WaitResult> {
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? defaultSleep;
  const started = now();

  let polls = 0;

  while (true) {
    const rows = parseChecks(await options.probe());
    polls += 1;
    const verdict = verdictOf(rows);
    const elapsedMs = now() - started;
    options.onPoll?.(rows, verdict, elapsedMs);

    if (verdict !== 'pending') return { verdict, rows, elapsedMs, polls };
    if (elapsedMs + options.intervalMs >= options.timeoutMs) {
      return { verdict: 'timeout', rows, elapsedMs, polls };
    }
    await sleep(options.intervalMs);
  }
}

/**
 * Runs a `gh` subcommand, returning stdout whatever the exit code.
 *
 * `gh pr checks` exits non-zero for a red run AND for a PR with no
 * checks, so the exit code cannot carry the verdict — the rows do.
 * A missing `gh` binary surfaces as empty stdout, which reads as `none`
 * and is handled by the caller rather than crashing the loop.
 */
export function runGh(args: string[], cwd?: string): string {
  const result = spawnSync('gh', args, {
    encoding: 'utf8',
    cwd: cwd ?? process.cwd(),
  });
  return result.stdout ?? '';
}

/** True when `gh` is on PATH and authenticated for this repo. */
export function isGhUsable(cwd?: string): boolean {
  const result = spawnSync('gh', ['auth', 'status'], {
    encoding: 'utf8',
    cwd: cwd ?? process.cwd(),
  });
  return result.status === 0;
}

/** The open PR number for a branch, or null when there is none. */
export function findOpenPullRequest(branch: string, cwd?: string): number | null {
  const stdout = runGh(
    ['pr', 'list', '--head', branch, '--state', 'open', '--json', 'number'],
    cwd,
  );
  const trimmed = stdout.trim();
  if (!trimmed.startsWith('[')) return null;

  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    const first: unknown = parsed[0];
    if (typeof first !== 'object' || first === null) return null;
    const num = (first as Record<string, unknown>)['number'];
    return typeof num === 'number'
      ? num
      : null;
  } catch {
    return null;
  }
}

/** Raw check rows for one PR. */
export function probeChecks(prNumber: number, cwd?: string): string {
  return runGh(
    ['pr', 'checks', String(prNumber), '--json', 'name,state,link'],
    cwd,
  );
}

/** `mergeable`/`mergeStateStatus`/`state`, or null when unreadable. */
export function readMergeState(
  prNumber: number,
  cwd?: string,
): { mergeable: string; mergeStateStatus: string; state: string } | null {
  const stdout = runGh(
    ['pr', 'view', String(prNumber), '--json', 'mergeable,mergeStateStatus,state'],
    cwd,
  );
  const trimmed = stdout.trim();
  if (!trimmed.startsWith('{')) return null;

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    return {
      mergeable: String(parsed['mergeable'] ?? 'UNKNOWN'),
      mergeStateStatus: String(parsed['mergeStateStatus'] ?? 'UNKNOWN'),
      state: String(parsed['state'] ?? 'UNKNOWN'),
    };
  } catch {
    return null;
  }
}
