/**
 * Where a run works, settled once the plan file is known to exist: the
 * project root, the checkout (`./checkout.ts` says which is which) and
 * the branch the guard reads and the session record names.
 *
 * Two routes, chosen by the words of the run's line alone:
 *
 *  - Without `--as-worktree` the checkout is the working tree the run
 *    was started in ({@link resolveRunDirs}), and the branch is the one
 *    it stands on, or the plan's own once the offer made on `main` or
 *    `master` has been taken ({@link resolveRunBranch}). This is the
 *    route every run took before the flag existed, unchanged.
 *  - Under `--as-worktree` the plan's `feat/<stub>` is added as a linked
 *    worktree at `loop.worktreeDir/<stub>` ({@link addRunWorktree}), or
 *    the worktree an earlier start left there on that branch is reused,
 *    and THAT worktree is the checkout: every git command the loop runs, each
 *    task's commit, the wrap-up, the release and the CI gate, and every
 *    session the run spawns, run there. The branch is the worktree's.
 *    No offer is made and nothing is asked, since the flag is the answer,
 *    and the main checkout is never switched.
 *
 * The project root is the same on both routes: the one the dispatcher
 * resolved, holding `.rafa/`. So a worktree run still reads its config,
 * plan and tracker there, writes its session record and its store rows
 * there, and serves each session from there — the run's served
 * directory is `.rafa/runs/<session-id>/served/` under the main
 * checkout (`./serving.ts`), and the project tier is read from the main
 * checkout's `.claude/` — while the session itself starts in the
 * worktree, which holds no `.rafa/` of its own (`.rafa/` is gitignored,
 * and a tracked one refuses the flag first, `./run-setup.ts`).
 *
 * ## The base
 *
 * Under `--as-worktree` the base the worktree's branch is cut from is
 * the run's base, `resolveBaseBranch` over git in the project root:
 * `pr.base` when it is set, else the branch `origin/HEAD` names, else
 * the default base. It is the reading the wrap-up makes for the pull
 * request (`./wrap-up-run.ts`), so the branch is cut from the base it
 * is later merged into. The reading is the `base` seam.
 *
 * The branch checked out where the run was started is NOT the base. It
 * was once: a run started on a branch `origin` had not got then fetched
 * a ref that was not there, and one started on a detached HEAD handed
 * on the word `HEAD` as a branch (issues #864 and #595). The flag
 * switches nothing in the started checkout, so that checkout's branch
 * says nothing about where the plan's branch belongs. It is still read,
 * with `readCheckedOutBranch`, which answers null on a detached HEAD,
 * for one purpose: when it is not the base, one info line names the
 * base, where the base was read from and what the run was started on
 * ({@link baseLine}). Started on the base, nothing is printed. A
 * detached HEAD is therefore no case of its own on this route.
 *
 * A branch that already exists is not cut again: the base is fetched
 * and merged into it when it holds only claim commits, and a branch
 * with other work on it that is behind the base is only reported
 * (`./worktree.ts`).
 *
 * Without the flag none of this is read: the run's branch, and the base
 * the offer is made on, is what `getCurrentBranch` answers in the
 * started checkout.
 *
 * Every refusal on the way — a checkout git could not read, a branch
 * offer that could not be taken, a worktree git would not add — is the
 * `CommandExit` the module it comes from throws, passed through as is.
 */
import type { RunDirs } from './checkout.js';
import type { RunBranchRequest } from './run-setup.js';
import type { WorktreeOutcome, WorktreeRequest } from './worktree.js';

import { activeOutput } from '../adapters/output/active.js';
import { resolveBaseBranch } from '../cleanup/index.js';
import { createGitRunner } from '../pr/git.js';
import { getCurrentBranch, readCheckedOutBranch } from '../utils/git.js';

import { resolveRunDirs } from './checkout.js';
import { AS_WORKTREE_FLAG, resolveRunBranch } from './run-setup.js';
import { addRunWorktree } from './worktree.js';

