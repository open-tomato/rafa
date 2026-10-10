/**
 * One run of `bun test`, over a list of paths or the whole project,
 * answering its exit code, Bun's summary line, and the failing tests read
 * from Bun's JUnit reporter file.
 *
 * The runner (`rafa loop start`) spawns this itself rather than asking a
 * session to, so no tool call's timeout caps it: the spawn has none. A
 * failure is identified by its test file plus its full test name
 * ({@link SuiteFailure}), the pair a baseline compares; it is read from
 * the JUnit file and never by searching console output for `fail`.
 *
 * ## What is spawned
 *
 * `bun test [--changed=<commit>] <paths...> --reporter=junit
 * --reporter-outfile=<junitFile>` in `cwd`, with `bun` looked up on the
 * environment's `PATH`. The
 * environment is the one handed in (`process.env` when left out) with
 * `CLAUDECODE` removed: with it set, Bun prints no per-test line, only
 * the counts. stdin and stdout are ignored; stderr is read to its end.
 *
 * Each rule below was measured on bun 1.4.2.
 *
 *   - **A bare relative path is a substring filter.** `bun test sub`
 *     also ran `subzero.test.ts` and `other/sub/b.test.ts`; `./sub` ran
 *     only `sub/`. So each relative path that does not already open with
 *     `./` or `../` is handed on as `./<path>`, and an absolute path as
 *     it is. That also keeps a path opening with `-` from reading as a
 *     flag.
 *   - **A path list with one unmatched path runs the rest and exits 0.**
 *     `./sub ./nope` ran `sub/` and said nothing of `./nope`. Only a list
 *     where NO path matches exits 1, with `Test filter "./nope" had no
 *     matches`, no summary line and no JUnit file. Choosing paths that
 *     exist is the caller's concern.
 *   - **A project holding no test file exits 1 with no summary line**,
 *     printing `No tests found!` or `error: 0 test files matching ...`;
 *     the result marks it `noTestFiles`, so a step reads it as green
 *     rather than unreported.
 *   - **Bun does not create the JUnit file's directory, and a failed
 *     write keeps exit code 0.** It printed `JUnitReportFailed: Failed to
 *     write JUnit report` and exited 0. So the directory is created
 *     before the spawn, and any file already at `junitFile` is removed,
 *     so a run that writes none can never be read as the last run's.
 *   - **`--changed=<commit>` runs the test files Bun's import graph
 *     reaches from the files changed since that commit**, the working
 *     tree's uncommitted and untracked files included (a run with no
 *     commit since the base still counted an untracked file as changed).
 *     When no test file is reached it printed `--changed: N changed
 *     files, but no test files are affected`, `Ran 0 tests across 0
 *     files.`, exited 0 and wrote NO JUnit file, so such a run reads
 *     `junit: 'missing'` with exit code 0: green, with nothing run.
 *   - **The report, counts and summary go to stderr**; a test's own
 *     `console.log` goes to stdout. Reading stderr alone keeps a test
 *     printing ` 5 errors` from changing the counts read here.
 *
 * ## What the JUnit file does NOT hold
 *
 * An error outside any test, a test file that throws while it loads or
 * imports a missing module, gets no `<testsuite>` and no `<testcase>`:
 * Bun counts it as both a `fail` and an `error` in its summary block,
 * under `# Unhandled error between tests`, and the JUnit file is silent.
 * A run of two such files exited 1 with a JUnit file holding no failure.
 * So a result carries {@link SuiteResult.errors}, the ` N error` or
 * ` N errors` line of the summary block, and a red run with no failure
 * named is told apart from a green one by it and by the exit code, never
 * by `failures` alone. A file holding no test gets no `<testsuite>`
 * either, so the absence of a file is no reading of anything.
 *
 * Stderr is the one place that names such an error, so a result also
 * carries {@link SuiteResult.unhandled}: each block's file and the
 * error's first line, read by `parseUnhandled` (`./unhandled.ts`). And
 * the run writes `suiteOutputText` (`./failure-lines.ts`) of its stderr,
 * the blocks, the failed cases with their error lines and the summary
 * lines only, capped, beside the JUnit file as `<name>.output.txt`
 * ({@link outputFileFor}); a step's text is
 * `.rafa/runs/<session>/suite/<kind>.output.txt`. It is removed before
 * the spawn, as the JUnit file is, and written after every run, empty
 * when stderr held none of the three, so the file on disk is always this
 * run's.
 *
 * ## How a test is named
 *
 * A `<testsuite>` directly under `<testsuites>` is a test file; each one
 * nested in it is a `describe` block. A failing test's name is its
 * enclosing describe names, outermost first, and its own, joined by
 * ` > `: the name Bun prints on its `(fail)` line, as in
 * `outer > inner > fails`. Bun's `classname` attribute is NOT used: it
 * holds the same chain innermost first (`inner > outer`). A failing
 * `beforeAll` or `afterAll` is a testcase named `(unnamed)`, so it reads
 * as `grp > (unnamed)`. A testcase fails when it holds a `<failure>` or
 * an `<error>` element; a timeout is a `<failure>` too.
 *
 * Two tests of one name in one file are one pair, so a failure appears
 * once in {@link SuiteResult.failures}, in the order the JUnit file
 * first names it.
 *
 * ## The message a failure carries
 *
 * A failure's {@link SuiteFailure.message} is the first line, trimmed,
 * of the `message` attribute on the first `<failure>` or `<error>` element of
 * its testcase that has one. It is left out when no such element has a
 * `message` attribute or when that first line is blank. The element's
 * text, the stack, is never read. Bun 1.4.2 wrote a `message` attribute on
 * every `<failure>` it was seen to write: an assertion's
 * `expect(received).toBe(expected)` heading the expected and received
 * lines, a thrown error's own message, `test timed out`, `TODO passed`.
 * It wrote no `<error>` element for an assertion, a thrown error, a
 * timeout, an unhandled rejection, a failing hook, a passing `.failing`
 * test, a passing todo or a missing assertion, so `<error>` is read for
 * other JUnit writers. A repeated pair keeps the message of the testcase
 * the JUnit file names first.
 *
 * Bun 1.3.14, the version `package.json` pins, wrote NO `message`
 * attribute at all: `<failure type="AssertionError" />` for a thrown
 * error and a failed assertion alike, `<failure type="TimeoutError" />`
 * for a timeout (`testdata/failed-cases.junit.xml`). Under it a failure
 * carries no message, and what failed it is read from stderr instead.
 *
 * ## The error lines a failure carries
 *
 * A failure's {@link SuiteFailure.errorLines} are the first lines of the
 * error Bun printed above its `(fail)` line, read by `parseFailedCases`
 * (`./failure-lines.ts`, which describes the reading and its caps) from
 * the same stderr the summary is read from, and matched to the JUnit
 * pair by file and name. The key is left out of a failure Bun printed no
 * error line for, or whose `(fail)` line was not found. The lines are
 * not part of what identifies a failure: a baseline compares the pair
 * alone.
 *
 * ## The order the files ran in
 *
 * {@link SuiteResult.fileOrder} holds the test files of the run in the
 * order the JUnit file names them, which is the order Bun ran them in
 * ({@link parseJunitFiles}): each `<testsuite>` directly under
 * `<testsuites>`, a passing file included. Measured on bun 1.3.14: a path
 * list ran its files in the order the arguments named them (`./b ./a` ran
 * `b` first), a bare run in the order of Bun's own scan, which was not
 * alphabetical, and the files of one run shared one process, so that a
 * value one file set on `globalThis` was read by the next. That last
 * reading is why the order is kept: a file red in a run and green alone
 * was failed by a file before it (`start/suite-retake-alone.ts`). The
 * field is a list of lists, one per `bun test` process: one for a run,
 * two for a run folded with a second (`start/task-always-run.ts`). A run
 * that wrote no JUnit file holds one empty list.
 */
