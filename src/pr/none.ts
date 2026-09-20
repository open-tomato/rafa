/**
 * What a `pr.provider: none` repository gets in place of a pull
 * request: the branch pushed, and the URL a pull request would be
 * opened from printed for the operator to follow by hand.
 *
 * With `gh` the wrap-up session opens the PR itself and
 * `start/pr-lifecycle.ts` then waits on its checks. With `none` there
 * is no CLI to open anything, so the run's last gate has nothing to
 * poll. The spec's answer is not "do nothing": the work still has to
 * leave the machine, so the branch is pushed here and the compare URL
 * printed, and the CI wait is skipped and said to be skipped
 * (`.rafa/specs/rafa-20-pr-commands.md`, section 1).
 *
 * ## Why the push lives here and not in `utils/git.ts`
 *
 * `utils/git.ts` holds two readings and no effect. {@link pushBranch}
 * is the one write this loop makes to a remote outside a Claude
 * session, and it exists only for this provider, so it sits beside the
 * provider it belongs to rather than becoming a general git helper
 * anything may reach for.
 *
 * It never throws. A push that fails — no upstream, a rejected
 * non-fast-forward, no network — is an outcome the gate reports and
 * moves past, the same way a provider that cannot be asked is
 * (`start/pr-lifecycle.ts`), because this is the run's last gate and
 * stopping harder changes nothing about the commits already made.
 *
 * ## What the compare URL is built from
 *
 * {@link compareUrl} builds GitHub's `.../compare/<branch>?expand=1`
 * shape from `origin` and the branch. It takes the path through
 * `normalizeRemote` (`schema/project-id.ts`), the one remote parser in
 * this repository, so the scheme, any embedded credentials, an
 * scp-style colon and a trailing `.git` are stripped by the same code
 * `projectId` and `pr/provider.ts` use rather than by a second parser
 * that can disagree.
 *
 * Two consequences of that choice are measured in `none.test.ts` and
 * not incidental. `normalizeRemote` LOWERCASES a network remote, so
 * `git@github.com:Open-Tomato/Rafa.git` yields
 * `https://github.com/open-tomato/rafa/compare/...`; the owner and repo
 * are lowercase where git wrote them mixed. And it leaves a port on the
 * host, which {@link compareUrl} keeps, since a host reached on a port
 * is reached on that port over https too.
 *
 * The branch is NOT normalized. Its segments are percent-encoded one by
 * one and rejoined on `/`, so `feat/ci gate` becomes
 * `feat/ci%20gate` and keeps the path separator a compare URL needs.
 *
 * A remote that names no host answers null rather than a guess: a
 * filesystem remote, a `file://` URL and a repository with no `origin`
 * at all have no web front end to compare against. The gate says so in
 * words instead of printing a link that goes nowhere.
 *
 * The shape is GitHub's. A `none` provider is most often a repository
 * that HAS a GitHub origin and has opted out of the CLI, which is the
 * case this serves exactly; for a host that spells the path some other
 * way the line is a starting point and the branch is pushed either way.
 */
import { spawnSync } from 'node:child_process';

import { normalizeRemote } from '../schema/project-id.js';

import { remoteHost } from './provider.js';

/** The query GitHub's compare page takes to open the PR form. */
const COMPARE_QUERY = '?expand=1';

/** How a push ended, in the shape the gate reports it. */
export interface PushOutcome {
  /** Whether git exited 0. */
  readonly ok: boolean;
  /**
   * What git said, stderr first: `git push` writes its progress and its
   * refusals there. Empty when it said nothing.
   */
  readonly output: string;
}

/**
 * Pushes `branch` to `origin` from the repository holding `dir`,
 * setting upstream, and answers how it went. Never throws; see the
 * module note.
 */
export function pushBranch(dir: string, branch: string): PushOutcome {
  const result = spawnSync('git', ['push', '--set-upstream', 'origin', branch], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, LC_ALL: 'C' },
  });
  if (result.error !== undefined) {
    return { ok: false, output: result.error.message };
  }

  const said = [result.stderr ?? '', result.stdout ?? '']
    .map((stream) => stream.trim())
    .filter((stream) => stream !== '')
    .join('\n');
  return { ok: result.status === 0, output: said };
}

/** `branch` as compare-URL path segments: each encoded, `/` kept. */
function encodeBranch(branch: string): string {
  return branch.split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

/**
 * The URL a pull request from `branch` would be opened at, given
 * `origin`'s URL, or null when the remote names no host or no
 * `owner/repo` path. See the module note on both.
 */
export function compareUrl(remote: string | null, branch: string): string | null {
  if (remote === null || branch.trim() === '') return null;

  const host = remoteHost(remote);
  if (host === null) return null;

  const segments = normalizeRemote(remote.trim()).split('/');
  const path = segments.slice(1)
    .filter((segment) => segment !== '')
    .join('/');
  if (path === '' || !path.includes('/')) return null;

  // The host comes back from `normalizeRemote` with any port still on
  // it, and `remoteHost` drops that; the first segment is taken here so
  // a port is kept. See the module note.
  return `https://${segments[0] ?? host}/${path}/compare/${encodeBranch(branch)}${COMPARE_QUERY}`;
}
