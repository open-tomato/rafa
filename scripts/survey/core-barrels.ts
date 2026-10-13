/**
 * The deep-import reading behind the core-barrels sweep: which files
 * outside `src/core/` import a file inside it that is not a barrel.
 *
 * The rule it measures: a file outside `src/core/` imports a subject's
 * barrel and nothing deeper. The barrels are the ones
 * `scripts/survey/core-moves.ts` lists (`CORE_BARRELS`), so `src/core/`
 * can become the core package by one `git mv` (#808) with every importer
 * already on a path the package will export. The move of #905 is held to
 * this from its first file on, so there is no allow-list: one deep import
 * is a failure, and the only way to allow a path is to list it as a
 * barrel in `core-moves.ts`.
 *
 * Which files are read:
 *
 *   - every file handed in whose name ends in a code extension
 *     ({@link isCodeFile}), whatever its kind and wherever it lies: a
 *     source file, a test file, a sweep, a test-support file, a script
 *     under `scripts/`, a package file, a config file at the root. Unlike
 *     the commands-direction reading, a test file is covered: a test
 *     outside `src/core/` reaches it through a barrel too;
 *   - less the files under `src/core/` themselves, which import their
 *     sibling files directly. They are named under `inside` and their
 *     imports are not read. That a file inside never imports a barrel is
 *     the other half of the move's import rule, and this reading does not
 *     measure it.
 *
 * Which imports count: every specifier `ts.preProcessFile` finds in the
 * source text (`textImports`, `scripts/survey/import-graph.ts`), so a
 * static import, an `import type`, an `export … from`, a dynamic
 * `import()` and a `require()` are all read, with no difference made
 * between an import that runs and one only the type checker reads. Three
 * things name a file and are not seen: an `import()` or `require()` whose
 * argument is not a string literal, a `mock.module()` call, and a path
 * built for a spawned process or a file read. Nothing inside a comment or
 * a string is seen either.
 *
 * Each specifier is resolved by the resolver handed in. A target under
 * `src/core/` that is a listed barrel is answered under `barrel`, any
 * other target under `src/core/` under `deep`, and a target outside it
 * adds nothing. A specifier that resolves to nothing adds no edge and is
 * not reported here: `tsc` is the gate for an import that reaches no
 * file. Only the listed paths are barrels: an `index.ts` below a subject
 * folder, or one directly in `src/core/`, is a deep import like any other
 * file.
 *
 * An edge is spelled `<importer path> -> <path under src/core/>`, both
 * paths repository-relative with their extension ({@link importLine}).
 * Two imports of one file from one importer are one edge.
 */

import type { ResolveImport } from './import-graph';

import { barrelPaths, CORE_FOLDER } from './core-moves';
import { textImports } from './import-graph';

const CODE_EXTENSION = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const EDGE_ARROW = ' -> ';

/** Where the barrels are listed, as the line of a deep import names it. */
const BARRELS_SOURCE = 'scripts/survey/core-moves.ts';

/** One import from a file outside `src/core/` to a file inside it. */
export interface CoreImport {
  /** The importing file, repository-relative. */
  readonly from: string;
  /** The imported file under `src/core/`, repository-relative. */
  readonly to: string;
}

/** What `readCoreImports` reads, all of it passed in as data. */
export interface CoreImportsInput {
  /** The files to consider, repository-relative; normally every file a commit would hold. */
  readonly files: readonly string[];
  /** The source text of each file. */
  readonly sources: ReadonlyMap<string, string>;
  /** The resolver for each specifier a file imports. */
  readonly resolve: ResolveImport;
  /** The files under `src/core/` a file outside may import; those of `core-moves.ts` unless a test plants its own. */
  readonly barrels?: readonly string[];
}

/** What `readCoreImports` answers. */
export interface CoreImports {
  /** Every import that reaches a barrel, sorted by line, free of duplicates. */
  readonly barrel: readonly CoreImport[];
  /** Every import that reaches past the barrels, sorted by line, free of duplicates. */
  readonly deep: readonly CoreImport[];
  /** The code files under `src/core/` that were handed in and left unread, sorted. */
  readonly inside: readonly string[];
  /** The files that should have been read and had no source text, sorted. */
  readonly missing: readonly string[];
  /** The files whose imports were read, sorted. */
  readonly read: readonly string[];
}

