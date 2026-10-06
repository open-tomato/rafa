/**
 * The test timing of rafa's own suite: `bun scripts/survey/test-timing.ts`
 * from the repository root reads a junit XML report of a suite run and
 * writes `.rafa/survey/test-timing.json` and `.rafa/survey/test-timing.md`
 * through `survey-io.ts`: seconds per test file, per folder and per
 * cluster.
 *
 * ## The report
 *
 * The script runs no test. It reads the report a suite run already wrote,
 * `.rafa/survey/junit.xml` by default or the path after `--report`:
 *
 * ```sh
 * bun test --reporter=junit --reporter-outfile=.rafa/survey/junit.xml
 * ```
 *
 * A file's seconds are the sum of the `time` of its `<testcase>` elements,
 * keyed by their `file` attribute ({@link parseJunit}). Bun writes `0` as
 * the time of a file's own `<testsuite>`, so suite times are not read, and
 * time spent in hooks outside a test case is not counted.
 *
 * ## Groups
 *
 * The folder is `test-index.ts`'s {@link folderOf}. A test file sits in no
 * import-graph cluster, so its cluster is its subject's
 * ({@link clusterOfTest}): the cluster of the source file its name names
 * (`foo.test.ts` reads `foo.ts`), else the cluster most graph files in its
 * own directory belong to, else `none`. It reads
 * `.rafa/survey/import-graph.json`, so `import-graph.ts` runs first.
 *
 * Coverage is measured over the tracked test files under `src/` and
 * `packages/`: one the report holds no case for is named as missed.
 */
import { realpathSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { listTrackedFiles, measureCoverage, SURVEY_DIR, writeSurvey } from './survey-io.js';
import {
  clustersFromGraph,
  folderOf,
  isTestFile,
  loadImportGraph,
  NO_CLUSTER,
  SURVEY_SCOPE,
} from './test-index.js';

/** The report read when no `--report` is given, relative to the repository root. */
export const DEFAULT_REPORT = `${SURVEY_DIR}/junit.xml`;

/** How many files the summary's slowest table lists. */
const TOP_FILES = 20;

/** Seconds are rounded to this many decimals in the reading. */
const DECIMALS = 3;

const TESTCASE = /<testcase\b([^>]*?)\/?>/g;
const ATTRIBUTE = /([\w:-]+)="([^"]*)"/g;
const TEST_SUFFIX = /\.test(\.[cm]?[jt]sx?)$/;
const ENTITIES: Readonly<Record<string, string>> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': '\'',
};

/** One test file's time as the report gives it. */
export interface FileTiming {
  readonly path: string;
  readonly folder: string;
  readonly cluster: string;
  readonly tests: number;
  readonly seconds: number;
}

/** A folder's or a cluster's time, summed over its test files. */
export interface GroupTiming {
  readonly name: string;
  readonly files: number;
  readonly tests: number;
  readonly seconds: number;
}

/** The whole reading. */
export interface TestTimingData {
  readonly report: string;
  readonly seconds: number;
  readonly files: readonly FileTiming[];
  readonly folders: readonly GroupTiming[];
  readonly clusters: readonly GroupTiming[];
  /** Report files that are not tracked test files under the scope, by path. */
  readonly untracked: readonly string[];
}

/** One file's sum from the report. */
export interface ReportFile {
  readonly tests: number;
  readonly seconds: number;
}

function decode(value: string): string {
  return value.replace(/&(?:amp|lt|gt|quot|apos);/g, (entity) => ENTITIES[entity] ?? entity);
}

function attributesOf(text: string): Map<string, string> {
  return new Map([...text.matchAll(ATTRIBUTE)].map((match) => [match[1] ?? '', decode(match[2] ?? '')]));
}

function round(seconds: number): number {
  return Number(seconds.toFixed(DECIMALS));
}

/**
 * Each file's test count and summed seconds from a junit XML report's
 * `<testcase>` elements. Throws when the text holds no `<testsuites>` or
 * `<testsuite>` element, or a case without a `file` or with a `time` that
 * is not a number.
 */
export function parseJunit(xml: string): Map<string, ReportFile> {
  if (!/<testsuites?\b/.test(xml)) {
    throw new Error('the report holds no <testsuites> element: is it a junit XML report?');
  }
  const files = new Map<string, ReportFile>();
  for (const match of xml.matchAll(TESTCASE)) {
    const attributes = attributesOf(match[1] ?? '');
    const file = attributes.get('file');
    const seconds = Number(attributes.get('time') ?? '0');
    if (file === undefined || file.length === 0) {
      throw new Error(`a <testcase> carries no file attribute: ${match[0]}`);
    }
    if (!Number.isFinite(seconds)) {
      throw new Error(`a <testcase> in ${file} carries a time that is not a number: ${attributes.get('time')}`);
    }
    const previous = files.get(file) ?? { tests: 0, seconds: 0 };
    files.set(file, { tests: previous.tests + 1, seconds: previous.seconds + seconds });
  }
  return files;
}

/**
 * The cluster a test file's time counts toward: its subject source file's
 * (the name without `.test`), else the cluster most graph files in its
 * directory belong to (the first by id on a tie), else {@link NO_CLUSTER}.
 */