/** What the run settles its checkout from. */
export interface RunCheckoutRequest {
  /** The project root the dispatcher resolved, which holds `.rafa/`. */
  readonly projectRoot: string;
  /** `loop.worktreeDir` as the config holds it, read under `--as-worktree` only. */
  readonly worktreeDir: string;
  /** `pr.base` as the config holds it, null when unset, read under `--as-worktree` only. */
  readonly prBase: string | null;
  /** The plan's stub, or null when the plan path gave none. */
  readonly planStub: string | null;
  /** The words of the run's line. */
  readonly args: readonly string[];
}

/** The run's two directories and the branch its checkout is on. */
export interface RunCheckout extends RunDirs {
  /** The branch the guard reads and the session record names. */
  readonly branch: string;
}

/** How the settling reaches git; each defaults to the module the run uses. */
export interface RunCheckoutSeams {
  /** The run's directories before any worktree. `resolveRunDirs` when absent. */
  readonly dirs?: (projectRoot: string) => RunDirs;
  /** The branch checked out in a directory, read without `--as-worktree`. `getCurrentBranch` when absent. */
  readonly currentBranch?: (dir: string) => string;
  /**
   * The branch checked out in a directory, null on a detached HEAD, read
   * under `--as-worktree` for the base line alone. `readCheckedOutBranch`
   * when absent.
   */
  readonly checkedOutBranch?: (dir: string) => string | null;
  /**
   * The base under `--as-worktree`, from the project root and `pr.base`.
   * `resolveBaseBranch` over git in that root when absent.
   */
  readonly base?: (projectRoot: string, prBase: string | null) => string;
  /** The branch offer on the base. `resolveRunBranch` when absent. */
  readonly offer?: (request: RunBranchRequest) => Promise<string>;
  /** The worktree `--as-worktree` adds. `addRunWorktree` when absent. */
  readonly worktree?: (request: WorktreeRequest) => WorktreeOutcome;
}

/** Where the base is read from when `pr.base` is unset, as the base line names it. */
const REMOTE_HEAD_SOURCE = 'origin/HEAD (the default when it names none)';

/** Where the base is read from when `pr.base` is set, as the base line names it. */
const PR_BASE_SOURCE = 'pr.base';

/** The run's base as `resolveBaseBranch` reads it in the project root. */
function readBase(projectRoot: string, prBase: string | null): string {
  return resolveBaseBranch(createGitRunner(projectRoot), prBase);
}

/**
 * The line a worktree run prints when it was started somewhere other
 * than on its base: the base, where it was read from, and the branch the
 * run was started on, `startedOn`, null standing for a detached HEAD.
 */
function baseLine(base: string, prBase: string | null, startedOn: string | null): string {
  const source = prBase === null
    ? REMOTE_HEAD_SOURCE
    : PR_BASE_SOURCE;
  const started = startedOn ?? 'a detached HEAD';
  return `\n🌿 The worktree's base is ${base}, read from ${source}, not ${started}, which the run was started on.`;
}

/**
 * Settles where the run works: the checkout it was started in and the
 * branch it stands on or was offered, or, under `--as-worktree`, the
 * worktree added for the plan's branch, cut from the run's base, and
 * that branch. The project root is `request.projectRoot` either way. See
 * the module note.
 */
export async function settleRunCheckout(
  request: RunCheckoutRequest,
  seams: RunCheckoutSeams = {},
): Promise<RunCheckout> {
  const { projectRoot, planStub, args } = request;
  const started = (seams.dirs ?? resolveRunDirs)(projectRoot);

  if (!args.includes(AS_WORKTREE_FLAG)) {
    const base = (seams.currentBranch ?? getCurrentBranch)(started.checkout);
    const branch = await (seams.offer ?? resolveRunBranch)({ checkout: started.checkout, planStub, base, args });
    return Object.freeze({ projectRoot, checkout: started.checkout, branch });
  }

  const base = (seams.base ?? readBase)(projectRoot, request.prBase);
  const startedOn = (seams.checkedOutBranch ?? readCheckedOutBranch)(started.checkout);
  if (startedOn !== base) {
    activeOutput().info(baseLine(base, request.prBase, startedOn));
  }
  const worktree = (seams.worktree ?? addRunWorktree)({
    projectRoot,
    worktreeDir: request.worktreeDir,
    planStub,
    base,
  });
  return Object.freeze({ projectRoot, checkout: worktree.path, branch: worktree.branch });
}
