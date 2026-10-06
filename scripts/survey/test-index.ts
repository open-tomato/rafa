/**
 * The test index of rafa's own suite: `bun scripts/survey/test-index.ts`
 * from the repository root writes `.rafa/survey/test-index.json` and
 * `.rafa/survey/test-index.md` through `survey-io.ts`. It is epic #801's
 * criterion 4 baseline: after the cut, no test file's index may rise.
 *
 * ## The index
 *
 * Ported from the two sketches the plan names (`test-scope.ts` and
 * `test-groups.ts`): a test file's index is how many groups its imports
 * reach, its own group always counted, doubled when it spawns a process.
 *
 * - **Imports** are the specifiers of its `from '…'` clauses
 *   ({@link importSpecifiers}), so `import type` and `export … from`
 *   count, as they did in the sketches: a type borrowed across a cut line
 *   is still a package dependency. A relative specifier and one under
 *   `@open-tomato/` (how a package imports core) are resolved to a
 *   repository file under `src/` or `packages/` ({@link isInScope}), as
 *   the sketches counted only `src/`; anything else, such as `bun:test`,
 *   a package or `package.json`, is no import here. `import('…')` and bare `import '…'` are not read.
 * - **Spawning** is the sketches' test, {@link SPAWN_PATTERN} anywhere in
 *   the file's text.
 * - **Groups** are read two ways. By folder ({@link folderOf}): the first
 *   folder under `src/` (`src` itself for a file at its root) or the
 *   package under `packages/`. By cluster: the import graph's cluster of
 *   the imported file, read from `.rafa/survey/import-graph.json`, which
 *   `import-graph.ts` writes and this script needs first; an imported
 *   file in no cluster (isolated, detached, or not a graph file at all)
 *   counts as the one group `none`. A test file is in no cluster, so its
 *   cluster index counts what its imports reach, and is 1 at least.
 *
 * ## Test-support and fakes aside
 *
 * Each index is also read as the guard index, the one criterion 4
 * compares, where an import of test-support or of a fake
 * ({@link isSupportOrFake}) is not counted: the file sits under
 * `src/tests/` (the test-support package to be) or a `testdata/` folder,
 * or its name holds `fake` or `stand-in`. The own folder still counts.
 */
import type { ImportGraphData } from './import-graph.js';

import { realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve as resolvePath, sep } from 'node:path';

import { listTrackedFiles, measureCoverage, SURVEY_DIR, writeSurvey } from './survey-io.js';

/** The tracked folders whose test files the index reads. */
export const SURVEY_SCOPE: readonly string[] = ['src', 'packages'];

/** The sketches' spawn test: a file whose text matches spawns a process. */
export const SPAWN_PATTERN = /spawnRafa|runRafa|Bun\.spawn|spawnSync/;

/** The folder whose files become the test-support package. */
export const TEST_SUPPORT_FOLDER = 'src/tests/';

/** The group an imported file in no cluster counts as. */
export const NO_CLUSTER = 'none';

/** How many files the summary's highest-index table lists. */
const TOP_FILES = 10;

const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;
const FROM_CLAUSE = /from\s+'([^']+)'/g;
const FAKE_NAME = /fake|stand-in/i;
const PERCENT = 100;
const P90 = 0.9;

/** Resolves `specifier` from the folder `fromDir` to an absolute path, as `Bun.resolveSync` does. */
export type Resolver = (specifier: string, fromDir: string) => string;

/** One index read one way: the groups reached, the index, and the guard's. */
export interface GroupReading {
  /** Every group the file's imports reach, its own folder included when read by folder, sorted. */
  readonly groups: readonly string[];
  /** The groups left with test-support and fakes aside, sorted. */
  readonly guardGroups: readonly string[];
  /** `groups` counted, doubled when the file spawns. */
  readonly index: number;
  /** `guardGroups` counted, doubled when the file spawns. */
  readonly guardIndex: number;
}