/**
 * Whether a path names a code file: TypeScript or JavaScript of any
 * module kind (`.ts`, `.mts`, `.cts`, `.tsx` and their `.js` forms).
 *
 * @param path - A path with `/` between segments.
 * @returns `true` when the file can hold an import.
 */
export function isCodeFile(path: string): boolean {
  return CODE_EXTENSION.test(path);
}

/**
 * The line an import is spelled as: `<importer path> -> <path under
 * src/core/>`.
 *
 * @param edge - The import.
 * @returns Its line.
 */
export function importLine(edge: CoreImport): string {
  return `${edge.from}${EDGE_ARROW}${edge.to}`;
}

/**
 * The barrels of the subject a path under `src/core/` lies in: those in
 * the folder its first segment below `src/core/` names.
 *
 * @param path - A repository-relative path.
 * @param barrels - The listed barrels; those of `core-moves.ts` unless a test plants its own.
 * @returns The barrels of its subject, sorted; empty for a path directly
 *   in `src/core/`, in a folder with no barrel, or outside `src/core/`.
 */
export function subjectBarrels(path: string, barrels: readonly string[] = barrelPaths()): readonly string[] {
  if (!path.startsWith(CORE_FOLDER)) {
    return [];
  }
  const segments = path.slice(CORE_FOLDER.length).split('/');
  if (segments.length < 2) {
    return [];
  }
  const folder = `${CORE_FOLDER}${segments[0]}/`;
  return barrels.filter((barrel) => barrel.startsWith(folder)).sort();
}

/**
 * The line a deep import is reported as: its {@link importLine}, then the
 * barrels to import in its place.
 *
 * @param edge - The deep import.
 * @param barrels - The listed barrels; those of `core-moves.ts` unless a test plants its own.
 * @returns The line, naming the subject's barrels or saying none is listed.
 */
export function deepImportLine(edge: CoreImport, barrels: readonly string[] = barrelPaths()): string {
  const instead = subjectBarrels(edge.to, barrels);
  const advice = instead.length > 0
    ? `import ${instead.join(' or ')}`
    : `no barrel is listed for it in ${BARRELS_SOURCE}`;
  return `${importLine(edge)} (${advice})`;
}

/**
 * The edges of a map keyed by their line, sorted by that line.
 *
 * @param byLine - Each edge under its line.
 * @returns The edges in line order.
 */
function sortedByLine(byLine: ReadonlyMap<string, CoreImport>): readonly CoreImport[] {
  return [...byLine.keys()].sort().flatMap((line) => byLine.get(line) ?? []);
}

/**
 * Reads every import from a code file outside `src/core/` into it, and
 * splits them into those that reach a barrel and those that reach deeper
 * (see the module note for which files and which imports). Pure: the
 * caller lists the files, reads their text and supplies the resolver.
 *
 * @param input - The files, their texts, a resolver, and the barrels when a test plants its own.
 * @returns The barrel imports, the deep imports, the files read, the
 *   files inside `src/core/` left unread, and the files with no text.
 */
export function readCoreImports(input: CoreImportsInput): CoreImports {
  const barrels = new Set(input.barrels ?? barrelPaths());
  const code = [...new Set(input.files)].filter(isCodeFile).sort();
  const inside = code.filter((path) => path.startsWith(CORE_FOLDER));
  const covered = code.filter((path) => !path.startsWith(CORE_FOLDER));
  const read = covered.filter((path) => input.sources.has(path));
  const missing = covered.filter((path) => !input.sources.has(path));
  const barrel = new Map<string, CoreImport>();
  const deep = new Map<string, CoreImport>();
  for (const path of read) {
    for (const specifier of textImports(input.sources.get(path) ?? '')) {
      const target = input.resolve(specifier, path);
      if (target === undefined || !target.startsWith(CORE_FOLDER)) {
        continue;
      }
      const edge: CoreImport = { from: path, to: target };
      const edges = barrels.has(target)
        ? barrel
        : deep;
      edges.set(importLine(edge), edge);
    }
  }
  return { barrel: sortedByLine(barrel), deep: sortedByLine(deep), inside, missing, read };
}
