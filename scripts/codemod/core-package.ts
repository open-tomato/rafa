/**
 * The core-package codemod: moves core into its workspace package,
 * `packages/rafa/` (#1090), and rewrites every path that names it. It is
 * a program over lists, not a judgement: every list it acts on is printed
 * with its count, and `--dry-run` prints them and changes nothing.
 *
 * Usage, from the repository root or naming it:
 *
 *   bun scripts/codemod/core-package.ts [--dry-run] [<root>]
 *
 * ## What it reads
 *
 * The files `git add -A` would commit (tracked, or untracked and not
 * ignored) and present on disk. Core is what `CORE_FOLDERS` and
 * `CORE_NAMED_FILES` of `scripts/survey/core-moves.ts` name before the
 * move: `src/core/`, `src/effort/store/`, `src/ports/` and four files.
 * Every specifier is resolved by `bunResolver` of
 * `scripts/survey/import-graph.ts`, from the importer's folder, so a
 * `paths`-mapped name resolves as `bun` resolves it.
 *
 * ## The eight steps
 *
 *  1. Moves every file under the core folders, the named files and their
 *     colocated test files to the same path under `CORE_SOURCE`: a file at
 *     `src/<p>` goes to `packages/rafa/src/<p>`. The folders' `testdata/`
 *     folders, lock files and the plan fixture go with them. A colocated
 *     test of a named file is a test file in its folder whose name opens
 *     with the file's stem and that has no source file of its own, the
 *     rule `core-moves.ts` states.
 *  2. Parks each test file of that set whose imports, resolved, reach a
 *     file of the repository outside core, at `CORE_PARKED_TESTS` under
 *     its path below `src/`. An import of a re-export file (step 3) is
 *     read as an import of the core file it names, and an import of the
 *     trimmed tracker as one of core when every name it takes is a name of
 *     the deleted block. The couplings of each are printed.
 *  3. Deletes the re-export files: a file outside core that carries the
 *     `#1090` note and holds nothing but `export … from` declarations into
 *     core. A file that carries the note and holds other code as well
 *     (`src/utils/tracker.ts`) loses those declarations, its re-export
 *     block, and keeps the rest.
 *  4. Rewrites every specifier of a code file under `src/`, `scripts/`,
 *     `packages/<name>/src/` or at the root that resolves into core from
 *     outside the package (a parked test included) to the core file's
 *     subpath ({@link coreSubpath}): static imports, `import type`,
 *     `export … from`, `import()`, `require()`, `import('…')` types and
 *     `declare module`. A specifier that named a deleted re-export takes
 *     the subpath of the file it named. A declaration that takes names of
 *     the tracker's deleted block and names it keeps as well is split in
 *     two, the block's names going to their subpath on a line of their
 *     own after it.
 *  5. Rewrites a moved file's specifier that named a root re-export to the
 *     relative path of the core file it named, and a parked file's
 *     relative specifier of a root file to the relative path from its new
 *     folder. Every other relative specifier of a moved file keeps its
 *     text: the package mirrors the layout under `src/`.
 *  6. Writes the two one-line build entries, `src/effort/store/index.ts`
 *     and `src/ports/index.ts`, at the old barrel paths
 *     ({@link BUILD_ENTRIES}).
 *  7. Renames the keys and the `outside` entries of
 *     `docs/survey/cluster-map.json` that name a moved or parked file, in
 *     place. Rewrites the core paths named in prose (`.md` files) and in
 *     the comments and string literals of code files under `context/`,
 *     `src/`, `scripts/` and `packages/` to the package paths
 *     ({@link rewritePathToken}). It leaves `docs/survey/`, the files of
 *     {@link LEFT_TO_HAND}, the codemod's own files ({@link OWN_FILES}),
 *     and every file under a `testdata/` or a module's `fixtures/` folder,
 *     whose text is a frozen capture.
 *  8. Flips `CORE_FOLDERS` to `[CORE_SOURCE]` and `CORE_NAMED_FILES` to
 *     `[]` in `scripts/survey/core-moves.ts`.
 *
 * It lists and leaves each line of a moved or parked test that builds a
 * path from `import.meta`, since that test now sits two folders deeper,
 * and each declaration of the trimmed file whose names it cannot read (a
 * default or namespace binding, `export *`, `import()`).
 *
 * ## What it refuses
 *
 * A run with any refusal writes nothing: a re-export file that names two
 * core files or `export *`, a missing `CORE_FOLDERS` or
 * `CORE_NAMED_FILES`, and two rewrites of one span. A tree whose core is
 * already its package (`CORE_FOLDERS` naming `CORE_SOURCE`, or
 * `CORE_SOURCE` on disk) is not read at all.
 *
 * Exit codes: 0 the run finished; 2 it could not run or refused.
 */
