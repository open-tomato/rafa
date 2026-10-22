/**
 * The branch scan a roadmap walk is read against, and the match that
 * says which issue a branch ref claims. `./roadmap.ts` re-exports all
 * of it and asks its questions over the scan; this module only reads
 * the refs and matches them.
 *
 * ## The claim branch, through the template
 *
 * A claim branch is the `naming.branch` template with the stub in it,
 * `feat/rafa-<n>-<slug>` under the default, `feat/{stub}`.
 * {@link scanClaimBranches} takes the template as an optional trailing
 * `template`, defaulting to `DEFAULT_BRANCH_TEMPLATE`, hands it to the
 * claim reader it carries (`./roadmap-claims.ts`), and records it as
 * {@link BranchScan.branchTemplate}; {@link branchClaims} matches a ref
 * under the template it is given. Only that template is read: under
 * `work/{stub}`, `feat/rafa-20-x` claims no issue, and under the default
 * `work/rafa-20-x` claims none.
 *
 * ## Two reads, each failure carried as data
 *
 * `git for-each-ref` over `refs/heads` and `refs/remotes` answers what
 * this clone holds, and `git ls-remote --heads <remote>` what the remote
 * holds now. A read that fails is a sentence in
 * {@link BranchScan.problems}, beside the other read's refs; the policy
 * over that list is the caller's (`./roadmap.ts`'s module note).
 */
import type { RemoteClaimReader } from './roadmap-claims.js';
import type { GitResult, GitRunner } from '@open-tomato/rafa/core/git';

import { boardId } from '@open-tomato/rafa/board/naming';
import { BRANCH_STUB, DEFAULT_BRANCH_TEMPLATE, isBranchTemplate } from '@open-tomato/rafa/core/config/sections';

import { createRemoteClaimReader } from './roadmap-claims.js';

/** The remote the branch scan asks when the caller names none. */
export const DEFAULT_REMOTE = 'origin';

/** What a failed git command wrote, for a problem sentence. Never empty. */
function detailOf(result: GitResult, command: string): string {
  const written = result.stderr.trim() || result.stdout.trim();
  return written === ''
    ? `${command} failed and wrote nothing`
    : `${command} failed: ${written}`;
}

/** `text` with every regular-expression metacharacter escaped. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/**
 * True when `ref` names the claim branch of `issue` under `template`:
 * the template's part before `{stub}`, then `rafa-<issue>` alone or
 * followed by `-` and a slug, then the template's part after `{stub}`,
 * wherever the ref's own prefix puts it. Under the default template
 * `feat/rafa-20-x`, `origin/feat/rafa-20-x` and
 * `refs/heads/feat/rafa-20-x` all claim issue 20, and `feat/rafa-2-x`
 * claims issue 2 and not issue 20; under `work/{stub}`,
 * `refs/remotes/origin/work/rafa-20-x` claims issue 20 and
 * `feat/rafa-20-x` claims nothing. A template that does not hold
 * `{stub}` exactly once claims nothing.
 */
export function branchClaims(ref: string, issue: number, template: string = DEFAULT_BRANCH_TEMPLATE): boolean {
  if (!isBranchTemplate(template)) return false;
  const [prefix = '', suffix = ''] = template.split(BRANCH_STUB);
  const claim = `${escapeRegExp(prefix)}${boardId(issue)}(?:-.*)?${escapeRegExp(suffix)}`;
  return new RegExp(`(?:^|/)${claim}$`, 'u').test(ref);
}

/** Every branch ref a walk has in hand, with what could not be read. */
export interface BranchScan {
  /** The refs read, as git spelled them. */
  readonly refs: readonly string[];
  /** A sentence per reading that failed; `./roadmap.ts`'s module note holds the policy. */
  readonly problems: readonly string[];
  /**
   * Reads the claim on a branch the remote holds (`./roadmap-claims.ts`).
   * Left out, as a scan planted by hand leaves it, no claim is read and
   * every branch is taken as it always was.
   */
  readonly claimOf?: RemoteClaimReader;
  /**
   * The `naming.branch` template the scan was taken under, which every
   * reading over its refs matches a claim branch by. Left out, as a scan
   * planted by hand leaves it, the default, `feat/{stub}`.
   */
  readonly branchTemplate?: string;
}

/** The lines of a git command's output, blank ones dropped. */
function outputLines(stdout: string): readonly string[] {
  return stdout.split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/**
 * Every branch this clone and `remote` hold, read once for a whole walk.
 *
 * `git for-each-ref` over `refs/heads` and `refs/remotes` answers what
 * the clone knows; `git ls-remote --heads <remote>` answers what the
 * remote holds now. Either failing is reported through
 * {@link BranchScan.problems} and leaves the other's refs in place, so a
 * scan is never silently half-read.
 *
 * The scan carries {@link BranchScan.claimOf}, the claim reader over the
 * claim branches under `template` the remote answered; it reads nothing
 * until a line asks, and then fetches the template's claim branches once
 * (`./roadmap-claims.ts`). It records `template` as
 * {@link BranchScan.branchTemplate}, so the readings over it match the
 * same branches the reader fetches.
 */
export function scanClaimBranches(
  git: GitRunner,
  remote: string = DEFAULT_REMOTE,
  template: string = DEFAULT_BRANCH_TEMPLATE,
): BranchScan {
  const local = git(['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes']);
  const pushed = git(['ls-remote', '--heads', remote]);

  const localRefs = local.ok
    ? outputLines(local.stdout)
    : [];
  const pushedRefs = pushed.ok
    ? outputLines(pushed.stdout).map((line) => line.split('\t').at(-1) ?? '')
    : [];
  const claimOf = createRemoteClaimReader(git, remote, pushedRefs, template);

  const problems = [
    local.ok
      ? ''
      : `the branches of this checkout could not be read, so a branch held only here was not seen: ${detailOf(local, 'git for-each-ref')}`,
    pushed.ok
      ? ''
      : `the branches on ${remote} could not be read, so a branch pushed but not fetched was not seen: ${detailOf(pushed, `git ls-remote --heads ${remote}`)}`,
  ].filter((problem) => problem !== '');

  return Object.freeze({
    refs: Object.freeze([...localRefs, ...pushedRefs].filter((ref) => ref !== '')),
    problems: Object.freeze(problems),
    claimOf,
    branchTemplate: template,
  });
}
