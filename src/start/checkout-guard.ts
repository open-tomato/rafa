/**
 * The loop guard: whether the checkout a run works in is still on the
 * branch the run holds, at the commit the run last left it on, and what
 * the operator is told when it is not.
 *
 * The run knows two things about its checkout (`./checkout.ts`): the
 * branch it holds, and the commit HEAD should be at — the one the loop
 * itself made last, or the HEAD it started from before its first commit.
 * That pair is a {@link CheckoutExpectation}. Someone switching branches
 * in another terminal, pulling, committing by hand, or removing the
 * worktree moves the checkout under the loop, and a commit made after
 * that lands on whatever the checkout now holds. The guard reads the
 * checkout, compares, and on a move answers the {@link CHECKOUT_MOVED}
 * halt with the lines that say what moved and how to put it back.
 *
 * Nothing here switches, stashes, resets or recreates anything: a guard
 * that moved the checkout back could move one someone had just chosen to
 * move, possibly mid-edit (`.rafa/specs/rafa-370-run-loop-own-worktree.md`).
 * The restore line is printed for the operator to run, and the halt
 * itself — no commit, the task stored `[BLOCKED]`, the run stopped — is
 * the caller's.
 *
 * ## The readings, as measured
 *
 * Measured on git 2.50.1 (Apple Git-155) under macOS with `LC_ALL=C`
 * set (2026-09-29):
 *
 *  - `git symbolic-ref --quiet --short HEAD` printed `feat/x` on a branch
 *    and exited 1 printing nothing at a detached HEAD, where
 *    `git rev-parse --abbrev-ref HEAD` would print `HEAD`, a string no
 *    comparison should read as a branch. A failed read is a detached
 *    HEAD here.
 *  - `git rev-parse --verify --quiet HEAD^{commit}` printed the full
 *    commit, and in a repository with no commit yet the unquieted form
 *    exited 128 with `fatal: Needed a single revision`. A failed read is
 *    no HEAD commit, which never equals the expected one.
 *  - A worktree nested under the main checkout (`.rafa/worktrees/w`)
 *    whose `.git` file was deleted is no checkout of its own any more,
 *    yet git run inside it walked up and answered the MAIN checkout:
 *    `--show-toplevel` printed the main checkout and `symbolic-ref`
 *    printed the main checkout's branch. So the toplevel is read first
 *    and compared with the checkout's real path, and a toplevel that is
 *    not the checkout reads as {@link CheckoutReading} `foreign` rather
 *    than as a branch the operator would be told to switch — in the main
 *    checkout.
 *  - `git -C <removed dir> status` exited 128 with `fatal: cannot change
 *    to '<dir>'`. The directory is therefore checked before git is
 *    asked, and a missing one reads as `missing`.
 *
 * ## The restore line
 *
 * One command, or none when nothing git offers restores the checkout:
 *
 *  - The branch moved, and the checkout's HEAD is the commit the expected
 *    branch points at: `git switch <branch>`. The uncommitted work
 *    follows the switch, since both sides are the same commit. This is
 *    the 2026-09-29 incident's own recovery.
 *  - The branch moved and the two commits differ: `git stash push -u -m
 *    '...' && git switch <branch>`. Measured: a plain switch there
 *    refused with `error: Your local changes to the following files would
 *    be overwritten by checkout` and exited 1, while the stash and the
 *    switch after it both exited 0. The stash names the branch, so the
 *    work is found again with `git stash list`.
 *  - The expected branch no longer exists: the same, ending in
 *    `git switch -c <branch> <expected head>`, which recreates it where
 *    the loop left it.
 *  - The branch is right and HEAD moved, a commit or a reset made
 *    outside the loop: `git reset --soft <expected head>`. It puts HEAD
 *    back where the loop left it and keeps every change, the outside
 *    commit's included, in the working tree and index; the commit stays
 *    reachable from the reflog.
 *  - The checkout's directory is gone and it was a linked worktree:
 *    `git -C <project root> worktree prune && git -C <project root>
 *    worktree add <checkout> <branch>`. Measured: re-adding without the
 *    prune exited 128 with `'<path>' is a missing but already registered
 *    worktree`, and with it exited 0 on the branch. The uncommitted work
 *    went with the directory; this only gives the branch its checkout
 *    back.
 *  - The project root itself is gone, or the directory is no checkout of
 *    its own (`foreign`): no line. `git worktree repair` on the deleted
 *    `.git` case above exited 1 with `.git file broken`, so it is not
 *    offered.
 *
 * Every word of a restore line is quoted by `shellQuote`
 * (`../pr/preflight-items.ts`) when a shell would not take it as it
 * stands.
 */
