/**
 * The test a reported bug names: its test file, its case name and its
 * first evidence line, read from the bug's `what` and `artifact`
 * ({@link testFailureOf}). #486's test-failure key is built from these,
 * so one red test reported by two plans, or worded two ways, keys once.
 *
 * ## The case name
 *
 * A bug names a test case when a line of its artifact, or failing that of
 * its `what`, is one of two wordings; the first such line is read and
 * every later one is left:
 *
 *   - bun's own `(fail)` line, `(fail) outer > inner > case [0.19ms]`: the
 *     case name is what follows the marker, without the trailing timing;
 *   - a `file > case` line, a test file's path then ` > ` then the case:
 *     the file is that path and the case name the rest of the line.
 *
 * A bug with neither names no test case and reads as null, even when it
 * names a test file (`src/a.test.ts:246`): there is no case to key on. A
 * bare `describe > case` with no marker and no file is not read, since a
 * sentence holding ` > ` would read as one.
 *
 * ## The test file
 *
 * A test file is a path whose name ends in `.test` or `.spec` and a
 * JavaScript or TypeScript extension. It is the one on a `file > case`
 * line; else the last file header (`src/a.test.ts:` alone on its line)
 * above the case line, since bun prints each file's name that way above
 * its failures, and its stack frames name the file by its absolute path;
 * else the last one in the artifact before the case line; else the first
 * one in the artifact after it; else the first one in the `what`;
 * else null. The path is answered as written, with or without a folder:
 * comparing two files, or keying on one, takes its base name.
 *
 * ## The first evidence line
 *
 * Measured on bun 1.4.2: bun prints a failure's source excerpt, `error:`
 * line, expected and received values and stack frames ABOVE its `(fail)`
 * line, so in a capture of several failures the lines after one case line
 * belong to the next case. The evidence line is therefore the first
 * evidence line between the previous case line (or the artifact's start)
 * and the case line; when there is none, as when a session quoted its
 * error after the case, it is the first one between the case line and the
 * next case line; else null. A line is evidence unless it is blank, a case
 * line, a file header (`src/a.test.ts:`), a source excerpt (`2 | ...`), a
 * caret line, a stack frame (`at ...`) or bun's banner (`bun test v...`).
 * The line is trimmed and a leading `error: ` is taken off, so it reads as
 * the first line of the JUnit failure message bun writes for the same
 * failure (`expect(received).toBe(expected)`, `boom 42`), which is what
 * `packages/rafa/src/suite/run.ts` records as a run-start failure's
 * message.
 *
 * ## Every case a capture holds
 *
 * {@link failedCaseNamesIn} reads a whole capture, such as the red run's
 * output text `packages/rafa/src/suite/run.ts` keeps, and answers the case
 * name of every `(fail)` line in it, in order and without the trailing
 * timing; a `file > case` line is not bun's own and is not read there.
 */
import type { ReportBug } from '../report/parse.js';

/** The test a bug names; see the module note. */
export interface TestFailure {
  /** The test file's path as written, or null when the bug names none. */
  readonly file: string | null;
  /** Its describe names, outermost first, and its own, joined by ` > `. */
  readonly name: string;
  /** The first evidence line, trimmed, without a leading `error: `; or null. */
  readonly evidence: string | null;
}

/** A test file's path: folders, then a name ending `.test` or `.spec` and a JS or TS extension. */
const TEST_FILE = '(?:/?(?:[\\w.@+-]+/)*)[\\w.@+-]+\\.(?:test|spec)\\.[cm]?[jt]sx?';

/** Every test file path in a text. */
const TEST_FILE_ANYWHERE = new RegExp(`(?<![\\w.@+/-])${TEST_FILE}(?![\\w])`, 'g');

/** Bun's `(fail)` marker opening a line, after any whitespace. */
const FAIL_MARK = /^\s*\(fail\)/;

/** The timing bun appends to a `(fail)` line, alone: `[0.19ms]`, `[1.50s]`. */
const FAIL_TIMING = /^\[\d+(?:\.\d+)?m?s\]$/;

/** A line break, which a case name never holds: what a regex's `.` does not match. */
const LINE_BREAK = /[\n\r\u2028\u2029]/;

/**
 * A `file > case` line's head: a test file's path, whitespace, then `>`.
 * The case name after it is read by {@link fileCaseLineOf}.
 */