export function clusterOfTest(path: string, clusterOf: ReadonlyMap<string, string>): string {
  const subject = clusterOf.get(path.replace(TEST_SUFFIX, '$1'));
  if (subject !== undefined) {
    return subject;
  }
  const dir = dirname(path);
  const counts = new Map<string, number>();
  clusterOf.forEach((cluster, file) => {
    if (dirname(file) === dir) {
      counts.set(cluster, (counts.get(cluster) ?? 0) + 1);
    }
  });
  const [best] = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return best?.[0] ?? NO_CLUSTER;
}

function groupBy(files: readonly FileTiming[], keyOf: (file: FileTiming) => string): GroupTiming[] {
  const groups = new Map<string, GroupTiming>();
  files.forEach((file) => {
    const name = keyOf(file);
    const previous = groups.get(name) ?? { name, files: 0, tests: 0, seconds: 0 };
    groups.set(name, {
      name,
      files: previous.files + 1,
      tests: previous.tests + file.tests,
      seconds: previous.seconds + file.seconds,
    });
  });
  return [...groups.values()]
    .map((group) => ({ ...group, seconds: round(group.seconds) }))
    .sort((a, b) => b.seconds - a.seconds || a.name.localeCompare(b.name));
}

/**
 * The reading of `report` (its per-file sums) over the tracked test files
 * `expected`: a report file outside `expected` is listed as untracked and
 * counted in no group.
 */
export function readTestTiming(
  reportPath: string,
  report: ReadonlyMap<string, ReportFile>,
  expected: readonly string[],
  clusterOf: ReadonlyMap<string, string>,
): TestTimingData {
  const tracked = new Set(expected);
  const files: FileTiming[] = [...report]
    .filter(([path]) => tracked.has(path))
    .map(([path, entry]) => ({
      path,
      folder: folderOf(path),
      cluster: clusterOfTest(path, clusterOf),
      tests: entry.tests,
      seconds: round(entry.seconds),
    }))
    .sort((a, b) => b.seconds - a.seconds || a.path.localeCompare(b.path));
  return {
    report: reportPath,
    seconds: round(files.reduce((sum, file) => sum + file.seconds, 0)),
    files,
    folders: groupBy(files, (file) => file.folder),
    clusters: groupBy(files, (file) => file.cluster),
    untracked: [...report.keys()].filter((path) => !tracked.has(path)).sort(),
  };
}

function groupTable(title: string, groups: readonly GroupTiming[]): string[] {
  return [
    `| ${title} | Files | Tests | Seconds |`,
    '| --- | --- | --- | --- |',
    ...groups.map((group) => `| \`${group.name}\` | ${group.files} | ${group.tests} | ${group.seconds} |`),
  ];
}

/** The markdown summary's body, written after the coverage line. */
export function renderTestTiming(data: TestTimingData): string {
  return [
    '# Test timing',
    '',
    `${data.files.length} test files from \`${basename(data.report)}\`, ${data.seconds} seconds in test cases `
      + '(hooks outside a case are not counted). A file\'s cluster is its subject source file\'s, else its '
      + `directory's most common, else \`${NO_CLUSTER}\`.`,
    '',
    `Report files that are no tracked test file: ${data.untracked.length === 0
      ? 'none'
      : data.untracked.map((path) => `\`${path}\``).join(', ')}`,
    '',
    '## Per folder',
    '',
    ...groupTable('Folder', data.folders),
    '',
    '## Per cluster',
    '',
    ...groupTable('Cluster', data.clusters),
    '',
    '## Slowest files',
    '',
    '| File | Cluster | Tests | Seconds |',
    '| --- | --- | --- | --- |',
    ...data.files.slice(0, TOP_FILES)
      .map((file) => `| \`${file.path}\` | ${file.cluster} | ${file.tests} | ${file.seconds} |`),
  ].join('\n');
}

/** The report path `argv` names after `--report`, or {@link DEFAULT_REPORT}. */
export function reportArgument(argv: readonly string[]): string {
  const at = argv.indexOf('--report');
  if (at === -1) {
    return DEFAULT_REPORT;
  }
  const value = argv[at + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error('--report needs a path');
  }
  return value;
}

/** Reads the report and writes the test timing of the repository at `repoRoot`. */
export async function surveyTestTiming(repoRoot: string, reportPath: string = DEFAULT_REPORT): Promise<TestTimingData> {
  const realRoot = realpathSync(repoRoot);
  const file = Bun.file(reportPath.startsWith('/')
    ? reportPath
    : join(realRoot, reportPath));
  if (!(await file.exists())) {
    throw new Error(`${reportPath} is absent: run bun test --reporter=junit --reporter-outfile=${reportPath} first`);
  }
  const clusterOf = clustersFromGraph(await loadImportGraph(realRoot));
  const expected = (await listTrackedFiles(realRoot, SURVEY_SCOPE)).filter(isTestFile);
  const data = readTestTiming(reportPath, parseJunit(await file.text()), expected, clusterOf);
  await writeSurvey(realRoot, 'test-timing', {
    data,
    markdown: renderTestTiming(data),
    coverage: measureCoverage(expected, data.files.map((entry) => entry.path)),
  });
  return data;
}

if (import.meta.main) {
  try {
    const data = await surveyTestTiming(process.cwd(), reportArgument(process.argv.slice(2)));
    console.log(`[test-timing] ${data.files.length} test files, ${data.seconds} seconds, `
      + `${data.clusters.length} clusters`);
  } catch (err) {
    console.error(`[test-timing] FAIL — ${err instanceof Error
      ? err.message
      : String(err)}`);
    process.exit(1);
  }
}