import type { UnhandledError } from './unhandled.js';
import type { SpawnEnv } from '../utils/session-env.js';

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join } from 'node:path';

import { failingFilesOf, parseFailedCases, suiteOutputText, withErrorLines } from './failure-lines.js';
import { parseUnhandled } from './unhandled.js';

/** The variable removed from the environment `bun test` runs in. */
export const CLAUDE_CODE_ENV = 'CLAUDECODE';

/** One failing test: its file, relative to the run's directory, and its full name. */
export interface SuiteFailure {
  readonly file: string;
  /** Its describe names, outermost first, and its own, joined by ` > `. */
  readonly name: string;
  /**
   * The first line of its JUnit failure's message; absent when the
   * report gave none. Compared by `src/triage/inherited.ts` when present to
   * identify inherited failures.
   */
  readonly message?: string;
  /**
   * The first lines of the error Bun printed for it on stderr, trimmed;
   * absent when it printed none. See the module note.
   */
  readonly errorLines?: readonly string[];
}

/**
 * How the JUnit file read: `read`, `missing` when Bun wrote none (no
 * path matched, or the write failed), or `unreadable` when the file
 * could not be opened or is not a whole `<testsuites>` document.
 */
export type JunitReading = 'read' | 'missing' | 'unreadable';

/** What one run of `bun test` answered. */
export interface SuiteResult {
  /** The argv spawned, `bun` first. */
  readonly command: readonly string[];
  readonly exitCode: number;
  /** Bun's `Ran N tests across M files. [t]` line, or null when it printed none. */
  readonly summary: string | null;
  /** The failing tests the JUnit file names; none when it was not read. */
  readonly failures: readonly SuiteFailure[];
  /**
   * Errors outside any test, from the summary block, which the JUnit file
   * does not hold; 0 when the block has no error line, null when there
   * was no summary to read it from.
   */
  readonly errors: number | null;
  readonly junit: JunitReading;
  /**
   * Each `# Unhandled error between tests` block of stderr, with the file
   * it names and the error's first line, in the order Bun printed them;
   * none when stderr held no block. See the module note.
   */
  readonly unhandled: readonly UnhandledError[];
  /**
   * True when Bun found no test file to run at all (a project with none,
   * which it reports as an error and exit code 1); absent otherwise.
   */
  readonly noTestFiles?: boolean;
  /**
   * The test files each `bun test` process ran, in the order its JUnit
   * file names them; absent from a result no run made. See the module
   * note.
   */
  readonly fileOrder?: readonly (readonly string[])[];
}