/** One test file's reading. */
export interface TestFileIndex {
  readonly path: string;
  /** The test file's own folder group. */
  readonly folder: string;
  readonly spawns: boolean;
  /** The repository files its imports resolve to, sorted. */
  readonly imports: readonly string[];
  readonly byFolder: GroupReading;
  readonly byCluster: GroupReading;
}

/** How an index spreads over a set of test files. */
export interface IndexStats {
  readonly files: number;
  readonly p50: number;
  readonly p90: number;
  readonly max: number;
  /** How many files have each index value, by value ascending. */
  readonly distribution: readonly { readonly index: number; readonly files: number }[];
}

/** The four index readings over one set of test files. */
export interface IndexSummary {
  readonly folder: IndexStats;
  readonly folderGuard: IndexStats;
  readonly cluster: IndexStats;
  readonly clusterGuard: IndexStats;
}

/** The test files of one own folder, summarized. */
export interface FolderSummary extends IndexSummary {
  readonly name: string;
  readonly spawning: number;
}

/** How many test files outside a group reach into it. */
export interface GroupReach {
  readonly group: string;
  /** Test files whose own folder is another, or every test file for a cluster. */
  readonly testFiles: number;
}

/** The reading written under `data` in `test-index.json`. */
export interface TestIndexData {
  readonly files: readonly TestFileIndex[];
  readonly overall: IndexSummary;
  readonly spawning: number;
  readonly folders: readonly FolderSummary[];
  /** Per folder, how many other folders' test files import it. */
  readonly folderReach: readonly GroupReach[];
  /** Per cluster, how many test files import it. */
  readonly clusterReach: readonly GroupReach[];
  /** Imports by relative specifier that resolved to no file, kept by plain path. */
  readonly unresolved: readonly { readonly from: string; readonly specifier: string }[];
}

/** Whether `path` is a test file the index reads. */
export function isTestFile(path: string): boolean {
  return TEST_FILE.test(path);
}

/**
 * The folder group of a repository-relative path: `src/<first folder>`,
 * `src` for a file at its root, `packages/<name>`, or the first segment
 * of any other path.
 */
export function folderOf(path: string): string {
  const parts = path.split('/');
  const [top, second] = parts;
  if (top === 'src') {
    return parts.length > 2
      ? `src/${second}`
      : 'src';
  }
  if (top === 'packages' && second !== undefined && parts.length > 2) {
    return `packages/${second}`;
  }
  return parts.length > 1
    ? (top ?? path)
    : '.';
}

/** Whether `path` sits under a folder of {@link SURVEY_SCOPE}: an import of any other file is no group. */
export function isInScope(path: string): boolean {
  return SURVEY_SCOPE.some((folder) => path.startsWith(`${folder}/`));
}

/** Whether an imported file is test-support or a fake, which the guard index does not count. */
export function isSupportOrFake(path: string): boolean {
  return path.startsWith(TEST_SUPPORT_FOLDER)
    || path.split('/').includes('testdata')
    || FAKE_NAME.test(basename(path));
}

/** The specifiers of every `from '…'` clause in `text`, in order. */
export function importSpecifiers(text: string): string[] {
  return [...text.matchAll(FROM_CLAUSE)].map((match) => match[1] ?? '');
}

/** Whether `specifier` is one the index resolves: relative, or under `@open-tomato/`. */
function isRepoSpecifier(specifier: string): boolean {
  return specifier.startsWith('.') || specifier.startsWith('@open-tomato/');
}

/** `absolute` relative to `repoRoot`, or `null` when it sits outside it or under `node_modules`. */
function inRepo(absolute: string, repoRoot: string): string | null {
  const path = relative(repoRoot, absolute);
  return path.startsWith('..') || isAbsolute(path) || path.split(sep).includes('node_modules')
    ? null
    : path.split(sep).join('/');
}

/**
 * The repository file `specifier`, imported from the test file `from`,
 * resolves to, and whether resolving failed. A relative specifier that
 * does not resolve is kept by its plain path, as the sketches read it, so
 * its folder still counts; an `@open-tomato/` one that does not is
 * dropped.
 */