import type { GitRunner } from '../pr/index.js';

import { existsSync, realpathSync } from 'node:fs';

import { createGitRunner } from '../pr/index.js';
import { shellQuote } from '../pr/preflight-items.js';

/** The reason a halted task is stored with, and its `[BLOCKED]` blocker text. */
export const CHECKOUT_MOVED = 'checkout moved';

/** The indent a line under the halt's headline carries, as `./budget.ts` indents its own. */
const INDENT = '   ';

/** How many characters of a commit the message shows. */
const SHORT_COMMIT = 12;

/** What the run holds its checkout to; see the module note. */
export interface CheckoutExpectation {
  /** The main checkout, owner of `.rafa/`, where a removed worktree is re-added from. */
  readonly projectRoot: string;
  /** The working tree the loop's git commands and sessions run in. */
  readonly checkout: string;
  /** The branch the run holds. */
  readonly branch: string;
  /** The full commit HEAD should be at: the loop's last commit, or its starting HEAD. */
  readonly head: string;
}

/** What the checkout held when it was read. */
export type CheckoutReading =
  | {
    /** The checkout's directory does not exist. */
    readonly kind: 'missing';
  }
  | {
    /** The directory exists but is no git checkout of its own. */
    readonly kind: 'foreign';
    /** The toplevel git answered from inside it, or null when git answered none. */
    readonly toplevel: string | null;
  }
  | {
    readonly kind: 'read';
    /** The branch checked out, or null at a detached HEAD. */
    readonly branch: string | null;
    /** The full HEAD commit, or null when there is none. */
    readonly head: string | null;
  };

/** Why the checkout does not match its expectation. */
export type CheckoutMove = 'missing' | 'foreign' | 'branch' | 'head';

/** What {@link guardCheckout} answered. */
export type CheckoutGuardVerdict =
  | { readonly held: true }
  | {
    readonly held: false;
    readonly move: CheckoutMove;
    readonly reading: CheckoutReading;
    /** The halt's lines, headline first, ready to print one by one. */
    readonly lines: readonly string[];
  };

/** How the guard reaches the disk and git. */
export interface CheckoutGuardSeams {
  /** The git runner for a directory. `createGitRunner` when left out. */
  readonly git?: (dir: string) => GitRunner;
  /** The real path of a directory, or null when it does not exist. {@link realDirOf} when left out. */
  readonly realDir?: (path: string) => string | null;
}

