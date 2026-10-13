/**
 * The survey's test index: per test file, the epic's index, and per
 * source file, the test files that reach it. Run from the repository root,
 * `bun scripts/survey/test-index.ts` writes `docs/survey/test-index.json`
 * and `docs/survey/test-index.md`, the survey's record. Run with
 * `--baseline`, it writes `docs/survey/test-index.baseline.json` instead
 * and leaves the other two as they are: the baseline epic #801 holds the
 * package cut to, no test file's index may rise above it. The baseline
 * names the commit it read, and the mode refuses to run when a tracked
 * file in scope differs from that commit, since the script reads the
 * working tree and the commit would then name other text.
 *
 * Run with `--against=<baseline>`, it writes nothing: it reads the working
 * tree, compares each test file's index with the one that baseline holds,
 * prints the comparison, and exits 1 when an index rose (see "The
 * comparison" below).
 *
 * The index of a test file is the number of folders its transitive imports
 * reach, doubled when it spawns a process:
 *
 *   - A folder is the unit a package cut moves: a file under
 *     `packages/<name>/src/` counts as its package, `packages/<name>`; any
 *     other file as the folder it lies in (`src/effort/store`). Only files
 *     of kind `source` (see `files.ts`) count their folder.
 *   - The imports are the edges of the survey's import graph
 *     (`import-graph.ts`), of either kind: a type-only import ties a test
 *     to a package as much as a value one does. A re-export
 *     (`export … from`) is an edge like any other import, so a test that
 *     reaches a file through a barrel reaches the file's folder.
 *   - The walk stops at a `test-support` file: `src/tests/` helpers,
 *     fixtures and fakes. The support files reached are listed apart, and
 *     so is each folder the walk reaches only through them
 *     (`supportFolders`); neither counts toward the index, as the epic
 *     sets test-support and fakes aside.
 *   - A test spawns a process when its own text, or the text of a support
 *     file it reaches, calls `Bun.spawn`, `Bun.spawnSync` or `Bun.$`,
 *     imports `$` from `bun`, or imports `node:child_process` by value.
 *     The calls are read from a TypeScript parse, so a comment or a string
 *     naming them is not one. A source file the test reaches may spawn too
 *     (git, `gh`); that is the code under test, not the test, and does not
 *     double the index.
 *
 * Per source file, `tests` lists the test files whose walk reaches it and
 * `supportOnlyTests` those that reach it only through support files. A
 * test from another folder is one whose own folder, by the unit above,
 * is not the source file's.
 *
 * A test file `bun build` did not reach has no recorded imports: it gets
 * no index, is named under `unindexed`, and counts as not read in the
 * coverage line.
 *
 * The comparison
 *
 * `--against=<baseline>` holds the move of #905 to the baseline, and reads
 * the tree by two rules of its own (`coreRules`), both of which leave the
 * index of a tree with no `src/core/` as the survey counts it:
 *
 *   - every file under `src/core/` counts as one folder, `src/core`, as a
 *     package's files count as their package: the folder is the core
 *     package after the cut (#808);
 *   - a core barrel, one of the files `core-moves.ts` lists as the only
 *     ones a file outside `src/core/` may import, is read as a support
 *     file is: reached, not counted, not walked past. The folders behind
 *     it are listed under `supportFolders` and the barrel under `support`.
 *     A barrel's own text is never read for a spawning call.
 *
 * So a test outside `src/core/` counts nothing for what it imports through
 * a barrel, and a test inside it, which imports its sibling files directly,
 * counts `src/core` once and every folder those files reach.
 *
 * The files read are the ones `git add -A` would commit: tracked, or
 * untracked and covered by no ignore rule, and present on disk. A barrel
 * or a test file written by the task under check is untracked until the
 * loop commits it. A listing of tracked files alone leaves such a test
 * file out of the comparison, and the graph keeps an edge only to a file
 * it was handed (`addEdge`, `import-graph.ts`).
 *
 * Each test file of the tree is one of:
 *
 *   - `risen`, `equal` or `fallen`: it has an index now and the baseline
 *     holds one for it. A test file at a path `core-moves.ts` moves a test
 *     to is compared with the entry under the path it moved from, when the
 *     baseline holds one; any other with the entry under its own path;
 *   - `added`: the baseline holds no index for it. It is new, and held to
 *     nothing;
 *   - `unread`: the baseline holds an index for it and `bun build` reached
 *     no imports of it now, so nothing says its index did not rise.
 *
 * A baseline entry no test file answers is `gone`. The mode exits 1 when a
 * test file is `risen` or `unread`, and 0 otherwise: `added` and `gone`
 * are printed and fail nothing. A test file renamed by hand, outside
 * `core-moves.ts`, therefore shows as one `added` and one `gone`.
 */

import type { CoreMove } from './core-moves';
import type { FileKind, TrackedFiles } from './files';
import type { ImportGraph } from './import-graph';

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, posix } from 'node:path';

import ts from 'typescript';

