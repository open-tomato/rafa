/**
 * The error Bun prints for each failed case, read from what `bun test`
 * writes to stderr: one {@link FailedCase} per `(fail)` line, holding the
 * first lines of the error above it.
 *
 * Bun's JUnit file says THAT a case failed and not why. Measured on bun
 * 1.3.14, the version `package.json` pins: every `<failure>` element was
 * written as `<failure type="AssertionError" />`, with no `message`
 * attribute and no text, for an error thrown before the first `expect`,
 * a failing assertion, a thrown string and a rejected promise alike, and
 * as `<failure type="TimeoutError" />` for a timeout. So stderr is the
 * one place that names the error, and a step that keeps the JUnit pairs
 * alone hands its repair session the failing cases without their cause.
 *
 * ## What Bun prints for a failed case
 *
 * Measured on bun 1.3.14 with stderr piped (no colour) and `CLAUDECODE`
 * unset, which `suiteEnv` (`./run.ts`) sees to: with it set, Bun prints
 * no `(pass)` line, and the lines of one case are no longer bounded by
 * the case before it. `suiteEnv` removes `FORCE_COLOR` as well: with it
 * set Bun colours the pipe and prints a `✗` glyph where `(fail)` is read
 * below.
 *
 * Under each file's header, the path relative to the run's directory and
 * a colon, every case ends in one marker line: `(pass)`, `(fail)`,
 * `(skip)` or `(todo)`, then its name, its describe names first, joined
 * by ` > `, and for most a time in brackets. What a case wrote to stderr
 * and the error that failed it are printed ABOVE its marker line:
 *
 * ```text
 * thrown.test.ts:
 * 7 | function guard(): void {
 * 8 |   throw new UndeclaredSpendError('...');
 *                                           ^
 * UndeclaredSpendError: rafa loop start spends through claude and declared none
 * second line of the message
 *       at guard (/abs/thrown.test.ts:8:119)
 *       at <anonymous> (/abs/thrown.test.ts:13:5)
 * (fail) stand-in claude > throws before any expect [0.19ms]
 * ```
 *
 * The error opens with a code frame (numbered lines `N | ...` and a caret
 * line), then the error itself: `error: <message>` for an `Error` or a
 * thrown string, `<Name>: <message>` for a subclass, a bare `error` for a
 * thrown object, and for a failed assertion `error: expect(received)...`
 * with the expected and received lines under it, blank lines between.
 * The stack follows, each frame a line opening with `at`. A timeout is
 * the one exception: its `(fail)` line comes first, and one line under
 * it says `  ^ this test timed out after 50ms.`.
 *
 * ## How a case is read
 *
 *   - A file header is a line holding one of the files handed in and a
 *     colon, and nothing else. Any line ending in a colon would read as
 *     one otherwise: a case that printed `warming up:` to stderr was
 *     measured to. {@link parseFailedCases} is handed the files the
 *     JUnit file names failures in, so a case under any other header is
 *     left out.
 *   - A case's lines run from the marker line before it, or its file's
 *     header, to its own `(fail)` line. A timeout's line under a `(fail)`
 *     line belongs to that case and is not read into the next.
 *   - Its error starts under the first caret line, which skips whatever
 *     the case printed itself, or at the first line when Bun printed no
 *     frame. From there every line is kept, trimmed, that is neither
 *     blank, a frame line nor a caret line, up to the first stack line
 *     or {@link MAX_ERROR_LINES}; a line over
 *     {@link MAX_ERROR_LINE_LENGTH} characters is cut there and ends in
 *     `...`.
 *   - {@link FailedCase.name} is the text after `(fail) ` with the
 *     trailing time off, and {@link FailedCase.label} that text whole,
 *     so a name ending in a time-like bracket of its own still matches
 *     its JUnit name ({@link withErrorLines}).
 *
 * ## The text kept beside the JUnit file
 *
 * {@link suiteOutputText} is what a run writes as `<name>.output.txt`:
 * the unhandled-error blocks (`./unhandled.ts`), then the failed cases
 * ({@link failedCasesLines}: each file's header once, each `(fail)` line
 * without its time, and its error lines indented under it, at most
 * {@link MAX_FAILED_CASES} cases and a line counting the rest), then the
 * summary lines, a blank line between the three.
 */
