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
 *   - less core's own files and its parked tests, which import their
 *     sibling files directly: every path `isCoreRead` of `core-moves.ts`
 *     holds, the files under `src/core/` and under the other core folders,
 *     the named core files, and the tests under `CORE_PARKED_TESTS`. They
 *     are named under `inside` and their imports are not read. That a file
 *     inside never imports a barrel is the other half of the move's import
 *     rule, and this reading does not measure it.
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
 * One specifier `textImports` finds is not an import: the name of a
 * module augmentation, a `declare module '<specifier>'` block at the top
 * level of the file ({@link augmentedModules}). It loads nothing and
 * takes no binding; it adds fields to an interface the named module
 * declares, and it has to name the DECLARING module: measured with `tsc`
 * when the config sections took their fields into `RafaConfig`, two
 * augmentations spelled through the config barrel merged with each other
 * and not with the interface, whose `keyof` missed both. So an
 * augmentation is answered under `augment` and never under `barrel` or
 * `deep`, and the module it names is one more path the core package
 * will have to export. A file that both imports and augments a module
 * has the import read as any other.
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

import ts from 'typescript';

import { barrelPaths, CORE_FOLDER, isCoreRead } from './core-moves';
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
  /** Every module augmentation that names a file under `src/core/`, sorted by line, free of duplicates. */
  readonly augment: readonly CoreImport[];
  /** The code files `isCoreRead` holds that were handed in and left unread, sorted. */
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
 * The modules a file augments: the specifier of each `declare module`
 * block named by a string at the top level of its text, in source order.
 *
 * @param path - The file's path, which tells TypeScript from JSX.
 * @param text - The file's source text.
 * @returns The specifiers, one per block.
 */
export function augmentedModules(path: string, text: string): string[] {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest);
  return source.statements.flatMap((statement) => ts.isModuleDeclaration(statement) && ts.isStringLiteral(statement.name)
    ? [statement.name.text]
    : []);
}

/**
 * The specifiers of `imports` left once each augmented module is taken
 * out of them, one occurrence for each block.
 *
 * @param imports - Every specifier `textImports` found.
 * @param augments - The specifiers {@link augmentedModules} found.
 * @returns The specifiers that import.
 */
function withoutAugments(imports: readonly string[], augments: readonly string[]): string[] {
  const left = [...imports];
  for (const specifier of augments) {
    const at = left.indexOf(specifier);
    if (at >= 0) left.splice(at, 1);
  }
  return left;
}

/**
 * Reads every import from a code file outside core into `src/core/`, and
 * splits them into those that reach a barrel and those that reach deeper
 * (see the module note for which files and which imports). Pure: the
 * caller lists the files, reads their text and supplies the resolver.
 *
 * @param input - The files, their texts, a resolver, and the barrels when a test plants its own.
 * @returns The barrel imports, the deep imports, the augmentations, the
 *   files read, core's files and parked tests left unread, and the files
 *   with no text.
 */
export function readCoreImports(input: CoreImportsInput): CoreImports {
  const barrels = new Set(input.barrels ?? barrelPaths());
  const code = [...new Set(input.files)].filter(isCodeFile).sort();
  const inside = code.filter((path) => isCoreRead(path));
  const covered = code.filter((path) => !isCoreRead(path));
  const read = covered.filter((path) => input.sources.has(path));
  const missing = covered.filter((path) => !input.sources.has(path));
  const barrel = new Map<string, CoreImport>();
  const deep = new Map<string, CoreImport>();
  const augment = new Map<string, CoreImport>();
  const intoCore = (specifier: string, path: string): CoreImport | undefined => {
    const target = input.resolve(specifier, path);
    return target === undefined || !target.startsWith(CORE_FOLDER)
      ? undefined
      : { from: path, to: target };
  };
  for (const path of read) {
    const text = input.sources.get(path) ?? '';
    const augments = augmentedModules(path, text);
    for (const specifier of withoutAugments(textImports(text), augments)) {
      const edge = intoCore(specifier, path);
      if (edge === undefined) {
        continue;
      }
      const edges = barrels.has(edge.to)
        ? barrel
        : deep;
      edges.set(importLine(edge), edge);
    }
    for (const specifier of augments) {
      const edge = intoCore(specifier, path);
      if (edge !== undefined) augment.set(importLine(edge), edge);
    }
  }
  return {
    barrel: sortedByLine(barrel),
    deep: sortedByLine(deep),
    augment: sortedByLine(augment),
    inside,
    missing,
    read,
  };
}