import { CORE_FOLDER, CORE_MOVES, barrelPaths, movedPaths } from './core-moves';
import { classifyFile, coverageLine, isInScope, listTrackedFiles, splitTrackedFiles } from './files';
import {
  OUTPUT_DIR,
  buildImportGraph,
  bunResolver,
  readMetafile,
  stableJson,
} from './import-graph';

/** What the index is computed from, all of it passed in as data. */
export interface TestIndexInput {
  /** The survey's import graph over every tracked file in scope. */
  readonly graph: ImportGraph;
  /** The source text of each file, read for the calls that spawn a process. */
  readonly sources: ReadonlyMap<string, string>;
}

/** One test file's index and what it was counted from. */
export interface TestIndexEntry {
  /** The repository-relative path of the test file. */
  readonly test: string;
  /** The test's own folder, by the index's unit. */
  readonly folder: string;
  /** The folders its walk reaches through source files, sorted: the ones counted. */
  readonly folders: readonly string[];
  /** `folders.length`, doubled when the test spawns. */
  readonly index: number;
  /** How many source files the walk reaches. */
  readonly sourceFiles: number;
  /** Whether the test or a support file it reaches spawns a process. */
  readonly spawns: boolean;
  /** The files whose text spawns, the test or its support files, sorted. */
  readonly spawnsVia: readonly string[];
  /** The support files the walk reaches, sorted; under `coreRules`, the core barrels too. */
  readonly support: readonly string[];
  /** The folders reached only through support files, sorted; not counted. */
  readonly supportFolders: readonly string[];
}

/** One source file and the test files that reach it. */
export interface SourceReach {
  /** The repository-relative path of the source file. */
  readonly source: string;
  /** Its folder, by the index's unit. */
  readonly folder: string;
  /** The test files whose walk reaches it, sorted. */
  readonly tests: readonly string[];
  /** How many of `tests` lie in another folder. */
  readonly testsFromOtherFolders: number;
  /** The test files that reach it only through support files, sorted. */
  readonly supportOnlyTests: readonly string[];
}

/** The whole index: what both outputs show. */
export interface TestIndex {
  /** One entry per indexed test file, sorted by path. */
  readonly tests: readonly TestIndexEntry[];
  /** One entry per source file, sorted by path. */
  readonly sources: readonly SourceReach[];
  /** The test files with no recorded imports, sorted. */
  readonly unindexed: readonly string[];
  /** The files whose imports were read, for the coverage line. */
  readonly read: readonly string[];
}

/** How a walk reads a file: the folder it counts as, and whether it is set aside. */
export interface IndexRules {
  /** The folder a file counts as. */
  readonly folderOf: (path: string) => string;
  /** Whether a source file is read as a support file is: reached, not counted, not walked past. */
  readonly setsAside: (path: string) => boolean;
}

/** One test's record in the baseline. */
export interface BaselineEntry {
  /** The folders its index was counted from, sorted. */
  readonly folders: readonly string[];
  /** Its index when the baseline was taken. */
  readonly index: number;
  /** Whether it spawned a process then. */
  readonly spawns: boolean;
  /** The files whose text spawned then, sorted. */
  readonly spawnsVia: readonly string[];
}

/** The baseline as `parseBaseline` reads it back. */
export interface TestIndexBaseline {
  /** The commit whose tree the baseline was read from. */
  readonly commit: string;
  /** Each indexed test's record, keyed by the path it had at that commit. */
  readonly tests: ReadonlyMap<string, BaselineEntry>;
  /** The test files that had no index then, sorted. */
  readonly unindexed: readonly string[];
}

/** One test file's index now beside the one the baseline holds for it. */
export interface IndexChange {
  /** The test file's path now. */
  readonly test: string;
  /** The path the baseline holds it under: its own, or the one it moved from. */
  readonly baselineTest: string;
  /** Its index in the baseline. */
  readonly before: number;
  /** Its index now. */
  readonly after: number;
  /** The folders counted now and not in the baseline, sorted. */
  readonly gained: readonly string[];
  /** The folders counted in the baseline and not now, sorted. */
  readonly lost: readonly string[];
  /** The files it spawns through now, when it did not spawn in the baseline; empty otherwise. */
  readonly spawnsSince: readonly string[];
}

/** Every test file of the tree against the baseline, each list sorted by path. */
export interface BaselineComparison {
  /** The commit the baseline names. */
  readonly commit: string;
  /** The test files whose index is above the baseline's. */
  readonly risen: readonly IndexChange[];
  /** The test files whose index is the baseline's. */
  readonly equal: readonly IndexChange[];
  /** The test files whose index is below the baseline's. */
  readonly fallen: readonly IndexChange[];
  /** The test files the baseline holds no index for: new, held to nothing. */
  readonly added: readonly string[];
  /** The baseline's entries no test file answers, at their path or the one they move to. */
  readonly gone: readonly string[];
  /** The test files the baseline holds an index for and that have none now. */
  readonly unread: readonly string[];
}

/** A mode that writes files: the survey's two, or the baseline. */
export type WritingMode = 'baseline' | 'survey';

