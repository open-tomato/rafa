/**
 * Reading the `rafa:promoted` block the wrap-up session answers with.
 *
 * The wrap-up prompt lists the lessons that recurred enough to promote,
 * and the session answers each of them with one line of a
 * `rafa:promoted` block: the lesson's id, an arrow, and either the path
 * it wrote the lesson into or `skipped:` and why it did not.
 *
 * ````markdown
 * ```rafa:promoted
 * bun-test-under-a-fresh-worktree-1a2b3c4d → context/verification.md
 * lint-order-of-type-imports-5e6f7a8b → skipped: a skill already covers it
 * ```
 * ````
 *
 * This module turns that block into answers and nothing more. Whether
 * every listed id was answered, and whether a named path really
 * changed, is the check that runs after the session; it reads the
 * {@link PromotedReading} answered here.
 *
 * ## Which block
 *
 * Blocks are found by `readRafaBlocks` (`plan/blocks.ts`), so a
 * `rafa:promoted` fence shown inside a longer fence is an illustration
 * and not an answer. The LAST block counts, as the last
 * `rafa:spec-review` block does in `board/spec-review.ts`: a session
 * that quotes an earlier draft and then answers answers with the second.
 * A block never closed is not read at all, and reads as `unclosed`: its
 * last line may have been cut mid-path, and a path cut short would read
 * as a path the session never named.
 *
 * ## A line
 *
 * Blank lines are skipped. Every other line is read as follows, and a
 * line that fails any step is answered as an {@link UnreadablePromotedLine}
 * rather than dropped, so the check can say which line it could not use.
 *
 *   - Surrounding space is trimmed, and one leading list marker (`- ` or
 *     `* `) is dropped: a session that writes the answer as a list has
 *     still answered.
 *   - The line splits at its FIRST arrow, `→` or its ASCII spelling
 *     `->`. A line with no arrow is unreadable.
 *   - The left side, trimmed and less one pair of wrapping backticks, is
 *     the id. It must be non-empty and hold no whitespace, which a
 *     lesson id never does (`report/lessons.ts`, `lessonId`).
 *   - The right side, trimmed, is a skip when it opens with `skipped:`,
 *     matched case-insensitively. The rest, trimmed, is the reason and
 *     must be non-empty: a skip that says nothing about why is the
 *     answer the prompt asks the session not to give.
 *   - Any other right side, less one pair of wrapping backticks, is the
 *     path. It must be non-empty and hold no whitespace, so prose after
 *     a path (`context/cli.md, the help section`) is unreadable rather
 *     than a path that names no file.
 *   - An id answered on an earlier line keeps that first answer, and the
 *     later line is unreadable: two answers for one lesson leave no one
 *     reading of it.
 *
 * Lines are numbered from one in the WHOLE output the block was read
 * from, the way `LineSpan` numbers them, so a report can point at the
 * line in the session's capture.
 *
 * Nothing here throws, opens a file or changes a value passed in.
 */
import { readRafaBlocks } from '../plan/blocks.js';

/** The kind of the block the wrap-up session answers in. */
export const PROMOTED_BLOCK_KIND = 'promoted';

/** A lesson the session wrote into a tracked page. */
export interface PromotedToPath {
  readonly kind: 'promoted';
  /** The lesson's id, as the prompt listed it. */
  readonly id: string;
  /** The path the session says it wrote the lesson into, as written. */
  readonly path: string;
  /** The answer's line in the output, from one. */
  readonly line: number;
}

/** A lesson the session chose not to promote, and why. */
export interface SkippedWithReason {
  readonly kind: 'skipped';
  /** The lesson's id, as the prompt listed it. */
  readonly id: string;
  /** Why it was not promoted: never empty. */
  readonly reason: string;
  /** The answer's line in the output, from one. */
  readonly line: number;
}

/** One lesson's answer. */
export type PromotedAnswer = PromotedToPath | SkippedWithReason;

/** A non-blank line of the block that answers no lesson. */
export interface UnreadablePromotedLine {
  /** The line's number in the output, from one. */
  readonly line: number;
  /** The line as the block holds it. */
  readonly text: string;
  /** Why it could not be read, as a clause. */
  readonly reason: string;
}

