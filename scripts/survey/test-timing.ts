/**
 * The survey's test timing: how long each test file's cases take in one
 * run of the suite. Run from the repository root,
 * `bun scripts/survey/test-timing.ts <junit.xml> <exit-code>` reads the
 * report `bun test --reporter=junit --reporter-outfile=<junit.xml>` wrote
 * and writes `docs/survey/test-timing.md`. The exit code is the run's own,
 * read by the caller on the line after `bun test`: the report does not
 * carry it.
 *
 * How bun 1.3 writes the report, as read from its output:
 *
 *   - One `<testsuite>` per test file under the `<testsuites>` root, its
 *     `file` attribute the file's path relative to where `bun test` ran.
 *     Each `describe` is a `<testsuite>` nested inside it, to any depth.
 *   - Each test is a `<testcase>` with its own `file` and `time` (seconds).
 *     A skipped or `todo` test holds a `<skipped>`, a failed one a
 *     `<failure>` (an `<error>` is counted as a failure too).
 *   - A `<testsuite>`'s own `time` covers only the cases inside it, and a
 *     fast suite reads `0`: it is not used. A file's time here is the sum
 *     of its cases' times, every nested suite included. Hooks
 *     (`beforeAll`, `afterEach`, …) and module loading fall outside every
 *     case; the root's `time` is the run's wall clock, and the summary
 *     shows the difference as time outside cases.
 *
 * The run is green when its exit code is `0` and no case failed; anything
 * else is reported as not green, the failed cases named.
 *
 * The coverage line counts the files the report holds against the tracked
 * files `bun test` discovers by name (`*.test.*`, `*_test.*`, `*.spec.*`,
 * `*_spec.*`), so a file the run skipped is named.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { coverageLine } from './files';
import { OUTPUT_DIR } from './import-graph';

/** How a test case ended. */
export type CaseOutcome = 'failed' | 'passed' | 'skipped';

/** One `<testcase>` of the report. */
export interface TimedCase {
  /** The test file the case belongs to, relative to where the run started. */
  readonly file: string;
  /** The case's name, prefixed by its `describe` names joined with ` > `. */
  readonly name: string;
  /** How the case ended. */
  readonly outcome: CaseOutcome;
  /** The case's time, in whole microseconds, so sums stay exact. */
  readonly micros: number;
}

/** The report as read: every case, and the run's wall clock. */
export interface JunitRun {
  /** Every case, in the order the report lists them. */
  readonly cases: readonly TimedCase[];
  /** The root's `time`, in whole microseconds: hooks and loading included. */
  readonly wallMicros: number;
}

/** One test file's time and the outcome of its cases. */
export interface FileTiming {
  /** The test file's path. */
  readonly file: string;
  /** The sum of its cases' times, in whole microseconds. */
  readonly micros: number;
  /** How many of its cases passed. */
  readonly passed: number;
  /** How many of its cases failed. */
  readonly failed: number;
  /** How many of its cases were skipped (`todo` included). */
  readonly skipped: number;
}

/** What the summary shows, every list sorted. */
export interface TimingSummary {
  /** One entry per test file, sorted by path. */
  readonly files: readonly FileTiming[];
  /** The slowest files, slowest first and then by path, at most `TOP_SLOWEST`. */
  readonly slowest: readonly FileTiming[];
  /** The sum of every case's time, in whole microseconds. */
  readonly totalMicros: number;
  /** The sum of the slowest files' times, in whole microseconds. */
  readonly slowestMicros: number;
  /** The run's wall clock, in whole microseconds. */
  readonly wallMicros: number;
  /** How many cases passed. */
  readonly passed: number;
  /** How many cases failed. */
  readonly failed: number;
  /** How many cases were skipped. */
  readonly skipped: number;
  /** The failed cases, sorted by file and then by name. */
  readonly failures: readonly TimedCase[];
  /** The files whose every case was skipped, sorted. */
  readonly allSkipped: readonly string[];
}

/** How many of the slowest files the summary lists. */
export const TOP_SLOWEST = 20;

/** The scope the coverage line names. */
export const TIMING_SCOPE = 'test files `bun test` discovers';