import type { Edit, Reexports, SiteNote, SpecifierSite } from './core-package-text';
import type { ResolveImport } from '../survey/import-graph';

import { existsSync, readFileSync } from 'node:fs';
import { join, posix, resolve } from 'node:path';

import ts from 'typescript';

import { isCodeFile } from '../survey/core-barrels';
import { CORE_FOLDERS, CORE_NAMED_FILES, CORE_PARKED_TESTS, CORE_SOURCE, isCoreFile } from '../survey/core-moves';
import { classifyFile } from '../survey/files';
import { bunResolver } from '../survey/import-graph';

import {
  applyEdits,
  CODE_EXTENSION,
  flipEdits,
  importedName,
  lineOf,
  parseSource,
  proseSpans,
  readReexports,
  relativeSpecifier,
  renameClusterMap,
  specifierSites,
  splitDeclaration,
  takenNames,
  tokenEdits,
} from './core-package-text';
import { applyTreeChanges, committableFiles, TreeError } from './core-package-tree';

/** The flag that prints the lists and changes nothing. */
export const DRY_RUN_FLAG = '--dry-run';

/** What a wrong command line is answered with. */
export const USAGE: string = `Usage: bun scripts/codemod/core-package.ts [${DRY_RUN_FLAG}] [<root>]`;

/** The folder core's files sit under before the move, with its closing `/`. */
export const SOURCE_ROOT = 'src/';

/** The name a file outside the package imports core by, with its closing `/`. */
export const PACKAGE_PREFIX = '@open-tomato/rafa/';

/** The file whose two constants step 8 flips. */
export const CORE_LOCATION_FILE = 'scripts/survey/core-moves.ts';

/** The cluster map whose keys step 7 renames. */
export const CLUSTER_MAP_FILE = 'docs/survey/cluster-map.json';

/** The folders whose prose and comments step 7 rewrites, each with its closing `/`. */
export const PROSE_ROOTS: readonly string[] = ['context/', 'packages/', 'scripts/', 'src/'];

/** The files whose core paths the move task rewrites by hand, read by no step 7. */
export const LEFT_TO_HAND: readonly string[] = [CORE_LOCATION_FILE, 'scripts/survey/cut-table.ts'];

/**
 * What the codemod's own files open with. Step 7 leaves them: they spell
 * the tree before the move, and their tests plant it.
 */
export const OWN_FILES = 'scripts/codemod/core-package';

/** One build entry the root keeps at an old barrel path. */
export interface BuildEntry {
  /** Its path, repository-relative. */
  readonly path: string;
  /** The subpath it re-exports, under {@link PACKAGE_PREFIX}. */
  readonly subpath: string;
}

/** The two build entries of step 6. */
export const BUILD_ENTRIES: readonly BuildEntry[] = [
  { path: 'src/effort/store/index.ts', subpath: 'store' },
  { path: 'src/ports/index.ts', subpath: 'ports' },
];

/** One file that changes path. */
export interface PathMove {
  readonly from: string;
  readonly to: string;
}

/** One parked test, with the files outside core it reaches. */
export interface ParkedTest extends PathMove {
  /** The files outside core its imports reach, sorted. */
  readonly couplings: readonly string[];
}

/** One specifier that changes, named by the importer's path before the move. */
export interface SpecifierRewrite {
  readonly file: string;
  readonly line: number;
  readonly from: string;
  readonly to: string;
}

/** How many core paths step 7 rewrites in one file, named by its path before the move. */
export interface PathMentions {
  readonly file: string;
  readonly count: number;
}

export type { SiteNote } from './core-package-text';

