/**
 * The plan's commits, as the kind check reads them: the plan's base, the
 * merge base of `HEAD` and `origin/<base>` ({@link readPlanBase}), and
 * the plan's files, the paths `git diff --name-only` names between that
 * base and `HEAD` ({@link readPlanFiles}). The kind check
 * (`./own-check.ts`) runs a named test on the base and reads a named
 * file against the files.
 *
 * Git is reached through a `GitRunner` (`../core/git/git.ts`), so a unit
 * test stubs it or hands it a temporary repository. Neither reading
 * throws: a ref git does not know, a branch sharing no history with the
 * base and a git that cannot run are each a reading with a `problem`
 * sentence, which the check reads as a base it cannot run on.
 *
 * **The base is read through its remote-tracking ref,**
 * `refs/remotes/origin/<base>`, never the bare name `origin/<base>`, so
 * a local branch or tag of a colliding name is never taken for it.
 *
 * **The files are read with `-z`,** so a path holding a space or a
 * character past ASCII comes back as written, not quoted as
 * `core.quotePath` would quote it.
 *
 * ## What git said, as measured
 *
 * On git 2.53.0 under Linux with `LC_ALL=C` (2026-10-14): `merge-base`
 * naming an absent ref exited 128 with `fatal: Not a valid object name
 * <ref>`; `merge-base` of two commits with no shared history exited 1
 * writing nothing; `diff --name-only <rev> HEAD --` from an unknown
 * revision exited 128 with `fatal: bad revision '<rev>'`, where the same
 * diff without the `--` says `fatal: ambiguous argument …`; and
 * `diff --name-only` without `-z` wrote `ü.txt` as `"\303\274.txt"`,
 * with `-z` as the bytes themselves.
 */
import type { GitRunner } from '../core/git/index.js';

import { gitSaid } from '../core/git/index.js';

/** The remote the plan's base is read from. */
const REMOTE = 'origin';

/** What {@link readPlanBase} read. */
export type PlanBaseReading =
  /** `sha` is the merge base of `HEAD` and `origin/<base>`. */
  | { readonly ok: true; readonly base: string; readonly sha: string }
  /** No merge base was read; `problem` is one sentence saying why. */
  | { readonly ok: false; readonly base: string; readonly problem: string };

/** What {@link readPlanFiles} read. */
export type PlanFilesReading =
  /** The paths changed between the plan's base and `HEAD`, in git's order. */
  | { readonly ok: true; readonly files: readonly string[] }
  /** No file list was read; `problem` is one sentence saying why. */
  | { readonly ok: false; readonly problem: string };

/** `text`, then what git said after a colon when it said anything. */
function saying(text: string, said: string): string {
  return said === ''
    ? text
    : `${text}: ${said}`;
}

/**
 * Reads the plan's base: the merge base of `HEAD` and the
 * remote-tracking ref of `base`. Never throws; a blank `base`, a ref git
 * does not know and no shared history each answer a `problem`.
 */
export function readPlanBase(git: GitRunner, base: string): PlanBaseReading {
  const remoteBase = `${REMOTE}/${base}`;
  if (base.trim() === '') return { ok: false, base, problem: 'No base branch was named to read the plan\'s base from.' };
  const read = git(['merge-base', 'HEAD', `refs/remotes/${remoteBase}`]);
  const sha = read.stdout.trim();
  if (read.ok && sha !== '') return { ok: true, base, sha };
  const said = gitSaid(read);
  return {
    ok: false,
    base,
    problem: said === ''
      ? `HEAD shares no history with ${remoteBase}.`
      : saying(`Could not read the merge base of HEAD and ${remoteBase}`, said),
  };
}

/**
 * Reads the plan's files: the paths `git diff --name-only` names between
 * `planBase`, the sha {@link readPlanBase} answered, and `HEAD`. Never
 * throws; a revision git does not know answers a `problem`.
 */
export function readPlanFiles(git: GitRunner, planBase: string): PlanFilesReading {
  if (planBase.trim() === '') return { ok: false, problem: 'No plan base was given to read the plan\'s files from.' };
  const read = git(['diff', '--name-only', '-z', planBase, 'HEAD', '--']);
  if (!read.ok) {
    return { ok: false, problem: saying(`Could not list the files changed between ${planBase} and HEAD`, gitSaid(read)) };
  }
  const files = read.stdout.split('\0').filter((path) => path !== '');
  return { ok: true, files };
}