/** The comparing mode, with the baseline it reads. */
export interface AgainstMode {
  /** The baseline's path, absolute or relative to the repository root. */
  readonly against: string;
}

/** What a command line asks for: files written, or a comparison. */
export type TestIndexMode = AgainstMode | WritingMode;

/** The flag that picks the baseline mode. */
export const BASELINE_FLAG = '--baseline';

/** The flag that picks the comparing mode, up to the baseline's path. */
export const AGAINST_FLAG = '--against=';

/** The one folder every file under `src/core/` counts as under `coreRules`. */
export const CORE_UNIT = CORE_FOLDER.replace(/\/$/, '');

/** The baseline's path, relative to the repository root. */
export const BASELINE_PATH = `${OUTPUT_DIR}/test-index.baseline.json`;

/** How many test files the summary lists by index. */
export const TOP_INDEXES = 20;

/** How many source files the summary lists by tests from other folders. */
export const TOP_REACHED = 20;

const PACKAGE_FILE = /^(packages\/[^/]+)\/src\//;
const SPAWNING_MEMBERS: ReadonlySet<string> = new Set(['$', 'spawn', 'spawnSync']);
const CHILD_PROCESS: ReadonlySet<string> = new Set(['child_process', 'node:child_process']);

/**
 * The folder a file counts as: `packages/<name>` for a file of a package,
 * the folder it lies in for any other.
 *
 * @param path - A repository-relative path.
 * @returns The folder, by the index's unit.
 */
export function indexFolder(path: string): string {
  return PACKAGE_FILE.exec(path)?.[1] ?? posix.dirname(path);
}

/** The survey's rules: a file counts as its folder or its package, and none is set aside. */
export const SURVEY_RULES: IndexRules = { folderOf: indexFolder, setsAside: () => false };

/**
 * The rules the comparison reads the tree by: `src/core/` is one folder,
 * and a core barrel is set aside.
 *
 * @param barrels - The core barrels; those of `core-moves.ts` unless a test plants its own.
 * @returns The rules.
 */
export function coreRules(barrels: readonly string[] = barrelPaths()): IndexRules {
  const aside = new Set(barrels);
  return {
    folderOf: (path) => (path.startsWith(CORE_FOLDER)
      ? CORE_UNIT
      : indexFolder(path)),
    setsAside: (path) => aside.has(path),
  };
}

/**
 * Whether an import declaration brings in a binding that runs: not
 * `import type`, and not a named list whose every element is `type`.
 *
 * @param node - An import declaration.
 * @returns `true` when the import survives to run time.
 */
function importsValue(node: ts.ImportDeclaration): boolean {
  const clause = node.importClause;
  if (clause === undefined) {
    return true;
  }
  if (clause.isTypeOnly) {
    return false;
  }
  const bindings = clause.namedBindings;
  if (clause.name !== undefined || bindings === undefined || !ts.isNamedImports(bindings)) {
    return true;
  }
  return bindings.elements.length === 0 || bindings.elements.some((element) => !element.isTypeOnly);
}

/**
 * The spawning call or import a node is, if it is one.
 *
 * @param node - Any node of a parsed source file.
 * @returns How it spawns (`Bun.spawn`, `node:child_process`, …), or `undefined`.
 */
function spawnApiOf(node: ts.Node): string | undefined {
  if (ts.isPropertyAccessExpression(node)
    && ts.isIdentifier(node.expression)
    && node.expression.text === 'Bun'
    && SPAWNING_MEMBERS.has(node.name.text)) {
    return `Bun.${node.name.text}`;
  }
  if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier) || !importsValue(node)) {
    return undefined;
  }
  const module = node.moduleSpecifier.text;
  if (CHILD_PROCESS.has(module)) {
    return module;
  }
  const bindings = node.importClause?.namedBindings;
  const importsDollar = bindings !== undefined
    && ts.isNamedImports(bindings)
    && bindings.elements.some((element) => !element.isTypeOnly && (element.propertyName ?? element.name).text === '$');
  return module === 'bun' && importsDollar
    ? '$ from bun'
    : undefined;
}

/**
 * The ways a source text spawns a process, read from a TypeScript parse.
 *
 * @param path - The file's path, which picks the parser's script kind.
 * @param text - The file's source text.
 * @returns Each spawning call or import found, sorted, without duplicates.
 */
export function spawnApis(path: string, text: string): string[] {
  const kind = /\.(?:js|mjs)$/.test(path)
    ? ts.ScriptKind.JS
    : ts.ScriptKind.TS;
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, false, kind);
  const found = new Set<string>();
  const visit = (node: ts.Node): void => {
    const api = spawnApiOf(node);
    if (api !== undefined) {
      found.add(api);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return [...found].sort();
}

/**
 * Every file reachable from `starts` along `next`, the starts included.
 * A file `expand` refuses is reached but not walked past.
 *
 * @param starts - The files the walk begins at.
 * @param next - Each file's import targets.
 * @param expand - Whether the walk goes on past a file.
 * @returns The files reached.
 */
function reach(
  starts: Iterable<string>,
  next: ReadonlyMap<string, readonly string[]>,
  expand: (path: string) => boolean,
): Set<string> {
  const seen = new Set(starts);
  const queue = [...seen];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const path = queue[cursor] ?? '';
    if (!expand(path)) {
      continue;
    }
    for (const target of next.get(path) ?? []) {
      if (!seen.has(target)) {
        seen.add(target);
        queue.push(target);
      }
    }
  }
  return seen;
}

