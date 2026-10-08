/**
 * The failed-case reader: which bun test cases a red CI run failed, by
 * test file, read from one `gh run view <id> --log-failed` capture.
 *
 * Pure over that capture. Every line goes through `parseFailedLogLine`
 * (`../pr/triage/evidence.ts`), which drops the job and step columns,
 * the BOM, the timestamp and the colour, so this module reads only the
 * message text and sends no command.
 *
 * ## The shape, as measured
 *
 * Read off `gh` 2.102.0 on 2026-10-07 against three failed `verify` runs
 * of `open-tomato/rafa` (37565187144, 37290183916 and 37190089292;
 * 22457, 21685 and 21057 lines), with bun's output in the `Run bun test`
 * step:
 *
 *   - **Bun's `(fail)` line does NOT name the file.** It reads
 *     `(fail) <describe> > <case> [45062.89ms]`, the same line bun prints
 *     to a terminal. The file comes from the line bun opens each file's
 *     output with under GitHub Actions, `##[group]<path>:`, closed by
 *     `##[endgroup]`. Of the 2709 group heads in the three captures that
 *     did not open with `Run `, 2687 were test file paths and the other
 *     22 runner set-up groups (`##[group]Fetching the repository`).
 *     {@link readFailedCases} takes a group head as a file only when it
 *     names a test file ({@link TEST_FILE_HEADER}).
 *   - **Every failed case is printed twice**: once under its file's
 *     group, and again after the run's `N tests failed:` line (written
 *     `1 tests failed:` for one), outside any group. The repeat is what
 *     the duplicate removal is for: a summary case already read under a
 *     file is dropped, and one never read under a file is kept under the
 *     file `null` rather than lost.
 *   - A `(pass)` case whose NAME holds `(fail)` was in the captures
 *     (`testFailureOf > reads bun's (fail) line: ...`), so the marker is
 *     only read at the start of the message.
 *   - Every `(fail)` line in the three captures ended with its timing in
 *     milliseconds. The timing is taken off the case name, and a line
 *     without one is still read.
 */
import { parseFailedLogLine } from '../pr/triage/evidence.js';

/** The failed cases of one test file. */
export interface FailedCaseFile {
  /**
   * The test file's path as bun printed it, relative to the checkout,
   * or null for cases no file group named (see the module note).
   */
  readonly file: string | null;
  /** Each case's describe names and its own, joined by ` > `, in the order first read. */
  readonly cases: readonly string[];
}

/**
 * Bun's file head under GitHub Actions: a test file's path, then `:`,
 * as a group's title. The path is any run of non-space characters ending
 * in `.test` or `.spec` and a JavaScript or TypeScript extension.
 */
export const TEST_FILE_HEADER = /^##\[group\](\S+\.(?:test|spec)\.[cm]?[jt]sx?):$/;

/** What closes a group. */
const GROUP_END = '##[endgroup]';

/** What opens any group, a file's or a step's. */
const GROUP_START = '##[group]';

/** Bun's `(fail)` line: the case, then the timing bun appends. */
const FAIL_LINE = /^\(fail\) (.+?)(?: \[\d+(?:\.\d+)?m?s\])?$/;

/**
 * The line bun opens its closing list of failed cases with. The list
 * comes after every file's output, so it also ends any file group a
 * capture left open.
 */
const SUMMARY_HEAD = /^\d+ tests? failed:$/;

/** One `(fail)` line read, and the file group it was read under. */
interface FailRead {
  readonly file: string | null;
  readonly name: string;
  /** Whether it came after bun's `N tests failed:` line. */
  readonly summary: boolean;
}

/** Every `(fail)` line in the capture, in order, with the file group in effect. */
function failLines(log: string): readonly FailRead[] {
  const reads: FailRead[] = [];
  let file: string | null = null;
  let summary = false;
  for (const raw of log.split('\n')) {
    const text = parseFailedLogLine(raw).text.trimEnd();
    if (text.startsWith(GROUP_START)) {
      file = TEST_FILE_HEADER.exec(text)?.[1] ?? null;
    } else if (text === GROUP_END) {
      file = null;
    } else if (SUMMARY_HEAD.test(text)) {
      file = null;
      summary = true;
    } else {
      const name = FAIL_LINE.exec(text)?.[1];
      if (name !== undefined) reads.push({ file, name, summary });
    }
  }
  return reads;
}

/**
 * The failed cases in one `gh run view <id> --log-failed` capture,
 * grouped by test file in the order each file was first read, each case
 * once. The empty capture, and one with no `(fail)` line, read as `[]`.
 */
export function readFailedCases(log: string): readonly FailedCaseFile[] {
  const reads = failLines(log);
  const named = new Set(reads.filter((read) => read.file !== null).map((read) => read.name));
  const kept = reads.filter((read) => !(read.summary && read.file === null && named.has(read.name)));
  const byFile = new Map<string | null, string[]>();
  for (const read of kept) {
    const cases = byFile.get(read.file) ?? [];
    if (!cases.includes(read.name)) byFile.set(read.file, [...cases, read.name]);
  }
  return [...byFile].map(([file, cases]) => ({ file, cases }));
}
