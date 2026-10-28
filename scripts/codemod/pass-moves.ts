/**
 * The pass-moves codemod: moves the files of a move list into a package,
 * core's `packages/rafa/src/` or a feature package's (#808), and rewrites
 * every path that names them. It is a program over lists, in the shape of
 * `core-package.ts`: every list it acts on is printed with its count, and
 * `--dry-run` prints them and changes nothing.
 *
 * Usage, from the repository root or naming it:
 *
 *   bun scripts/codemod/pass-moves.ts --list=scripts/codemod/moves/pass-1.ts [--package=<name>] [--dry-run] [<root>]
 *
 * The list is a module under `scripts/codemod/moves/` that exports one
 * array of `FileMove` (`moves/types.ts`); its path is read from the
 * working folder. `--package=` names the target by its folder under
 * `packages/`, as `rewire-facade.ts` spells it (`rafa-inventory`), and
 * must name a workspace member; absent, or `rafa`, the target is core
 * (`pass-target.ts`). The steps below read "the package" as the target.
 *
 * ## What it reads
 *
 * The files `git add -A` would commit (tracked, or untracked and not
 * ignored) and present on disk. Every specifier is resolved by
 * `bunResolver` of `scripts/survey/import-graph.ts`, from the importer's
 * folder, so a `paths`-mapped name resolves as `bun` resolves it.
 *
 * ## The six steps
 *
 *  1. Moves each listed file to its `to` path, with its colocated test
 *     files and its folder's `testdata/`. A colocated test is a test file
 *     in the listed file's folder whose name opens with the file's stem,
 *     followed by `.`, `-` or nothing, and that has no source file of its
 *     own (`record-composition.test.ts` goes with `record.ts`,
 *     `position.integration.test.ts` with `position.ts`); the longest stem
 *     wins. The `testdata/` folder goes when every source file of the
 *     folder is listed. A colocated test the project's `tests.integration`
 *     globs match (`readTestKindGlobs` of `scripts/survey/test-kinds.ts`)
 *     is left in place with its imports rewritten by step 3, and listed,
 *     until #913 places each integration test with the package entry it
 *     drives.
 *  2. Parks each moved test file whose imports, resolved, reach a file of
 *     the repository outside core, outside the package's folder, outside
 *     the move and outside the folders of the feature packages the
 *     package's `package.json` names under `dependencies`
 *     (`declaredFolders` of `pass-target.ts`, printed after the first
 *     line as `declared dependencies (n)`, a facade by name counting as
 *     its folder's `index.ts`), such as a root file, a `src/tests/`
 *     helper or the root `package.json`, at the target's parking folder
 *     (`src/tests/core-coupled/` for core, `src/tests/<name>-coupled/`
 *     for `rafa-<name>`) under its path below `src/`, and prints what
 *     each reaches as a row of that folder's README.
 *  3. Rewrites every specifier of a code file outside the package, under
 *     `src/`, `scripts/`, `packages/<name>/src/` or at the root, that
 *     resolves to a moved file to that file's subpath
 *     ({@link packageSubpath}): static imports, `import type`,
 *     `export … from`, `import()`, `require()`, `import('…')` types and
 *     `declare module`. For a feature package, a file directly under a
 *     `packages/<name>/` is read too, and one in the package's folder but
 *     outside its `src/` (its facade `index.ts`, a `commands.ts`) takes
 *     the relative path from its own folder instead. A parked test's
 *     import of a moved or core file reads its subpath too, a bare core
 *     specifier keeping its text, and its relative import of any other
 *     file the relative path from its new folder.
 *  4. Rewrites a moved file's own specifiers. Into core, a bare
 *     `@open-tomato/rafa/<subpath>`, a `declare module` target included,
 *     becomes the relative path from the file's new folder to the file it
 *     resolves to, with a `.js` form for a `.ts` file; into a feature
 *     package it keeps its text, since core is another package. A
 *     relative specifier between two moved files keeps its text: the
 *     package mirrors the layout under `src/`.
 *  5. Rewrites a moved path named in prose and in the comments and string
 *     literals of code files to the path after the move
 *     ({@link rewriteMovedPath}), with and without its code extension,
 *     and renames the keys and `outside` entries of
 *     `docs/survey/cluster-map.json` that name a moved or parked file.
 *     Prose is the `.md` files under `context/`, `docs/` (less
 *     `docs/survey/` but its generated maps, {@link SURVEY_MAPS}) and
 *     `.claude/`, and `README.md` and `AGENTS.md`; code is the files under
 *     {@link CODE_PROSE_ROOTS}. It leaves every file under a `testdata/`
 *     or a module's `fixtures/` folder, the codemod's own files, the move
 *     lists and the earlier codemods ({@link CODEMOD_FOLDER}), and the
 *     files of {@link LEFT_TO_HAND}. A moved path in the build's files,
 *     the code under `scripts/build/` and the root `package.json`, keeps
 *     its text and is listed for the move task: rewritten, an entry of
 *     the library build's `--root=src` would build outside `dist/`
 *     without a word (`pass-prose.ts`).
 *  6. Lists and leaves each line of a moved or parked test that builds a
 *     path from `import.meta`, since the test sits deeper now, or builds
 *     one from a folder constant or as a relative string that the move
 *     breaks; and each line of a code file outside the move that builds
 *     one naming a moved file or folder, from `import.meta`, from a folder
 *     constant or as a relative string, since its target has gone
 *     (`pass-paths.ts`). A relative string that is an import specifier is
 *     step 3's.
 *
 * ## What it refuses
 *
 * A run with any refusal writes nothing: a listed `from` that is not
 * tracked or not on disk, a `to` that exists or lies outside the
 * package's source, a path listed twice, a moved file whose relative
 * specifier (or, into core, `@open-tomato/rafa/` specifier) resolves to
 * nothing or outside the move and outside the package, a test to park
 * that is not under `src/`, and two rewrites of one span.
 *
 * Exit codes: 0 the run finished; 2 it could not run, named no workspace
 * member, or refused.
 */
