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

/** A file path in running text: an optional `file://`, then steps ending in an extension. */
const PATH_TOKEN = /(?:file:\/\/)?((?:\.{0,2}\/)?[\w@.+~-]+(?:\/[\w@.+~-]+)*\.[A-Za-z0-9]+)/g;

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
  const found = Array.from(text.matchAll(PATH_TOKEN), (match) => resolve(root, match[1] ?? ''))
    .find((path) => path !== root && isInside(root, path) && !path.includes(DEPENDENCIES) && fs.exists(path));
  return found === undefined
    ? null
    : relative(root, found);
}
