/**
 * The two directories a loop run works in, never confused.
 *
 *   - The PROJECT ROOT holds `.rafa/`: the config, the plans and their
 *     trackers, the session records under `.rafa/runs`, the effort store
 *     and the triage trackers. It is the root the dispatcher resolved
 *     from the nearest `.rafa/config.yaml` (`project/scope.ts`), which
 *     from a linked worktree with no `.rafa/` of its own is the main
 *     checkout's.
 *   - The CHECKOUT is the working tree the loop's git commands and its
 *     `claude -p` sessions run in: the branch is read, offered and
 *     guarded there, each task session edits it, each task's work is
 *     committed in it, and the wrap-up, the release and the CI repair
 *     sessions run in it too.
 *
 * {@link resolveRunDirs} answers both, once, before the run reads its
 * branch. Under `--as-worktree` the checkout it answers is only where
 * the base is read: `run-checkout.ts` then adds the plan's worktree and
 * makes THAT the run's checkout, with the same project root.
 *
 * ## Which checkout
 *
 * The checkout is the working tree the loop was started in: the git
 * toplevel of the process's working directory. That is the project
 * root itself for a loop started anywhere in the main checkout, which
 * is where every loop ran before a worktree could be its checkout. It is
 * a linked worktree's own directory for a loop started in that worktree,
 * whether it sits beside the repository or under it (a Claude Code
 * worktree under `.claude/worktrees`, say): the walk to `.rafa/` then
 * ends in the main checkout, and a run that took the project root as
 * its checkout too would switch, edit and commit the main checkout while
 * the person who started it stood in the worktree.
 *
 * So the toplevel is taken only when it belongs to the project's own
 * repository: the same directory as the project root, or a working tree
 * whose main checkout (`project/worktree-root.ts`) is the project root's
 * main checkout. Anything else — a working directory in no repository,
 * or in a repository nested inside the project that is not one of its
 * worktrees — answers the project root, as a run did before this module.
 *
 * ## Refusals
 *
 * A git that cannot answer, which `gitToplevel` and `mainCheckoutOf`
 * throw for rather than answer "no repository", refuses the run with
 * exit code 1 and the reading's own message, as every refusal before the
 * session record is thrown (`cli/command.ts`).
 */
import type { GitToplevelProbe } from '../project/roots.js';

import { activeOutput } from '../adapters/output/active.js';
import { CommandExit } from '../cli/command.js';
import { messageOf } from '../config-sections.js';
import { gitToplevel } from '../project/roots.js';
import { mainCheckoutOf } from '../project/worktree-root.js';

/** The two directories of one run; see the module note. */
export interface RunDirs {
  /** The directory holding `.rafa/`. */
  readonly projectRoot: string;
  /** The working tree git runs in and every session is spawned in. */
  readonly checkout: string;
}

/** What {@link resolveRunDirs} reads beside the project root. */
export interface RunDirsSeams {
  /** The directory the loop was started in. `process.cwd()` when absent. */
  readonly cwd?: string;
  /** The git toplevel above a directory. `gitToplevel` when absent. */
  readonly toplevel?: GitToplevelProbe;
  /** The main checkout of a directory's repository. `mainCheckoutOf` when absent. */
  readonly mainCheckout?: (dir: string) => string | null;
}

/** Whether `toplevel` is a working tree of the repository `projectRoot` is in. */
function sameRepository(toplevel: string, projectRoot: string, mainCheckout: (dir: string) => string | null): boolean {
  if (toplevel === projectRoot) return true;
  const main = mainCheckout(toplevel);
  return main !== null && main === mainCheckout(projectRoot);
}

/**
 * The run's project root and checkout: `projectRoot` as the dispatcher
 * resolved it, and the git toplevel of the working directory when that
 * is a working tree of the same repository, else `projectRoot` again.
 * Throws a {@link CommandExit} with exit code 1 when git cannot answer.
 * See the module note.
 */
export function resolveRunDirs(projectRoot: string, seams: RunDirsSeams = {}): RunDirs {
  const cwd = seams.cwd ?? process.cwd();
  const readToplevel = seams.toplevel ?? gitToplevel;
  const mainCheckout = seams.mainCheckout ?? mainCheckoutOf;
  try {
    const toplevel = readToplevel(cwd);
    const checkout = toplevel !== null && sameRepository(toplevel, projectRoot, mainCheckout)
      ? toplevel
      : projectRoot;
    return { projectRoot, checkout };
  } catch (error) {
    throw new CommandExit(1, `❌ Refusing to start: the checkout the loop would run in could not be read from ${cwd}: ${messageOf(error)}`);
  }
}

/**
 * Names the checkout when it is not the project root, so a run started
 * in a linked worktree says where it commits and where `.rafa/` is read.
 * Prints nothing when the two are one directory.
 */
export function announceRunDirs(dirs: RunDirs): void {
  if (dirs.checkout === dirs.projectRoot) return;
  activeOutput().info(`🌿 Running in the checkout ${dirs.checkout}; config, plans, runs and the store are read under ${dirs.projectRoot}.`);
}