/** What one test's two walks reach. */
interface TestWalk {
  /** Files reached without passing a support file, the test included. */
  readonly direct: ReadonlySet<string>;
  /** Files reached only past a support file. */
  readonly throughSupport: ReadonlySet<string>;
}

/**
 * Walks from a test file: first up to the support files, then on past them.
 *
 * @param test - The test file.
 * @param next - Each file's import targets.
 * @param kindOf - Each file's kind.
 * @returns What the walk reaches directly and only through support files.
 */
function walkTest(test: string, next: ReadonlyMap<string, readonly string[]>, kindOf: (path: string) => FileKind): TestWalk {
  const direct = reach([test], next, (path) => path === test || kindOf(path) !== 'test-support');
  const support = [...direct].filter((path) => kindOf(path) === 'test-support');
  const past = reach(support, next, () => true);
  return { direct, throughSupport: new Set([...past].filter((path) => !direct.has(path))) };
}

/** How one index reads a file: its kind once the rules have set files aside, and its folder. */
interface FileReading {
  /** Each file's kind; a source file the rules set aside reads as `test-support`. */
  readonly kindOf: (path: string) => FileKind;
  /** The folder a file counts as. */
  readonly folderOf: (path: string) => string;
}

/**
 * The sorted folders of the source files among `paths`.
 *
 * @param paths - Files reached.
 * @param reading - Each file's kind and folder.
 * @returns The folders, sorted, without duplicates.
 */
function sourceFolders(paths: Iterable<string>, reading: FileReading): string[] {
  const folders = new Set<string>();
  for (const path of paths) {
    if (reading.kindOf(path) === 'source') {
      folders.add(reading.folderOf(path));
    }
  }
  return [...folders].sort();
}

/**
 * One test's entry, from its walk and the spawning calls of the files read.
 *
 * @param test - The test file.
 * @param walk - What its walk reached.
 * @param spawning - The files whose text spawns.
 * @param reading - Each file's kind and folder.
 * @returns The entry.
 */
function indexEntry(test: string, walk: TestWalk, spawning: ReadonlySet<string>, reading: FileReading): TestIndexEntry {
  const { kindOf } = reading;
  const folders = sourceFolders(walk.direct, reading);
  const counted = new Set(folders);
  const support = [...walk.direct].filter((path) => kindOf(path) === 'test-support').sort();
  const spawnsVia = [test, ...support].filter((path) => spawning.has(path)).sort();
  const spawns = spawnsVia.length > 0;
  return {
    folder: reading.folderOf(test),
    folders,
    index: spawns
      ? folders.length * 2
      : folders.length,
    sourceFiles: [...walk.direct].filter((path) => kindOf(path) === 'source').length,
    spawns,
    spawnsVia,
    support,
    supportFolders: sourceFolders(walk.throughSupport, reading).filter((folder) => !counted.has(folder)),
    test,
  };
}

/**
 * Computes every test file's index and every source file's reaching tests.
 * Pure: the caller builds the graph and reads the texts (see `main`).
 *
 * @param input - The import graph and the source texts.
 * @param rules - How a file is read; the survey's rules unless the comparison passes its own.
 * @returns The index, every list sorted.
 */
export function computeTestIndex(input: TestIndexInput, rules: IndexRules = SURVEY_RULES): TestIndex {
  const { graph } = input;
  const kindOf = (path: string): FileKind => {
    const kind = classifyFile(path);
    return kind === 'source' && rules.setsAside(path)
      ? 'test-support'
      : kind;
  };
  const reading: FileReading = { folderOf: rules.folderOf, kindOf };
  const next = new Map<string, string[]>();
  for (const edge of graph.edges) {
    next.set(edge.from, [...(next.get(edge.from) ?? []), edge.to]);
  }
  // By its own kind, not the rules': a file set aside is a source file still, and its spawning is the code under test's.
  const spawning = new Set(
    graph.nodes.filter((path) => classifyFile(path) !== 'source' && spawnApis(path, input.sources.get(path) ?? '').length > 0),
  );
  const read = new Set(graph.read);
  const allTests = graph.nodes.filter((path) => kindOf(path) === 'test');
  const reaching = new Map<string, { direct: string[]; support: string[] }>(
    graph.nodes.filter((path) => kindOf(path) === 'source').map((path) => [path, { direct: [], support: [] }]),
  );
  const tests: TestIndexEntry[] = [];
  for (const test of allTests.filter((path) => read.has(path))) {
    const walk = walkTest(test, next, kindOf);
    tests.push(indexEntry(test, walk, spawning, reading));
    walk.direct.forEach((path) => reaching.get(path)?.direct.push(test));
    walk.throughSupport.forEach((path) => reaching.get(path)?.support.push(test));
  }
  const sources = [...reaching].map(([source, found]): SourceReach => {
    const folder = rules.folderOf(source);
    return {
      folder,
      source,
      supportOnlyTests: [...found.support].sort(),
      tests: [...found.direct].sort(),
      testsFromOtherFolders: found.direct.filter((test) => rules.folderOf(test) !== folder).length,
    };
  });
  return { read: [...read].sort(), sources, tests, unindexed: allTests.filter((path) => !read.has(path)) };
}

