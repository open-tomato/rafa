/**
 * The first file of the project a text names (#951): the frame of a
 * stack, or the path in an error line, that a bug's package is read
 * from.
 *
 * A path is a run of steps ending in an extension, with an optional
 * `file://` ahead of it and whatever follows the extension, a `:line:col`
 * among it, left out. Each one found is resolved against the project
 * root and passed over when it lies outside the root, under
 * `node_modules`, or names nothing on disk: a dependency's frame is not
 * where the project's bug is, and a path that is not there is a word
 * that looked like one.
 *
 * It reads the text as written, so a caller reads the path BEFORE it
 * takes local paths out of the text.
 */
import type { PackageFileSystem } from '../project/package-of.js';

import { relative, resolve, sep } from 'node:path';

import { DISK_PACKAGE_FILE_SYSTEM, isInside } from '../project/package-of.js';

/**
 * A file path at the start of a text: an optional `file://`, then steps
 * ending in an extension. It is anchored, so one attempt reads one run:
 * the same pattern unanchored was tried from every character of a long
 * run and took quadratic time on one (CodeQL js/polynomial-redos).
 */
const PATH_AT_START = /^(?:file:\/\/)?((?:\.{0,2}\/)?[\w@.+~-]+(?:\/[\w@.+~-]+)*\.[A-Za-z0-9]+)/;

/** A character a path's step holds. */
const STEP_CHARACTER = /[\w@.+~-]/;

/** The scheme a path may open with. */
const FILE_SCHEME = 'file://';

/** Where the steps that start at `from` end: past each step character, and each `/` with one after it. */
function stepsEnd(text: string, from: number): number {
  let end = from;
  while (end < text.length && (STEP_CHARACTER.test(text.charAt(end))
    || (text.charAt(end) === '/' && STEP_CHARACTER.test(text.charAt(end + 1))))) end += 1;
  return end;
}

/**
 * Where the next path may start once none starts at `at`. A start inside
 * the same steps holds no extension the steps from `at` lack, so every
 * such start fails too and the scan goes on at their end, or at a
 * `file://` just before it, whose `:` is what ends them.
 */
function nextStart(text: string, at: number): number {
  if (!STEP_CHARACTER.test(text.charAt(at))) return at + 1;
  const end = stepsEnd(text, at);
  const scheme = end - 'file'.length;
  return scheme > at && text.startsWith(FILE_SCHEME, scheme)
    ? scheme
    : end;
}

/**
 * Every path in `text`, in order, as a global match of the unanchored
 * pattern answers them: the first at the leftmost start that holds one,
 * the next from where it ends. It reads the text in linear time.
 */
function pathsIn(text: string): readonly string[] {
  const paths: string[] = [];
  let at = 0;
  while (at < text.length) {
    const match = PATH_AT_START.exec(text.slice(at));
    if (match === null) {
      at = nextStart(text, at);
    } else {
      paths.push(match[1] ?? '');
      at += match[0].length;
    }
  }
  return paths;
}

/** The directory whose files are never the project's own. */
const DEPENDENCIES = `${sep}node_modules${sep}`;

/**
 * The first path in `text` that is a file of the project under `root`,
 * relative to the root, or null when it names none. See the module note.
 */
export function firstProjectPath(
  text: string,
  root: string,
  fs: Pick<PackageFileSystem, 'exists'> = DISK_PACKAGE_FILE_SYSTEM,
): string | null {
  const found = pathsIn(text).map((path) => resolve(root, path))
    .find((path) => path !== root && isInside(root, path) && !path.includes(DEPENDENCIES) && fs.exists(path));
  return found === undefined
    ? null
    : relative(root, found);
}