/** What one spawn of `bun test` answered. */
export interface SuiteSpawnResult {
  readonly exitCode: number;
  /** Everything the process wrote to stderr. */
  readonly stderr: string;
}

/** Where, and with what environment, `bun test` is spawned. */
export interface SuiteSpawnOptions {
  readonly cwd: string;
  readonly env: SpawnEnv;
}

/** Spawns `argv` and waits for it; {@link spawnSuite} is the real one. */
export type SuiteSpawner = (argv: readonly string[], options: SuiteSpawnOptions) => Promise<SuiteSpawnResult>;

/** What one run takes. Everything past `junitFile` is a seam. */
export interface SuiteRunOptions {
  /** The project directory `bun test` runs in. */
  readonly cwd: string;
  /**
   * The test files and folders to run, relative to `cwd` or absolute.
   * Left out, the whole project runs. An empty list is refused: it would
   * run the whole project too, which no caller asking for paths means.
   */
  readonly paths?: readonly string[];
  /**
   * A commit: only the test files reached from what changed since it
   * run, as `--changed=<commit>`; see the module note. Left out, no
   * selection is made.
   */
  readonly changedSince?: string;
  /**
   * Where Bun writes its JUnit report; its directory is created, and the
   * capped stderr text is written beside it ({@link outputFileFor}).
   */
  readonly junitFile: string;
  /** The environment to start from; `process.env` when left out. */
  readonly env?: Readonly<SpawnEnv>;
  /** {@link spawnSuite} when left out. */
  readonly spawn?: SuiteSpawner;
}

