/**
 * Errors outside any test, read from what `bun test` writes to stderr:
 * one {@link UnhandledError} per `# Unhandled error between tests` block,
 * and a capped text holding those blocks and the summary lines only.
 *
 * Bun's JUnit file holds nothing for such an error (`src/suite/run.ts`,
 * "What the JUnit file does NOT hold"), so its stderr is the only place
 * that names the file that threw and what it threw.
 *
 * ## What a block looks like
 *
 * Measured on bun 1.4.2, with stderr piped (no colour) and `CLAUDECODE`
 * unset. A test file that throws while it loads, imports a missing
 * module, or leaves a rejected promise behind at load is printed as its
 * file header, the path relative to the run's directory and a colon,
 * then a blank line, the heading, a dash line, the body, and a closing
 * dash line:
 *
 * ```text
 * sub/f.test.ts:
 *
 * # Unhandled error between tests
 * -------------------------------
 *  9 | const x: any = undefined;
 * 10 | x.foo();
 *        ^
 * TypeError: undefined is not an object (evaluating '(void 0).foo')
 *       at /abs/sub/f.test.ts:10:3
 * -------------------------------
 * ```
 *
 * The body opens with a code frame when Bun has the source (numbered
 * lines `N | ...`, right-aligned, and a caret line), then the error:
 * `error: <message>` for an `Error` or a thrown string, `<Name>: <message>`
 * for a subclass such as `TypeError` or `RangeError`. A missing module
 * prints `error: Cannot find module ...` with no frame. A message holding
 * newlines continues on the lines after, so only the first is read.
 *
 * An error thrown later from a timer inside a test was printed as that
 * test's failure, with no block, and is not read here.
 *
 * ## How a block is read
 *
 *   - {@link UnhandledError.file} is the nearest non-blank line above the
 *     heading when it ends in `:` and opens with no space; null otherwise.
 *   - The body runs from the dash line under the heading to the next
 *     dash-only line, or, when stderr was cut short, to the next heading
 *     or the end.
 *   - {@link UnhandledError.firstLine} is the first body line, trimmed,
 *     that is neither blank, a code frame line nor a caret line; null when
 *     the body holds none.
 *
 * ## The capped text
 *
 * {@link unhandledText} keeps each block, its file header first, a blank
 * line between blocks, and then the summary lines: the count lines
 * (` 1 pass`, ` 2 errors`, ...) directly above Bun's last
 * `Ran N tests across M files.` line, and that line. Test output, passing
 * or failing, is dropped. Two caps keep a run with many throwing files
 * readable: at most {@link MAX_BLOCKS} blocks, then one line saying how
 * many more there were, and at most {@link MAX_BLOCK_LINES} body lines per
 * block, then one line saying how many more. The list
 * {@link parseUnhandled} answers is never capped.
 */

/** The heading Bun prints above each error outside any test. */
export const UNHANDLED_HEADING = '# Unhandled error between tests';

/** The most blocks {@link unhandledText} keeps. */
export const MAX_BLOCKS = 20;

/** The most body lines {@link unhandledText} keeps of one block. */
export const MAX_BLOCK_LINES = 40;

/** One error outside any test. */
export interface UnhandledError {
  /** The file Bun named above the block, relative to the run's directory; null when none was. */
  readonly file: string | null;
  /** The error's first line, as `error: boom` or `TypeError: ...`; null when the block holds none. */
  readonly firstLine: string | null;
}

/** One block as found in stderr: its file header line, if any, and its body lines. */
interface RawBlock {
  readonly header: string | null;
  readonly body: readonly string[];
}

/** The dash line {@link unhandledText} draws above and below a kept body, as Bun does. */
const DASHES = '-------------------------------';

/** A line holding only dashes, as Bun draws above and below a body. */
const DASH_LINE = /^-{3,}$/;

/** A code frame line, as `1 | throw x;` or ` 9 | ...`. */
const FRAME_LINE = /^\s*\d+ \|/;

/** The caret line under a code frame. */
const CARET_LINE = /^\s*\^\s*$/;

/** A file header Bun prints above a file's output, as `sub/b.test.ts:`. */
const FILE_HEADER = /^\S.*:$/;

/** The summary line Bun ends a run with. */
const SUMMARY_LINE = /^Ran \d+ tests? across \d+ files?\./;

/** One count line of the block above the summary, as ` 3 fail`. */
const COUNT_LINE = /^\s*\d+ \S/;

/** `stderr` as lines, line endings and trailing spaces removed. */
function linesOf(stderr: string): readonly string[] {
  return stderr.split(/\r?\n/).map((line) => line.trimEnd());
}

