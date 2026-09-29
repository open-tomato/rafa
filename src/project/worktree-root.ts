/**
 * The MAIN CHECKOUT of the repository a directory sits in: the working
 * tree `git worktree list` names first, which owns the project's
 * `.rafa/` when the directory is a linked worktree beside it or under
 * it. {@link mainCheckoutOf} answers it, or null when no repository
 * holds the directory.
 *
 * ## The reading
 *
 * {@link mainCheckoutOf} runs `git worktree list --porcelain -z` in the
 * directory and answers the path on the first record's `worktree` line.
 * Git always lists the main working tree first, whichever worktree the
 * command runs in, so a linked worktree, the main checkout itself and a
 * directory nested in either all answer the same path. `-z` ends every
 * line with a NUL rather than a newline, so a path holding a newline
 * is read whole.
 *
 * Measured with Apple Git 2.50.1 on macOS (2026-09-29), in a scratch
 * repository under `mktemp -d` with one worktree beside it and one
 * under its `.rafa/worktrees`:
 *
 *   - The first record is the main checkout from the main checkout and
 *     from both linked worktrees.
 *   - The path is a REAL path: the repository was entered as
 *     `/var/folders/...` and git printed `/private/var/folders/...`.
 *     So the answer compares with the real paths `scope.ts` walks, and
 *     this module follows no link itself.
 *   - A bare repository's first record is its own directory with a
 *     `bare` line and no `HEAD`. A bare repository has no main
 *     checkout to hold a `.rafa/`, so it answers null.
 *   - Outside any repository git prints {@link NOT_A_REPOSITORY}'s line
 *     and exits 128, answered as null.
 *
 * Any other failure, a git that cannot run included, is a
 * {@link WorktreeRootError} and never an answer of "no repository", as
 * `gitToplevel` in `roots.ts` treats the same line.
 *
 * ## Seams
 *
 * The directory is refused unless it is absolute, since running git in
 * a relative one would read the process's working directory. Git is
 * reached through a {@link GitRunner} opened for the directory,
 * `createGitRunner` from `src/pr/git.ts` when left out, which already
 * sets `LC_ALL=C` so the refusal line matched is git's untranslated one.
 */
import type { GitResult, GitRunner } from '../pr/git.js';

import { isAbsolute } from 'node:path';

import { createGitRunner, gitSaid } from '../pr/git.js';

/**
 * The start of the line git prints when no directory at or above holds
 * a repository, as `git rev-parse` and `git worktree list` both print
 * it. Defined here rather than in `roots.ts`, which re-exports it, so
 * this module imports nothing from `roots.ts`: `scope.ts` imports this
 * module and `roots.ts` imports `scope.ts`, and the cycle through them
 * left `SCOPE_DIR` uninitialised when `roots.ts` evaluated.
 */
export const NOT_A_REPOSITORY = 'fatal: not a git repository (or any ';

/** The argv, after `git`, that lists the worktrees NUL-terminated. */
export const WORKTREE_LIST_ARGS = Object.freeze(['worktree', 'list', '--porcelain', '-z'] as const);

/** The prefix of the porcelain line naming a worktree's path. */
const WORKTREE_PREFIX = 'worktree ';

/** The porcelain line marking a bare repository's record. */
const BARE_LINE = 'bare';

/** What {@link mainCheckoutOf} reads beside the directory. */
export interface WorktreeRootSeams {
  /** Opens the git runner for a directory. `createGitRunner` when absent. */
  readonly openGit?: (dir: string) => GitRunner;
}

/** A directory this module cannot begin from, or a git that cannot answer. */
export class WorktreeRootError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(`rafa worktree root: ${message}`, options);
    this.name = 'WorktreeRootError';
  }
}

/**
 * The lines of the first record of `git worktree list --porcelain -z`:
 * every line up to the first empty one, which ends a record.
 */
function firstRecordOf(stdout: string): readonly string[] {
  const lines = stdout.split('\0');
  const end = lines.indexOf('');
  return end === -1
    ? lines
    : lines.slice(0, end);
}

/** The main checkout named by a successful listing, or null for a bare repository. */
function readListing(dir: string, stdout: string): string | null {
  const record = firstRecordOf(stdout);
  const head = record[0];
  if (head === undefined || !head.startsWith(WORKTREE_PREFIX)) {
    throw new WorktreeRootError(`git worktree list in ${dir} printed no worktree line first`);
  }
  if (record.includes(BARE_LINE)) return null;
  return head.slice(WORKTREE_PREFIX.length);
}

/** Refuses a failed listing unless git said no repository holds the directory. */
function readFailure(dir: string, result: GitResult): null {
  if (result.stderr.startsWith(NOT_A_REPOSITORY)) return null;
  throw new WorktreeRootError(`git worktree list failed in ${dir}: ${gitSaid(result)}`);
}

/**
 * The main checkout of the repository holding `dir`, an absolute path:
 * the first worktree `git worktree list --porcelain -z` names, a real
 * path. The same for a linked worktree, the main checkout itself and
 * any directory under either. Null when no repository holds `dir` and
 * for a bare repository, which has no main checkout.
 *
 * Throws a {@link WorktreeRootError} for a relative `dir`, for a git
 * that cannot run or fails any other way, and for a listing whose first
 * line names no worktree. See the module note.
 */
export function mainCheckoutOf(dir: string, seams: WorktreeRootSeams = {}): string | null {
  if (!isAbsolute(dir)) {
    throw new WorktreeRootError(`directory ${JSON.stringify(dir)} is not an absolute path`);
  }
  const git = (seams.openGit ?? createGitRunner)(dir);
  const result = git(WORKTREE_LIST_ARGS);
  return result.ok
    ? readListing(dir, result.stdout)
    : readFailure(dir, result);
}
