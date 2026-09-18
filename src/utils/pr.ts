import { spawnSync } from 'child_process';

/**
 * The `gh` invocations behind the wrap-up stage's CI gate.
 *
 * The readers that turn their output into a verdict — `classifyState`,
 * `parseChecks`, `verdictOf`, `failingRows`, `formatRows` and
 * `waitForChecks` — moved to `src/pr/checks.ts`, which is pure and has
 * no process spawn in its tests. They are re-exported here so this
 * module stays the one import its callers name until the port replaces
 * it. Everything defined below spawns `gh`.
 */

export type {
  CheckOutcome,
  CheckRow,
  ChecksVerdict,
  WaitOptions,
  WaitResult,
} from '../pr/checks.js';

export {
  classifyState,
  failingRows,
  formatRows,
  parseChecks,
  verdictOf,
  waitForChecks,
} from '../pr/checks.js';

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