const MICROS_PER_SECOND = 1_000_000;
const TEST_FILE_NAME = /(?:\.test|_test|\.spec|_spec)\.(?:[cm]?[jt]s|[jt]sx)$/;
const TAG = /<(\/?)(testsuites|testsuite|testcase|failure|error|skipped)\b((?:[^>"]|"[^"]*")*?)(\/?)>/g;
const ATTRIBUTE = /([\w:-]+)="([^"]*)"/g;
const ENTITY = /&(?:#x([0-9a-fA-F]+)|#(\d+)|(amp|lt|gt|quot|apos));/g;
const NAMED_ENTITIES: Readonly<Record<string, string>> = { amp: '&', apos: '\'', gt: '>', lt: '<', quot: '"' };
const IGNORED_SPANS = /<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->/g;

/**
 * Whether `bun test` discovers a file by its name.
 *
 * @param path - A repository-relative path.
 * @returns `true` for `*.test.*`, `*_test.*`, `*.spec.*` and `*_spec.*`
 *   JavaScript or TypeScript files outside `node_modules`.
 */
export function isTestFileName(path: string): boolean {
  return TEST_FILE_NAME.test(path) && !path.split('/').includes('node_modules');
}

/**
 * Decodes the XML entities of an attribute value, once.
 *
 * @param value - The raw attribute text.
 * @returns The text it stands for.
 */
function decodeEntities(value: string): string {
  return value.replace(ENTITY, (whole, hex: string | undefined, decimal: string | undefined, named: string | undefined) => {
    if (hex !== undefined) {
      return String.fromCodePoint(Number.parseInt(hex, 16));
    }
    if (decimal !== undefined) {
      return String.fromCodePoint(Number.parseInt(decimal, 10));
    }
    return NAMED_ENTITIES[named ?? ''] ?? whole;
  });
}

/**
 * The attributes of one tag.
 *
 * @param text - The tag's text between its name and its closing `>`.
 * @returns Each attribute's decoded value by name.
 */
function attributesOf(text: string): Map<string, string> {
  return new Map([...text.matchAll(ATTRIBUTE)].map((match) => [match[1] ?? '', decodeEntities(match[2] ?? '')]));
}

/**
 * A `time` attribute in whole microseconds; a missing one reads `0`.
 *
 * @param value - The attribute's value, if any.
 * @param where - What the time belongs to, for the error.
 * @returns The time in whole microseconds.
 * @throws When the value is not a non-negative number.
 */
function microsOf(value: string | undefined, where: string): number {
  if (value === undefined || value === '') {
    return 0;
  }
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new Error(`malformed time "${value}" on ${where}`);
  }
  return Math.round(seconds * MICROS_PER_SECOND);
}

/** A `<testcase>` opened and not yet closed. */
interface OpenCase {
  readonly file: string;
  readonly name: string;
  readonly micros: number;
  outcome: CaseOutcome;
}

/** The parser's state across tags. */
interface ParseState {
  readonly suites: { readonly name: string; readonly file: string }[];
  readonly cases: TimedCase[];
  open: OpenCase | undefined;
  wallMicros: number | undefined;
}

/**
 * Opens a test case from its tag.
 *
 * @param state - The parser's state; its suite stack names the case.
 * @param attributes - The tag's attributes.
 * @returns The case, passed until a child says otherwise.
 */
