/**
 * A printed step placed where it must run: the command alone when the
 * reader already stands in the checkout it needs, and
 * `cd <checkout> && <command>` when they do not.
 *
 * A step a command prints after its own run is a line the reader
 * copies or clicks, and it runs in the directory the command ran in.
 * When that directory's git top level is the checkout the step needs,
 * a `cd` in front would be noise; when it is another one, the step
 * without it runs in the wrong checkout. So the line carries the `cd`
 * exactly when the two differ.
 *
 * The helper knows nothing of the subject whose steps it places. The
 * caller names the command, the checkout it must run in, and two seams:
 * the top-level read of the directory the command ran in
 * ({@link readTopLevel} over a {@link GitRunner} is the reading a
 * caller passes in production) and the check that a path is there.
 *
 * ## The three readings that are not "the same place"
 *
 *   - A different top level: the prefix.
 *   - A top-level read git did not answer (not a repository, git not
 *     spawned): the prefix too. The line then runs wherever it is
 *     clicked, which is the point of the prefix, and leaving it out
 *     would bet the step on a place nobody read.
 *   - A checkout path that is not there, as `git worktree list` still
 *     lists a worktree whose folder was removed: no line at all. The
 *     answer is `unplaced`, and the caller prints its own fallback, such
 *     as a `git switch` to the branch, since a `cd` into a missing
 *     folder fails before the command runs.
 *
 * The missing path is checked first, so a missing checkout answers
 * `unplaced` whatever the top level reads.
 *
 * ## How two paths are compared
 *
 * Both are compared after `path.resolve`, which drops a trailing slash
 * and `.` segments, and nothing more: no symlink is followed. Git
 * prints both the top level (`git rev-parse --show-toplevel`) and the
 * worktree paths (`git worktree list --porcelain`) with symlinks
 * resolved, so two readings of git agree without it. A checkout that is
 * not plain shell text is quoted with {@link shellQuote}.
 */
import type { GitRunner } from './git.js';

import { resolve } from 'node:path';

import { shellQuote } from '../../utils/shell.js';

/** The seams {@link placeLine} reads the two places through. */
export interface PlaceSeams {
  /**
   * The git top level of the directory the command ran in, or null when
   * git did not answer.
   */
  readonly readTopLevel: () => string | null;
  /** True when `path` is there on disk. */
  readonly pathExists: (path: string) => boolean;
}

/** The line a step prints, placed where it must run. */
export interface PlacedLine {
  readonly kind: 'placed';
  /** The command alone, or `cd <checkout> && <command>`. */
  readonly line: string;
}

/** No line: the checkout is not there, so the caller prints its own fallback. */
export interface UnplacedLine {
  readonly kind: 'unplaced';
  /** The checkout path that was not there. */
  readonly checkout: string;
}

/** What {@link placeLine} answers. */
export type PlaceAnswer = PlacedLine | UnplacedLine;

/** What joins the `cd` to the command it places. */
const CD_JOIN = ' && ';

/**
 * `command` placed to run in `checkout`; see the module note.
 *
 * @param command - The command as the reader would type it in the checkout.
 * @param checkout - The checkout the command must run in.
 * @param seams - The top-level read and the path check.
 * @returns The placed line, or `unplaced` when `checkout` is not there.
 */
export function placeLine(command: string, checkout: string, seams: PlaceSeams): PlaceAnswer {
  if (!seams.pathExists(checkout)) return { kind: 'unplaced', checkout };
  const topLevel = seams.readTopLevel();
  if (topLevel !== null && resolve(topLevel) === resolve(checkout)) return { kind: 'placed', line: command };
  return { kind: 'placed', line: `cd ${shellQuote(checkout)}${CD_JOIN}${command}` };
}

/**
 * The git top level of the directory `git` was made for, read with
 * `git rev-parse --show-toplevel`, or null when git did not answer or
 * printed nothing.
 *
 * @param git - The runner of the directory the command ran in.
 * @returns The top level's absolute path, or null.
 */
export function readTopLevel(git: GitRunner): string | null {
  const answer = git(['rev-parse', '--show-toplevel']);
  if (!answer.ok) return null;
  const path = answer.stdout.trim();
  return path === ''
    ? null
    : path;
}
