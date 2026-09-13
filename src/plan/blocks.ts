/**
 * Reading fenced `rafa:*` blocks out of a markdown document.
 *
 * A plan stays markdown a person can read, and the parts the loop acts
 * on are fenced code blocks whose info string opens with `rafa:`:
 *
 * ````markdown
 * ```rafa:plan
 * stub: my-feature
 * ```
 * ````
 *
 * The rest of that first word is the block's KIND, `plan` above. This
 * module answers every such block in source order with its kind, its
 * body and the lines it spans, and nothing more: which kinds to act on,
 * and what a body means, belong to whoever reads the document.
 * {@link RAFA_BLOCK_KINDS} names the four kinds this phase defines.
 *
 * ## Fences are read the way a renderer shows them
 *
 * The checklist grammar is line-anchored and fence-blind: `findNextTask`
 * dispatches a `- [ ] ` at column 0 inside a code fence, skipping one
 * only inside a closed block this module answers. This reader is
 * deliberately the opposite. A document
 * that ILLUSTRATES the format puts its example inside a longer fence of
 * its own, as the one above does, and a reader taking every line that
 * opens with a `rafa:` fence for a block would hand the illustration to
 * every task. So every fence is tracked, whatever its info string, and
 * a `rafa:` line inside one is body text.
 *
 * The fence rules are CommonMark's, from its fenced code block section:
 *
 *   - An opening fence is three or more backticks or tildes after at
 *     most three spaces. Four spaces, or a tab anywhere before it, and
 *     the line opens no fence; nor does a fence that does not open its
 *     line, which is prose quoting the syntax.
 *   - A backtick fence's info string holds no backtick, so a line such
 *     as ` ```rafa:plan``` ` is an inline code span and opens nothing.
 *   - A closing fence is the SAME character, at least as many of it,
 *     after at most three spaces, with nothing after it but spaces and
 *     tabs. It carries no info string, so ` ```ts ` inside a block is
 *     body; a block that holds a fence of its own opens with a longer
 *     one, as the illustration above does.
 *   - A fence never closed runs to the end of the document. The block
 *     is still answered, with {@link RafaBlock.closed} false: a session
 *     cut off mid-report leaves exactly that, and only the caller can
 *     judge whether a truncated body is usable.
 *   - Each body line loses up to as many leading spaces as the opening
 *     fence carried.
 *
 * What is NOT parsed is container structure. Measured against micromark
 * (the CommonMark parser `@eslint/markdown` lints this repo's prose
 * with), that costs three shapes: a fence inside a block quote, and one
 * inside a list item indented four columns or more, are fences to a
 * renderer and not here; a fence inside a multi-line HTML comment is
 * raw HTML to a renderer and a block here. Outside those shapes the two
 * agree: with every info string in 499 markdown files (this repo's, its
 * sibling's and a skill library, on 2026-09-11) rewritten to open with
 * `rafa:`, they answered the same kind, body and span for all 2,177
 * fences. A plan puts its blocks at the top level.
 *
 * ## Lines
 *
 * A line is what `split('\n')` yields, the split `utils/tracker.ts`
 * reads a tracker with, less one trailing carriage return, so a CRLF
 * document reads exactly like its LF twin. A final newline ends the
 * last line rather than opening an empty one. A LONE carriage return
 * breaks no line here, where CommonMark breaks one on it; that is the
 * fourth shape the measurement above found.
 *
 * {@link LineSpan} numbers lines from ONE, fences included, the way an
 * editor and `grep -n` number them, so `sed -n '<first>,<last>p'`
 * prints a block whole. `TaskInfo.lineNum` counts from ZERO: the line
 * at index `i` of that split is line `i + 1` here.
 *
 * ## Unknown kinds
 *
 * A `rafa:` fence whose kind is none of {@link RAFA_BLOCK_KINDS} is
 * answered like any other, never refused and never dropped. That is the
 * rule `utils/declaration.ts` applies to an unrecognised key, for the
 * same reason: a plan written for a later phase names kinds this one has
 * never heard of, and refusing them would make every new kind a
 * breaking change for older installs.
 *
 * The kind is the first word of the info string less its `rafa:`
 * prefix, taken as written: `rafa:` alone answers the empty kind, and
 * `rafa:Plan` answers `Plan`, which is unknown. The prefix is matched
 * case-sensitively, as the declaration keys are, so `RAFA:plan` is an
 * ordinary code block and no rafa block at all.
 *
 * Nothing here throws. A document with no block — empty, prose only, or
 * fenced only in other languages — answers an empty list.
 */

/**
 * The kinds this phase defines. `plan`, `context` and `stage-context`
 * are a plan's; `report` ends a task session's final message.
 *
 * Each document's reader acts on its own kinds and ignores the rest.
 * {@link readRafaBlocks} answers every kind; see the module note.
 */
export const RAFA_BLOCK_KINDS = [
  'plan',
  'context',
  'stage-context',
  'report',
] as const;