export function resolveImport(
  specifier: string,
  from: string,
  repoRoot: string,
  resolve: Resolver,
): { path: string | null; unresolved: boolean } {
  if (!isRepoSpecifier(specifier)) {
    return { path: null, unresolved: false };
  }
  const fromDir = dirname(join(repoRoot, from));
  try {
    return { path: inRepo(resolve(specifier, fromDir), repoRoot), unresolved: false };
  } catch {
    return specifier.startsWith('.')
      ? { path: inRepo(resolvePath(fromDir, specifier), repoRoot), unresolved: true }
      : { path: null, unresolved: true };
  }
}

/** The groups as read, the guard's, and both indexes. */
function readGroups(groups: readonly string[], guardGroups: readonly string[], spawns: boolean): GroupReading {
  const factor = spawns
    ? 2
    : 1;
  const sorted = [...new Set(groups)].sort();
  const guardSorted = [...new Set(guardGroups)].sort();
  return {
    groups: sorted,
    guardGroups: guardSorted,
    index: Math.max(sorted.length, 1) * factor,
    guardIndex: Math.max(guardSorted.length, 1) * factor,
  };
}

/**
 * One test file's index from its `imports` (repository files) and
 * whether it spawns, with `clusterOf` naming each graph file's cluster.
 */
export function indexTestFile(
  path: string,
  imports: readonly string[],
  spawns: boolean,
  clusterOf: ReadonlyMap<string, string>,
): TestFileIndex {
  const folder = folderOf(path);
  const unique = [...new Set(imports)].filter((target) => target !== path && isInScope(target)).sort();
  const kept = unique.filter((target) => !isSupportOrFake(target));
  const clusterGroup = (target: string): string => clusterOf.get(target) ?? NO_CLUSTER;
  return {
    path,
    folder,
    spawns,
    imports: unique,
    byFolder: readGroups([folder, ...unique.map(folderOf)], [folder, ...kept.map(folderOf)], spawns),
    byCluster: readGroups(unique.map(clusterGroup), kept.map(clusterGroup), spawns),
  };
}

/** The sketches' spread of `values`: the middle, the ninetieth percentile and the highest. */
export function indexStats(values: readonly number[]): IndexStats {
  const sorted = [...values].sort((a, b) => a - b);
  const counts = new Map<number, number>();
  sorted.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  return {
    files: sorted.length,
    p50: sorted[Math.floor(sorted.length / 2)] ?? 0,
    p90: sorted[Math.floor(sorted.length * P90)] ?? 0,
    max: sorted.at(-1) ?? 0,
    distribution: [...counts].map(([index, files]) => ({ index, files })),
  };
}

/** The four index readings over `files`. */
export function summarize(files: readonly TestFileIndex[]): IndexSummary {
  return {
    folder: indexStats(files.map((file) => file.byFolder.index)),
    folderGuard: indexStats(files.map((file) => file.byFolder.guardIndex)),
    cluster: indexStats(files.map((file) => file.byCluster.index)),
    clusterGuard: indexStats(files.map((file) => file.byCluster.guardIndex)),
  };
}

/** How many test files reach each group `groupsOf` names for them, most first. */
function reachOf(files: readonly TestFileIndex[], groupsOf: (file: TestFileIndex) => readonly string[]): GroupReach[] {
  const counts = new Map<string, number>();
  files.forEach((file) => groupsOf(file).forEach((group) => counts.set(group, (counts.get(group) ?? 0) + 1)));
  return [...counts]
    .map(([group, testFiles]) => ({ group, testFiles }))
    .sort((a, b) => b.testFiles - a.testFiles || a.group.localeCompare(b.group));
}

