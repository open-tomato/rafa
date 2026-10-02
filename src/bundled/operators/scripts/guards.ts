/**
 * `stretch base-check` and `stretch merge-guard`: the two checks the
 * engineer runs before a loop starts and before a merge. Each answers
 * with one line per condition and refuses on the first that fails.
 *
 * @module bundled/operators/scripts/guards
 */
import type { Io } from './io.js';

import { join } from 'node:path';

/** A guard's answer: the lines to print and the exit code. */
export interface GuardResult {
  readonly code: number;
  readonly lines: readonly string[];
}

/** Exit code for a refusal. */
const REFUSED = 1;

/** Exit code for a step that could not run. */
const BROKEN = 2;

/** Runs git in `root`, answering its trimmed stdout and exit code. */
function git(io: Io, root: string, ...args: string[]): { code: number; out: string } {
  const run = io.exec(['git', ...args], root);

  return { code: run.code, out: run.stdout.trim() };
}

/** Whether `origin/<branch>` holds `origin/<base>`, merging it in with `fix`. */
export function baseCheck(io: Io, root: string, branch: string, base: string, fix: boolean): GuardResult {
  if (git(io, root, 'fetch', '-q', 'origin', base, branch).code !== 0) {
    return { code: BROKEN, lines: [`could not fetch ${base} and ${branch}`] };
  }
  const head = git(io, root, 'rev-parse', '--short', `origin/${base}`).out;

  if (git(io, root, 'merge-base', '--is-ancestor', `origin/${base}`, `origin/${branch}`).code === 0) {
    return { code: 0, lines: [`OK: origin/${branch} holds origin/${base} (${head})`] };
  }
  const behind = `BEHIND: origin/${branch} lacks origin/${base} (${head})`;

  if (!fix) {
    return { code: REFUSED, lines: [behind] };
  }
  const scratch = join(root, '.rafa', 'tmp', `base-check-${io.now()}`);

  if (git(io, root, 'worktree', 'add', '-q', '--detach', scratch, `origin/${branch}`).code !== 0) {
    return { code: BROKEN, lines: [behind, 'could not add a scratch worktree'] };
  }
  const merged = git(io, scratch, 'merge', '-q', '--no-edit', `origin/${base}`, '-m', `Merge ${base} into ${branch} before its loop starts`);

  if (merged.code !== 0) {
    return { code: BROKEN, lines: [behind, `MERGE CONFLICT: left in ${scratch}`] };
  }
  const pushed = git(io, scratch, 'push', '-q', 'origin', `HEAD:refs/heads/${branch}`);

  git(io, root, 'worktree', 'remove', scratch);

  return pushed.code === 0
    ? { code: 0, lines: [behind, `FIXED: origin/${base} merged into ${branch} and pushed`] }
    : { code: BROKEN, lines: [behind, 'the merge could not be pushed'] };
}

/** The fields of `rafa pr show --output=json` the guard reads. */
export interface PrDetail {
  readonly state: string;
  readonly headRefName: string;
  readonly baseRefName: string;
  readonly mergeStateStatus: string;
}

/** The pull request in the result line of `rafa pr show <n> --output=json`. */
export function parsePrShow(stdout: string): PrDetail | undefined {
  const result = stdout.trim().split('\n')
    .reverse()
    .find((line) => line.includes('"type":"result"'));

  try {
    const detail = (JSON.parse(result ?? '') as { data?: { detail?: Partial<PrDetail> } }).data?.detail;

    return detail?.state && detail.headRefName && detail.baseRefName
      ? { state: detail.state, headRefName: detail.headRefName, baseRefName: detail.baseRefName, mergeStateStatus: detail.mergeStateStatus ?? 'UNKNOWN' }
      : undefined;
  } catch {
    return undefined;
  }
}

/** The conditions a pull request must meet before it merges into `base`. */
export function mergeRefusals(detail: PrDetail, head: string, base: string, checkout: { clean: boolean; branch: string }): string[] {
  return [
    detail.state === 'open'
      ? undefined
      : `it is ${detail.state}, not open`,
    detail.headRefName === head
      ? undefined
      : `its head is ${detail.headRefName}, not ${head}`,
    detail.baseRefName === base
      ? undefined
      : `its base is ${detail.baseRefName}, not ${base}`,
    detail.mergeStateStatus === 'CLEAN'
      ? undefined
      : `it reads ${detail.mergeStateStatus}, not CLEAN`,
    checkout.clean
      ? undefined
      : 'the main checkout has uncommitted changes',
    checkout.branch === base
      ? undefined
      : `the main checkout is on ${checkout.branch}, not ${base}`,
  ].filter((reason): reason is string => reason !== undefined);
}

/** Checks a pull request, then merges it with `merge`, adding `--skip-checks` only when asked. */
export function mergeGuard(io: Io, root: string, pr: string, head: string, base: string, options: { merge: boolean; skipChecks: boolean }): GuardResult {
  const detail = parsePrShow(io.exec(['rafa', 'pr', 'show', pr, '--output=json'], root).stdout);

  if (!detail) {
    return { code: BROKEN, lines: [`could not read #${pr} from rafa pr show`] };
  }
  const checkout = { clean: git(io, root, 'status', '--porcelain').out === '', branch: git(io, root, 'branch', '--show-current').out };
  const refusals = mergeRefusals(detail, head, base, checkout);

  if (refusals.length > 0) {
    return { code: REFUSED, lines: refusals.map((reason) => `REFUSED: #${pr}: ${reason}`) };
  }
  const ok = `OK: #${pr} ${head} → ${base}, CLEAN, checkout clean`;

  if (!options.merge) {
    return { code: 0, lines: [ok] };
  }
  const merged = io.exec(['rafa', 'pr', 'merge', pr, '--yes', '--no-hint', ...(options.skipChecks
    ? ['--skip-checks']
    : [])], root);

  return { code: merged.code, lines: [ok, ...merged.stdout.trim().split('\n'), ...(merged.code === 0
    ? []
    : [merged.stderr.trim()])] };
}
