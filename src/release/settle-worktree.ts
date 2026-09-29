/**
 * The scratch worktree `rafa release settle` works in: a detached
 * worktree of `origin/<pr.base>`, fetched first, added under a scratch
 * directory of its own and removed again on every path out.
 *
 * Settle writes the version file and the changelog, deletes fragments
 * and commits, and none of that may touch the caller's checkout or its
 * index: the caller may be on a feature branch with work in flight. So
 * the release commit is built in a worktree of the base branch as the
 * remote holds it, and {@link withSettleWorktree} is the one place that
 * worktree is made and unmade. What happens inside it (the fold, the
 * commit, the delivery) is the body's business, not this module's.
 *
 * ## The steps
 *
 *   1. `git fetch <remote> <branch>` in the caller's repository. A
 *      failed fetch REFUSES: settle folds the base branch as the remote
 *      holds it now, and a stale copy would fold fragments another
 *      settle has already deleted. This is where it differs from the
 *      wrap-up's fragment naming (`./prepare.ts`), which carries a failed
 *      fetch as a problem and goes on.
 *   2. `<remote>/<branch>` is resolved to one commit, so the worktree,
 *      the body and any message name the same hash even if the ref moves.
 *   3. A scratch directory is made with `mkdtemp` under `scratchRoot`
 *      (the system temporary directory unless named), and the worktree
 *      is added at `<scratch>/base` with `--detach` at that hash: no
 *      local branch is created, so nothing is left in the caller's branch
 *      list and no branch can be "already used by worktree".
 *   4. The body runs with a {@link SettleWorktree}, whose `git` runs in
 *      the worktree.
 *   5. The worktree is removed and the scratch directory deleted,
 *      whether the body answered, threw or rejected, and also when the
 *      add itself failed.
 *
 * ## Why removal forces
 *
 * `git worktree remove` refuses a worktree holding modified or untracked
 * files (`src/pr/worktree.ts` measured it), and the resolve worktree
 * honours that refusal because its files are a person's evidence. This
 * worktree holds nothing of anyone's: it was made from a pushed commit a
 * moment ago, and whatever it holds that was not committed and pushed is
 * a half-built release commit settle abandoned. So removal is
 * `git worktree remove --force`, then the scratch directory is deleted
 * outright, then `git worktree prune` drops any record the remove did not
 * — the order that leaves no worktree record naming a missing directory.
 *
 * ## What is answered rather than thrown
 *
 * Every git failure is answered as a {@link SettleWorktreeOutcome} with
 * one sentence, as the {@link GitRunner} answers rather than throws. A
 * throw from the body is the body's own and is rethrown after removal;
 * when removal also left something behind, the rethrown error names that
 * too, with the body's error as its `cause`, so neither is lost.
 */
import type { BaseVersionOptions } from './version.js';
import type { GitRunner } from '../pr/git.js';

import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { messageOf } from '../config-sections.js';
import { createGitRunner, gitSaid } from '../pr/git.js';

import { RELEASE_BASE_BRANCH, RELEASE_REMOTE } from './version.js';

/** What the scratch directory's name starts with, before `mkdtemp`'s suffix. */
export const SETTLE_SCRATCH_PREFIX = 'rafa-settle-';

/** The worktree's directory name inside the scratch directory. */
const WORKTREE_DIRECTORY = 'base';

/** What {@link withSettleWorktree} is given. */
export interface SettleWorktreeOptions {
  /** Runs git at the caller's repository root; used to fetch, add and remove. */
  readonly git: GitRunner;
  /** The base branch and its remote; `origin` and `main` unless named. */
  readonly base?: BaseVersionOptions;
  /** The directory the scratch directory is made in; the system temporary directory unless named. */
  readonly scratchRoot?: string;
}

/** The worktree a body runs in. */
export interface SettleWorktree {
  /** The worktree's directory, symlinks resolved. */
  readonly path: string;
  /** Runs git in the worktree. */
  readonly git: GitRunner;
  /** The remote the base branch was fetched from. */
  readonly remote: string;
  /** The base branch's name on that remote. */
  readonly branch: string;
  /** The ref resolved, as git was given it: `origin/main`. */
  readonly ref: string;
  /** The full hash the worktree was added at. */
  readonly commit: string;
}