const FILE_CASE_HEAD = new RegExp(`^\\s*(${TEST_FILE})\\s+>`);

/** Bun's file header: a test file's path alone on its line, then `:`. */
const FILE_HEADER = new RegExp(`^\\s*(${TEST_FILE}):\\s*$`);

/** Lines that are never a failure's evidence; see the module note. */
const NOISE_LINES: readonly RegExp[] = [
  /^\s*$/,
  FILE_HEADER,
  /^\s*\d+\s+\|/,
  /^\s*\^+\s*$/,
  /^\s*at\s/,
  /^\s*bun test v/,
];

/** What a leading `error: ` reads as. */
const ERROR_PREFIX = /^error:\s+/;

/** Where the rest of a `(fail)` line, after the marker, ends its content, and its trailing timing. */
interface FailTail {
  /** Where the content ends: only whitespace follows. */
  readonly content: number;
  /** Where the whitespace before a trailing timing starts and where the timing opens, or null when none ends the content. */
  readonly timing: { readonly gap: number; readonly open: number } | null;
}

/** The {@link FailTail} of `rest`. The timing holds no `[`, so it opens at the content's last one. */
function failTailOf(rest: string): FailTail {
  const core = rest.trimEnd();
  const open = core.lastIndexOf('[');
  const gap = core.slice(0, open).trimEnd().length;
  const timed = open !== -1 && gap < open && FAIL_TIMING.test(core.slice(open));
  return {
    content: core.length,
    timing: timed
      ? { gap, open }
      : null,
  };
}

/**
 * Where the shortest case name opening at `start` of `rest` ends, or null
 * when none does: at the gap before a trailing timing when that leaves the
 * name a character and the gap one, else at the content's end, and never
 * past the line break at `lineBreak`, the first at or after `start`.
 */
function nameEndFrom(start: number, tail: FailTail, lineBreak: number, rest: string): number | null {
  if (tail.timing !== null) {
    const end = Math.max(tail.timing.gap, start + 1);
    if (end < tail.timing.open && end <= lineBreak) return end;
  }
  const end = Math.max(tail.content, start + 1);
  return end <= rest.length && end <= lineBreak
    ? end
    : null;
}

/**
 * The case name on Bun's `(fail)` line `line`, or null when it is none:
 * the shortest name of a character or more, holding no line break, that
 * leaves a trailing timing with whitespace before it, or else whitespace
 * only, read from the end of the whitespace after the marker, then from
 * one character earlier each time no name fits. That is what
 * `/^\s*\(fail\)\s+(.+?)(?:\s+\[\d+(?:\.\d+)?m?s\])?\s*$/` read, here in
 * linear time, where the regex's three whitespace runs could share one
 * long run and took cubic time on it (CodeQL js/polynomial-redos).
 */
function failedCaseNameOf(line: string): string | null {
  const mark = FAIL_MARK.exec(line);
  if (mark === null) return null;
  const rest = line.slice(mark[0].length);
  return shortestNameIn(rest, failTailOf(rest));
}

/**
 * The shortest case name in `rest`, the text after a case line's marker,
 * whose end `tail` gives, or null: read from the end of the whitespace
 * `rest` opens with, then from one character earlier each time no name
 * fits, so a character or more of whitespace always stays before it.
 */
function shortestNameIn(rest: string, tail: FailTail): string | null {
  const lead = rest.length - rest.trimStart().length;
  const breakAfterLead = rest.slice(lead).search(LINE_BREAK);
  let lineBreak = breakAfterLead === -1
    ? rest.length
    : lead + breakAfterLead;
  for (let start = lead; start >= 1; start -= 1) {
    if (LINE_BREAK.test(rest.charAt(start))) lineBreak = start;
    const end = nameEndFrom(start, tail, lineBreak, rest);
    if (end !== null) return rest.slice(start, end);
  }
  return null;
}

/** A case line read: where it is, its name, and the file it names when it is a `file > case` line. */
interface CaseLine {
  readonly index: number;
  readonly name: string;
  readonly file: string | null;
}

/**
 * The file and case name on the `file > case` line `line`, or null when it
 * is none: the name is the shortest one, of a character or more and
 * holding no line break, that leaves whitespace only after it, read as
 * {@link shortestNameIn} reads a `(fail)` line's with no timing. That is
 * what `/^\s*(TEST_FILE)\s+>\s+(.+?)\s*$/` read, here in linear time,
 * where the name and the whitespace runs around it could share one long
 * run and took quadratic time on it.
 */