/** One of the four kinds this phase defines. */
export type RafaBlockKind = (typeof RAFA_BLOCK_KINDS)[number];

/** The lines one block covers: from one, inclusive, fences included. */
export interface LineSpan {
  /** The opening fence's line. */
  readonly first: number;
  /**
   * The closing fence's line, or the document's last line when the
   * block was never closed.
   */
  readonly last: number;
}

/** One fenced `rafa:*` block, as the document wrote it. */
export interface RafaBlock {
  /** The info string's first word less `rafa:`, as written. */
  readonly kind: string;
  /**
   * Every line between the fences, each less the opening fence's
   * indentation, joined with `\n` and carrying no final newline. Empty
   * for a block with no line between its fences.
   */
  readonly body: string;
  /** Where the block sits in the document. */
  readonly span: LineSpan;
  /** False when the document ended before a closing fence. */
  readonly closed: boolean;
}

/** The word a fence's info string opens with to make a rafa block. */
const RAFA_PREFIX = 'rafa:';

/**
 * The run opening a fence: at most three spaces, then three or more
 * backticks or tildes. Whatever follows the run is the info string.
 */
const FENCE_RUN = /^( {0,3})(`{3,}|~{3,})/;

/** A closing fence: a run and nothing after it but spaces and tabs. */
const CLOSING_FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

/** An open fence, and what closing it takes. */
interface Fence {
  /** The fence character, a backtick or a tilde. */
  marker: string;
  /** How many of it opened the fence; a closer needs at least as many. */
  length: number;
  /** Spaces before the run, which each body line loses up to. */
  indent: number;
  /** The kind after `rafa:`, or null for any other fence. */
  kind: string | null;
}

/** True when `kind` is one of the four kinds this phase defines. */
export function isRafaBlockKind(kind: string): kind is RafaBlockKind {
  return (RAFA_BLOCK_KINDS as readonly string[]).includes(kind);
}

/** The document's lines. See the module note for what counts as one. */
function linesOf(markdown: string): string[] {
  const lines = markdown.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines.map((line) => (line.endsWith('\r')
    ? line.slice(0, -1)
    : line));
}

/** The kind an info string names, or null when it names no rafa block. */
function kindOf(info: string): string | null {
  const word = info.trim().split(/\s+/)[0] ?? '';
  return word.startsWith(RAFA_PREFIX)
    ? word.slice(RAFA_PREFIX.length)
    : null;
}

/** The fence `line` opens, or null when it opens none. */
function openingFence(line: string): Fence | null {
  const match = FENCE_RUN.exec(line);
  const opener = match?.[0];
  const indent = match?.[1];
  const run = match?.[2];
  if (opener === undefined || indent === undefined || run === undefined) {
    return null;
  }

  const marker = run.charAt(0);
  const info = line.slice(opener.length);
  if (marker === '`' && info.includes('`')) return null;

  return { marker, length: run.length, indent: indent.length, kind: kindOf(info) };
}

/** True when `line` closes `fence`. */
function closes(line: string, fence: Fence): boolean {
  const run = CLOSING_FENCE.exec(line)?.[1];
  return run !== undefined
    && run.charAt(0) === fence.marker
    && run.length >= fence.length;
}

/**
 * The index of the line closing `fence`, searching from `from`, or the
 * line count when nothing closes it.
 */
function closingIndex(lines: readonly string[], from: number, fence: Fence): number {
  for (let index = from; index < lines.length; index += 1) {
    if (closes(lines[index] ?? '', fence)) return index;
  }
  return lines.length;
}

/** `line` less up to `indent` leading spaces. */
function dedent(line: string, indent: number): string {
  let cut = 0;
  while (cut < indent && line.charAt(cut) === ' ') cut += 1;
  return line.slice(cut);
}

/**
 * Every `rafa:*` block in a markdown document, in source order.
 *
 * Takes any string and answers a new list, empty when the document
 * holds no rafa block. An unknown kind is answered like a known one and
 * an unclosed block is answered with `closed` false; see the module
 * note for what counts as a fence and how lines are numbered.
 */
export function readRafaBlocks(markdown: string): readonly RafaBlock[] {
  const lines = linesOf(markdown);
  const blocks: RafaBlock[] = [];

  let index = 0;
  while (index < lines.length) {
    const fence = openingFence(lines[index] ?? '');
    if (fence === null) {
      index += 1;
      continue;
    }

    const closing = closingIndex(lines, index + 1, fence);
    const closed = closing < lines.length;
    if (fence.kind !== null) {
      const body = lines
        .slice(index + 1, closing)
        .map((line) => dedent(line, fence.indent))
        .join('\n');
      const last = closed
        ? closing + 1
        : lines.length;
      blocks.push({ kind: fence.kind, body, span: { first: index + 1, last }, closed });
    }
    index = closing + 1;
  }

  return blocks;
}