/** What {@link withSettleWorktree} answers. */
export type SettleWorktreeOutcome<T> =
  | {
    readonly ok: true;
    /** What the body answered. */
    readonly value: T;
    /** The ref the worktree was made from. */
    readonly ref: string;
    /** The full hash the worktree was added at. */
    readonly commit: string;
    /** One sentence naming what removal left behind, or null when it left nothing. */
    readonly leftover: string | null;
  }
  | {
    readonly ok: false;
    /** One sentence naming the step that failed and what git said. */
    readonly problem: string;
    /** One sentence naming what removal left behind, or null when it left nothing. */
    readonly leftover: string | null;
  };

/** The worktree's parts known before the body runs. */
interface Added {
  readonly scratch: string;
  readonly worktree: SettleWorktree;
}

/** A failed step before any body ran. */
type Refused = { readonly ok: false; readonly problem: string; readonly leftover: string | null };

/**
 * Removes the worktree at `path` and deletes `scratch`, answering one
 * sentence naming what is left, or null. The module note holds the order.
 */
function removeScratch(git: GitRunner, scratch: string, path: string): string | null {
  const removed = git(['worktree', 'remove', '--force', path]);
  const problems: string[] = [];
  try {
    rmSync(scratch, { recursive: true, force: true });
  } catch (error) {
    problems.push(`the scratch directory ${scratch} could not be deleted: ${messageOf(error)}`);
  }
  if (!removed.ok) {
    const pruned = git(['worktree', 'prune']);
    if (!pruned.ok) {
      problems.push(`the worktree record of ${path} could not be pruned: ${gitSaid(pruned)}`);
    }
  }
  if (problems.length === 0 && existsSync(scratch)) {
    problems.push(`the scratch directory ${scratch} is still there`);
  }
  return problems.length === 0
    ? null
    : problems.join('; ');
}

/** Makes the scratch directory, or answers why it could not be made. */
function makeScratch(root: string): string | Refused {
  try {
    return realpathSync(mkdtempSync(join(root, SETTLE_SCRATCH_PREFIX)));
  } catch (error) {
    return { ok: false, problem: `no scratch directory could be made under ${root}: ${messageOf(error)}`, leftover: null };
  }
}

/** Fetches the base branch, resolves it and adds the worktree; the module note holds the steps. */
function addWorktree(options: SettleWorktreeOptions): Added | Refused {
  const remote = options.base?.remote ?? RELEASE_REMOTE;
  const branch = options.base?.branch ?? RELEASE_BASE_BRANCH;
  const ref = `${remote}/${branch}`;
  const { git } = options;

  const fetched = git(['fetch', remote, branch]);
  if (!fetched.ok) {
    return { ok: false, problem: `${branch} could not be fetched from ${remote}: ${gitSaid(fetched)}`, leftover: null };
  }
  const resolved = git(['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`]);
  const commit = resolved.stdout.trim();
  if (!resolved.ok || commit === '') {
    return { ok: false, problem: `${ref} could not be resolved to a commit: ${gitSaid(resolved) || 'git names no such commit'}`, leftover: null };
  }

  const scratch = makeScratch(options.scratchRoot ?? tmpdir());
  if (typeof scratch !== 'string') return scratch;
  const path = join(scratch, WORKTREE_DIRECTORY);
  const added = git(['worktree', 'add', '--detach', path, commit]);
  if (!added.ok) {
    return {
      ok: false,
      problem: `no worktree of ${ref} could be added at ${path}: ${gitSaid(added)}`,
      leftover: removeScratch(git, scratch, path),
    };
  }
  return { scratch, worktree: { path, git: createGitRunner(path), remote, branch, ref, commit } };
}

/**
 * Fetches `<remote>/<branch>`, adds a detached worktree of it under a
 * fresh scratch directory, runs `body` there and removes the worktree
 * and the directory on every path out; see the module note. A git
 * failure is answered; a throw from `body` is rethrown after removal.
 */
export async function withSettleWorktree<T>(
  options: SettleWorktreeOptions,
  body: (worktree: SettleWorktree) => T | Promise<T>,
): Promise<SettleWorktreeOutcome<T>> {
  const added = addWorktree(options);
  if ('ok' in added) return added;
  const { scratch, worktree } = added;

  let value: T;
  try {
    value = await body(worktree);
  } catch (error) {
    const leftover = removeScratch(options.git, scratch, worktree.path);
    if (leftover === null) throw error;
    throw new Error(`${messageOf(error)}; and removing the settle worktree left ${leftover}`, { cause: error });
  }
  const leftover = removeScratch(options.git, scratch, worktree.path);
  return { ok: true, value, ref: worktree.ref, commit: worktree.commit, leftover };
}
