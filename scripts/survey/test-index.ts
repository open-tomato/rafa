/**
 * The survey's test index: per test file, the epic's index, and per
 * source file, the test files that reach it. The script has three modes,
 * each run from the repository root:
 *
 *   - `bun scripts/survey/test-index.ts` (the survey) writes
 *     `docs/survey/test-index.json` and `docs/survey/test-index.md`, the
 *     survey's record, counting folders (see below).
 *   - `--baseline --map=<file>` (the record) writes
 *     `docs/survey/test-index.baseline.json` instead and leaves the other
 *     two as they are: the record epic #801 holds the package cut to, read
 *     in projected packages (`test-index-record.ts`). It reads the commit
 *     (`readCommit`), the map, the test kinds (`readTestKindGlobs`) and the
 *     workspace members (`readMembers`), computes the index under
 *     `packageRules`, and writes the record through `renderRecordJson`,
 *     its header naming the map as passed with the sha256 of its bytes,
 *     the commit and the bin's reach. It reads the tracked files in scope,
 *     the text of the commit it names, and refuses to run when a tracked
 *     file in scope differs from that commit, since it reads the working
 *     tree and the commit would then name other text. When a file is
 *     unplaced it writes nothing and exits 1 naming each one.
 *   - `--against=<record> --map=<file>` (the guard) writes nothing: it
 *     reads the record (`parseRecord`) and the map, computes the index of
 *     the working tree under `packageRules`, runs `checkHeader` and
 *     `compareToRecord` (`test-index-guard.ts`), prints `renderGuard` and
 *     then each unplaced file, and exits 1 when `holdsRecord` is `false`
 *     (a refusal, a risen test or an unread one) or a file is unplaced.
 *
 * Either flag is refused without `--map=<file>`, and `--map=<file>` is
 * refused alone; the modes, the flags and `parseMode`, which reads them,
 * lie in `test-index-args.ts`. The map is the cut table,
 * `docs/survey/cut-table.json` as `scripts/survey/cut-table.ts` writes it,
 * read by `cut-map.ts`: a file's unit is the `name` of the `packages[]`
 * row whose `files` list it, or the `folder` of the `unassigned[]` entry
 * whose `files` list it (`src/ci/`). A file listed nowhere takes its
 * folder's unit through `cut-map.ts` (the one unit of its directory's
 * listed files, or of the nearest folder above it holding any, else the
 * one row naming its longest folder), and is unplaced only when that
 * places it nowhere.
 *
 * The rule per kind, which the record and the guard apply: a test's kind
 * is read from its name through `tests.contract` and `tests.integration`
 * of the project's config, every other test file a unit test. A unit test
 * and a contract test meet their rule when the units their walk reaches
 * are their own unit alone; a use-case test reaches real code everywhere
 * and meets its rule when none of its own specifiers enters another unit
 * through no public entry (the `exports` keys of the workspace member
 * that holds the landing). A test that does not meet its rule lies on the
 * record's `unsorted` list, which may only shrink: the guard names a test
 * that does not meet its rule and is not on the list as risen.
 *
 * The index of a test file under the survey's rules is the number of
 * folders its transitive imports reach, doubled when it spawns a process:
 *
 *   - A folder is the unit a package cut moves: a file under
 *     `packages/<name>/src/` counts as its package, `packages/<name>`; any
 *     other file as the folder it lies in (`packages/rafa/src/effort/store`). Only files
 *     of kind `source` (see `files.ts`) count their folder.
 *   - The imports are the edges of the survey's import graph
 *     (`import-graph.ts`), of either kind under the survey's rules. Under
 *     `packageRules` (below) one edge is not followed: a type-only import
 *     (`kind: 'type'`) whose target the map places in core's unit,
 *     `@open-tomato/rafa-core` (`CORE_PACKAGE` of `cut-table.ts`), adds no
 *     unit, no source file and no reaching test, since a type-only import
 *     of core ties a test to no unit. A value import of core, and a
 *     type-only import of any other unit, is followed. The rules carry
 *     this as `follows`, which the test walk consults per edge. A re-export
 *     (`export … from`) is an edge like any other import, so a test that
 *     reaches a file through a barrel reaches the file's folder. An import
 *     of a facade (`packages/rafa-<name>/index.ts`), or of its commands
 *     entry (`packages/rafa-<name>/commands.ts`), is read through that
 *     member's table: an edge to the file each name taken is re-exported
 *     from, never to the facade or the entry.
 *   - The walk stops at a `test-support` file: `src/tests/` helpers,
 *     fixtures and fakes. The support files reached are listed apart, and
 *     so is each folder the walk reaches only through them
 *     (`supportFolders`); neither counts toward the index, as the epic
 *     sets test-support and fakes aside.
 *   - A test spawns a process when its own text, or the text of a support
 *     file it reaches, calls `Bun.spawn`, `Bun.spawnSync` or `Bun.$`,
 *     imports `$` from `bun`, or imports `node:child_process` by value.
 *     The calls are read from a TypeScript parse (`spawnApis`, in
 *     `test-index-spawn.ts`), so a comment or a string naming them is not
 *     one. A source file the test reaches may spawn too
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
 * The index in projected packages
 *
 * `packageRules(map, graph)`, which the record and the guard read the tree
 * by, reads it by the cut map instead: a file's folder is its unit, so
 * three folders in one package count once and one folder cut across two
 * packages counts twice, and a test's walk leaves a type-only import of
 * core unfollowed (above). The spawned rule: the rules carry the spawned
 * reach, the sorted units of every source file reachable from the bin
 * entry `src/rafa.ts` along the graph (edges of either kind), and a
 * spawning test then counts the union of its own units and that reach
 * instead of doubling, since the process it spawns loads the bin, not the
 * test's imports twice. A file listed nowhere takes its folder's unit
 * through `cut-map.ts`, and a file that places nowhere has no unit and is
 * unplaced: the index names under `unplaced` every test file, every
 * source file a test's walk reaches (through support files or not) and,
 * when a test spawns, every source file of the bin's reach, that the map
 * holds no unit for. An unplaced file counts toward no index. Under the
 * survey's rules every file has a folder and `unplaced` is empty.
 *
 * The files the guard reads are the ones `git add -A` would commit:
 * tracked, or untracked and covered by no ignore rule, and present on
 * disk. A test file written by the task under check is untracked until
 * the loop commits it, a listing of tracked files alone would leave it
 * out, and the graph keeps an edge only to a file it was handed
 * (`addEdge`, `import-graph.ts`).
 */

