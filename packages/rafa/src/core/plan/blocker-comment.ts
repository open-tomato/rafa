/**
 * The blocker and repairs comments a tracker's task line may trail,
 * spelled both ways: the writers {@link blockerComment} and
 * {@link repairsComment}, the escape pair they write with, and the
 * reader {@link splitBlockerComment}.
 *
 * The family moved here from `packages/rafa/src/utils/tracker.ts`, which re-exports
 * its public names under the same names for the importers outside core.
 * `plan/parse.ts` reads a task's text through {@link splitBlockerComment},
 * so with the family in core the parser imports nothing above it.
 *
 * The tracker's line writers in `packages/rafa/src/utils/tracker.ts` (marking a line
 * blocked, ticking it, inserting a repair) take a line's comments off
 * and put them back with {@link splitTrailingComments},
 * {@link commentText}, {@link keptRepairs} and {@link BLOCKER_GAP}, so
 * those are exported too, through the plan barrel, and one file spells
 * the comment for every reader and writer. This file imports nothing.
 */

/** What opens a blocker comment. */
const BLOCKER_OPEN = '<!-- blocked: ';

/** What opens a repairs comment. */
const REPAIRS_OPEN = '<!-- repairs: ';

/** What closes either. */
const BLOCKER_CLOSE = ' -->';

/** The spaces written before a comment, as a tracker spells a declaration's. */
export const BLOCKER_GAP = '  ';

/** The two comments a tracker line may trail, by the word each opens with. */
type CommentKind = 'blocked' | 'repairs';

/**
 * A blocker or repairs comment at the end of a task's text, after
 * whitespace. The first capture is its kind and the second its escaped
 * text, which holds neither `<!--` nor `-->`, so only the text's last
 * opener can start a match.
 */
const TRAILING_COMMENT = /\s<!-- (blocked|repairs): ((?:(?!<!--|-->).)*) -->$/;

/** A `\u` and four hex digits, or a backslash and any one character. */
const ESCAPE_SEQUENCE = /\\(u[0-9A-Fa-f]{4}|[\s\S])/g;

/** The code unit of a tab, the one control character written raw. */
const TAB = 0x09;

/** The first code unit that is no C0 control character. */
const FIRST_PRINTABLE = 0x20;

/** DEL, and the two JavaScript line terminators that are no line break in the file. */
const ESCAPED_CODE_UNITS: readonly number[] = [0x7f, 0x2028, 0x2029];

/** True when a code unit is written as `\uXXXX` rather than raw. */
function isEscapedCodeUnit(code: number): boolean {
  if (code < FIRST_PRINTABLE) return code !== TAB;
  return ESCAPED_CODE_UNITS.includes(code);
}

/** One character of a blocker text, as the comment holds it. */
function escapeCharacter(char: string): string {
  if (char === '\\') return '\\\\';
  if (char === '\n') return '\\n';
  if (char === '\r') return '\\r';
  const code = char.charCodeAt(0);
  return isEscapedCodeUnit(code)
    ? `\\u${code.toString(16).padStart(4, '0')}`
    : char;
}

/**
 * The text a blocker comment holds for `text`: one line that closes no
 * comment and opens none, which {@link unescapeBlockerText} turns back
 * into `text` exactly.
 *
 * A backslash is the escape character and is itself written `\\`. A
 * line feed is written `\n`, since the tracker is read line by line on
 * `split('\n')`, and a carriage return `\r`, which a Markdown reader
 * also ends a line on. U+2028 and U+2029 are written `\u2028` and
 * `\u2029`: neither ends a line of the file, but JavaScript's `.`
 * matches neither, so the `(.+)` capture in `findNextTask` stops at one
 * and would leave the comment unclosed in the task text. Every other
 * control character but the tab, and DEL, is written the same way, so
 * the comment holds printable text alone.
 *
 * Then a `>` after `--` or `--!` is written `\>`, so neither `-->` nor
 * `--!>` closes the comment early, and a `!` between `<` and `--` is
 * written `\!`, so no `<!--` opens a second one. Nothing else changes,
 * which keeps the text readable in the tracker.
 */
export function escapeBlockerText(text: string): string {
  return Array.from(text, escapeCharacter)
    .join('')
    .replace(/(?<=--!?)>/g, '\\>')
    .replace(/(?<=<)!(?=--)/g, '\\!');
}

/**
 * The text {@link escapeBlockerText} escaped, back as it was.
 *
 * A backslash followed by `n` or `r` is that line break, by `u` and four
 * hex digits that code unit, and by any other character that character.
 * A backslash with nothing after it stays, so a comment edited by hand
 * reads back as written rather than failing.
 */
export function unescapeBlockerText(escaped: string): string {
  return escaped.replace(ESCAPE_SEQUENCE, (_sequence, code: string) => {
    if (code === 'n') return '\n';
    if (code === 'r') return '\r';
    return code.length === 5
      ? String.fromCharCode(Number.parseInt(code.slice(1), 16))
      : code;
  });
}

/** The comment a tracker line trails for `blocker`: `<!-- blocked: <escaped text> -->`. */
export function blockerComment(blocker: string): string {
  return `${BLOCKER_OPEN}${escapeBlockerText(blocker)}${BLOCKER_CLOSE}`;
}

