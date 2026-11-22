/**
 * The `module` column of `finding_facts`, `bug_facts` and `change_facts`:
 * the module a store row is about, read from the paths its text names.
 *
 * 1. **Modules.** {@link discoverModules} expands each of the project's
 *    `moduleGlobs` (`packages/*`, `src/*` and `addons/*` until
 *    `loadAtlasConfig` reads a project's own) into the folders it names
 *    under the project root, as paths relative to it with `/` between
 *    segments. A segment is a folder name, which takes that folder, or
 *    `*`, which takes every folder there whose name does not start with a
 *    dot and is not `node_modules`. A glob that names no folder adds none.
 * 2. **Attribution.** {@link attributeModule} takes the texts of a row in
 *    order (`artifact`, then `what`) and answers the longest module found
 *    in the first text that names one, so `packages/rafa-effort` wins
 *    over `packages/rafa`, and a module the artifact names wins over one
 *    only the `what` names. A module is found where it stands as a whole
 *    path: the character before it is none, a `/` or one that is not a
 *    path character, and the one after it is none, a `/`, or one that is
 *    not a path character; a `.` that ends a sentence counts as none. So
 *    an absolute path (`/home/x/repo/packages/rafa/src/a.ts`) names
 *    `packages/rafa`, and `packages/rafa-effort` does not.
 *
 * A row whose texts name no module reads NULL.
 */
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** The globs a project's modules are found by, until a project's own config names them. */
export const DEFAULT_MODULE_GLOBS: readonly string[] = ['packages/*', 'src/*', 'addons/*'];

/** The segment that takes every folder in its place. */
const WILDCARD = '*';

/** A folder `*` never takes. */
const SKIPPED_FOLDER = 'node_modules';

/** A character a path segment holds besides `/`. */
const PATH_CHARACTER = /[A-Za-z0-9_.-]/;

/** The segments of `glob`, or a thrown `Error` naming it when it is not one. */
function segmentsOf(glob: string): readonly string[] {
  const segments = glob.split('/');
  const bad = segments.find((segment) => segment === '' || segment === '.' || segment === '..'
    || (segment.includes(WILDCARD) && segment !== WILDCARD));
  if (bad !== undefined) {
    throw new Error(`atlas: the module glob '${glob}' holds the segment '${bad}'; a segment is a folder name or *`);
  }
  return segments;
}

/** The names of the folders `*` takes in `parent` under `root`; none when `parent` cannot be listed. */
function childFolders(root: string, parent: string): readonly string[] {
  try {
    return readdirSync(join(root, parent), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== SKIPPED_FOLDER)
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/** True when `path` under `root` is a folder. */
function isFolder(root: string, path: string): boolean {
  try {
    return statSync(join(root, path)).isDirectory();
  } catch {
    return false;
  }
}

/** `name` under `parent`, as a relative path. */
function childPath(parent: string, name: string): string {
  return parent === ''
    ? name
    : `${parent}/${name}`;
}

/** The folders one glob names under `root`, as relative paths; a literal segment takes any folder it names. */
function expandGlob(root: string, segments: readonly string[]): readonly string[] {
  return segments.reduce<readonly string[]>((parents, segment) => parents.flatMap((parent) => {
    if (segment === WILDCARD) return childFolders(root, parent).map((name) => childPath(parent, name));
    const path = childPath(parent, segment);
    return isFolder(root, path)
      ? [path]
      : [];
  }), ['']);
}

/**
 * The modules `globs` name under `root`, each once, sorted; see the
 * module note. Throws naming the glob when one holds an empty segment,
 * `.`, `..`, or a `*` beside other characters.
 */
export function discoverModules(root: string, globs: readonly string[] = DEFAULT_MODULE_GLOBS): readonly string[] {
  const found = globs.flatMap((glob) => expandGlob(root, segmentsOf(glob)));
  return [...new Set(found)].sort();
}

/** True when `module` stands in `text` at `index` as a whole path; see the module note. */
function standsAlone(text: string, index: number, module: string): boolean {
  const before = text.charAt(index - 1);
  const after = text.charAt(index + module.length);
  const next = text.charAt(index + module.length + 1);
  const opens = before === '' || before === '/' || !PATH_CHARACTER.test(before);
  const closes = after === '' || after === '/' || !PATH_CHARACTER.test(after)
    || (after === '.' && (next === '' || /\s/.test(next)));
  return opens && closes;
}

/** True when `text` names `module` as a whole path anywhere. */
function names(text: string, module: string): boolean {
  let index = text.indexOf(module);
  while (index !== -1) {
    if (standsAlone(text, index, module)) return true;
    index = text.indexOf(module, index + 1);
  }
  return false;
}

/**
 * The longest of `modules` named by the first of `texts` that names one,
 * or null; see the module note. A null or empty text is passed over.
 */
export function attributeModule(modules: readonly string[], texts: readonly (string | null)[]): string | null {
  const longestFirst = [...modules].sort((a, b) => b.length - a.length || (a < b
    ? -1
    : 1));
  for (const text of texts) {
    if (text === null || text === '') continue;
    const found = longestFirst.find((module) => names(text, module));
    if (found !== undefined) return found;
  }
  return null;
}