/** How many specifiers reach core from the files outside it, before the move. */
export interface CoreReach {
  /** Specifiers of files outside core that resolve into it, augmentations included. */
  readonly specifiers: number;
  /** The files that hold them. */
  readonly files: number;
  /** Those already spelled with {@link PACKAGE_PREFIX}. */
  readonly spelled: number;
}

/** Everything one run would do, and the text of every file it writes. */
export interface CorePackagePlan {
  /** Step 1, by path before the move, sorted. */
  readonly moves: readonly PathMove[];
  /** Step 2, sorted. */
  readonly parked: readonly ParkedTest[];
  /** Step 3: the deleted re-export files, sorted. */
  readonly deleted: readonly string[];
  /** Step 3: the files that lose their re-export block, sorted. */
  readonly trimmed: readonly string[];
  /** Step 4, sorted by file and line. */
  readonly specifiers: readonly SpecifierRewrite[];
  /** Step 5, sorted by file and line. */
  readonly ownSpecifiers: readonly SpecifierRewrite[];
  /** Step 6: the build entries written. */
  readonly entries: readonly string[];
  /** Step 7: the cluster-map paths renamed. */
  readonly clusterKeys: readonly PathMove[];
  /** Step 7: the core paths rewritten, per file, sorted by file. */
  readonly mentions: readonly PathMentions[];
  /** Step 8: the constants flipped. */
  readonly flipped: readonly string[];
  /** The reading of step 4 before any rewrite. */
  readonly reach: CoreReach;
  /** The `import.meta` path lines of moved and parked tests, left to the move task. */
  readonly pathReads: readonly SiteNote[];
  /**
   * The declarations of the trimmed file whose names cannot be read (a
   * default or namespace binding, `*`, `import()`): left as they are, to
   * the move task.
   */
  readonly unread: readonly SiteNote[];
  /** What the codemod will not rewrite; a run with any writes nothing. */
  readonly refusals: readonly SiteNote[];
  /** The text of every file written, by its path after the move. */
  readonly writes: ReadonlyMap<string, string>;
}

/** The inputs of {@link planCorePackage}. */
export interface CorePackageInput {
  /** Every committable file, repository-relative. */
  readonly files: readonly string[];
  /** The text of each code file, `.md` file, the cluster map and `core-moves.ts`. */
  readonly sources: ReadonlyMap<string, string>;
  readonly resolve: ResolveImport;
  /** The core folders before the move; `CORE_FOLDERS` unless a test plants its own. */
  readonly folders?: readonly string[];
  /** The named core files before the move; `CORE_NAMED_FILES` unless a test plants its own. */
  readonly named?: readonly string[];
}