/**
 * The index as `docs/survey/test-index.json` holds it: each test keyed by
 * its path, each source file keyed by its path, and the unindexed tests.
 *
 * @param index - The computed index.
 * @returns The JSON text.
 */
export function renderTestIndexJson(index: TestIndex): string {
  return stableJson({
    sources: Object.fromEntries(index.sources.map(({ source, ...reached }) => [source, reached])),
    tests: Object.fromEntries(index.tests.map(({ test, ...entry }) => [test, entry])),
    unindexed: index.unindexed,
  });
}

/**
 * Orders two strings by UTF-16 code unit, the order `sort` gives.
 *
 * @param left - One string.
 * @param right - The other.
 * @returns A negative, zero or positive number.
 */
function byText(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right
    ? -1
    : 1;
}

/**
 * A list of paths as one markdown cell, each in code, or `-` when empty.
 *
 * @param paths - The paths.
 * @returns The cell.
 */
function codeCell(paths: readonly string[]): string {
  return paths.length === 0
    ? '-'
    : paths.map((path) => `\`${path}\``).join(', ');
}

/**
 * The table of the highest indexes, highest first, then by path.
 *
 * @param tests - Every indexed test.
 * @returns The table's lines.
 */
function topIndexRows(tests: readonly TestIndexEntry[]): string[] {
  const top = [...tests]
    .sort((left, right) => right.index - left.index || byText(left.test, right.test))
    .slice(0, TOP_INDEXES);
  return [
    '| Rank | Test | Index | Folders | Spawns via | Support-only folders |',
    '| --- | --- | --- | --- | --- | --- |',
    ...top.map((entry, rank) => `| ${rank + 1} | \`${entry.test}\` | ${entry.index} | ${entry.folders.length} | `
      + `${codeCell(entry.spawnsVia)} | ${codeCell(entry.supportFolders)} |`),
  ];
}

/**
 * The table of the source files most reached from other folders, most
 * first, then by path; a file no test from another folder reaches is left
 * out.
 *
 * @param sources - Every source file.
 * @returns The table's lines.
 */
function topReachedRows(sources: readonly SourceReach[]): string[] {
  const top = sources
    .filter((source) => source.testsFromOtherFolders > 0)
    .sort((left, right) => right.testsFromOtherFolders - left.testsFromOtherFolders || byText(left.source, right.source))
    .slice(0, TOP_REACHED);
  return [
    '| Rank | Source file | Tests from other folders | All tests | Support-only tests |',
    '| --- | --- | --- | --- | --- |',
    ...top.map((source, rank) => `| ${rank + 1} | \`${source.source}\` | ${source.testsFromOtherFolders} | `
      + `${source.tests.length} | ${source.supportOnlyTests.length} |`),
  ];
}

/**
 * The index as `docs/survey/test-index.md` holds it: the coverage line,
 * the counts, the highest indexes, and the source files reached by the
 * most test files from other folders.
 *
 * @param index - The computed index.
 * @param tracked - The tracked files in scope, for the coverage line.
 * @returns The markdown text, ending in a newline.
 */
export function renderTestIndexMarkdown(index: TestIndex, tracked: readonly string[]): string {
  const spawning = index.tests.filter((entry) => entry.spawns).length;
  const unreached = index.sources.filter((source) => source.tests.length === 0).length;
  const lines = [
    '# Test index',
    '',
    coverageLine(index.read, tracked),
    '',
    `${index.tests.length} test files indexed, ${spawning} of them spawning a process; `
    + `${index.sources.length} source files, ${unreached} of them reached by no test outside support files. `
    + 'A test\'s index is the number of folders (a package counts as one) its transitive imports reach '
    + 'through source files, doubled when it spawns a process; folders reached only through `src/tests/` '
    + 'support files and fakes are listed apart and not counted.',
    '',
    `## The ${TOP_INDEXES} highest indexes`,
    '',
    ...topIndexRows(index.tests),
    '',
    `## The ${TOP_REACHED} source files reached by the most test files from other folders`,
    '',
    ...topReachedRows(index.sources),
  ];
  if (index.unindexed.length > 0) {
    lines.push('', '## Unindexed tests', '', 'No `bun build` entry reached these; their imports were not read.', '');
    lines.push(...index.unindexed.map((path) => `- \`${path}\``));
  }
  return `${lines.join('\n')}\n`;
}

