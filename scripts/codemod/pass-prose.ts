/**
 * Step 5 of the pass-moves codemod (`pass-moves.ts`): which files it reads,
 * the path forms it rewrites, and the build files it reads but leaves.
 *
 * A moved path in the build's arguments is not a name to follow. The
 * library build of `scripts/build/bundle.ts` hands `bun build` its entries
 * with `--root=src`, so an entry rewritten from `src/` into a package's
 * folder is still built, but to a path outside `--outdir`, and the build
 * reads green (pass 4a, #808: `src/learning/index.ts` in
 * `LIBRARY_ENTRIES` wrote `packages/rafa-inventory/src/learning/index.js`
 * beside its source). So a moved path in a build file
 * ({@link isBuildScope}) keeps its text and is listed for the move task,
 * which points it by hand; the build then fails loud on the missing path
 * until it does.
 */
import type { Edit, SiteNote } from './core-package-text';
import type { PathMove } from './pass-moves-set';

import { isCodeFile } from '../survey/core-barrels';

import { CODE_EXTENSION } from './core-package-text';

/** The cluster map whose keys step 5 renames. */
export const CLUSTER_MAP_FILE = 'docs/survey/cluster-map.json';

/** The folders whose code files' comments and strings step 5 rewrites, each with its closing `/`. */
export const CODE_PROSE_ROOTS: readonly string[] = ['context/', 'packages/', 'scripts/', 'src/'];

/** The folders whose `.md` files step 5 rewrites, each with its closing `/`. */
export const PROSE_ROOTS: readonly string[] = ['.claude/', 'context/', 'docs/'];

/** The `.md` files at the root step 5 rewrites. */
export const ROOT_PROSE: readonly string[] = ['AGENTS.md', 'README.md'];

/** The survey folder, a dated record that step 5 leaves but for its generated maps. */
export const SURVEY_FOLDER = 'docs/survey/';

/** The generated maps of {@link SURVEY_FOLDER} that step 5 rewrites: the three the move regenerates. */
export const SURVEY_MAPS: readonly string[] = ['docs/survey/cut-table.md', 'docs/survey/import-graph.md', 'docs/survey/test-index.md'];

/**
 * The folder step 5 leaves: the codemod's own files, the move lists under
 * `moves/` and the earlier codemods. Each spells the tree before its own
 * move, and its tests plant that tree.
 */
export const CODEMOD_FOLDER = 'scripts/codemod/';

/**
 * The files step 5 leaves to the move task: the cases of the cut table
 * plant graphs whose paths the live `CUT_RULES` place, so a planted path
 * keeps its meaning only as written.
 */
export const LEFT_TO_HAND: readonly string[] = ['scripts/survey/cut-table.test.ts'];

/** The folder of the build's scripts, whose moved paths step 5 lists and leaves, with its closing `/`. */
export const BUILD_FOLDER = 'scripts/build/';

/** The root manifest, whose `build` script names paths `bun build` and `cp` read, listed and left by step 5. */
export const BUILD_MANIFEST = 'package.json';

/**
 * Whether a file is one of the build's: a code file under
 * {@link BUILD_FOLDER} or the root {@link BUILD_MANIFEST}.
 *
 * @param file - A path from the root.
 * @returns Whether step 5 lists its moved paths and leaves them.
 */
export function isBuildScope(file: string): boolean {
  return file === BUILD_MANIFEST || (file.startsWith(BUILD_FOLDER) && isCodeFile(file));
}

/**
 * The notes of the rewrites step 5 would make in a build file and leaves:
 * one per moved path, its line and the path it would take.
 *
 * @param file - The build file.
 * @param text - Its text.
 * @param edits - The rewrites step 5 found in it.
 * @returns The notes, in the order of the text.
 */
export function buildNotes(file: string, text: string, edits: readonly Edit[]): readonly SiteNote[] {
  return [...edits].sort((a, b) => a.pos - b.pos).map((edit) => ({
    file,
    line: text.slice(0, edit.pos).split('\n').length,
    text: `${text.slice(edit.pos, edit.end)} -> ${edit.text}`,
  }));
}

/**
 * The text a moved path takes after the move, or `undefined` when it is
 * not one: a moved or parked file by its full path, else a path under a
 * moved folder, or the folder itself, under that folder's new path.
 *
 * @param token - A path as written, opening with `src/`.
 * @param finals - The path after the move of each moved and parked file.
 * @param folders - The moved folders, each path with its closing `/`.
 * @returns The path after the move, or `undefined`.
 */
export function rewriteMovedPath(token: string, finals: ReadonlyMap<string, string>, folders: readonly PathMove[]): string | undefined {
  const exact = finals.get(token);
  if (exact !== undefined) {
    return exact;
  }
  for (const folder of folders) {
    if (token.startsWith(folder.from)) {
      return `${folder.to}${token.slice(folder.from.length)}`;
    }
    if (token === folder.from.slice(0, -1)) {
      return folder.to.slice(0, -1);
    }
  }
  return undefined;
}

/** Whether a path lies under a `testdata/` folder or a module's `fixtures/` folder. */
export function isFrozen(path: string): boolean {
  const folders = path.split('/').slice(0, -1);
  return folders.includes('testdata') || folders.some((folder, depth) => folder === 'fixtures' && depth > 1);
}

/** Whether step 5 reads a file. */
export function isProseScope(file: string): boolean {
  if (isFrozen(file) || file.startsWith(CODEMOD_FOLDER) || LEFT_TO_HAND.includes(file)) {
    return false;
  }
  if (isCodeFile(file)) {
    return CODE_PROSE_ROOTS.some((root) => file.startsWith(root));
  }
  if (!file.endsWith('.md')) {
    return false;
  }
  return ROOT_PROSE.includes(file)
    || (PROSE_ROOTS.some((root) => file.startsWith(root)) && (!file.startsWith(SURVEY_FOLDER) || SURVEY_MAPS.includes(file)));
}

/**
 * The path forms step 5 rewrites: each moved and parked file by its full
 * path, and each moved code file by its path without the extension where
 * no other file or folder is named by it.
 *
 * @param files - The committable files.
 * @param finals - The path after the move of each moved and parked file.
 * @returns The forms, each with its path after the move.
 */
export function proseForms(files: readonly string[], finals: ReadonlyMap<string, string>): ReadonlyMap<string, string> {
  const forms = new Map(finals);
  const stems = (path: string): string => path.replace(CODE_EXTENSION, '');
  for (const [from, to] of finals) {
    const stem = stems(from);
    const named = stem !== from && !files.some((file) => file !== from && (file.startsWith(`${stem}/`) || stems(file) === stem));
    if (named) forms.set(stem, stems(to));
  }
  return forms;
}
