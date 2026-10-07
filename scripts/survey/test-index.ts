/**
 * The survey's test index: per test file, the epic's index, and per
 * source file, the test files that reach it. Run from the repository root,
 * `bun scripts/survey/test-index.ts` writes `docs/survey/test-index.json`
 * and `docs/survey/test-index.md`. The JSON is the baseline epic #801
 * holds the package cut to: no test file's index may rise above it.
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
 */

import type { FileKind } from './files';
import type { ImportGraph } from './import-graph';

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, posix } from 'node:path';

import ts from 'typescript';

import { classifyFile, coverageLine, listTrackedFiles } from './files';
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
  /** The support files the walk reaches, sorted. */
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

/**
 * The sorted folders of the source files among `paths`.
 *
 * @param paths - Files reached.
 * @param kindOf - Each file's kind.
 * @returns The folders, sorted, without duplicates.
 */
function sourceFolders(paths: Iterable<string>, kindOf: (path: string) => FileKind): string[] {
  const folders = new Set<string>();
  for (const path of paths) {
    if (kindOf(path) === 'source') {
      folders.add(indexFolder(path));
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
 * @param kindOf - Each file's kind.
 * @returns The entry.
 */
function indexEntry(test: string, walk: TestWalk, spawning: ReadonlySet<string>, kindOf: (path: string) => FileKind): TestIndexEntry {
  const folders = sourceFolders(walk.direct, kindOf);
  const counted = new Set(folders);
  const support = [...walk.direct].filter((path) => kindOf(path) === 'test-support').sort();
  const spawnsVia = [test, ...support].filter((path) => spawning.has(path)).sort();
  const spawns = spawnsVia.length > 0;
  return {
    folder: indexFolder(test),
    folders,
    index: spawns
      ? folders.length * 2
      : folders.length,
    sourceFiles: [...walk.direct].filter((path) => kindOf(path) === 'source').length,
    spawns,
    spawnsVia,
    support,
    supportFolders: sourceFolders(walk.throughSupport, kindOf).filter((folder) => !counted.has(folder)),
    test,
  };
}

/**
 * Computes every test file's index and every source file's reaching tests.
 * Pure: the caller builds the graph and reads the texts (see `main`).
 *
 * @param input - The import graph and the source texts.
 * @returns The index, every list sorted.
 */
export function computeTestIndex(input: TestIndexInput): TestIndex {
  const { graph } = input;
  const kindOf = (path: string): FileKind => classifyFile(path);
  const next = new Map<string, string[]>();
  for (const edge of graph.edges) {
    next.set(edge.from, [...(next.get(edge.from) ?? []), edge.to]);
  }
  const spawning = new Set(
    graph.nodes.filter((path) => kindOf(path) !== 'source' && spawnApis(path, input.sources.get(path) ?? '').length > 0),
  );
  const read = new Set(graph.read);
  const allTests = graph.nodes.filter((path) => kindOf(path) === 'test');
  const reaching = new Map<string, { direct: string[]; support: string[] }>(
    graph.nodes.filter((path) => kindOf(path) === 'source').map((path) => [path, { direct: [], support: [] }]),
  );
  const tests: TestIndexEntry[] = [];
  for (const test of allTests.filter((path) => read.has(path))) {
    const walk = walkTest(test, next, kindOf);
    tests.push(indexEntry(test, walk, spawning, kindOf));
    walk.direct.forEach((path) => reaching.get(path)?.direct.push(test));
    walk.throughSupport.forEach((path) => reaching.get(path)?.support.push(test));
  }
  const sources = [...reaching].map(([source, found]): SourceReach => {
    const folder = indexFolder(source);
    return {
      folder,
      source,
      supportOnlyTests: [...found.support].sort(),
      tests: [...found.direct].sort(),
      testsFromOtherFolders: found.direct.filter((test) => indexFolder(test) !== folder).length,
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
 * Reads the repository at `root` and writes both outputs under
 * `docs/survey/`. The import graph is built here again rather than read
 * from `docs/survey/import-graph.json`, so the scripts run in any order.
 *
 * @param root - The repository root.
 * @returns The paths written, relative to `root`.
 */
export async function main(root: string): Promise<string[]> {
  const tracked = listTrackedFiles(root);
  const sources = new Map<string, string>();
  for (const path of tracked.all) {
    sources.set(path, await Bun.file(join(root, path)).text());
  }
  const metafile = await readMetafile(root, tracked.all);
  const graph = buildImportGraph({ files: tracked.all, metafile, resolve: bunResolver(root), root, sources });
  const index = computeTestIndex({ graph, sources });
  mkdirSync(join(root, OUTPUT_DIR), { recursive: true });
  const jsonPath = `${OUTPUT_DIR}/test-index.json`;
  const markdownPath = `${OUTPUT_DIR}/test-index.md`;
  writeFileSync(join(root, jsonPath), renderTestIndexJson(index));
  writeFileSync(join(root, markdownPath), renderTestIndexMarkdown(index, tracked.all));
  return [jsonPath, markdownPath];
}

if (import.meta.main) {
  try {
    for (const path of await main(process.cwd())) {
      console.log(`wrote ${path}`);
    }
  } catch (err) {
    console.error(err instanceof Error
      ? err.message
      : String(err));
    process.exit(1);
  }
}