/** The file header line above the heading at `index`, or null. */
function headerAbove(lines: readonly string[], index: number): string | null {
  for (let at = index - 1; at >= 0; at -= 1) {
    const line = lines[at] ?? '';
    if (line === '') continue;
    return FILE_HEADER.test(line)
      ? line
      : null;
  }
  return null;
}

/** The index one past the body that starts at `start`. */
function bodyEnd(lines: readonly string[], start: number): number {
  for (let at = start; at < lines.length; at += 1) {
    const line = lines[at] ?? '';
    if (DASH_LINE.test(line) || line === UNHANDLED_HEADING) return at;
  }
  return lines.length;
}

/** Every block in `lines`, in the order Bun printed them. */
function rawBlocks(lines: readonly string[]): readonly RawBlock[] {
  return lines.flatMap((line, index) => {
    if (line !== UNHANDLED_HEADING) return [];
    const start = DASH_LINE.test(lines[index + 1] ?? '')
      ? index + 2
      : index + 1;
    return [{ header: headerAbove(lines, index), body: lines.slice(start, bodyEnd(lines, start)) }];
  });
}

/** The first body line that is the error rather than frame, caret or blank. */
function errorLine(body: readonly string[]): string | null {
  const found = body.find((line) => line.trim() !== '' && !FRAME_LINE.test(line) && !CARET_LINE.test(line));
  return found?.trim() ?? null;
}

/**
 * Each `# Unhandled error between tests` block in Bun's `stderr`, in the
 * order printed, with the file it names and the error's first line. See
 * the module note.
 */
export function parseUnhandled(stderr: string): readonly UnhandledError[] {
  return rawBlocks(linesOf(stderr)).map((raw) => ({
    file: raw.header === null
      ? null
      : raw.header.slice(0, -1),
    firstLine: errorLine(raw.body),
  }));
}

/** Bun's last summary line and the count lines directly above it; none when it printed no summary. */
function summaryLines(lines: readonly string[]): readonly string[] {
  let index = lines.length - 1;
  while (index >= 0 && !SUMMARY_LINE.test(lines[index] ?? '')) index -= 1;
  if (index < 0) return [];
  let start = index;
  while (start > 0 && COUNT_LINE.test(lines[start - 1] ?? '')) start -= 1;
  return lines.slice(start, index + 1);
}

/** One block as kept in the capped text, its body cut at {@link MAX_BLOCK_LINES}. */
function blockText(raw: RawBlock): readonly string[] {
  const kept = raw.body.slice(0, MAX_BLOCK_LINES);
  const left = raw.body.length - kept.length;
  const more = left > 0
    ? [`... ${left} more lines`]
    : [];
  const header = raw.header === null
    ? []
    : [raw.header];
  return [...header, UNHANDLED_HEADING, DASHES, ...kept, ...more, DASHES];
}

/** The kept blocks, a blank line apart, with the line counting those left out. */
function blocksText(blocks: readonly RawBlock[]): readonly string[] {
  const kept = blocks.slice(0, MAX_BLOCKS).map((raw, index) => index === 0
    ? blockText(raw)
    : ['', ...blockText(raw)]);
  const left = blocks.length - MAX_BLOCKS;
  const more = left > 0
    ? ['', `... ${left} more unhandled error blocks`]
    : [];
  return [...kept.flat(), ...more];
}

/** The two parts of the capped text: the kept blocks' lines and the summary lines, either one empty. */
export interface CappedSections {
  readonly blocks: readonly string[];
  readonly summary: readonly string[];
}

/**
 * The capped blocks and the summary lines of Bun's `stderr`, apart, so
 * that a caller can put lines of its own between them
 * (`./failure-lines.ts`) and join them with {@link joinSections}.
 */
export function cappedSections(stderr: string): CappedSections {
  const lines = linesOf(stderr);
  return { blocks: blocksText(rawBlocks(lines)), summary: summaryLines(lines) };
}

/**
 * `sections` as one text: each one that holds a line, a blank line
 * between two, ending in a newline; empty when none holds a line.
 */
export function joinSections(sections: readonly (readonly string[])[]): string {
  const held = sections.filter((section) => section.length > 0);
  return held.length === 0
    ? ''
    : `${held.map((section) => section.join('\n')).join('\n\n')}\n`;
}

/**
 * The text of Bun's `stderr` that keeps only its unhandled-error blocks
 * and its summary lines, capped as the module note says, ending in a
 * newline; empty when stderr holds neither.
 */
export function unhandledText(stderr: string): string {
  const { blocks, summary } = cappedSections(stderr);
  return joinSections([blocks, summary]);
}