/**
 * The comment a repair's tracker line trails for `repaired`, the text of
 * the plan task it repairs: `<!-- repairs: <escaped text> -->`, escaped
 * as {@link blockerComment} escapes a blocker.
 */
export function repairsComment(repaired: string): string {
  return `${REPAIRS_OPEN}${escapeBlockerText(repaired)}${BLOCKER_CLOSE}`;
}

/** A task's text split from the blocker comment it may trail. */
export interface BlockerSplit {
  /** The text before the comment, or the input unchanged without one. */
  text: string;
  /** The comment's text unescaped, or null without a comment or with a blank one. */
  blocker: string | null;
}

/** A comment found at the end of a text, and what came before it. */
interface FoundComment {
  /** Which of the two comments it is. */
  readonly kind: CommentKind;
  /** The text before the comment, trailing spaces off. Never blank. */
  readonly before: string;
  /** The comment's text, still escaped. */
  readonly escaped: string;
}

/** The blocker or repairs comment `text` ends on, or null; see {@link splitBlockerComment}. */
function findTrailingComment(text: string): FoundComment | null {
  const trimmed = text.trimEnd();
  const match = TRAILING_COMMENT.exec(trimmed);
  const kind = match?.[1];
  const escaped = match?.[2];
  if (match === null || escaped === undefined || (kind !== 'blocked' && kind !== 'repairs')) return null;
  const before = trimmed.slice(0, match.index).trimEnd();
  return before.length === 0
    ? null
    : { kind, before, escaped };
}

/** A task's text with the comments it trails taken off, each still escaped. */
export interface TrailingComments {
  /** The text before the comments, trailing spaces off, or the input unchanged without one. */
  readonly text: string;
  /** The blocker comment's escaped text, or null without that comment. */
  readonly blocked: string | null;
  /** The repairs comment's escaped text, or null without that comment. */
  readonly repairs: string | null;
}

/**
 * The comments `taskText` ends on, one of each kind at most and in
 * either order, and the text before them; see {@link splitBlockerComment}.
 */
export function splitTrailingComments(taskText: string): TrailingComments {
  const last = findTrailingComment(taskText);
  if (last === null) return { text: taskText, blocked: null, repairs: null };
  const earlier = findTrailingComment(last.before);
  const found = earlier === null || earlier.kind === last.kind
    ? [last]
    : [last, earlier];
  return {
    text: found.at(-1)?.before ?? last.before,
    blocked: found.find((comment) => comment.kind === 'blocked')?.escaped ?? null,
    repairs: found.find((comment) => comment.kind === 'repairs')?.escaped ?? null,
  };
}

/** A comment's escaped text as its reader answers it: unescaped, or null without a comment or with a blank one. */
export function commentText(escaped: string | null): string | null {
  if (escaped === null) return null;
  const text = unescapeBlockerText(escaped);
  return text.trim().length === 0
    ? null
    : text;
}

/** `escaped`, a repairs comment's text as a line holds it, written back after a gap; nothing for null. */
export function keptRepairs(escaped: string | null): string {
  return escaped === null
    ? ''
    : `${BLOCKER_GAP}${REPAIRS_OPEN}${escaped}${BLOCKER_CLOSE}`;
}

/**
 * Splits a task's text from the blocker comment it may trail.
 *
 * Takes the TEXT of a task, as `findNextTask` captures it off a line. The
 * comment is `<!-- blocked: <text> -->` as {@link blockerComment} writes
 * it, and four rules keep a comment a task WROTE ABOUT from being read as
 * one, as the declaration grammar's rules do for a block:
 *
 *   - It is anchored at END OF TEXT, trailing spaces aside. A task quoting
 *     the comment in a code span ends on the backtick.
 *   - It follows WHITESPACE, which the writer always puts before it.
 *   - Its text holds neither `<!--` nor `-->`, which the writer escapes,
 *     so a match starts at the last opener, and a task holding an opener
 *     of its own keeps it rather than losing it into the comment.
 *   - It is not the WHOLE text, so no task is left empty.
 *
 * A near miss spelled by hand, `<!--blocked: x-->` among them, is task
 * text. Without a comment `text` is the input unchanged and `blocker` is
 * null. With one, `text` is what came before it, trailing spaces off, and
 * `blocker` is its text unescaped, or null when that is blank.
 *
 * A repair's line trails a second comment, `<!-- repairs: <text> -->`
 * ({@link repairsComment}), held to the same four rules. The writer puts
 * it before the blocker comment, so the blocker is still what the line
 * ends on, and it is read on either side of it: one comment of each kind
 * comes off the end of the text, whichever is last. `text` holds neither,
 * so the three modules reading a line through this function
 * (`plan/parse.ts`, `loop/blocked-tasks.ts`, `start/pass-over.ts`) meet
 * the task's text and its declaration as they do on any other line. A
 * second comment of one kind is task text. What the repairs comment says
 * is answered by `findNextTask` alone, as `TaskInfo.repairs`
 * (`utils/tracker.ts`).
 */
export function splitBlockerComment(taskText: string): BlockerSplit {
  const { text, blocked } = splitTrailingComments(taskText);
  return { text, blocker: commentText(blocked) };
}