import type { SuiteFailure } from './run.js';

import { cappedSections, joinSections } from './unhandled.js';

/** The most lines kept of one failed case's error. */
export const MAX_ERROR_LINES = 5;

/** The most characters kept of one error line; a longer one is cut there and ends in `...`. */
export const MAX_ERROR_LINE_LENGTH = 300;

/** The most failed cases {@link failedCasesLines} writes before it counts the rest. */
export const MAX_FAILED_CASES = 40;

/** One failed case as Bun printed it. See the module note. */
export interface FailedCase {
  /** The file whose header the case was printed under, relative to the run's directory. */
  readonly file: string;
  /** The text after `(fail) `, its trailing time off. */
  readonly name: string;
  /** The text after `(fail) `, whole. */
  readonly label: string;
  /** The first lines of its error, trimmed; none when Bun printed nothing for it. */
  readonly errorLines: readonly string[];
}

/** A marker line ending a case: its kind and the text after it. */
const MARKER_LINE = /^\((pass|fail|skip|todo)\) (.*)$/;

/** The time Bun appends to a marker line, as ` [0.19ms]`. */
const TRAILING_TIME = /\s+\[\d+(?:\.\d+)?m?s\]$/;

/** The line under a timed-out case's `(fail)` line, as `  ^ this test timed out after 50ms.`. */
const TIMEOUT_NOTE = /^\s+\^ (\S.*)$/;

/** A code frame line, as `1 | throw x;` or ` 9 | ...`. */
const FRAME_LINE = /^\s*\d+ \|/;

/** The caret line under a code frame. */
const CARET_LINE = /^\s*\^\s*$/;

/** A stack frame, as `      at guard (/abs/a.test.ts:8:119)`. */
const STACK_LINE = /^\s+at /;

/** What marks a line cut at {@link MAX_ERROR_LINE_LENGTH}. */
const CUT_MARK = '...';

/** `line` trimmed, cut at {@link MAX_ERROR_LINE_LENGTH}. */
function keptLine(line: string): string {
  const trimmed = line.trim();
  return trimmed.length > MAX_ERROR_LINE_LENGTH
    ? `${trimmed.slice(0, MAX_ERROR_LINE_LENGTH)}${CUT_MARK}`
    : trimmed;
}

/** The error lines among `segment`, the lines printed above a `(fail)` line; see the module note. */
function errorLinesOf(segment: readonly string[]): readonly string[] {
  const caret = segment.findIndex((line) => CARET_LINE.test(line));
  const fromError = segment.slice(caret + 1);
  const stack = fromError.findIndex((line) => STACK_LINE.test(line));
  const error = stack < 0
    ? fromError
    : fromError.slice(0, stack);
  return error
    .filter((line) => line.trim() !== '' && !FRAME_LINE.test(line) && !CARET_LINE.test(line))
    .slice(0, MAX_ERROR_LINES)
    .map(keptLine);
}

/** Where the walk over stderr is: the file whose header was last read, and where the open case's lines start. */
interface CaseWalk {
  readonly file: string | null;
  readonly start: number;
  readonly cases: readonly FailedCase[];
}

/** The failed case whose `(fail)` line is `lines[index]`, holding `label`, under `file`. */
function failedCase(lines: readonly string[], walk: CaseWalk, index: number, label: string, file: string): FailedCase {
  const timeout = TIMEOUT_NOTE.exec(lines[index + 1] ?? '');
  const errorLines = timeout === null
    ? errorLinesOf(lines.slice(walk.start, index))
    : [keptLine(timeout[1] ?? '')];
  return { file, name: label.replace(TRAILING_TIME, ''), label, errorLines };
}

/** Takes `lines[index]` into the walk: a header opens a file, a marker line ends a case. */
function takeLine(lines: readonly string[], headers: ReadonlyMap<string, string>, walk: CaseWalk, index: number): CaseWalk {
  const line = lines[index] ?? '';
  const header = headers.get(line);
  if (header !== undefined) return { ...walk, file: header, start: index + 1 };
  const marker = MARKER_LINE.exec(line);
  if (marker === null) return walk;
  const timedOut = marker[1] === 'fail' && TIMEOUT_NOTE.test(lines[index + 1] ?? '');
  const start = timedOut
    ? index + 2
    : index + 1;
  if (marker[1] !== 'fail' || walk.file === null) return { ...walk, start };
  return { ...walk, start, cases: [...walk.cases, failedCase(lines, walk, index, marker[2] ?? '', walk.file)] };
}