/** Where `main` writes. */
export interface CorePackageStreams {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

/** The run could not start, or refused. */
export class CorePackageError extends Error {}

const IMPORT_META_PATH = /import\.meta\.(?:dir|dirname|url|path)\b/;

/**
 * The subpath a file outside the package imports a core file by: its path
 * below `src/` with a code extension and a closing `/index` dropped, and
 * `effort/store` spelled `store`.
 *
 * @param path - A core file's path before the move, under `src/`.
 * @returns The specifier, such as `@open-tomato/rafa/core/config`.
 */
export function coreSubpath(path: string): string {
  const below = path.slice(SOURCE_ROOT.length).replace(CODE_EXTENSION, '')
    .replace(/\/index$/, '');
  const named = below === 'effort/store' || below.startsWith('effort/store/')
    ? `store${below.slice('effort/store'.length)}`
    : below;
  return `${PACKAGE_PREFIX}${named}`;
}

/**
 * Where a moved file lands: the same path below {@link CORE_SOURCE}.
 *
 * @param path - Its path before the move, under `src/`.
 * @returns Its path in the package.
 */
export function packagePath(path: string): string {
  return `${CORE_SOURCE}${path.slice(SOURCE_ROOT.length)}`;
}

/**
 * Where a parked test lands: its path below `src/` under {@link CORE_PARKED_TESTS}.
 *
 * @param path - Its path before the move, under `src/`.
 * @returns Its parked path.
 */
export function parkedPath(path: string): string {
  return `${CORE_PARKED_TESTS}${path.slice(SOURCE_ROOT.length)}`;
}

/**
 * The text a core path takes after the move, or `undefined` when it is
 * not one: a moved or parked file by its full path, else a path under a
 * core folder, or the folder itself, under {@link CORE_SOURCE}.
 *
 * @param token - A path as written, opening with `src/`.
 * @param finals - The path after the move of each moved and parked file.
 * @param folders - The core folders before the move.
 * @returns The path after the move, or `undefined`.
 */
export function rewritePathToken(
  token: string,
  finals: ReadonlyMap<string, string>,
  folders: readonly string[],
): string | undefined {
  const exact = finals.get(token);
  if (exact !== undefined) {
    return exact;
  }
  return folders.some((folder) => token.startsWith(folder) || token === folder.slice(0, -1))
    ? packagePath(token)
    : undefined;
}

/** Whether a path lies under a `testdata/` folder or a module's `fixtures/` folder. */
function isFrozen(path: string): boolean {
  const folders = path.split('/').slice(0, -1);
  return folders.includes('testdata') || folders.some((folder, depth) => folder === 'fixtures' && depth > 1);
}

/** Whether a path is a file whose specifiers step 4 reads. */
function isSpecifierScope(path: string): boolean {
  return isCodeFile(path)
    && (path.startsWith(SOURCE_ROOT) || path.startsWith('scripts/') || /^packages\/[^/]+\/src\//.test(path) || !path.includes('/'));
}

/** Whether a resolved location is outside the repository. */
function isOutsideRepository(landed: string): boolean {
  return landed.startsWith('/') || landed.includes('node_modules/') || /^[a-z]+:/.test(landed);
}

/** The core files and the colocated tests of the named files, sorted. */
function readMoveSet(input: CorePackageInput, folders: readonly string[], named: readonly string[]): readonly string[] {
  const all = new Set(input.files);
  const tests = input.files.filter((file) => named.some((path) => {
    if (classifyFile(file) !== 'test' || posix.dirname(file) !== posix.dirname(path)) {
      return false;
    }
    const stem = posix.basename(path).replace(CODE_EXTENSION, '');
    const own = posix.basename(file).replace(/\.test(\.[^.]+)$/, '$1');
    const ownStem = own.replace(CODE_EXTENSION, '');
    return ownStem === stem || (ownStem.startsWith(`${stem}-`) && !all.has(posix.join(posix.dirname(file), own)));
  }));
  return [...new Set([...input.files.filter((file) => isCoreFile(file, folders, named)), ...tests])].sort();
}

/** What a specifier lands on once re-exports are read through, or `undefined` when it leaves the repository or reaches nothing. */
interface Landing {
  /** The file it resolves to. */
  readonly resolved: string;
  /** The file it means: a deleted re-export's core file, the tracker block's core file when it takes only block names. */
  readonly meant: string;
  /** The tracker block names it takes alongside other names, when it splits. */
  readonly split?: { readonly block: readonly ts.ImportSpecifier[] | readonly ts.ExportSpecifier[]; readonly target: string };
  /** Why it is left as it is, when the names it takes cannot be read. */
  readonly unread?: string;
}

function land(input: CorePackageInput, reexports: Reexports, site: SpecifierSite, file: string): Landing | undefined {
  const resolved = input.resolve(site.node.text, file);
  if (resolved === undefined || isOutsideRepository(resolved)) {
    return undefined;
  }
  const deleted = reexports.deleted.get(resolved);
  if (deleted !== undefined) {
    return { meant: deleted, resolved };
  }
  const trimmed = reexports.trimmed.get(resolved);
  if (trimmed === undefined) {
    return { meant: resolved, resolved };
  }
  const elements = site.declaration === undefined
    ? undefined
    : takenNames(site.declaration);
  if (elements === undefined) {
    return { meant: resolved, resolved, unread: 'takes the trimmed file by default, namespace, `*` or `import()`' };
  }
  const block = elements.filter((element) => trimmed.names.has(importedName(element)));
  if (block.length === 0) {
    return { meant: resolved, resolved };
  }
  return block.length === elements.length
    ? { meant: trimmed.target, resolved }
    : { meant: resolved, resolved, split: { block: block as readonly ts.ImportSpecifier[], target: trimmed.target } };
}

/**
 * Whether a span lies inside one of the declarations step 3 removes.
 *
 * @param removals - The removals of the file.
 * @param pos - The span's start.
 * @param end - The span's end.
 * @returns `true` when a removal covers it.
 */
function isRemoved(removals: readonly Edit[], pos: number, end: number): boolean {
  return removals.some((removal) => pos >= removal.pos && end <= removal.end);
}

/** What one file's specifiers come to. */
interface FileSpecifiers {
  readonly edits: readonly Edit[];
  readonly outside: readonly SpecifierRewrite[];
  readonly own: readonly SpecifierRewrite[];
  readonly reached: number;
  readonly spelled: number;
  readonly unread: readonly SiteNote[];
}

/** The context every file's specifier rewrite reads. */
interface Rules {
  readonly input: CorePackageInput;
  readonly reexports: Reexports;
  readonly isCore: (path: string) => boolean;
  readonly moved: ReadonlySet<string>;
  readonly finals: ReadonlyMap<string, string>;
}

/**
 * Steps 4 and 5 over one file.
 *
 * @param rules - The run's lists.
 * @param file - The file's path before the move.
 * @param source - The parsed file.
 * @returns Its edits, its rewrites and its reading.
 */
function rewriteSpecifiers(rules: Rules, file: string, source: ts.SourceFile): FileSpecifiers {
  const inPackage = rules.moved.has(file) && rules.finals.get(file)?.startsWith(CORE_SOURCE) === true;
  const finalFile = rules.finals.get(file) ?? file;
  const parked = rules.moved.has(file) && !inPackage;
  const edits: Edit[] = [];
  const outside: SpecifierRewrite[] = [];
  const own: SpecifierRewrite[] = [];
  const unread: SiteNote[] = [];
  let reached = 0;
  let spelled = 0;
  const removals = rules.reexports.edits.get(file) ?? [];
  const live = specifierSites(source).filter((site) => !isRemoved(removals, site.node.getStart(source), site.node.end));
  for (const site of live) {
    const landing = land(rules.input, rules.reexports, site, file);
    if (landing === undefined) {
      continue;
    }
    const line = lineOf(source, site.node.getStart(source));
    const written = site.node.text;
    if (landing.unread !== undefined) {
      unread.push({ file, line, text: `'${written}' ${landing.unread}` });
      continue;
    }
    const intoCore = rules.isCore(landing.meant);
    if (!rules.moved.has(file) && intoCore) {
      reached += 1;
      spelled += written.startsWith(PACKAGE_PREFIX)
        ? 1
        : 0;
    }
    const replace = (to: string, list: SpecifierRewrite[]): void => {
      if (to !== written) {
        edits.push({ end: site.node.end - 1, pos: site.node.getStart(source) + 1, text: to });
        list.push({ file, from: written, line, to });
      }
    };
    if (landing.split !== undefined) {
      const declaration = site.declaration!;
      const blockTo = inPackage
        ? relativeSpecifier(finalFile, rules.finals.get(landing.split.target) ?? landing.split.target, written)
        : coreSubpath(landing.split.target);
      const keptTo = parked && written.startsWith('.')
        ? relativeSpecifier(finalFile, landing.resolved, written)
        : written;
      edits.push({
        end: declaration.end,
        pos: declaration.getStart(source),
        text: splitDeclaration(source, declaration, keptTo, landing.split.block, blockTo),
      });
      (inPackage
        ? own
        : outside).push({ file, from: written, line, to: `${keptTo} + ${blockTo}` });
      continue;
    }
    if (inPackage) {
      if (landing.meant !== landing.resolved && intoCore) {
        replace(relativeSpecifier(finalFile, rules.finals.get(landing.meant) ?? landing.meant, written), own);
      }
      continue;
    }
    if (intoCore) {
      replace(coreSubpath(landing.meant), outside);
    } else if (parked && written.startsWith('.')) {
      replace(relativeSpecifier(finalFile, rules.finals.get(landing.meant) ?? landing.meant, written), own);
    }
  }
  return { edits, outside, own, reached, spelled, unread };
}

/**
 * Step 2: the files outside core a test's imports reach.
 *
 * @param rules - The run's lists, before any test is parked.
 * @param file - The test's path.
 * @returns The files, sorted.
 */
function couplingsOf(rules: Omit<Rules, 'finals' | 'moved'>, file: string): readonly string[] {
  const text = rules.input.sources.get(file);
  if (text === undefined || !isCodeFile(file)) {
    return [];
  }
  const reached = new Set<string>();
  for (const site of specifierSites(parseSource(file, text))) {
    const landing = land(rules.input, rules.reexports, site, file);
    if (landing !== undefined && !rules.isCore(landing.meant)) {
      reached.add(landing.meant);
    }
  }
  return [...reached].sort();
}

/** The text of one build entry. */
function buildEntryText(entry: BuildEntry): string {
  return [
    '/**',
    ` * The root's build entry for \`${PACKAGE_PREFIX}${entry.subpath}\`: \`bun build\` writes`,
    ' * the `dist/` file the root\'s `exports` names from this path, until #808',
    ' * publishes core itself. The code lives in core\'s package, `packages/rafa/`.',
    ' */',
    `export * from '${PACKAGE_PREFIX}${entry.subpath}';`,
    '',
  ].join('\n');
}

function byFileAndLine(a: { readonly file: string; readonly line: number }, b: { readonly file: string; readonly line: number }): number {
  return a.file.localeCompare(b.file) || a.line - b.line;
}

/**
 * Plans the whole move over a file set. Pure: it reads only its input.
 *
 * @param input - The files, their texts and a resolver.
 * @returns The lists of the eight steps and the text of every file written.
 * @throws {CorePackageError} When core is already its package.
 */
export function planCorePackage(input: CorePackageInput): CorePackagePlan {
  const folders = input.folders ?? CORE_FOLDERS;
  const named = input.named ?? CORE_NAMED_FILES;
  if (folders.includes(CORE_SOURCE)) {
    throw new CorePackageError(`core is already its package: CORE_FOLDERS names ${CORE_SOURCE}`);
  }
  const moveSet = readMoveSet(input, folders, named);
  const moved = new Set(moveSet);
  const isCore = (path: string): boolean => moved.has(path) || isCoreFile(path, folders, named);
  const reexports = readReexports(input, isCore);
  const parked = moveSet
    .filter((file) => classifyFile(file) === 'test')
    .map((file) => ({ couplings: couplingsOf({ input, isCore, reexports }, file), from: file, to: parkedPath(file) }))
    .filter((test) => test.couplings.length > 0);
  const parkedFrom = new Set(parked.map((test) => test.from));
  const moves = moveSet.filter((file) => !parkedFrom.has(file)).map((file) => ({ from: file, to: packagePath(file) }));
  const finals = new Map<string, string>([...moves, ...parked].map((move) => [move.from, move.to]));
  const rules: Rules = { finals, input, isCore, moved, reexports };
  const rewriteToken = (token: string): string | undefined => rewritePathToken(token, finals, folders);

  const writes = new Map<string, string>();
  const specifiers: SpecifierRewrite[] = [];
  const ownSpecifiers: SpecifierRewrite[] = [];
  const mentions: PathMentions[] = [];
  const pathReads: SiteNote[] = [];
  const unread: SiteNote[] = [];
  const refusals: SiteNote[] = [...reexports.refusals];
  let flipped: readonly string[] = [];
  let reach = { files: 0, specifiers: 0, spelled: 0 };
  const proseScope = (file: string): boolean => PROSE_ROOTS.some((root) => file.startsWith(root))
    && !LEFT_TO_HAND.includes(file) && !file.startsWith(OWN_FILES) && !isFrozen(file);

  for (const file of input.files) {
    const text = input.sources.get(file);
    if (text === undefined || reexports.deleted.has(file)) {
      continue;
    }
    const removals = reexports.edits.get(file) ?? [];
    const edits: Edit[] = [...removals];
    if (isCodeFile(file)) {
      const source = parseSource(file, text);
      const sites = specifierSites(source);
      if (isSpecifierScope(file)) {
        const result = rewriteSpecifiers(rules, file, source);
        edits.push(...result.edits);
        specifiers.push(...result.outside);
        ownSpecifiers.push(...result.own);
        unread.push(...result.unread);
        reach = {
          files: reach.files + (result.reached > 0
            ? 1
            : 0),
          specifiers: reach.specifiers + result.reached,
          spelled: reach.spelled + result.spelled,
        };
      }
      if (proseScope(file)) {
        const positions = new Set(sites.map((site) => site.node.getStart(source)));
        const found = proseSpans(source, positions).flatMap((span) => tokenEdits(text, span, rewriteToken))
          .filter((edit) => !isRemoved(removals, edit.pos, edit.end));
        edits.push(...found);
        if (found.length > 0) mentions.push({ count: found.length, file });
      }
      if (file === CORE_LOCATION_FILE) {
        const flip = flipEdits(source);
        edits.push(...flip.edits);
        flipped = flip.flipped;
      }
      if (moved.has(file) && classifyFile(file) === 'test') {
        text.split('\n').forEach((content, index) => {
          if (IMPORT_META_PATH.test(content)) pathReads.push({ file, line: index + 1, text: content.trim() });
        });
      }
    } else if (file.endsWith('.md') && proseScope(file)) {
      const found = tokenEdits(text, [0, text.length], rewriteToken);
      edits.push(...found);
      if (found.length > 0) mentions.push({ count: found.length, file });
    }
    const next = applyEdits(text, edits);
    if (next === undefined) {
      refusals.push({ file, line: 1, text: 'two rewrites of one span' });
      continue;
    }
    const to = finals.get(file) ?? file;
    if (next !== text || to !== file) {
      writes.set(to, next);
    }
  }

  let clusterKeys: readonly PathMove[] = [];
  const clusterText = input.sources.get(CLUSTER_MAP_FILE);
  if (clusterText !== undefined) {
    const renamed = renameClusterMap(clusterText, finals);
    clusterKeys = renamed.renamed;
    if (renamed.text !== clusterText) writes.set(CLUSTER_MAP_FILE, renamed.text);
  }
  if (flipped.length !== 2) {
    refusals.push({ file: CORE_LOCATION_FILE, line: 1, text: 'holds no CORE_FOLDERS and CORE_NAMED_FILES to flip' });
  }
  const entries = BUILD_ENTRIES.filter((entry) => moved.has(entry.path));
  for (const entry of entries) writes.set(entry.path, buildEntryText(entry));

  return {
    clusterKeys,
    deleted: [...reexports.deleted.keys()].sort(),
    entries: entries.map((entry) => entry.path),
    flipped,
    mentions: mentions.sort((a, b) => a.file.localeCompare(b.file)),
    moves,
    ownSpecifiers: ownSpecifiers.sort(byFileAndLine),
    parked,
    pathReads: pathReads.sort(byFileAndLine),
    reach,
    refusals: refusals.sort(byFileAndLine),
    specifiers: specifiers.sort(byFileAndLine),
    trimmed: [...reexports.trimmed.keys()].sort(),
    unread: unread.sort(byFileAndLine),
    writes,
  };
}

/**
 * Carries a plan out: parks and moves the files, deletes the re-export
 * files, and writes every changed text at its path after the move
 * (`core-package-tree.ts`).
 *
 * @param root - The repository root.
 * @param plan - The plan {@link planCorePackage} answered for that root.
 * @throws {TreeError} When a git call fails.
 */
export function applyCorePackage(root: string, plan: CorePackagePlan): void {
  applyTreeChanges(root, { deleted: plan.deleted, moves: [...plan.parked, ...plan.moves], writes: plan.writes });
}

/** Where core is before the move: the folders and the named files. */
export interface CoreLists {
  readonly folders: readonly string[];
  readonly named: readonly string[];
}

/** The lists of `scripts/survey/core-moves.ts`. */
export const CORE_LISTS: CoreLists = { folders: CORE_FOLDERS, named: CORE_NAMED_FILES };

/**
 * Reads a repository and plans its move.
 *
 * @param root - The repository root.
 * @param lists - Where core is; {@link CORE_LISTS} unless a test plants its own.
 * @returns The plan.
 * @throws {CorePackageError} When core is already its package.
 * @throws {TreeError} When `git ls-files` fails.
 */
export function readCorePackage(root: string, lists: CoreLists = CORE_LISTS): CorePackagePlan {
  if (existsSync(join(root, CORE_SOURCE))) {
    throw new CorePackageError(`core is already its package: ${CORE_SOURCE} exists`);
  }
  const files = committableFiles(root);
  const sources = new Map<string, string>();
  for (const file of files) {
    if (isCodeFile(file) || file.endsWith('.md') || file === CLUSTER_MAP_FILE) {
      sources.set(file, readFileSync(join(root, file), 'utf8'));
    }
  }
  return planCorePackage({ files, resolve: bunResolver(root), sources, ...lists });
}

function section(title: string, lines: readonly string[]): readonly string[] {
  return [`${title} (${lines.length})`, ...lines.map((line) => `  ${line}`)];
}

/**
 * The lines a run prints: each list with its count, the reading of step 4,
 * the lines left to the move task, and the refusals.
 *
 * @param plan - The plan.
 * @param dryRun - Whether nothing was written.
 * @returns The lines.
 */
export function reportLines(plan: CorePackagePlan, dryRun: boolean): readonly string[] {
  const rewrite = (item: SpecifierRewrite): string => `${item.file}:${item.line} '${item.from}' -> '${item.to}'`;
  return [
    ...section('1. moved into the package', plan.moves.map((move) => `${move.from} -> ${move.to}`)),
    ...section('2. parked tests', plan.parked.map((test) => `${test.from} -> ${test.to} (reaches ${test.couplings.join(', ')})`)),
    ...section('3. deleted re-export files', plan.deleted),
    ...section('3. trimmed re-export blocks', plan.trimmed),
    `4. specifiers into core from outside it: ${plan.reach.specifiers} in ${plan.reach.files} file(s), ${plan.reach.spelled} already spelled ${PACKAGE_PREFIX}`,
    ...section('4. specifiers rewritten to subpaths', plan.specifiers.map(rewrite)),
    ...section('5. moved and parked files\' own specifiers rewritten', plan.ownSpecifiers.map(rewrite)),
    ...section('6. build entries written', plan.entries),
    ...section('7. cluster-map paths renamed', plan.clusterKeys.map((move) => `${move.from} -> ${move.to}`)),
    `7. core paths rewritten in prose, comments and strings: ${plan.mentions.reduce((sum, item) => sum + item.count, 0)}`,
    ...section('7. files whose core paths are rewritten', plan.mentions.map((item) => `${item.file} (${item.count})`)),
    ...section('8. constants flipped', plan.flipped),
    ...section('left to the move task: test lines building a path from import.meta', plan.pathReads.map((note) => `${note.file}:${note.line} ${note.text}`)),
    ...section('left to the move task: declarations of the trimmed file whose names cannot be read', plan.unread.map((note) => `${note.file}:${note.line} ${note.text}`)),
    ...section('refused', plan.refusals.map((note) => `${note.file}:${note.line} ${note.text}`)),
    dryRun
      ? 'dry run, nothing written.'
      : plan.refusals.length > 0
        ? 'refused, nothing written.'
        : `wrote ${plan.writes.size} file(s).`,
  ];
}

/**
 * The command line: `[--dry-run] [<root>]`, the root defaulting to `cwd`.
 *
 * @param argv - The arguments after the script.
 * @param cwd - The working folder.
 * @param streams - Where the lines go.
 * @param lists - Where core is; {@link CORE_LISTS} unless a test plants its own.
 * @returns 0 when the run finished, 2 when it could not run or refused.
 */
export function main(argv: readonly string[], cwd: string, streams: CorePackageStreams, lists: CoreLists = CORE_LISTS): number {
  const flags = argv.filter((argument) => argument.startsWith('--'));
  const roots = argv.filter((argument) => !argument.startsWith('--'));
  if (roots.length > 1 || flags.some((flag) => flag !== DRY_RUN_FLAG)) {
    streams.err(USAGE);
    return 2;
  }
  const root = resolve(cwd, roots[0] ?? '.');
  const dryRun = flags.includes(DRY_RUN_FLAG);
  try {
    const plan = readCorePackage(root, lists);
    if (!dryRun && plan.refusals.length === 0) {
      applyCorePackage(root, plan);
    }
    reportLines(plan, dryRun).forEach((line) => {
      streams.out(line);
    });
    return plan.refusals.length > 0
      ? 2
      : 0;
  } catch (error) {
    if (!(error instanceof CorePackageError) && !(error instanceof TreeError)) {
      throw error;
    }
    streams.err(error.message);
    return 2;
  }
}

if (import.meta.main) {
  process.exit(main(process.argv.slice(2), process.cwd(), {
    err: (line) => {
      console.error(line);
    },
    out: (line) => {
      console.log(line);
    },
  }));
}