/**
 * The index as `docs/survey/test-index.baseline.json` holds it: the commit
 * read, each test keyed by its path with its index and what the index was
 * counted from, and the unindexed tests. The per-source lists and the
 * support files are left out: the baseline is compared by test file, and
 * neither counts toward an index.
 *
 * @param index - The computed index.
 * @param commit - The commit whose tree the index was read from.
 * @returns The JSON text.
 */
export function renderTestIndexBaselineJson(index: TestIndex, commit: string): string {
  return stableJson({
    commit,
    tests: Object.fromEntries(index.tests.map((entry) => [
      entry.test,
      { folders: entry.folders, index: entry.index, spawns: entry.spawns, spawnsVia: entry.spawnsVia },
    ])),
    unindexed: index.unindexed,
  });
}

/**
 * Whether a parsed JSON value is an object with keys, not an array or `null`.
 *
 * @param value - Any parsed value.
 * @returns `true` when its keys can be read.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Whether a parsed JSON value is a list of strings.
 *
 * @param value - Any parsed value.
 * @returns `true` when every element is a string.
 */
function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/**
 * One test's record, read from the baseline's `tests`.
 *
 * @param test - The key it lies under.
 * @param value - The parsed value.
 * @returns The record.
 * @throws When a field is missing or of another type.
 */
function baselineEntry(test: string, value: unknown): BaselineEntry {
  if (!isRecord(value)
    || !isStringList(value['folders'])
    || typeof value['index'] !== 'number'
    || !Number.isInteger(value['index'])
    || value['index'] < 0
    || typeof value['spawns'] !== 'boolean'
    || !isStringList(value['spawnsVia'])) {
    throw new Error(`not a test-index baseline: tests["${test}"] must hold folders, a whole index, spawns and spawnsVia`);
  }
  return { folders: value['folders'], index: value['index'], spawns: value['spawns'], spawnsVia: value['spawnsVia'] };
}

/**
 * Reads back what `renderTestIndexBaselineJson` wrote.
 *
 * @param text - The baseline file's text.
 * @returns The baseline.
 * @throws When the text is not JSON, or not the baseline's shape.
 */
export function parseBaseline(text: string): TestIndexBaseline {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    const reason = err instanceof Error
      ? err.message
      : String(err);
    throw new Error(`not a test-index baseline: ${reason}`);
  }
  if (!isRecord(parsed) || typeof parsed['commit'] !== 'string' || !isRecord(parsed['tests']) || !isStringList(parsed['unindexed'])) {
    throw new Error('not a test-index baseline: it must hold a commit, tests keyed by path, and unindexed');
  }
  const tests = new Map(Object.entries(parsed['tests']).map(([test, value]) => [test, baselineEntry(test, value)]));
  return { commit: parsed['commit'], tests, unindexed: parsed['unindexed'] };
}

/**
 * One test's index now beside its baseline record.
 *
 * @param entry - The test's entry now.
 * @param baselineTest - The path the baseline holds it under.
 * @param before - Its record in the baseline.
 * @returns The change, with the folders gained and lost.
 */
function indexChange(entry: TestIndexEntry, baselineTest: string, before: BaselineEntry): IndexChange {
  const was = new Set(before.folders);
  const now = new Set(entry.folders);
  return {
    after: entry.index,
    baselineTest,
    before: before.index,
    gained: entry.folders.filter((folder) => !was.has(folder)),
    lost: before.folders.filter((folder) => !now.has(folder)),
    spawnsSince: before.spawns
      ? []
      : entry.spawnsVia,
    test: entry.test,
  };
}

/**
 * Compares an index with a baseline, test file by test file (see "The
 * comparison" in the module note). Pure: the caller computes the index
 * and reads the baseline.
 *
 * @param index - The index of the tree now, computed under `coreRules`.
 * @param baseline - The baseline it is held to.
 * @param moves - The moves a test file is followed through; those of `core-moves.ts` unless a test plants its own.
 * @returns Each test file under what it is, and the baseline's entries left unanswered.
 */
export function compareToBaseline(index: TestIndex, baseline: TestIndexBaseline, moves: readonly CoreMove[] = CORE_MOVES): BaselineComparison {
  const movedFrom = new Map(movedPaths(moves).map((moved) => [moved.to, moved.from]));
  const heldUnder = (test: string): string | undefined => [movedFrom.get(test), test]
    .find((path) => path !== undefined && baseline.tests.has(path));
  const answered = new Set<string>();
  const risen: IndexChange[] = [];
  const equal: IndexChange[] = [];
  const fallen: IndexChange[] = [];
  const added: string[] = [];
  const unread: string[] = [];
  for (const entry of index.tests) {
    const baselineTest = heldUnder(entry.test);
    const before = baselineTest === undefined
      ? undefined
      : baseline.tests.get(baselineTest);
    if (baselineTest === undefined || before === undefined) {
      added.push(entry.test);
      continue;
    }
    answered.add(baselineTest);
    const change = indexChange(entry, baselineTest, before);
    const bucket = change.after === change.before
      ? equal
      : change.after > change.before
        ? risen
        : fallen;
    bucket.push(change);
  }
  for (const test of index.unindexed) {
    const baselineTest = heldUnder(test);
    if (baselineTest === undefined) {
      added.push(test);
      continue;
    }
    answered.add(baselineTest);
    unread.push(test);
  }
  const byTest = (left: IndexChange, right: IndexChange): number => byText(left.test, right.test);
  return {
    added: added.sort(),
    commit: baseline.commit,
    equal: equal.sort(byTest),
    fallen: fallen.sort(byTest),
    gone: [...baseline.tests.keys()].filter((path) => !answered.has(path)).sort(),
    risen: risen.sort(byTest),
    unread: unread.sort(),
  };
}