function openCase(state: ParseState, attributes: ReadonlyMap<string, string>): OpenCase {
  const name = attributes.get('name') ?? '';
  const describes = state.suites.slice(1).map((suite) => suite.name);
  const file = attributes.get('file') ?? state.suites[0]?.file ?? '';
  return {
    file: file.replace(/^\.\//, ''),
    micros: microsOf(attributes.get('time'), `test case "${name}" in ${file}`),
    name: [...describes, name].join(' > '),
    outcome: 'passed',
  };
}

/**
 * Applies one tag to the parser's state.
 *
 * @param state - The parser's state, changed in place.
 * @param closing - Whether the tag is a closing one (`</…>`).
 * @param tag - The tag's name.
 * @param attributes - The tag's attributes.
 * @param selfClosing - Whether the tag closes itself (`<…/>`).
 */
function applyTag(state: ParseState, closing: boolean, tag: string, attributes: ReadonlyMap<string, string>, selfClosing: boolean): void {
  if (tag === 'testsuites') {
    state.wallMicros ??= microsOf(attributes.get('time'), 'the report root');
    return;
  }
  if (tag === 'testsuite') {
    if (closing) {
      state.suites.pop();
    } else if (!selfClosing) {
      state.suites.push({ file: attributes.get('file') ?? attributes.get('name') ?? '', name: attributes.get('name') ?? '' });
    }
    return;
  }
  if (tag === 'testcase') {
    if (closing || selfClosing) {
      const done = state.open ?? openCase(state, attributes);
      state.cases.push({ ...done });
      state.open = undefined;
    } else {
      state.open = openCase(state, attributes);
    }
    return;
  }
  if (closing || state.open === undefined) {
    return;
  }
  if (tag === 'skipped' && state.open.outcome === 'passed') {
    state.open.outcome = 'skipped';
  } else if (tag === 'failure' || tag === 'error') {
    state.open.outcome = 'failed';
  }
}

/**
 * Reads a `bun test --reporter=junit` report. Pure: the caller reads the
 * file.
 *
 * @param xml - The report's text.
 * @returns Every case with its file, outcome and time, and the run's wall clock.
 * @throws When the text holds no `<testsuites>` root, or a time is malformed.
 */
export function parseJunit(xml: string): JunitRun {
  const state: ParseState = { cases: [], open: undefined, suites: [], wallMicros: undefined };
  for (const match of xml.replace(IGNORED_SPANS, '').matchAll(TAG)) {
    applyTag(state, match[1] === '/', match[2] ?? '', attributesOf(match[3] ?? ''), match[4] === '/');
  }
  if (state.wallMicros === undefined) {
    throw new Error('not a junit report: no <testsuites> root');
  }
  return { cases: state.cases, wallMicros: state.wallMicros };
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
 * Sums a run's cases per file and picks the slowest files.
 *
 * @param run - The report as read.
 * @returns The summary, every list sorted.
 */
export function summarizeTiming(run: JunitRun): TimingSummary {
  const perFile = new Map<string, FileTiming>();
  for (const item of run.cases) {
    const before = perFile.get(item.file) ?? { failed: 0, file: item.file, micros: 0, passed: 0, skipped: 0 };
    perFile.set(item.file, {
      ...before,
      [item.outcome]: before[item.outcome] + 1,
      micros: before.micros + item.micros,
    });
  }
  const files = [...perFile.values()].sort((left, right) => byText(left.file, right.file));
  const slowest = [...files].sort((left, right) => right.micros - left.micros || byText(left.file, right.file)).slice(0, TOP_SLOWEST);
  const count = (outcome: CaseOutcome): number => run.cases.filter((item) => item.outcome === outcome).length;
  const sum = (list: readonly FileTiming[]): number => list.reduce((total, file) => total + file.micros, 0);
  return {
    allSkipped: files.filter((file) => file.skipped > 0 && file.passed + file.failed === 0).map((file) => file.file),
    failed: count('failed'),
    failures: run.cases
      .filter((item) => item.outcome === 'failed')
      .sort((left, right) => byText(left.file, right.file) || byText(left.name, right.name)),
    files,
    passed: count('passed'),
    skipped: count('skipped'),
    slowest,
    slowestMicros: sum(slowest),
    totalMicros: sum(files),
    wallMicros: run.wallMicros,
  };
}

/**
 * Whether a run is green: it exited `0` and no case failed.
 *
 * @param summary - The run's summary.
 * @param exitCode - The exit code `bun test` returned.
 * @returns `true` only when both hold.
 */
export function isGreen(summary: TimingSummary, exitCode: number): boolean {
  return exitCode === 0 && summary.failed === 0;
}

/**
 * A time in seconds with two decimals.
 *
 * @param micros - A time in whole microseconds.
 * @returns The seconds, as `12.34 s`.
 */
function seconds(micros: number): string {
  return `${(micros / MICROS_PER_SECOND).toFixed(2)} s`;
}

/**
 * A part of a whole as a percentage with one decimal.
 *
 * @param part - The part.
 * @param whole - The whole; `0` reads as a share of `0.0%`.
 * @returns The share, as `12.3%`.
 */
function share(part: number, whole: number): string {
  return `${(whole === 0
    ? 0
    : (part * 100) / whole).toFixed(1)}%`;
}

/**
 * The summary as `docs/survey/test-timing.md` holds it: the coverage line,
 * the run's outcome, the slowest files and their share, the failed cases
 * and the files whose every case was skipped.
 *
 * @param summary - The run's summary.
 * @param exitCode - The exit code `bun test` returned.
 * @param tracked - The tracked test files, for the coverage line.
 * @returns The markdown text, ending in a newline.
 */
export function renderTestTimingMarkdown(summary: TimingSummary, exitCode: number, tracked: readonly string[]): string {
  const green = isGreen(summary, exitCode);
  const outside = Math.max(0, summary.wallMicros - summary.totalMicros);
  const lines = [
    '# Test timing',
    '',
    coverageLine(summary.files.map((file) => file.file), tracked, TIMING_SCOPE),
    '',
    `Run: ${green
      ? 'green'
      : 'not green'}. Exit code ${exitCode}; ${summary.passed} pass, ${summary.failed} fail, ${summary.skipped} skipped `
    + `across ${summary.files.length} test files.`,
    '',
    `Time in test cases: ${seconds(summary.totalMicros)}; wall clock ${seconds(summary.wallMicros)}, `
    + `${seconds(outside)} of it outside any case (hooks, module loading). A file's time is the sum of its cases, `
    + 'every nested `describe` included.',
    '',
    `## The ${TOP_SLOWEST} slowest files`,
    '',
    `They take ${seconds(summary.slowestMicros)}, ${share(summary.slowestMicros, summary.totalMicros)} of the time in test cases.`,
    '',
    '| Rank | Test file | Time | Share | Pass | Fail | Skipped |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...summary.slowest.map((file, rank) => `| ${rank + 1} | \`${file.file}\` | ${seconds(file.micros)} | `
      + `${share(file.micros, summary.totalMicros)} | ${file.passed} | ${file.failed} | ${file.skipped} |`),
  ];
  if (summary.failures.length > 0) {
    lines.push('', '## Failed cases', '', ...summary.failures.map((item) => `- \`${item.file}\`: ${item.name}`));
  }
  if (summary.allSkipped.length > 0) {
    lines.push('', '## Files whose every case was skipped', '', ...summary.allSkipped.map((file) => `- \`${file}\``));
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Lists the tracked files `bun test` discovers by name.
 *
 * @param root - The repository's root folder.
 * @returns The paths, sorted.
 * @throws When `git ls-files` cannot run or exits non-zero.
 */
export function listTrackedTestFiles(root: string): string[] {
  const result = Bun.spawnSync(['git', 'ls-files', '-z'], { cwd: root, stderr: 'pipe', stdout: 'pipe' });
  if (result.exitCode !== 0) {
    throw new Error(`git ls-files failed in ${root} (exit ${result.exitCode}): ${result.stderr.toString().trim()}`);
  }
  return result.stdout
    .toString()
    .split('\0')
    .filter((path) => path !== '' && isTestFileName(path))
    .sort();
}

/**
 * Reads the report and writes `docs/survey/test-timing.md` under `root`.
 *
 * @param root - The repository root, where `bun test` ran.
 * @param reportPath - The junit report, relative to `root` or absolute.
 * @param exitCode - The exit code `bun test` returned.
 * @returns The paths written, relative to `root`.
 */
export async function main(root: string, reportPath: string, exitCode: number): Promise<string[]> {
  const summary = summarizeTiming(parseJunit(await Bun.file(resolve(root, reportPath)).text()));
  mkdirSync(join(root, OUTPUT_DIR), { recursive: true });
  const markdownPath = `${OUTPUT_DIR}/test-timing.md`;
  writeFileSync(join(root, markdownPath), renderTestTimingMarkdown(summary, exitCode, listTrackedTestFiles(root)));
  return [markdownPath];
}

/**
 * Reads the command line: the report's path and the run's exit code.
 *
 * @param args - The arguments after the script's path.
 * @returns The report's path and the exit code.
 * @throws When either is missing or the exit code is not a whole number.
 */
export function parseArguments(args: readonly string[]): { readonly reportPath: string; readonly exitCode: number } {
  const [reportPath, exitText] = args;
  if (reportPath === undefined || exitText === undefined || args.length !== 2) {
    throw new Error('usage: bun scripts/survey/test-timing.ts <junit.xml> <exit-code>');
  }
  if (!/^\d+$/.test(exitText)) {
    throw new Error(`exit code must be a whole number, got "${exitText}"`);
  }
  return { exitCode: Number(exitText), reportPath };
}

if (import.meta.main) {
  try {
    const { exitCode, reportPath } = parseArguments(process.argv.slice(2));
    for (const path of await main(process.cwd(), reportPath, exitCode)) {
      console.log(`wrote ${path}`);
    }
  } catch (err) {
    console.error(err instanceof Error
      ? err.message
      : String(err));
    process.exit(1);
  }
}