import type { Edit, SiteNote } from './core-package-text';
import type { FileMove } from './moves/types';
import type { ParkedTest, PassMovesInput, PathMove } from './pass-moves-set';
import type { BuiltLine, BuiltPath } from './pass-paths';
import type { PassTarget } from './pass-target';

import { existsSync, readFileSync } from 'node:fs';
import { join, posix, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { isCodeFile } from '../survey/core-barrels';
import { CORE_SOURCE } from '../survey/core-moves';
import { classifyFile } from '../survey/files';
import { bunResolver } from '../survey/import-graph';
import { readTestKindGlobs } from '../survey/test-kinds';

import {
  applyEdits,
  lineOf,
  parseSource,
  proseSpans,
  relativeSpecifier,
  renameClusterMap,
  specifierSites,
  tokenEdits,
} from './core-package-text';
import { applyTreeChanges, committableFiles, TreeError } from './core-package-tree';
import { isOutsideRepository, readMoveSet, targetOf } from './pass-moves-set';
import { builtPaths, codeForms, IMPORT_META_PATH, namedImports, pathTree, shiftedPath } from './pass-paths';
import { buildNotes, CLUSTER_MAP_FILE, CODEMOD_FOLDER, isBuildScope, isProseScope, proseForms, rewriteMovedPath } from './pass-prose';
import {
  checkWorkspaceMember,
  CORE_TARGET,
  declaredFolders,
  PACKAGE_PREFIX,
  packageSubpath,
  PassTargetError,
  readmeRow,
  readPassTarget,
  SOURCE_ROOT,
} from './pass-target';

/** The flag that prints the lists and changes nothing. */
export const DRY_RUN_FLAG = '--dry-run';

/** The flag that names the move list, before its `=`. */
export const LIST_FLAG = '--list';

/** The flag that names the target package, before its `=`. */
export const PACKAGE_FLAG = '--package';

/** What a wrong command line is answered with. */
export const USAGE: string = `Usage: bun scripts/codemod/pass-moves.ts ${LIST_FLAG}=<move list> [${PACKAGE_FLAG}=<name>] [${DRY_RUN_FLAG}] [<root>]`;

/** One specifier that changes, named by the importer's path before the move. */
export interface SpecifierRewrite {
  readonly file: string;
  readonly line: number;
  readonly from: string;
  readonly to: string;
}

/** How many moved paths step 5 rewrites in one file, named by its path before the move. */
export interface PathMentions {
  readonly file: string;
  readonly count: number;
}

export type { SiteNote } from './core-package-text';
export type { ParkedTest, PassMovesInput, PathMove } from './pass-moves-set';
export type { PassTarget } from './pass-target';
export { metaPaths } from './pass-paths';
export {
  BUILD_FOLDER,
  BUILD_MANIFEST,
  CLUSTER_MAP_FILE,
  CODE_PROSE_ROOTS,
  CODEMOD_FOLDER,
  LEFT_TO_HAND,
  PROSE_ROOTS,
  ROOT_PROSE,
  rewriteMovedPath,
  SURVEY_FOLDER,
  SURVEY_MAPS,
} from './pass-prose';

/** Everything one run would do, and the text of every file it writes. */
export interface PassMovesPlan {
  /** The package the list moves into. */
  readonly target: PassTarget;
  /** Step 2: the folders of the feature packages the target declares, read as inside. */
  readonly declared: readonly string[];
  /** Step 1: the listed files, sorted by `from`. */
  readonly moves: readonly PathMove[];
  /** Step 1: the colocated tests that move into the package, sorted. */
  readonly colocated: readonly PathMove[];
  /** Step 1: the colocated integration tests left at the root, imports rewritten, sorted. */
  readonly left: readonly string[];
  /** Step 1: the `testdata/` files that move with their folder, sorted. */
  readonly testdata: readonly PathMove[];
  /** Step 2, sorted. */
  readonly parked: readonly ParkedTest[];
  /** Step 3, sorted by file and line. */
  readonly specifiers: readonly SpecifierRewrite[];
  /** Step 3: how many files outside the move hold a rewritten specifier. */
  readonly importers: number;
  /** Step 4, sorted by file and line. */
  readonly ownSpecifiers: readonly SpecifierRewrite[];
  /**
   * Step 4: the imports of a moved file the list does not name (a
   * `testdata/` file) that reach outside the package and the move, each
   * pointed at its file from the new folder and left to the move task.
   */
  readonly escapes: readonly SiteNote[];
  /** Step 5: the cluster-map paths renamed. */
  readonly clusterKeys: readonly PathMove[];
  /** Step 5: the moved paths rewritten, per file, sorted by file. */
  readonly mentions: readonly PathMentions[];
  /** Step 5: the moved paths of the build's files, left as written for the move task ({@link isBuildScope}). */
  readonly buildReads: readonly SiteNote[];
  /** Step 6: the `import.meta` path lines of moved and parked tests, and those the move breaks, left to the move task. */
  readonly pathReads: readonly SiteNote[];
  /** Step 6: the path lines outside the move that name a moved file or folder, left to the move task. */
  readonly movedPathReads: readonly SiteNote[];
  /** What the codemod will not do; a run with any writes nothing. */
  readonly refusals: readonly SiteNote[];
  /** The text of every file whose text changes, by its path after the move. */
  readonly writes: ReadonlyMap<string, string>;
}

/** Where `main` writes. */
export interface PassMovesStreams {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

/** The run could not start. */
export class PassMovesError extends Error {}

/** The `.js` form a specifier spells each TypeScript extension with. */
const JS_FORM: Readonly<Record<string, string>> = { '.cts': '.cjs', '.mts': '.mjs', '.ts': '.js', '.tsx': '.jsx' };

/**
 * Whether a path is a code file outside the package's source whose
 * specifiers step 3 reads: one directly under a `packages/<name>/` only
 * for a feature target.
 */
function isImporterScope(target: PassTarget, path: string): boolean {
  return isCodeFile(path) && !path.startsWith(target.source)
    && (path.startsWith(SOURCE_ROOT) || path.startsWith('scripts/') || /^packages\/[^/]+\/src\//.test(path) || !path.includes('/')
      || (!target.core && /^packages\/[^/]+\/[^/]+$/.test(path)));
}

/**
 * Whether a literal on a line of a code file is one of its import
 * specifiers, which step 3 rewrites and step 6 leaves.
 *
 * @param file - The file's path.
 * @param text - Its text.
 * @returns The question, by line (from 1) and literal.
 */
function specifierAt(file: string, text: string): (line: number, literal: string) => boolean {
  const source = parseSource(file, text);
  const sites = new Set(specifierSites(source).map((site) => `${lineOf(source, site.node.getStart(source))}:${site.node.text}`));
  return (line, literal) => sites.has(`${line}:${literal}`);
}

/**
 * Step 6's reading of each file: the lines that build a path, with the
 * folder constants it imports by name from a module that exports one
 * built from `import.meta`, one import deep.
 *
 * @param input - The run's input, for the texts and the resolver.
 * @returns The reading, by file and text.
 */
function pathReader(input: PassMovesInput): (file: string, text: string) => readonly BuiltLine[] {
  const exports = new Map<string, ReadonlyMap<string, BuiltPath>>();
  const exportedBy = (path: string): ReadonlyMap<string, BuiltPath> => {
    const known = exports.get(path);
    if (known !== undefined) return known;
    const text = input.sources.get(path);
    const read = text === undefined || !IMPORT_META_PATH.test(text)
      ? new Map<string, BuiltPath>()
      : builtPaths(path, text, { isSpecifier: () => false }).exported;
    exports.set(path, read);
    return read;
  };
  return (file, text) => {
    const imported = new Map<string, BuiltPath>();
    for (const item of namedImports(text)) {
      if (!item.specifier.startsWith('.')) continue;
      const landed = input.resolve(item.specifier, file);
      const held = landed === undefined
        ? undefined
        : exportedBy(landed).get(item.name);
      if (held !== undefined) imported.set(item.local, held);
    }
    return builtPaths(file, text, { imported, isSpecifier: specifierAt(file, text) }).lines;
  };
}

function byFileAndLine(a: { readonly file: string; readonly line: number }, b: { readonly file: string; readonly line: number }): number {
  return a.file.localeCompare(b.file) || a.line - b.line;
}

/** The lists every file's rewrite reads. */
interface Rules {
  readonly input: PassMovesInput;
  /** The listed files, by path before the move. */
  readonly listed: ReadonlySet<string>;
  /** The path after the move of each moved and parked file. */
  readonly finals: ReadonlyMap<string, string>;
  /** The package the list moves into. */
  readonly target: PassTarget;
}

/** Whether a path, after the move, sits in the package. */
function landsInPackage(rules: Rules, path: string): boolean {
  return (rules.finals.get(path) ?? path).startsWith(rules.target.source);
}

/** What one file's specifiers come to. */
interface FileSpecifiers {
  readonly edits: readonly Edit[];
  readonly rewrites: readonly SpecifierRewrite[];
  readonly escapes: readonly SiteNote[];
  readonly refusals: readonly SiteNote[];
}

/**
 * Step 4 over one moved file.
 *
 * @param rules - The run's lists.
 * @param file - The file's path before the move.
 * @param text - Its text.
 * @returns Its edits, its rewrites and its refusals.
 */
function rewriteOwn(rules: Rules, file: string, text: string): FileSpecifiers {
  const source = parseSource(file, text);
  const final = rules.finals.get(file) ?? file;
  const edits: Edit[] = [];
  const rewrites: SpecifierRewrite[] = [];
  const escapes: SiteNote[] = [];
  const refusals: SiteNote[] = [];
  for (const site of specifierSites(source)) {
    const written = site.node.text;
    const relative = written.startsWith('.');
    if (!relative && (!rules.target.core || !written.startsWith(PACKAGE_PREFIX))) continue;
    const line = lineOf(source, site.node.getStart(source));
    const landed = rules.input.resolve(written, file);
    const reachesOut = landed === undefined || isOutsideRepository(landed) || !landsInPackage(rules, landed);
    if (reachesOut && (landed === undefined || isOutsideRepository(landed) || rules.listed.has(file))) {
      refusals.push({ file, line, text: `'${written}' resolves to ${landed ?? 'nothing'}, outside the move and the package` });
      continue;
    }
    if (relative && rules.finals.has(landed!)) continue;
    const target = rules.finals.get(landed!) ?? landed!;
    const extension = posix.extname(target);
    const to = relativeSpecifier(final, target, relative
      ? written
      : `x${JS_FORM[extension] ?? extension}`);
    if (reachesOut) escapes.push({ file, line, text: `'${written}' reaches ${target}, outside the package: now '${to}'` });
    if (to !== written) {
      edits.push({ end: site.node.end - 1, pos: site.node.getStart(source) + 1, text: to });
      rewrites.push({ file, from: written, line, to });
    }
  }
  return { edits, escapes, refusals, rewrites };
}

/**
 * Step 3's text for one specifier: a file of the package by its subpath,
 * or by its relative path from a file in the package's folder outside its
 * source; a core file by core's subpath, a bare one keeping its text; any
 * other file by its relative path from the importer's new folder.
 *
 * @param rules - The run's lists.
 * @param final - The importer's path after the move.
 * @param written - The specifier as written.
 * @param landed - The file it resolves to, before the move.
 * @returns The specifier after the move.
 */
function importerSpecifier(rules: Rules, final: string, written: string, landed: string): string {
  const { target } = rules;
  const path = rules.finals.get(landed) ?? landed;
  if (path.startsWith(target.source)) {
    if (final.startsWith(target.folder)) {
      return relativeSpecifier(final, path, written);
    }
    return rules.finals.has(landed) || !written.startsWith(target.prefix)
      ? packageSubpath(target, path)
      : written;
  }
  if (path.startsWith(CORE_SOURCE)) {
    return written.startsWith(PACKAGE_PREFIX)
      ? written
      : packageSubpath(CORE_TARGET, path);
  }
  return written.startsWith('.')
    ? relativeSpecifier(final, path, written)
    : written;
}

/**
 * Step 3 over one file outside the package's source, a parked test included.
 *
 * @param rules - The run's lists.
 * @param file - The file's path before the move.
 * @param text - Its text.
 * @returns Its edits and its rewrites.
 */
function rewriteImporter(rules: Rules, file: string, text: string): FileSpecifiers {
  const source = parseSource(file, text);
  const final = rules.finals.get(file) ?? file;
  const parked = final !== file;
  const edits: Edit[] = [];
  const rewrites: SpecifierRewrite[] = [];
  for (const site of specifierSites(source)) {
    const written = site.node.text;
    const landed = rules.input.resolve(written, file);
    if (landed === undefined || isOutsideRepository(landed) || (!parked && !rules.finals.has(landed))) continue;
    const to = importerSpecifier(rules, final, written, landed);
    if (to !== written) {
      edits.push({ end: site.node.end - 1, pos: site.node.getStart(source) + 1, text: to });
      rewrites.push({ file, from: written, line: lineOf(source, site.node.getStart(source)), to });
    }
  }
  return { edits, escapes: [], refusals: [], rewrites };
}

/**
 * Plans the whole move over a file set. Pure: it reads only its input.
 *
 * @param input - The files, their texts, a resolver and the move list.
 * @returns The lists of the six steps and the text of every file written.
 */
export function planPassMoves(input: PassMovesInput): PassMovesPlan {
  const files = new Set(input.files);
  const present = input.present ?? ((path: string): boolean => files.has(path));
  const set = readMoveSet(input, present);
  const target = targetOf(input);
  const rules: Rules = { finals: set.finals, input, listed: new Set(input.moves.map((move) => move.from)), target };
  const forms = proseForms(input.files, set.finals);
  const rewriteToken = (token: string): string | undefined => rewriteMovedPath(token, forms, set.folders);
  const writes = new Map<string, string>();
  const specifiers: SpecifierRewrite[] = [];
  const ownSpecifiers: SpecifierRewrite[] = [];
  const mentions: PathMentions[] = [];
  const pathReads: SiteNote[] = [];
  const movedPathReads: SiteNote[] = [];
  const buildReads: SiteNote[] = [];
  const before = pathTree(input.files);
  const after = pathTree(input.files.map((path) => set.finals.get(path) ?? path));
  const breaksOnMove = (built: BuiltPath): boolean => codeForms(built.path).some((form) => before.has(form))
    && !codeForms(shiftedPath(built.anchor, set.finals.get(built.anchor) ?? built.anchor, built.path)).some((form) => after.has(form));
  const readPaths = pathReader(input);
  const escapes: SiteNote[] = [];
  const refusals: SiteNote[] = [...set.refusals];
  const parkedFrom = new Set(set.parked.map((test) => test.from));

  for (const file of input.files) {
    const text = input.sources.get(file);
    if (text === undefined) continue;
    const edits: Edit[] = [];
    const final = set.finals.get(file) ?? file;
    if (isCodeFile(file)) {
      const intoPackage = set.finals.has(file) && !parkedFrom.has(file);
      if (intoPackage || isImporterScope(target, file)) {
        const result = intoPackage
          ? rewriteOwn(rules, file, text)
          : rewriteImporter(rules, file, text);
        edits.push(...result.edits);
        (intoPackage
          ? ownSpecifiers
          : specifiers).push(...result.rewrites);
        escapes.push(...result.escapes);
        refusals.push(...result.refusals);
      }
      if (set.finals.has(file) && classifyFile(file) === 'test') {
        const broken = new Set(readPaths(file, text).filter((read) => read.paths.some(breaksOnMove))
          .map((read) => read.line));
        text.split('\n').forEach((content, index) => {
          if (IMPORT_META_PATH.test(content) || broken.has(index + 1)) pathReads.push({ file, line: index + 1, text: content.trim() });
        });
      } else if (!set.finals.has(file) && !file.startsWith(CODEMOD_FOLDER)) {
        for (const read of readPaths(file, text)) {
          if (read.paths.some(breaksOnMove)) movedPathReads.push({ file, line: read.line, text: read.text });
        }
      }
    }
    if (isProseScope(file) || isBuildScope(file)) {
      const source = isCodeFile(file)
        ? parseSource(file, text)
        : undefined;
      const spans = source === undefined
        ? [[0, text.length] as const]
        : proseSpans(source, new Set(specifierSites(source).map((site) => site.node.getStart(source))));
      const found = spans.flatMap((span) => tokenEdits(text, span, rewriteToken));
      if (isBuildScope(file)) {
        buildReads.push(...buildNotes(file, text, found));
      } else {
        edits.push(...found);
        if (found.length > 0) mentions.push({ count: found.length, file });
      }
    }
    const next = applyEdits(text, edits);
    if (next === undefined) {
      refusals.push({ file, line: 0, text: 'two rewrites of one span' });
      continue;
    }
    if (next !== text) writes.set(final, next);
  }

  let clusterKeys: readonly PathMove[] = [];
  const clusterText = input.sources.get(CLUSTER_MAP_FILE);
  if (clusterText !== undefined) {
    const renamed = renameClusterMap(clusterText, set.finals);
    clusterKeys = renamed.renamed;
    if (clusterKeys.length > 0) writes.set(CLUSTER_MAP_FILE, renamed.text);
  }

  return {
    buildReads: buildReads.sort(byFileAndLine),
    clusterKeys,
    colocated: set.colocated,
    declared: input.declared ?? [],
    escapes: escapes.sort(byFileAndLine),
    importers: new Set(specifiers.filter((item) => !parkedFrom.has(item.file)).map((item) => item.file)).size,
    left: set.left,
    mentions: mentions.sort((a, b) => a.file.localeCompare(b.file)),
    movedPathReads: movedPathReads.sort(byFileAndLine),
    moves: set.moves,
    ownSpecifiers: ownSpecifiers.sort(byFileAndLine),
    parked: set.parked,
    pathReads: pathReads.sort(byFileAndLine),
    refusals: refusals.sort(byFileAndLine),
    specifiers: specifiers.sort(byFileAndLine),
    target,
    testdata: set.testdata,
    writes,
  };
}

/**
 * Carries a plan out: parks and moves the files, and writes every changed
 * text at its path after the move (`core-package-tree.ts`).
 *
 * @param root - The repository root.
 * @param plan - The plan {@link planPassMoves} answered for that root.
 * @throws {TreeError} When a git call fails.
 */
export function applyPassMoves(root: string, plan: PassMovesPlan): void {
  applyTreeChanges(root, { deleted: [], moves: [...plan.parked, ...plan.moves, ...plan.colocated, ...plan.testdata], writes: plan.writes });
}

/**
 * The files git's index holds, those missing from disk included.
 *
 * @param root - The repository root.
 * @returns Their paths.
 * @throws {TreeError} When git exits non-zero.
 */
function indexFiles(root: string): ReadonlySet<string> {
  const result = Bun.spawnSync(['git', 'ls-files', '-z', '--cached'], { cwd: root, stderr: 'pipe', stdout: 'pipe' });
  if (result.exitCode !== 0) {
    throw new TreeError(`git ls-files failed in ${root} (exit ${result.exitCode}): ${result.stderr.toString().trim()}`);
  }
  return new Set(result.stdout.toString().split('\0')
    .filter((path) => path !== ''));
}

/**
 * Reads a repository and plans its move.
 *
 * @param root - The repository root.
 * @param moves - The move list.
 * @param integrationGlobs - The project's `tests.integration` patterns.
 * @param target - The package the list moves into; core unless handed in.
 *   Its `package.json`'s declared feature packages ({@link declaredFolders})
 *   are handed in as `declared`.
 * @returns The plan.
 * @throws {TreeError} When `git ls-files` fails.
 * @throws {PassTargetError} When the target's `package.json` cannot be read.
 */
export function readPassMoves(root: string, moves: readonly FileMove[], integrationGlobs: readonly string[], target: PassTarget = CORE_TARGET): PassMovesPlan {
  const files = committableFiles(root);
  const sources = new Map<string, string>();
  for (const file of files) {
    if (isCodeFile(file) || file.endsWith('.md') || file === CLUSTER_MAP_FILE || isBuildScope(file)) {
      sources.set(file, readFileSync(join(root, file), 'utf8'));
    }
  }
  return planPassMoves({
    declared: declaredFolders(root, target),
    files,
    integrationGlobs,
    moves,
    present: (path) => existsSync(join(root, path)),
    resolve: bunResolver(root),
    sources,
    target,
    tracked: indexFiles(root),
  });
}

/** Whether a value is a move list: an array of `{ from, to }` string pairs. */
function isMoveList(value: unknown): value is readonly FileMove[] {
  return Array.isArray(value) && value.every((item: unknown) => typeof item === 'object' && item !== null
    && typeof (item as { from?: unknown }).from === 'string' && typeof (item as { to?: unknown }).to === 'string');
}

/**
 * Loads a move list: the one export of the module that is an array of
 * `FileMove`.
 *
 * @param path - The module's absolute path.
 * @returns The list.
 * @throws {PassMovesError} When the module cannot load or holds no list, or two.
 */
export async function loadMoveList(path: string): Promise<readonly FileMove[]> {
  let module: Record<string, unknown>;
  try {
    module = await import(pathToFileURL(path).href) as Record<string, unknown>;
  } catch (error) {
    throw new PassMovesError(`cannot load the move list ${path}: ${error instanceof Error
      ? error.message
      : String(error)}`);
  }
  const lists = Object.values(module).filter(isMoveList);
  if (lists.length !== 1) {
    throw new PassMovesError(`the move list ${path} exports ${lists.length} arrays of FileMove; it must export one`);
  }
  return lists[0]!;
}

function section(title: string, lines: readonly string[]): readonly string[] {
  return [`${title} (${lines.length})`, ...lines.map((line) => `  ${line}`)];
}

/**
 * The lines a run prints: each list with its count, the lines left to the
 * move task, and the refusals.
 *
 * @param plan - The plan.
 * @param dryRun - Whether nothing was written.
 * @returns The lines.
 */
export function reportLines(plan: PassMovesPlan, dryRun: boolean): readonly string[] {
  const move = (item: PathMove): string => `${item.from} -> ${item.to}`;
  const rewrite = (item: SpecifierRewrite): string => `${item.file}:${item.line} '${item.from}' -> '${item.to}'`;
  const note = (item: SiteNote): string => `${item.file}:${item.line} ${item.text}`;
  return [
    `the package: ${plan.target.source}, imported as ${plan.target.prefix}`,
    ...section('declared dependencies', plan.declared),
    ...section('1. moved into the package', plan.moves.map(move)),
    ...section('1. colocated tests moved with them', plan.colocated.map(move)),
    ...section('1. integration tests left at the root, imports rewritten', plan.left),
    ...section('1. testdata files moved with their folder', plan.testdata.map(move)),
    ...section('2. parked tests', plan.parked.map(move)),
    ...section('2. parked tests as README rows', plan.parked.map((test) => readmeRow(plan.target, test))),
    `3. importers rewritten: ${plan.specifiers.length} specifier(s) in ${plan.importers} file(s) outside the move, parked tests apart`,
    ...section('3. specifiers rewritten to subpaths', plan.specifiers.map(rewrite)),
    ...section('4. moved files\' own specifiers rewritten', plan.ownSpecifiers.map(rewrite)),
    ...section('4. left to the move task: moved files outside the list reaching outside the package', plan.escapes.map(note)),
    ...section('5. cluster-map paths renamed', plan.clusterKeys.map(move)),
    `5. moved paths rewritten in prose, comments and strings: ${plan.mentions.reduce((sum, item) => sum + item.count, 0)}`,
    ...section('5. files whose moved paths are rewritten', plan.mentions.map((item) => `${item.file} (${item.count})`)),
    ...section('5. left to the move task: moved paths in the build\'s files, left as written', plan.buildReads.map(note)),
    ...section('6. left to the move task: test lines building a path from import.meta, a folder constant or a relative string', plan.pathReads.map(note)),
    ...section('6. left to the move task: lines outside the move building a path to a moved file', plan.movedPathReads.map(note)),
    ...section('refused', plan.refusals.map(note)),
    dryRun
      ? 'dry run, nothing written.'
      : plan.refusals.length > 0
        ? 'refused, nothing written.'
        : `wrote ${plan.writes.size} file(s).`,
  ];
}

/** The command line, read. */
interface Arguments {
  readonly list: string;
  /** The target's name, `rafa` when `--package=` is absent. */
  readonly packageName: string;
  readonly root: string;
  readonly dryRun: boolean;
}

/** The values of one `<flag>=` among the flags. */
function flagValues(flags: readonly string[], flag: string): readonly string[] {
  return flags.filter((item) => item.startsWith(`${flag}=`)).map((item) => item.slice(flag.length + 1));
}

function readArguments(argv: readonly string[], cwd: string): Arguments | undefined {
  const flags = argv.filter((argument) => argument.startsWith('--'));
  const roots = argv.filter((argument) => !argument.startsWith('--'));
  const lists = flagValues(flags, LIST_FLAG);
  const packages = flagValues(flags, PACKAGE_FLAG);
  const unknown = flags.filter((flag) => flag !== DRY_RUN_FLAG && !flag.startsWith(`${LIST_FLAG}=`) && !flag.startsWith(`${PACKAGE_FLAG}=`));
  if (roots.length > 1 || unknown.length > 0 || lists.length !== 1 || lists[0] === '' || packages.length > 1 || packages[0] === '') {
    return undefined;
  }
  return {
    dryRun: flags.includes(DRY_RUN_FLAG),
    list: resolve(cwd, lists[0]!),
    packageName: packages[0] ?? CORE_TARGET.name,
    root: resolve(cwd, roots[0] ?? '.'),
  };
}

/**
 * The command line: `--list=<file> [--package=<name>] [--dry-run] [<root>]`,
 * the list and the root read from `cwd`, the root defaulting to it and the
 * package to core.
 *
 * @param argv - The arguments after the script.
 * @param cwd - The working folder.
 * @param streams - Where the lines go.
 * @returns 0 when the run finished, 2 when it could not run, named no
 *   workspace member, or refused.
 */
export async function main(argv: readonly string[], cwd: string, streams: PassMovesStreams): Promise<number> {
  const args = readArguments(argv, cwd);
  if (args === undefined) {
    streams.err(USAGE);
    return 2;
  }
  try {
    const target = readPassTarget(args.packageName);
    checkWorkspaceMember(args.root, target);
    const moves = await loadMoveList(args.list);
    const plan = readPassMoves(args.root, moves, (await readTestKindGlobs(args.root)).integration, target);
    if (!args.dryRun && plan.refusals.length === 0) {
      applyPassMoves(args.root, plan);
    }
    reportLines(plan, args.dryRun).forEach((line) => {
      streams.out(line);
    });
    return plan.refusals.length > 0
      ? 2
      : 0;
  } catch (error) {
    if (!(error instanceof PassMovesError) && !(error instanceof TreeError) && !(error instanceof PassTargetError)) {
      throw error;
    }
    streams.err(error.message);
    return 2;
  }
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2), process.cwd(), {
    err: (line) => {
      console.error(line);
    },
    out: (line) => {
      console.log(line);
    },
  }));
}