/**
 * Each failed case Bun's `stderr` holds under the header of one of
 * `files`, in the order printed, with the first lines of its error. See
 * the module note.
 */
export function parseFailedCases(stderr: string, files: readonly string[]): readonly FailedCase[] {
  const lines = stderr.split(/\r?\n/).map((line) => line.trimEnd());
  const headers = new Map(files.map((file) => [`${file}:`, file]));
  let walk: CaseWalk = { file: null, start: 0, cases: [] };
  for (let index = 0; index < lines.length; index += 1) walk = takeLine(lines, headers, walk, index);
  return walk.cases;
}

/** True when `failed` is the case the JUnit file names as `failure`: one file, and its name with or without a trailing time. */
function isCaseOf(failed: FailedCase, failure: SuiteFailure): boolean {
  return failed.file === failure.file && (failed.name === failure.name || failed.label === failure.name);
}

/**
 * `failures`, each with the error lines of the first of `cases` that is
 * its own and holds any; a failure with no such case is answered as it
 * was, with no `errorLines` key.
 */
export function withErrorLines(failures: readonly SuiteFailure[], cases: readonly FailedCase[]): readonly SuiteFailure[] {
  return failures.map((failure) => {
    const found = cases.find((failed) => failed.errorLines.length > 0 && isCaseOf(failed, failure));
    return found === undefined
      ? failure
      : { ...failure, errorLines: found.errorLines };
  });
}

/**
 * True when `file` can name one test file: not blank, not spelled as a
 * directory with a trailing `/`, and not ending in a `.` or `..` segment.
 */
function namesOneFile(file: string): boolean {
  const name = file.trim();
  if (name === '' || name.endsWith('/')) return false;
  const last = name.split('/').at(-1);
  return last !== '.' && last !== '..';
}

/**
 * The files `failures` name, each once, in first-seen order. A name
 * that cannot be one file is left out ({@link namesOneFile}): a JUnit
 * case with no `file` attribute under a suite with none reads as `''`
 * (`./run.ts`), no header of Bun's stderr is such a name, and handed on
 * as a path it becomes `./`, which `bun test` runs as the whole project.
 */
export function failingFilesOf(failures: readonly Pick<SuiteFailure, 'file'>[]): readonly string[] {
  return [...new Set(failures.map((failure) => failure.file))].filter(namesOneFile);
}

/** One case as kept: its `(fail)` line without the time, and its error lines indented under it. */
function caseLines(failed: FailedCase): readonly string[] {
  return [`(fail) ${failed.name}`, ...failed.errorLines.map((line) => `  ${line}`)];
}

/**
 * The failed cases as the kept text holds them: each file's header once
 * above its cases, a blank line between two files, the first
 * {@link MAX_FAILED_CASES} cases and one line counting the rest. No line
 * for no case.
 */
export function failedCasesLines(cases: readonly FailedCase[]): readonly string[] {
  const kept = cases.slice(0, MAX_FAILED_CASES);
  const lines = kept.flatMap((failed, index) => {
    const previous = kept[index - 1];
    if (previous?.file === failed.file) return caseLines(failed);
    const gap = previous === undefined
      ? []
      : [''];
    return [...gap, `${failed.file}:`, ...caseLines(failed)];
  });
  const left = cases.length - kept.length;
  return left > 0
    ? [...lines, `... ${left} more failed cases`]
    : lines;
}

/**
 * The text a run keeps of Bun's `stderr` beside its JUnit file: the
 * unhandled-error blocks, `cases`, and the summary lines, a blank line
 * between the three, ending in a newline; empty when stderr holds none
 * of them. See the module note.
 */
export function suiteOutputText(stderr: string, cases: readonly FailedCase[]): string {
  const { blocks, summary } = cappedSections(stderr);
  return joinSections([blocks, failedCasesLines(cases), summary]);
}
