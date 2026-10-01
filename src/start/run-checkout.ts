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
 * The base the worktree's branch is cut from is the branch checked out
 * where the run was started, read as `--create-branch` reads it, so a
 * run started on `main` cuts `feat/<stub>` from a freshly fetched
 * `origin/main`. Unlike `--create-branch`, which acts on `main` and
 * `master` alone, the flag acts on any base: it switches nothing, so
 * there is no base it would be unsafe to leave. A branch that already
 * exists is taken as it stands, and the base, though read, cuts nothing
 * (`./worktree.ts`).
 *
 * Every refusal on the way — a checkout git could not read, a branch
 * offer that could not be taken, a worktree git would not add — is the
 * `CommandExit` the module it comes from throws, passed through as is.
 */
import type { RunDirs } from './checkout.js';
import type { RunBranchRequest } from './run-setup.js';
import type { WorktreeOutcome, WorktreeRequest } from './worktree.js';

import { getCurrentBranch } from '../utils/git.js';

import { resolveRunDirs } from './checkout.js';
import { AS_WORKTREE_FLAG, resolveRunBranch } from './run-setup.js';
import { addRunWorktree } from './worktree.js';

/** What the run settles its checkout from. */
export interface RunCheckoutRequest {
  /** The project root the dispatcher resolved, which holds `.rafa/`. */
  readonly projectRoot: string;
  /** `loop.worktreeDir` as the config holds it, read under `--as-worktree` only. */
  readonly worktreeDir: string;
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
  /** The branch checked out in a directory. `getCurrentBranch` when absent. */
  readonly currentBranch?: (dir: string) => string;
  /** The branch offer on the base. `resolveRunBranch` when absent. */
  readonly offer?: (request: RunBranchRequest) => Promise<string>;
  /** The worktree `--as-worktree` adds. `addRunWorktree` when absent. */
  readonly worktree?: (request: WorktreeRequest) => WorktreeOutcome;
}

/**
 * Settles where the run works: the checkout it was started in and the
 * branch it stands on or was offered, or, under `--as-worktree`, the
 * worktree added for the plan's branch and that branch. The project root
 * is `request.projectRoot` either way. See the module note.
 */
export async function settleRunCheckout(
  request: RunCheckoutRequest,
  seams: RunCheckoutSeams = {},
): Promise<RunCheckout> {
  const { projectRoot, planStub, args } = request;
  const started = (seams.dirs ?? resolveRunDirs)(projectRoot);
  const base = (seams.currentBranch ?? getCurrentBranch)(started.checkout);

  if (!args.includes(AS_WORKTREE_FLAG)) {
    const branch = await (seams.offer ?? resolveRunBranch)({ checkout: started.checkout, planStub, base, args });
    return Object.freeze({ projectRoot, checkout: started.checkout, branch });
  }

  const worktree = (seams.worktree ?? addRunWorktree)({
    projectRoot,
    worktreeDir: request.worktreeDir,
    planStub,
    base,
  });
  return Object.freeze({ projectRoot, checkout: worktree.path, branch: worktree.branch });
}