import type { CutMap } from './cut-map';
import type { FileKind, TrackedFiles } from './files';
import type { ImportEdge, ImportGraph } from './import-graph';
import type { AgainstMode, WritingMode } from './test-index-args';
import type { RecordComparison } from './test-index-guard';
import type { RecordInput, TestRecord } from './test-index-record';
import type { TestWalk } from './test-index-walk';

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, posix } from 'node:path';

import { readCutMap } from './cut-map';
import { CORE_PACKAGE } from './cut-table';
import { readFacadeTables } from './facade-tables';
import { classifyFile, isInScope, listTrackedFiles, splitTrackedFiles } from './files';
import {
  OUTPUT_DIR,
  buildImportGraph,
  bunResolver,
  readMetafile,
  stableJson,
} from './import-graph';
import { readMembers } from './package-entries';
import { parseMode } from './test-index-args';
import { checkHeader, compareToRecord, holdsRecord, renderGuard } from './test-index-guard';
import { renderTestIndexMarkdown } from './test-index-markdown';
import { parseRecord, recordEntry, renderRecordJson } from './test-index-record';
import { spawnApis } from './test-index-spawn';
import { importTargets, reach, walkTest } from './test-index-walk';
import { readTestKindGlobs } from './test-kinds';

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
  /** The test's own folder, by the index's unit; `undefined` when the rules place it nowhere. */
  readonly folder: string | undefined;
  /**
   * The folders its walk reaches through source files, sorted: the ones
   * counted. When it spawns and the rules carry a spawned reach, the
   * reach's units are among them.
   */
  readonly folders: readonly string[];
  /** `folders.length`, doubled when the test spawns and the rules carry no spawned reach. */
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
  /** Its folder, by the index's unit; `undefined` when the rules place it nowhere. */
  readonly folder: string | undefined;
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
  /** The test files and reached source files the rules place nowhere, sorted; empty unless the rules can leave a file without a folder. */
  readonly unplaced: readonly string[];
}