/** The summary line Bun ends a run with. */
const SUMMARY_LINE = /^Ran \d+ tests? across \d+ files?\./;

/** One count line of the block above the summary, as ` 3 fail`. */
const COUNT_LINE = /^\s*(\d+) (\S.*)$/;

/** The count line naming errors outside any test. */
const ERROR_COUNT_LABEL = /^errors?$/;

/** The lines Bun prints, in one of two wordings, instead of a summary when the project holds no test file. */
const NO_TEST_FILES_LINE = /^(?:error: 0 test files matching |No tests found!)/m;

/** True when `stderr` is Bun saying the project holds no test file at all. */
export function readNoTestFiles(stderr: string): boolean {
  return NO_TEST_FILES_LINE.test(stderr);
}

/** `path` as `bun test` reads it as a path rather than a filter; see the module note. */
export function suitePathArgument(path: string): string {
  if (isAbsolute(path) || path.startsWith('./') || path.startsWith('../')) return path;
  return `./${path}`;
}

/**
 * The argv of one run over `paths`, or over the whole project when left
 * out, narrowed to what changed since `changedSince` when it is handed.
 */
export function suiteCommand(junitFile: string, paths?: readonly string[], changedSince?: string): readonly string[] {
  const pathArgs = paths === undefined
    ? []
    : paths.map(suitePathArgument);
  const changedArgs = changedSince === undefined
    ? []
    : [`--changed=${changedSince}`];
  return ['bun', 'test', ...changedArgs, ...pathArgs, '--reporter=junit', `--reporter-outfile=${junitFile}`];
}

/** The suffix a JUnit file name ends in, which {@link outputFileFor} replaces. */
const JUNIT_SUFFIX = '.junit.xml';

/** The suffix of the capped stderr text written beside a JUnit file. */
export const OUTPUT_SUFFIX = '.output.txt';

/**
 * Where the capped stderr text of the run reporting to `junitFile` goes:
 * beside it, `<name>.output.txt` for `<name>.junit.xml`, or for any other
 * name the name without its extension and with that suffix.
 */
export function outputFileFor(junitFile: string): string {
  const name = basename(junitFile);
  const stem = name.endsWith(JUNIT_SUFFIX)
    ? name.slice(0, -JUNIT_SUFFIX.length)
    : name.slice(0, name.length - extname(name).length);
  return join(dirname(junitFile), `${stem}${OUTPUT_SUFFIX}`);
}

/** `base` without `CLAUDECODE`, as a new object. */
export function suiteEnv(base: Readonly<SpawnEnv>): SpawnEnv {
  return Object.fromEntries(Object.entries(base).filter(([key]) => key !== CLAUDE_CODE_ENV));
}

/** The index of the last summary line in `lines`, or -1. */
function summaryIndex(lines: readonly string[]): number {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (SUMMARY_LINE.test(lines[index] ?? '')) return index;
  }
  return -1;
}

/** The error count in the count lines directly above `index`, 0 when none names errors. */
function errorCount(lines: readonly string[], index: number): number {
  for (let at = index - 1; at >= 0; at -= 1) {
    const match = COUNT_LINE.exec(lines[at] ?? '');
    if (match === null) return 0;
    if (ERROR_COUNT_LABEL.test(match[2] ?? '')) return Number(match[1]);
  }
  return 0;
}

/**
 * Bun's summary line and the error count above it, read from its
 * stderr. Both are null when no summary line was printed.
 */
export function readSummary(stderr: string): { readonly summary: string | null; readonly errors: number | null } {
  const lines = stderr.split(/\r?\n/).map((line) => line.trimEnd());
  const index = summaryIndex(lines);
  if (index < 0) return { summary: null, errors: null };
  return { summary: lines[index] ?? null, errors: errorCount(lines, index) };
}