/**
 * Whether a comparison holds the tree to its baseline: no test file's
 * index rose, and none the baseline indexed went unread.
 *
 * @param comparison - The comparison.
 * @returns `false` when the comparing mode exits 1.
 */
export function holdsBaseline(comparison: BaselineComparison): boolean {
  return comparison.risen.length === 0 && comparison.unread.length === 0;
}

/**
 * The line a compared test file is printed as: its path, the path the
 * baseline holds it under when it moved, both indexes, and what changed.
 *
 * @param change - The test file's change.
 * @returns The line, indented.
 */
function changeLine(change: IndexChange): string {
  const name = change.baselineTest === change.test
    ? change.test
    : `${change.test} (in the baseline as ${change.baselineTest})`;
  const details = [
    ...change.gained.length > 0
      ? [`gained ${change.gained.join(', ')}`]
      : [],
    ...change.lost.length > 0
      ? [`lost ${change.lost.join(', ')}`]
      : [],
    ...change.spawnsSince.length > 0
      ? [`now spawns via ${change.spawnsSince.join(', ')}`]
      : [],
  ];
  const tail = details.length > 0
    ? ` (${details.join('; ')})`
    : '';
  return `  ${name}: ${change.before} -> ${change.after}${tail}`;
}

/**
 * A heading with its lines below it, or nothing when there are no lines.
 *
 * @param heading - What the lines are.
 * @param lines - One line per test file, unindented.
 * @returns The block's lines, opened by an empty one.
 */
function namedBlock(heading: string, lines: readonly string[]): string[] {
  return lines.length === 0
    ? []
    : ['', `${heading} (${lines.length}):`, ...lines];
}

/**
 * The comparison as the comparing mode prints it: the baseline read, the
 * counts, then each risen test file with its two indexes and what it
 * gained, and the unread, added and gone ones by name. Equal and fallen
 * test files are counted and not named.
 *
 * @param comparison - The comparison.
 * @param baselinePath - The baseline's path as it was passed.
 * @returns The text, without a closing newline.
 */
export function renderComparison(comparison: BaselineComparison, baselinePath: string): string {
  const { added, equal, fallen, gone, risen, unread } = comparison;
  const held = risen.length + equal.length + fallen.length;
  return [
    `test-index: ${held} test file(s) held to ${baselinePath}, read at commit ${comparison.commit}: `
    + `${risen.length} risen, ${equal.length} equal, ${fallen.length} fallen`,
    `test-index: ${added.length} new, ${gone.length} gone, ${unread.length} not read`,
    ...namedBlock('Risen, the index is above the baseline', risen.map(changeLine)),
    ...namedBlock('Not read, the baseline holds an index and bun build reached no imports now', unread.map((test) => `  ${test}`)),
    ...namedBlock('New, the baseline holds no index and nothing is held', added.map((test) => `  ${test}`)),
    ...namedBlock('Gone, no test file answers the baseline entry', gone.map((test) => `  ${test}`)),
  ].join('\n');
}

/**
 * The mode a command line asks for.
 *
 * @param args - The arguments after the script's path.
 * @returns `survey` when there is no argument, `baseline` when the one
 *   argument is `--baseline`, and the baseline's path under `against`
 *   when it is `--against=<baseline>`.
 * @throws When any other argument is passed, more than one, or `--against=` with no path.
 */
export function parseMode(args: readonly string[]): TestIndexMode {
  const [only] = args;
  if (only === undefined) {
    return 'survey';
  }
  if (args.length === 1 && only === BASELINE_FLAG) {
    return 'baseline';
  }
  if (args.length === 1 && only.startsWith(AGAINST_FLAG) && only.length > AGAINST_FLAG.length) {
    return { against: only.slice(AGAINST_FLAG.length) };
  }
  throw new Error(
    `unknown arguments: ${args.join(' ')}. Usage: bun scripts/survey/test-index.ts [${BASELINE_FLAG} | ${AGAINST_FLAG}<baseline>]`,
  );
}

/**
 * Runs git in `root` and returns what it printed.
 *
 * @param root - The repository root.
 * @param args - The git arguments.
 * @returns Standard output.
 * @throws When git cannot run or exits non-zero.
 */