/** How a walk reads a file: the folder it counts as, whether it is set aside, and what a spawned process loads. */
export interface IndexRules {
  /** The folder a file counts as; `undefined` when the rules place it nowhere, and the file is unplaced. */
  readonly folderOf: (path: string) => string | undefined;
  /** Whether a source file is read as a support file is: reached, not counted, not walked past. */
  readonly setsAside: (path: string) => boolean;
  /**
   * The folders a spawned process loads, sorted. When present, a spawning
   * test counts them beside its own instead of doubling its index.
   */
  readonly spawnedReach?: readonly string[];
  /** The source files a spawned process loads that the rules place nowhere, sorted. */
  readonly spawnedUnplaced?: readonly string[];
  /**
   * Whether a test's walk follows an import edge; every edge is followed
   * when absent. The spawned reach is read without it.
   */
  readonly follows?: (edge: ImportEdge) => boolean;
}

/** The bin's entry, the file a spawned `rafa` process starts from. */
export const BIN_ENTRY = 'src/rafa.ts';

/** The record's path, relative to the repository root; the folder-unit baseline lay at the same path. */
export const BASELINE_PATH: string = `${OUTPUT_DIR}/test-index.baseline.json`;

const PACKAGE_FILE = /^(packages\/[^/]+)\/src\//;

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
 * The rules of the index in projected packages: a file counts as its
 * unit in the cut map, none is set aside, a test's walk does not follow a
 * `type` edge into `CORE_PACKAGE`, and a spawning test counts the units
 * of every source file reachable from `BIN_ENTRY` along the graph, edges
 * of either kind, instead of doubling (see "The index in projected
 * packages" in the module note).
 *
 * @param map - The cut map; its `unitOf` is the rules' `folderOf`.
 * @param graph - The import graph the bin's reach is walked along.
 * @returns The rules, with the bin's units under `spawnedReach`, its unplaced source files under `spawnedUnplaced`, and the core type-only rule under `follows`.
 * @throws When `BIN_ENTRY` is not a file of the graph, so no reach could be read.
 */
export function packageRules(map: CutMap, graph: ImportGraph): IndexRules {
  if (!graph.nodes.includes(BIN_ENTRY)) {
    throw new Error(`cannot read the spawned reach: the bin entry ${BIN_ENTRY} is not a file of the import graph`);
  }
  const nodes = new Set(graph.nodes);
  const loaded = [...reach([BIN_ENTRY], importTargets(graph), () => true)]
    .filter((path) => nodes.has(path) && classifyFile(path) === 'source');
  const units = new Set<string>();
  const unplaced: string[] = [];
  for (const path of loaded) {
    const unit = map.unitOf(path);
    if (unit === undefined) {
      unplaced.push(path);
    } else {
      units.add(unit);
    }
  }
  return {
    folderOf: (path) => map.unitOf(path),
    follows: (edge) => edge.kind !== 'type' || map.unitOf(edge.to) !== CORE_PACKAGE,
    setsAside: () => false,
    spawnedReach: [...units].sort(),
    spawnedUnplaced: unplaced.sort(),
  };
}

/** How one index reads a file: its kind once the rules have set files aside, its folder, and what a spawned process loads. */
interface FileReading {
  /** Each file's kind; a source file the rules set aside reads as `test-support`. */
  readonly kindOf: (path: string) => FileKind;
  /** The folder a file counts as; `undefined` when the rules place it nowhere. */
  readonly folderOf: (path: string) => string | undefined;
  /** The folders a spawned process loads, when the rules carry them. */
  readonly spawnedReach: readonly string[] | undefined;
}

/**
 * The sorted folders of the source files among `paths`; a file the rules
 * place nowhere counts none.
 *
 * @param paths - Files reached.
 * @param reading - Each file's kind and folder.
 * @returns The folders, sorted, without duplicates.
 */
function sourceFolders(paths: Iterable<string>, reading: FileReading): string[] {
  const folders = new Set<string>();
  for (const path of paths) {
    const folder = reading.kindOf(path) === 'source'
      ? reading.folderOf(path)
      : undefined;
    if (folder !== undefined) {
      folders.add(folder);
    }
  }
  return [...folders].sort();
}

/**
 * One test's entry, from its walk and the spawning calls of the files read.
 * A spawning test counts the spawned reach beside its own folders when the
 * rules carry one, and doubles its count when they do not.
 *
 * @param test - The test file.
 * @param walk - What its walk reached.
 * @param spawning - The files whose text spawns.
 * @param reading - Each file's kind and folder, and the spawned reach.
 * @returns The entry.
 */
function indexEntry(test: string, walk: TestWalk, spawning: ReadonlySet<string>, reading: FileReading): TestIndexEntry {
  const { kindOf, spawnedReach } = reading;
  const own = sourceFolders(walk.direct, reading);
  const support = [...walk.direct].filter((path) => kindOf(path) === 'test-support').sort();
  const spawnsVia = [test, ...support].filter((path) => spawning.has(path)).sort();
  const spawns = spawnsVia.length > 0;
  const folders = spawns && spawnedReach !== undefined
    ? [...new Set([...own, ...spawnedReach])].sort()
    : own;
  const counted = new Set(folders);
  return {
    folder: reading.folderOf(test),
    folders,
    index: spawns && spawnedReach === undefined
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

/** The test files whose walk reaches one source file, directly and only through support files. */
interface Reaching {
  readonly direct: string[];
  readonly support: string[];
}

/**
 * The files an index places nowhere: every test file, every source file a
 * test's walk reaches, and, when an indexed test spawns, every source file
 * of the spawned reach, that the rules give no folder.
 *
 * @param tests - Every test file of the graph, indexed or not.
 * @param reaching - Each source file with the tests that reach it.
 * @param entries - The indexed tests.
 * @param rules - How a file is read.
 * @returns The unplaced files, sorted, without duplicates.
 */
function unplacedFiles(
  tests: readonly string[],
  reaching: ReadonlyMap<string, Reaching>,
  entries: readonly TestIndexEntry[],
  rules: IndexRules,
): string[] {
  const reached = [...reaching]
    .filter(([, found]) => found.direct.length > 0 || found.support.length > 0)
    .map(([source]) => source);
  const spawned = entries.some((entry) => entry.spawns)
    ? rules.spawnedUnplaced ?? []
    : [];
  const unplaced = [...tests, ...reached].filter((path) => rules.folderOf(path) === undefined);
  return [...new Set([...unplaced, ...spawned])].sort();
}

/**
 * Computes every test file's index and every source file's reaching tests.
 * Pure: the caller builds the graph and reads the texts (see `main`).
 *
 * @param input - The import graph and the source texts.
 * @param rules - How a file is read; the survey's rules unless `packageRules` passes its own.
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
  const reading: FileReading = { folderOf: rules.folderOf, kindOf, spawnedReach: rules.spawnedReach };
  const { follows } = rules;
  const next = importTargets(follows === undefined
    ? graph
    : { ...graph, edges: graph.edges.filter(follows) });
  // By its own kind, not the rules': a file set aside is a source file still, and its spawning is the code under test's.
  const spawning = new Set(
    graph.nodes.filter((path) => classifyFile(path) !== 'source' && spawnApis(path, input.sources.get(path) ?? '').length > 0),
  );
  const read = new Set(graph.read);
  const allTests = graph.nodes.filter((path) => kindOf(path) === 'test');
  const reaching = new Map<string, Reaching>(
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
  return {
    read: [...read].sort(),
    sources,
    tests,
    unindexed: allTests.filter((path) => !read.has(path)),
    unplaced: unplacedFiles(allTests, reaching, tests, rules),
  };
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
 * Builds the import graph of `files` in the repository at `root`, read
 * through its facade entries (`readFacadeTables`), and reads their texts. The graph is built here again rather than read from
 * `docs/survey/import-graph.json`, so the scripts run in any order.
 *
 * @param root - The repository root.
 * @param files - The files to read, repository-relative.
 * @returns The graph and the texts the index is computed from.
 * @throws When a file cannot be read or `bun build` exits non-zero.
 */
async function readTree(root: string, files: readonly string[]): Promise<TestIndexInput> {
  const sources = new Map<string, string>();
  for (const path of files) {
    sources.set(path, await Bun.file(join(root, path)).text());
  }
  const metafile = await readMetafile(root, files);
  const graph = buildImportGraph({
    facades: readFacadeTables(root),
    files,
    metafile,
    resolve: bunResolver(root),
    root,
    sources,
  });
  return { graph, sources };
}

/**
 * Builds the import graph of `files` and computes the index from it.
 *
 * @param root - The repository root.
 * @param files - The files to read, repository-relative.
 * @param rules - How a file is read.
 * @returns The index.
 * @throws When a file cannot be read or `bun build` exits non-zero.
 */
async function readIndex(root: string, files: readonly string[], rules: IndexRules): Promise<TestIndex> {
  return computeTestIndex(await readTree(root, files), rules);
}

/** A path as passed, read against the repository root when it is relative. */
function fromRoot(root: string, path: string): string {
  return isAbsolute(path)
    ? path
    : join(root, path);
}

/** The tree read in projected packages: the index, the rules it was computed under, and what a test's record is read by. */
interface PackageReading {
  /** The index under `packageRules`. */
  readonly index: TestIndex;
  /** The rules, the bin's reach among them. */
  readonly rules: IndexRules;
  /** The map, the kind globs, the members, the texts and the resolver. */
  readonly input: RecordInput;
}

/**
 * Reads the map, the test kinds and the workspace members of the
 * repository at `root`, builds the graph of `files` and computes the index
 * under `packageRules`.
 *
 * @param root - The repository root.
 * @param files - The files to read, repository-relative.
 * @param mapPath - The map's path as passed, absolute or relative to `root`.
 * @returns The index, its rules and the record input.
 * @throws When the map, the config or a manifest cannot be read or is
 *   refused, the tree cannot be read, or the graph holds no bin entry.
 */
async function readPackages(root: string, files: readonly string[], mapPath: string): Promise<PackageReading> {
  const map = readCutMap(root, mapPath);
  const globs = await readTestKindGlobs(root);
  const members = readMembers(root);
  const tree = await readTree(root, files);
  const rules = packageRules(map, tree.graph);
  const input: RecordInput = { globs, map, members, resolve: bunResolver(root), sources: tree.sources };
  return { index: computeTestIndex(tree, rules), input, rules };
}

/**
 * The lines that name the unplaced files.
 *
 * @param unplaced - The files the map holds no unit for, sorted.
 * @param mapPath - The map's path as passed.
 * @returns A heading naming the map and the count, then one indented line per file; empty when none is unplaced.
 */
export function unplacedLines(unplaced: readonly string[], mapPath: string): string[] {
  return unplaced.length === 0
    ? []
    : [`test-index: ${unplaced.length} file(s) the map ${mapPath} places in no unit, by listing or by folder:`, ...unplaced.map((path) => `  ${path}`)];
}

/**
 * Reads the repository at `root` in projected packages and writes the
 * record (see the module note).
 *
 * @param root - The repository root.
 * @param mapPath - The map's path as passed; the record names it so.
 * @returns The record's path, relative to `root`.
 * @throws When `readCommit` cannot name the commit read, the map, the
 *   config or a manifest is refused, or a file is unplaced, the message
 *   then naming each; the record is left as it was.
 */
async function takeRecord(root: string, mapPath: string): Promise<string> {
  const commit = readCommit(root);
  const { index, input, rules } = await readPackages(root, listTrackedFiles(root).all, mapPath);
  if (index.unplaced.length > 0) {
    throw new Error([...unplacedLines(index.unplaced, mapPath), 'test-index: no record was written'].join('\n'));
  }
  const tests = new Map<string, TestRecord>(index.tests.map((entry) => [entry.test, recordEntry(entry, input)]));
  const header = {
    binReach: rules.spawnedReach ?? [],
    commit,
    map: { path: mapPath, sha256: input.map.sha256 },
  };
  mkdirSync(join(root, OUTPUT_DIR), { recursive: true });
  writeFileSync(join(root, BASELINE_PATH), renderRecordJson({ tests, unindexed: index.unindexed }, header));
  return BASELINE_PATH;
}

/** What the guard read: the comparison, the header's refusals and the unplaced files. */
export interface GuardReading {
  /** Every test file of the tree against the record. */
  readonly comparison: RecordComparison;
  /** The lines `checkHeader` answered; empty when the record and the map agree. */
  readonly refusals: readonly string[];
  /** Every file the index places nowhere, sorted: test files, reached source files and the bin's. */
  readonly unplaced: readonly string[];
  /** The map's path as passed. */
  readonly mapPath: string;
}

/**
 * Reads the record and the repository at `root` in projected packages and
 * holds the tree to the record. Writes nothing.
 *
 * @param root - The repository root.
 * @param mode - The record's and the map's paths, each absolute or relative to `root`.
 * @returns What the guard read; {@link guardHolds} says whether it passes.
 * @throws When the record is missing or `parseRecord` refuses it, the map,
 *   the config or a manifest is refused, or the tree cannot be read.
 */
export async function guard(root: string, mode: AgainstMode): Promise<GuardReading> {
  const file = fromRoot(root, mode.against);
  if (!existsSync(file)) {
    throw new Error(`cannot read the record: no file at ${file}`);
  }
  const record = parseRecord(readFileSync(file, 'utf8'));
  const { index, input } = await readPackages(root, listCommittableFiles(root).all, mode.map);
  return {
    comparison: compareToRecord(index, record, input),
    mapPath: mode.map,
    refusals: checkHeader(record, input.map),
    unplaced: index.unplaced,
  };
}

/**
 * Whether the guard passes: `holdsRecord`, and no file unplaced.
 *
 * @param reading - What the guard read.
 * @returns `false` when the guard exits 1.
 */
export function guardHolds(reading: GuardReading): boolean {
  return holdsRecord(reading.comparison, reading.refusals) && reading.unplaced.length === 0;
}

/**
 * What the guard prints: `renderGuard`, then each unplaced file.
 *
 * @param reading - What the guard read.
 * @param recordPath - The record's path as it was passed.
 * @returns The text, without a closing newline.
 */
export function renderGuardReading(reading: GuardReading, recordPath: string): string {
  const unplaced = unplacedLines(reading.unplaced, reading.mapPath);
  return [
    renderGuard(reading.comparison, reading.refusals, recordPath),
    ...unplaced.length > 0
      ? ['', ...unplaced]
      : [],
  ].join('\n');
}

/**
 * Reads the repository at `root` and writes the survey's two outputs under
 * `docs/survey/`, or the record alone in the record mode.
 *
 * @param root - The repository root.
 * @param mode - What to write; the survey's two files unless the record mode is handed with its map.
 * @returns The paths written, relative to `root`.
 * @throws In the record mode, as `takeRecord` refuses: no commit to name,
 *   a refused map, config or manifest, or an unplaced file.
 */
export async function main(root: string, mode: WritingMode = 'survey'): Promise<string[]> {
  if (mode !== 'survey') {
    return [await takeRecord(root, mode.map)];
  }
  const tracked = listTrackedFiles(root);
  const index = await readIndex(root, tracked.all, SURVEY_RULES);
  mkdirSync(join(root, OUTPUT_DIR), { recursive: true });
  const jsonPath = `${OUTPUT_DIR}/test-index.json`;
  const markdownPath = `${OUTPUT_DIR}/test-index.md`;
  writeFileSync(join(root, jsonPath), renderTestIndexJson(index));
  writeFileSync(join(root, markdownPath), renderTestIndexMarkdown(index, tracked.all));
  return [jsonPath, markdownPath];
}

if (import.meta.main) {
  try {
    const mode = parseMode(process.argv.slice(2));
    if (mode === 'survey' || 'baseline' in mode) {
      for (const path of await main(process.cwd(), mode)) {
        console.log(`wrote ${path}`);
      }
    } else {
      const reading = await guard(process.cwd(), mode);
      console.log(renderGuardReading(reading, mode.against));
      if (!guardHolds(reading)) {
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