/** The real path of `path`, or null when nothing is there. */
export function realDirOf(path: string): string | null {
  if (!existsSync(path)) return null;
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

/** The first line git printed, trimmed, or null when it failed or printed nothing. */
function firstLine(git: GitRunner, args: readonly string[]): string | null {
  const result = git(args);
  if (!result.ok) return null;
  const line = result.stdout.split('\n')[0]?.trim() ?? '';
  return line === ''
    ? null
    : line;
}

/**
 * Reads what the checkout at `checkout` holds: gone, no checkout of its
 * own, or its branch and HEAD. Never throws. See the module note for the
 * three git reads and why the toplevel comes first.
 */
export function readCheckout(checkout: string, seams: CheckoutGuardSeams = {}): CheckoutReading {
  const realDir = (seams.realDir ?? realDirOf)(checkout);
  if (realDir === null) return { kind: 'missing' };

  const git = (seams.git ?? createGitRunner)(checkout);
  const toplevel = firstLine(git, ['rev-parse', '--show-toplevel']);
  if (toplevel === null || toplevel !== realDir) return { kind: 'foreign', toplevel };

  return {
    kind: 'read',
    branch: firstLine(git, ['symbolic-ref', '--quiet', '--short', 'HEAD']),
    head: firstLine(git, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']),
  };
}

/**
 * How `reading` differs from `expected`, or null when the checkout is
 * where the run left it. A moved branch is named before a moved HEAD,
 * since switching back is what restores the rest.
 */
export function compareCheckout(expected: Pick<CheckoutExpectation, 'branch' | 'head'>, reading: CheckoutReading): CheckoutMove | null {
  if (reading.kind !== 'read') return reading.kind;
  if (reading.branch !== expected.branch) return 'branch';
  if (reading.head !== expected.head) return 'head';
  return null;
}

/** A commit as the message shows it. */
function shortCommit(commit: string): string {
  return commit.slice(0, SHORT_COMMIT);
}

/** What the checkout was found holding, as the message names it. */
function foundText(reading: CheckoutReading, checkout: string): string {
  if (reading.kind === 'missing') return `no checkout: ${checkout} does not exist`;
  if (reading.kind === 'foreign') {
    return reading.toplevel === null
      ? `no git checkout at ${checkout}`
      : `no checkout of its own: git answers ${reading.toplevel} from inside ${checkout}`;
  }
  const at = reading.head === null
    ? 'no commit'
    : shortCommit(reading.head);
  return reading.branch === null
    ? `a detached HEAD at ${at}`
    : `${reading.branch} at ${at}`;
}

/** The inputs of {@link restoreLine}: the expectation, the reading, and the expected branch's tip. */
export interface RestoreInput {
  readonly expected: CheckoutExpectation;
  readonly move: CheckoutMove;
  readonly reading: CheckoutReading;
  /** The commit the expected branch points at now, or null when it no longer exists. */
  readonly branchTip: string | null;
}

/** The stash that keeps the work before a switch between two different commits. */
function stashCommand(branch: string): string {
  return `git stash push -u -m ${shellQuote(`rafa: ${CHECKOUT_MOVED} off ${branch}`)}`;
}

/** The restore line for a moved branch; see the module note. */
function switchBack(expected: CheckoutExpectation, found: string | null, branchTip: string | null): string {
  const branch = shellQuote(expected.branch);
  if (branchTip === null) {
    const recreate = `git switch -c ${branch} ${expected.head}`;
    return found === expected.head
      ? recreate
      : `${stashCommand(expected.branch)} && ${recreate}`;
  }
  return found === branchTip
    ? `git switch ${branch}`
    : `${stashCommand(expected.branch)} && git switch ${branch}`;
}

/**
 * The one command that puts the checkout back where the run expects it,
 * or null when git offers none. Pure; see the module note for each case.
 */
export function restoreLine(input: RestoreInput): string | null {
  const { expected, move, reading, branchTip } = input;
  if (move === 'foreign') return null;
  if (move === 'missing') {
    if (expected.checkout === expected.projectRoot) return null;
    const root = shellQuote(expected.projectRoot);
    return `git -C ${root} worktree prune && git -C ${root} worktree add ${shellQuote(expected.checkout)} ${shellQuote(expected.branch)}`;
  }
  if (move === 'head') return `git reset --soft ${expected.head}`;
  const found = reading.kind === 'read'
    ? reading.head
    : null;
  return switchBack(expected, found, branchTip);
}

/**
 * The halt's lines: the headline naming {@link CHECKOUT_MOVED}, the
 * expected branch and commit, what was found, the restore line or the
 * reason there is none, and that the work was left in place. Pure.
 */
export function checkoutMovedLines(input: RestoreInput): readonly string[] {
  const { expected, reading } = input;
  const restore = restoreLine(input);
  return Object.freeze([
    `⛔ Run halted: ${CHECKOUT_MOVED} in ${expected.checkout}. Nothing was committed.`,
    `${INDENT}Expected: ${expected.branch} at ${shortCommit(expected.head)}`,
    `${INDENT}Found:    ${foundText(reading, expected.checkout)}`,
    restore === null
      ? `${INDENT}No git command restores it; the loop did not touch it.`
      : `${INDENT}Restore:  ${restore}`,
    `${INDENT}Uncommitted work was left where it is; the checkout was not switched back.`,
  ]);
}

/**
 * Reads the checkout, compares it with `expected`, and answers held, or
 * the move with the halt's lines. On a moved branch it reads the
 * expected branch's tip as well, which picks the restore line. Never
 * throws and never changes the checkout.
 */
export function guardCheckout(expected: CheckoutExpectation, seams: CheckoutGuardSeams = {}): CheckoutGuardVerdict {
  const reading = readCheckout(expected.checkout, seams);
  const move = compareCheckout(expected, reading);
  if (move === null) return { held: true };

  const branchTip = move === 'branch'
    ? firstLine((seams.git ?? createGitRunner)(expected.checkout), ['rev-parse', '--verify', '--quiet', `refs/heads/${expected.branch}^{commit}`])
    : null;
  return { held: false, move, reading, lines: checkoutMovedLines({ expected, move, reading, branchTip }) };
}