function gitOutput(root: string, args: readonly string[]): string {
  const result = Bun.spawnSync(['git', ...args], { cwd: root, stderr: 'pipe', stdout: 'pipe' });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} failed in ${root} (exit ${result.exitCode}): ${result.stderr.toString().trim()}`);
  }
  return result.stdout.toString();
}

/**
 * The commit the working tree's files in scope are the text of: `HEAD`,
 * once no tracked file in scope differs from it, staged or not.
 *
 * @param root - The repository root.
 * @returns The full hash of `HEAD`.
 * @throws When there is no commit, or a tracked file in scope differs from it.
 */
export function readCommit(root: string): string {
  const commit = gitOutput(root, ['rev-parse', '--verify', 'HEAD^{commit}']).trim();
  const changed = gitOutput(root, ['diff', '--name-only', '-z', 'HEAD', '--', 'src', 'packages'])
    .split('\0')
    .filter(isInScope)
    .sort();
  if (changed.length > 0) {
    throw new Error(`cannot name the commit read: ${changed.length} tracked file(s) in scope differ from ${commit}: ${changed.join(', ')}`);
  }
  return commit;
}

/**
 * The files in scope a commit of the working tree would hold: tracked, or
 * untracked and covered by no ignore rule, and present on disk.
 *
 * @param root - The repository root.
 * @returns The files in scope, split by kind.
 * @throws When `git ls-files` cannot run or exits non-zero.
 */
export function listCommittableFiles(root: string): TrackedFiles {
  const listed = gitOutput(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', 'src', 'packages']);
  return splitTrackedFiles(listed.split('\0').filter((path) => path !== '' && existsSync(join(root, path))));
}

/**
 * Builds the import graph of `files` in the repository at `root` and
 * computes the index from it. The graph is built here again rather than
 * read from `docs/survey/import-graph.json`, so the scripts run in any
 * order.
 *
 * @param root - The repository root.
 * @param files - The files to read, repository-relative.
 * @param rules - How a file is read.
 * @returns The index.
 * @throws When a file cannot be read or `bun build` exits non-zero.
 */
async function readIndex(root: string, files: readonly string[], rules: IndexRules): Promise<TestIndex> {
  const sources = new Map<string, string>();
  for (const path of files) {
    sources.set(path, await Bun.file(join(root, path)).text());
  }
  const metafile = await readMetafile(root, files);
  const graph = buildImportGraph({ files, metafile, resolve: bunResolver(root), root, sources });
  return computeTestIndex({ graph, sources }, rules);
}

/**
 * Reads the repository at `root` under `coreRules` and compares it with a
 * baseline. Writes nothing.
 *
 * @param root - The repository root.
 * @param baselinePath - The baseline's path, absolute or relative to `root`.
 * @returns The comparison; `holdsBaseline` says whether it passes.
 * @throws When the baseline cannot be read or is not one, or the tree cannot be read.
 */
export async function against(root: string, baselinePath: string): Promise<BaselineComparison> {
  const file = isAbsolute(baselinePath)
    ? baselinePath
    : join(root, baselinePath);
  if (!existsSync(file)) {
    throw new Error(`cannot read the baseline: no file at ${file}`);
  }
  const baseline = parseBaseline(readFileSync(file, 'utf8'));
  const index = await readIndex(root, listCommittableFiles(root).all, coreRules());
  return compareToBaseline(index, baseline);
}

/**
 * Reads the repository at `root` and writes the survey's two outputs under
 * `docs/survey/`, or the baseline alone in `baseline` mode.
 *
 * @param root - The repository root.
 * @param mode - What to write; the survey's two files unless `baseline`.
 * @returns The paths written, relative to `root`.
 * @throws In `baseline` mode, when `readCommit` cannot name the commit read.
 */
export async function main(root: string, mode: WritingMode = 'survey'): Promise<string[]> {
  const commit = mode === 'baseline'
    ? readCommit(root)
    : undefined;
  const tracked = listTrackedFiles(root);
  const index = await readIndex(root, tracked.all, SURVEY_RULES);
  mkdirSync(join(root, OUTPUT_DIR), { recursive: true });
  if (commit !== undefined) {
    writeFileSync(join(root, BASELINE_PATH), renderTestIndexBaselineJson(index, commit));
    return [BASELINE_PATH];
  }
  const jsonPath = `${OUTPUT_DIR}/test-index.json`;
  const markdownPath = `${OUTPUT_DIR}/test-index.md`;
  writeFileSync(join(root, jsonPath), renderTestIndexJson(index));
  writeFileSync(join(root, markdownPath), renderTestIndexMarkdown(index, tracked.all));
  return [jsonPath, markdownPath];
}

if (import.meta.main) {
  try {
    const mode = parseMode(process.argv.slice(2));
    if (typeof mode === 'string') {
      for (const path of await main(process.cwd(), mode)) {
        console.log(`wrote ${path}`);
      }
    } else {
      const comparison = await against(process.cwd(), mode.against);
      console.log(renderComparison(comparison, mode.against));
      if (!holdsBaseline(comparison)) {
        process.exit(1);
      }
    }
  } catch (err) {
    console.error(err instanceof Error
      ? err.message
      : String(err));
    process.exit(1);
  }
}