/**
 * What the output answered.
 *
 * `absent` and `unclosed` carry no answer and no unreadable line: the
 * first found no block, and the second found one it would not read.
 */
export interface PromotedReading {
  readonly status: 'read' | 'absent' | 'unclosed';
  /** One per answered id, in the order the block answered them. */
  readonly answers: readonly PromotedAnswer[];
  /** Every non-blank line that answered nothing, in source order. */
  readonly unreadable: readonly UnreadablePromotedLine[];
}

/** The arrow between an id and its answer, in either spelling. */
const ARROW = /→|->/;

/** The prefix that turns an answer into a skip. */
const SKIPPED = /^skipped:/i;

/** One leading list marker. */
const LIST_MARKER = /^[-*]\s+/;

/** Any whitespace, which neither an id nor a path may hold. */
const WHITESPACE = /\s/;

/** `text` less one pair of wrapping backticks, trimmed. */
function unquoted(text: string): string {
  const trimmed = text.trim();
  return trimmed.length >= 2 && trimmed.startsWith('`') && trimmed.endsWith('`')
    ? trimmed.slice(1, -1).trim()
    : trimmed;
}

/** Why `word` is no usable `what`, or null when it is one. */
function wordProblem(word: string, what: string): string | null {
  if (word === '') return `it names no ${what}`;
  if (WHITESPACE.test(word)) return `its ${what} \`${word}\` holds whitespace`;
  return null;
}

/** One line read: an answer, or the reason it is none. */
type LineReading =
  | { readonly answer: PromotedAnswer }
  | { readonly reason: string };

/** Reads one non-blank line; see the module note. */
function readLine(text: string, line: number): LineReading {
  const content = text.trim().replace(LIST_MARKER, '');
  const arrow = ARROW.exec(content);
  if (arrow === null) return { reason: 'it holds no `→` or `->`' };

  const id = unquoted(content.slice(0, arrow.index));
  const idProblem = wordProblem(id, 'id');
  if (idProblem !== null) return { reason: idProblem };

  const right = content.slice(arrow.index + arrow[0].length).trim();
  if (SKIPPED.test(right)) {
    const reason = right.replace(SKIPPED, '').trim();
    return reason === ''
      ? { reason: `it skips \`${id}\` without a reason` }
      : { answer: { kind: 'skipped', id, reason, line } };
  }

  const path = unquoted(right);
  const pathProblem = wordProblem(path, 'path');
  return pathProblem === null
    ? { answer: { kind: 'promoted', id, path, line } }
    : { reason: pathProblem };
}

/**
 * Reads the last `rafa:promoted` block out of the wrap-up session's
 * output.
 *
 * Takes any string, normally the session's captured final message, and
 * answers a new reading. Never throws. See the module note for which
 * block counts and how each of its lines is read.
 */
export function parsePromoted(output: string): PromotedReading {
  const block = readRafaBlocks(output)
    .filter((found) => found.kind === PROMOTED_BLOCK_KIND)
    .at(-1);
  if (block === undefined) return { status: 'absent', answers: [], unreadable: [] };
  if (!block.closed) return { status: 'unclosed', answers: [], unreadable: [] };

  const answers: PromotedAnswer[] = [];
  const unreadable: UnreadablePromotedLine[] = [];
  const firstLine = new Map<string, number>();

  block.body.split('\n').forEach((text, index) => {
    if (text.trim() === '') return;
    const line = block.span.first + 1 + index;
    const reading = readLine(text, line);
    if ('reason' in reading) {
      unreadable.push({ line, text, reason: reading.reason });
      return;
    }

    const { id } = reading.answer;
    const earlier = firstLine.get(id);
    if (earlier !== undefined) {
      const reason = `\`${id}\` was already answered at line ${String(earlier)}`;
      unreadable.push({ line, text, reason });
      return;
    }

    firstLine.set(id, line);
    answers.push(reading.answer);
  });

  return { status: 'read', answers, unreadable };
}