/** The whole reading over indexed `files`. */
export function readTestIndex(
  files: readonly TestFileIndex[],
  unresolved: TestIndexData['unresolved'] = [],
): TestIndexData {
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  const byFolder = new Map<string, TestFileIndex[]>();
  sorted.forEach((file) => byFolder.set(file.folder, [...(byFolder.get(file.folder) ?? []), file]));
  const folders = [...byFolder]
    .map(([name, members]) => ({
      name,
      spawning: members.filter((file) => file.spawns).length,
      ...summarize(members),
    }))
    .sort((a, b) => b.folder.files - a.folder.files || a.name.localeCompare(b.name));
  return {
    files: sorted,
    overall: summarize(sorted),
    spawning: sorted.filter((file) => file.spawns).length,
    folders,
    folderReach: reachOf(sorted, (file) => file.byFolder.groups.filter((group) => group !== file.folder)),
    clusterReach: reachOf(sorted, (file) => file.byCluster.groups),
    unresolved,
  };
}

/** Each graph file's cluster, from an import-graph reading. */
export function clustersFromGraph(graph: Pick<ImportGraphData, 'files'>): Map<string, string> {
  return new Map(graph.files.flatMap((file) => file.cluster === null
    ? []
    : [[file.path, file.cluster] as const]));
}

/** One summary table row: the four spreads as `p50/p90/max`. */
function statsCells(summary: IndexSummary): string {
  const cell = (stats: IndexStats): string => `${stats.p50}/${stats.p90}/${stats.max}`;
  return `${cell(summary.folder)} | ${cell(summary.folderGuard)} | ${cell(summary.cluster)} | ${cell(summary.clusterGuard)}`;
}

/** The distribution table of the four readings. */
function distributionTable(summary: IndexSummary): string[] {
  const values = [...new Set([summary.folder, summary.folderGuard, summary.cluster, summary.clusterGuard]
    .flatMap((stats) => stats.distribution.map((entry) => entry.index)))].sort((a, b) => a - b);
  const share = (stats: IndexStats, index: number): string => {
    const files = stats.distribution.find((entry) => entry.index === index)?.files ?? 0;
    return stats.files === 0
      ? '0'
      : `${files} (${((PERCENT * files) / stats.files).toFixed(0)}%)`;
  };
  return [
    '| Index | By folder | By folder, guard | By cluster | By cluster, guard |',
    '| --- | --- | --- | --- | --- |',
    ...values.map((index) => `| ${index} | ${share(summary.folder, index)} | ${share(summary.folderGuard, index)} `
      + `| ${share(summary.cluster, index)} | ${share(summary.clusterGuard, index)} |`),
  ];
}