function fileCaseLineOf(line: string): { readonly file: string; readonly name: string } | null {
  const head = FILE_CASE_HEAD.exec(line);
  if (head === null) return null;
  const rest = line.slice(head[0].length);
  const name = shortestNameIn(rest, { content: rest.trimEnd().length, timing: null });
  return name === null
    ? null
    : { file: head[1]!, name };
}

/** The case line `line` is, at `index`, or null. */
function caseLineOf(line: string, index: number): CaseLine | null {
  const failName = failedCaseNameOf(line);
  if (failName !== null) return { index, name: failName, file: null };
  const fileCase = fileCaseLineOf(line);
  return fileCase === null
    ? null
    : { index, ...fileCase };
}

/** The lines of `text`. */
function linesOf(text: string): readonly string[] {
  return text.split(/\r?\n/);
}

/** Every case line among `lines`, in order. */
function caseLinesOf(lines: readonly string[]): readonly CaseLine[] {
  return lines
    .map((line, index) => caseLineOf(line, index))
    .filter((found): found is CaseLine => found !== null);
}

/** Every test file path in `text`, in order; `./similarity.ts` reads a bug's test file with it too. */
export function testFilesIn(text: string): readonly string[] {
  return text.match(TEST_FILE_ANYWHERE) ?? [];
}

/** The first evidence line among `lines`, trimmed and without `error: `, or null. */
function firstEvidence(lines: readonly string[]): string | null {
  const found = lines.find((line) => caseLineOf(line, 0) === null
    && !NOISE_LINES.some((noise) => noise.test(line)));
  return found === undefined
    ? null
    : found.trim().replace(ERROR_PREFIX, '');
}

/** The test file the case at `found` names in `artifactLines`, else the first one in `what`. */
function testFileOf(found: CaseLine, artifactLines: readonly string[], what: string): string | null {
  if (found.file !== null) return found.file;
  const above = artifactLines.slice(0, found.index);
  const header = above.map((line) => FILE_HEADER.exec(line)?.[1])
    .filter((file): file is string => file !== undefined)
    .at(-1);
  const before = testFilesIn(above.join('\n'));
  const after = testFilesIn(artifactLines.slice(found.index).join('\n'));
  return header ?? before.at(-1) ?? after[0] ?? testFilesIn(what)[0] ?? null;
}

/** The evidence line for the case at `found`, read from `artifactLines`; see the module note. */
function evidenceOf(found: CaseLine | null, artifactLines: readonly string[]): string | null {
  if (found === null) return firstEvidence(artifactLines);
  const cases = caseLinesOf(artifactLines);
  const previous = cases.filter((other) => other.index < found.index).at(-1);
  const next = cases.find((other) => other.index > found.index);
  const before = artifactLines.slice(previous === undefined
    ? 0
    : previous.index + 1, found.index);
  const after = artifactLines.slice(found.index + 1, next === undefined
    ? artifactLines.length
    : next.index);
  return firstEvidence(before) ?? firstEvidence(after);
}

/**
 * The test file, case name and first evidence line a bug names, or null
 * when it names no test case; see the module note.
 */
export function testFailureOf(bug: Pick<ReportBug, 'what' | 'artifact'>): TestFailure | null {
  const artifactLines = linesOf(bug.artifact ?? '');
  const what = bug.what ?? '';
  const inArtifact = caseLinesOf(artifactLines)[0];
  if (inArtifact !== undefined) {
    return {
      file: testFileOf(inArtifact, artifactLines, what),
      name: inArtifact.name,
      evidence: evidenceOf(inArtifact, artifactLines),
    };
  }
  const inWhat = caseLinesOf(linesOf(what))[0];
  if (inWhat === undefined) return null;
  return {
    file: inWhat.file ?? testFilesIn(bug.artifact ?? '')[0] ?? testFilesIn(what)[0] ?? null,
    name: inWhat.name,
    evidence: evidenceOf(null, artifactLines),
  };
}

/**
 * The case name of every bun `(fail)` line in `capture`, in order, with
 * the trailing timing taken off; see the module note.
 */
export function failedCaseNamesIn(capture: string): readonly string[] {
  return linesOf(capture)
    .map((line) => failedCaseNameOf(line))
    .filter((name): name is string => name !== null);
}