/** An XML attribute value with its entities replaced. */
function unescapeXml(value: string): string {
  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|quot|apos|lt|gt|amp);/g, (whole: string, entity: string) => {
    if (entity.startsWith('#x')) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith('#')) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    const named: Record<string, string> = { quot: '"', apos: '\'', lt: '<', gt: '>', amp: '&' };
    return named[entity] ?? whole;
  });
}

/** The attributes of one tag, their values unescaped. */
export function attributesOf(text: string): Readonly<Record<string, string>> {
  const found: Record<string, string> = {};
  for (const match of text.matchAll(/([\w:-]+)="([^"]*)"/g)) {
    found[match[1] ?? ''] = unescapeXml(match[2] ?? '');
  }
  return found;
}

/** A tag the parser reads: element name, whether it closes, whether it self-closes. */
const TAG = /<(\/?)(testsuites|testsuite|testcase|failure|error)\b([^>]*?)(\/?)>/g;

/** The testcase being read, until its closing tag. */
interface OpenCase {
  readonly file: string;
  readonly name: string;
  failed: boolean;
  /** The first message line read from its failure elements, once one is. */
  message?: string;
}

/** Where the JUnit walk is: the suite stack, the case open inside it, and the test files met so far. */
interface JunitWalk {
  readonly suites: { readonly name: string; readonly file: string }[];
  readonly failures: SuiteFailure[];
  /** Each test file once, in the order its suite opened. */
  readonly files: string[];
  open: OpenCase | null;
}

/** Records `open` as a failure when it failed and its pair is not yet held. */
function closeCase(walk: JunitWalk): void {
  const open = walk.open;
  walk.open = null;
  if (open === null || !open.failed) return;
  const held = walk.failures.some((failure) => failure.file === open.file && failure.name === open.name);
  if (held) return;
  walk.failures.push(open.message === undefined
    ? { file: open.file, name: open.name }
    : { file: open.file, name: open.name, message: open.message });
}

/** The first line of `message`, trimmed, or undefined when there is none or it is blank. */
export function firstMessageLine(message: string | undefined): string | undefined {
  const line = message?.split(/\r?\n/, 1)[0]?.trim() ?? '';
  return line === ''
    ? undefined
    : line;
}

/** Marks the open case failed, taking its message from `attributes` when it has none yet. */
function failCase(open: OpenCase, attributes: Readonly<Record<string, string>>): void {
  open.failed = true;
  if (open.message === undefined) open.message = firstMessageLine(attributes['message']);
}

/** Opens a testcase from its attributes, inside the suites on the stack. */
function openCase(walk: JunitWalk, attributes: Readonly<Record<string, string>>): void {
  const [fileSuite, ...describes] = walk.suites;
  const file = attributes['file'] ?? fileSuite?.file ?? '';
  const name = [...describes.map((suite) => suite.name), attributes['name'] ?? ''].join(' > ');
  walk.open = { file, name, failed: false };
}

/** Opens a suite from its attributes; one opened under no other is a test file, held once. */
function openSuite(walk: JunitWalk, attributes: Readonly<Record<string, string>>): void {
  const file = attributes['file'] ?? attributes['name'] ?? '';
  if (walk.suites.length === 0 && file !== '' && !walk.files.includes(file)) walk.files.push(file);
  walk.suites.push({ name: attributes['name'] ?? '', file });
}

/** Takes one tag into the walk. */
function takeTag(walk: JunitWalk, match: RegExpMatchArray): void {
  const [, closing, element, rest, selfClosing] = match;
  const attributes = attributesOf(rest ?? '');
  if (element === 'testsuite') {
    if (closing === '/') walk.suites.pop();
    else if (selfClosing !== '/') openSuite(walk, attributes);
    return;
  }
  if (element === 'testcase') {
    if (closing === '/') return closeCase(walk);
    openCase(walk, attributes);
    if (selfClosing === '/') closeCase(walk);
    return;
  }
  if ((element === 'failure' || element === 'error') && closing !== '/' && walk.open !== null) failCase(walk.open, attributes);
}