/** The markdown summary's body, written after the coverage line. */
export function renderTestIndex(data: TestIndexData): string {
  const top = [...data.files]
    .sort((a, b) => b.byFolder.guardIndex - a.byFolder.guardIndex || a.path.localeCompare(b.path))
    .slice(0, TOP_FILES);
  const statsHeader = '| p50/p90/max by folder | by folder, guard | by cluster | by cluster, guard |';
  return [
    '# Test index',
    '',
    `${data.files.length} test files, ${data.spawning} of them spawning. A file's index is how many groups its `
      + '`from` imports reach, its own folder counted, doubled when it spawns. The guard index sets test-support '
      + `(\`${TEST_SUPPORT_FOLDER}\`, \`testdata/\`) and fakes aside; it is the one criterion 4 compares.`,
    '',
    `Unresolved relative imports, counted by plain path: ${data.unresolved.length === 0
      ? 'none'
      : data.unresolved.map((entry) => `\`${entry.from}\` → \`${entry.specifier}\``).join(', ')}`,
    '',
    '## Overall',
    '',
    `| Files ${statsHeader}`,
    '| --- | --- | --- | --- | --- |',
    `| ${data.files.length} | ${statsCells(data.overall)} |`,
    '',
    ...distributionTable(data.overall),
    '',
    '## Per folder',
    '',
    `| Folder | Tests | Spawning ${statsHeader}`,
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...data.folders.map((folder) => `| \`${folder.name}\` | ${folder.folder.files} | ${folder.spawning} `
      + `| ${statsCells(folder)} |`),
    '',
    '## Reach',
    '',
    'Folders imported by other folders\' test files:',
    '',
    ...data.folderReach.map((reach) => `- \`${reach.group}\` ${reach.testFiles}`),
    '',
    'Clusters imported by test files:',
    '',
    ...data.clusterReach.map((reach) => `- ${reach.group} ${reach.testFiles}`),
    '',
    '## Highest guard index by folder',
    '',
    '| File | Spawns | By folder | Guard | By cluster | Guard | Guard folders |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...top.map((file) => `| \`${file.path}\` | ${file.spawns
      ? 'yes'
      : 'no'} | ${file.byFolder.index} | ${file.byFolder.guardIndex} | ${file.byCluster.index} `
      + `| ${file.byCluster.guardIndex} | ${file.byFolder.guardGroups.join(', ')} |`),
  ].join('\n');
}

/** The import-graph reading at `repoRoot`; throws naming the script to run first when it is absent. */
export async function loadImportGraph(repoRoot: string): Promise<Pick<ImportGraphData, 'files'>> {
  const file = Bun.file(join(repoRoot, SURVEY_DIR, 'import-graph.json'));
  if (!(await file.exists())) {
    throw new Error(`${SURVEY_DIR}/import-graph.json is absent: run bun scripts/survey/import-graph.ts first`);
  }
  const parsed = (await file.json()) as { data?: Pick<ImportGraphData, 'files'> };
  if (!Array.isArray(parsed.data?.files)) {
    throw new Error(`${SURVEY_DIR}/import-graph.json holds no data.files`);
  }
  return parsed.data;
}

/** Reads one test file into its index, or `null` when it cannot be read. */
async function readTestFile(
  repoRoot: string,
  path: string,
  resolve: Resolver,
  clusterOf: ReadonlyMap<string, string>,
): Promise<{ file: TestFileIndex; unresolved: TestIndexData['unresolved'] } | null> {
  let text: string;
  try {
    text = await Bun.file(join(repoRoot, path)).text();
  } catch {
    return null;
  }
  const unresolved: { from: string; specifier: string }[] = [];
  const imports = importSpecifiers(text).flatMap((specifier) => {
    const target = resolveImport(specifier, path, repoRoot, resolve);
    if (target.unresolved) {
      unresolved.push({ from: path, specifier });
    }
    return target.path === null
      ? []
      : [target.path];
  });
  return { file: indexTestFile(path, imports, SPAWN_PATTERN.test(text), clusterOf), unresolved };
}

/** Reads, indexes and writes the test index of the repository at `repoRoot`. */
export async function surveyTestIndex(repoRoot: string, resolve: Resolver = Bun.resolveSync): Promise<TestIndexData> {
  const realRoot = realpathSync(repoRoot);
  const clusterOf = clustersFromGraph(await loadImportGraph(realRoot));
  const expected = (await listTrackedFiles(realRoot, SURVEY_SCOPE)).filter(isTestFile);
  const readings = await Promise.all(expected.map((path) => readTestFile(realRoot, path, resolve, clusterOf)));
  const read = readings.filter((reading) => reading !== null);
  const data = readTestIndex(read.map((reading) => reading.file), read.flatMap((reading) => reading.unresolved));
  await writeSurvey(realRoot, 'test-index', {
    data,
    markdown: renderTestIndex(data),
    coverage: measureCoverage(expected, data.files.map((file) => file.path)),
  });
  return data;
}

if (import.meta.main) {
  try {
    const data = await surveyTestIndex(process.cwd());
    const guard = data.overall.folderGuard;
    console.log(`[test-index] ${data.files.length} test files, ${data.spawning} spawning, `
      + `guard index by folder p50 ${guard.p50} p90 ${guard.p90} max ${guard.max}`);
  } catch (err) {
    console.error(`[test-index] FAIL — ${err instanceof Error
      ? err.message
      : String(err)}`);
    process.exit(1);
  }
}
