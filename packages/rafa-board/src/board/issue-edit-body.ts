/**
 * The body `rafa issue edit` writes: the dated `Updated` block an append
 * adds below the original, the appended and replaced bodies, the
 * `already` reading, and the original-part comparison the post-write
 * check makes (`.rafa/specs/rafa-812-spec-rafa-issue-edit.md`).
 *
 * Nothing here reads or writes the board; every function is pure, and
 * the command hands each one the body it read.
 *
 * ## The block
 *
 * {@link renderUpdateBlock} writes `**Updated <YYYY-MM-DD>, <reason>:**`
 * on its own line, a blank line, and the added text. The day is the
 * local calendar day ({@link localDay}, the day `renderUnblockNote` in
 * `./epic-trail.ts` names), and the reason is one line through that
 * module's {@link normaliseReason}, so the heading reads the way the
 * planner already reads an amendment as superseding. The text keeps its
 * own lines and loses only its trailing whitespace, so the block a
 * second run renders is the block the first one wrote. A reason or text
 * holding nothing but whitespace is refused with a thrown `RangeError`:
 * an update without either says nothing, and the command checks both
 * before it reaches here.
 *
 * ## The bodies
 *
 * {@link appendedBody} keeps the body it is handed as a byte-identical
 * prefix and adds the block after one blank line, writing only the line
 * breaks the body does not already end with. An empty body takes the
 * block alone. {@link replacedBody} is the new text with its trailing
 * whitespace dropped, refused when blank.
 *
 * ## Already
 *
 * {@link carriesUpdateBlock} is true when the block — same day, same
 * reason, same text — is the body's last part, trailing whitespace
 * aside, and opens a line. The same line run twice on one day answers
 * `already` and writes nothing; run on another day, or with another
 * reason, it appends a second block.
 *
 * ## After the write
 *
 * {@link originalPartHolds} weighs the body re-read after the write
 * against the body read before it: the original part must be the
 * before-body byte for byte, followed by exactly the separator and block
 * {@link appendedBody} added (trailing whitespace aside, which the board
 * may trim). Anything else means the body changed between the read and
 * the write, and the command reports `conflict`.
 */
import { normaliseReason } from './epic-trail.js';
import { localDay } from './epics.js';

/** Whitespace closing a string, which a block and a replaced body drop. */
const TRAILING_WHITESPACE = /\s+$/u;

/** The text with its trailing whitespace dropped, refused when nothing is left. */
function trimmedText(text: string, what: string): string {
  const trimmed = text.replace(TRAILING_WHITESPACE, '');
  if (trimmed.trim() === '') throw new RangeError(`${what} holds nothing but whitespace`);
  return trimmed;
}

/** The heading line of an update block: `**Updated <YYYY-MM-DD>, <reason>:**`. */
export function renderUpdateHeading(now: Date, reason: string): string {
  const normalised = normaliseReason(reason);
  if (normalised === '') throw new RangeError('the reason holds nothing but whitespace');
  return `**Updated ${localDay(now)}, ${normalised}:**`;
}

/**
 * The block an append adds: {@link renderUpdateHeading}, a blank line,
 * and `text` without its trailing whitespace.
 */
export function renderUpdateBlock(now: Date, reason: string, text: string): string {
  return `${renderUpdateHeading(now, reason)}\n\n${trimmedText(text, 'the added text')}`;
}

/** The line breaks that put exactly one blank line between `body` and what follows it. */
function separatorAfter(body: string): string {
  if (body === '' || body.endsWith('\n\n')) return '';
  return body.endsWith('\n')
    ? '\n'
    : '\n\n';
}

/** `body` unchanged, then `block` after one blank line. */
export function appendedBody(body: string, block: string): string {
  return `${body}${separatorAfter(body)}${block}`;
}

/** The body a replace writes: `text` without its trailing whitespace. */
export function replacedBody(text: string): string {
  return trimmedText(text, 'the replacing text');
}

/**
 * True when `block` is the last part of `body`, trailing whitespace
 * aside, and opens a line: the update was appended already.
 */
export function carriesUpdateBlock(body: string, block: string): boolean {
  const trimmed = body.replace(TRAILING_WHITESPACE, '');
  if (!trimmed.endsWith(block)) return false;
  const before = trimmed.slice(0, trimmed.length - block.length);
  return before === '' || before.endsWith('\n');
}

/**
 * True when `after`, the body re-read after an append of `block`, opens
 * with `before` byte for byte and holds nothing past it but the
 * separator and `block` {@link appendedBody} added, trailing whitespace
 * aside.
 */
export function originalPartHolds(before: string, after: string, block: string): boolean {
  if (!after.startsWith(before)) return false;
  const added = after.slice(before.length).replace(TRAILING_WHITESPACE, '');
  return added === `${separatorAfter(before)}${block}`;
}