/**
 * The failing tests a Bun JUnit report names, each pair once, or null
 * when `xml` is not a whole `<testsuites>` document. See the module note
 * for how a test is named.
 */
export function parseJunitFailures(xml: string): readonly SuiteFailure[] | null {
  return walkJunit(xml)?.failures ?? null;
}

/**
 * The test files a Bun JUnit report names, each once, in the order it
 * names them, or null when `xml` is not a whole `<testsuites>` document.
 * See the module note, "The order the files ran in".
 */
export function parseJunitFiles(xml: string): readonly string[] | null {
  return walkJunit(xml)?.files ?? null;
}

/** The walk over a whole `<testsuites>` document, or null when `xml` is none. */
function walkJunit(xml: string): JunitWalk | null {
  if (!/<testsuites\b/.test(xml) || !xml.includes('</testsuites>')) return null;
  const walk: JunitWalk = { suites: [], failures: [], files: [], open: null };
  for (const match of xml.matchAll(TAG)) {
    if (match[2] !== 'testsuites') takeTag(walk, match);
  }
  return walk;
}

/** What {@link readJunit} answers: how the file read, its failures and its test files in order. */
interface JunitRead {
  readonly junit: JunitReading;
  readonly failures: readonly SuiteFailure[];
  readonly files: readonly string[];
}

/** The JUnit file at `path`, read and parsed. */
function readJunit(path: string): JunitRead {
  if (!existsSync(path)) return { junit: 'missing', failures: [], files: [] };
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return { junit: 'unreadable', failures: [], files: [] };
  }
  const walk = walkJunit(text);
  return walk === null
    ? { junit: 'unreadable', failures: [], files: [] }
    : { junit: 'read', failures: walk.failures, files: walk.files };
}

/**
 * Spawns `argv` in `options.cwd` with stdin and stdout ignored and no
 * timeout, reading stderr to its end. See the module note.
 */
export async function spawnSuite(argv: readonly string[], options: SuiteSpawnOptions): Promise<SuiteSpawnResult> {
  const proc = Bun.spawn([...argv], {
    cwd: options.cwd,
    env: { ...options.env },
    stdin: 'ignore',
    stdout: 'ignore',
    stderr: 'pipe',
  });
  const [stderr, exitCode] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  return { exitCode, stderr };
}

/**
 * Runs `bun test` over `options.paths`, or the whole project when they
 * are left out, narrowed by `options.changedSince` when it is handed,
 * and answers what it found. Throws a `RangeError` for an
 * empty path list; a failing suite is an answer, never a throw.
 */
export async function runSuite(options: SuiteRunOptions): Promise<SuiteResult> {
  if (options.paths?.length === 0) {
    throw new RangeError('runSuite: an empty path list would run the whole project; leave paths out for that');
  }
  const command = suiteCommand(options.junitFile, options.paths, options.changedSince);
  const outputFile = outputFileFor(options.junitFile);
  mkdirSync(dirname(options.junitFile), { recursive: true });
  rmSync(options.junitFile, { force: true });
  rmSync(outputFile, { force: true });
  const spawn = options.spawn ?? spawnSuite;
  const env = suiteEnv(options.env ?? process.env);
  const { exitCode, stderr } = await spawn(command, { cwd: options.cwd, env });
  const { junit, failures: named, files } = readJunit(options.junitFile);
  const cases = parseFailedCases(stderr, failingFilesOf(named));
  writeFileSync(outputFile, suiteOutputText(stderr, cases));
  const { summary, errors } = readSummary(stderr);
  const failures = withErrorLines(named, cases);
  const unhandled = parseUnhandled(stderr);
  const result: SuiteResult = { command, exitCode, summary, failures, errors, junit, unhandled, fileOrder: [files] };
  return readNoTestFiles(stderr)
    ? { ...result, noTestFiles: true }
    : result;
}
