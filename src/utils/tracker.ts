import fs from 'fs';

import { readRafaBlocks } from '../plan/blocks.js';

export interface TaskInfo {
  task: string;
  lineNum: number; // 0-indexed
  status: 'blocked' | 'unchecked';
  /**
   * The text of the blocker comment the line trails, unescaped
   * ({@link splitBlockerComment}). Absent when the line trails none, or
   * a blank one, so a line without a comment answers the record it
   * answered before comments were written.
   */
  blocker?: string;
}

/** What opens a blocker comment. */
const BLOCKER_OPEN = '<!-- blocked: ';

/** What closes one. */
const BLOCKER_CLOSE = ' -->';

/** The spaces written before a comment, as a tracker spells a declaration's. */
const BLOCKER_GAP = '  ';

/**
 * A blocker comment at the end of a task's text, after whitespace. The
 * capture is the escaped text, which holds neither `<!--` nor `-->`, so
 * only the text's last opener can start a match.
 */
const BLOCKER_COMMENT = /\s<!-- blocked: ((?:(?!<!--|-->).)*) -->$/;

/** An open or blocked task line's checkbox, as `findNextTask` reads it. */
const OPEN_TASK_PREFIX = /^- \[(?: |BLOCKED)\] /;

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

/** A task's text split from the blocker comment it may trail. */
export interface BlockerSplit {
  /** The text before the comment, or the input unchanged without one. */
  text: string;
  /** The comment's text unescaped, or null without a comment or with a blank one. */
  blocker: string | null;
}

/** A comment found at the end of a text, and what came before it. */
interface FoundComment {
  /** The text before the comment, trailing spaces off. Never blank. */
  readonly before: string;
  /** The comment's text, still escaped. */
  readonly escaped: string;
}

/** The blocker comment `text` ends on, or null; see {@link splitBlockerComment}. */
function findBlockerComment(text: string): FoundComment | null {
  const trimmed = text.trimEnd();
  const match = BLOCKER_COMMENT.exec(trimmed);
  const escaped = match?.[1];
  if (match === null || escaped === undefined) return null;
  const before = trimmed.slice(0, match.index).trimEnd();
  return before.length === 0
    ? null
    : { before, escaped };
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
 */
export function splitBlockerComment(taskText: string): BlockerSplit {
  const found = findBlockerComment(taskText);
  if (found === null) return { text: taskText, blocker: null };
  const blocker = unescapeBlockerText(found.escaped);
  return {
    text: found.before,
    blocker: blocker.trim().length === 0
      ? null
      : blocker,
  };
}

/** A line split from the carriage return a CRLF tracker ends it with. */
function splitCarriageReturn(line: string): { body: string; cr: string } {
  return line.endsWith('\r')
    ? { body: line.slice(0, -1), cr: '\r' }
    : { body: line, cr: '' };
}

/** An open or blocked task line with its blocker comment off, or the line as it was. */
function withoutBlockerComment(line: string): string {
  const { body, cr } = splitCarriageReturn(line);
  const prefix = OPEN_TASK_PREFIX.exec(body)?.[0];
  if (prefix === undefined) return line;
  const found = findBlockerComment(body.slice(prefix.length));
  return found === null
    ? line
    : `${prefix}${found.before}${cr}`;
}

/**
 * The index, counting from zero, of every line a closed `rafa:*` block
 * spans, its fences included.
 *
 * A block's span counts from one, so the line at index `i` of the
 * tracker's `split('\n')` is span line `i + 1`. The two splits agree on
 * every index: `readRafaBlocks` only drops a carriage return off a
 * line's end and the empty line after a final newline.
 */
function closedBlockLines(trackerContent: string): ReadonlySet<number> {
  const inside = new Set<number>();
  for (const block of readRafaBlocks(trackerContent)) {
    if (!block.closed) continue;
    for (let line = block.span.first; line <= block.span.last; line += 1) {
      inside.add(line - 1);
    }
  }
  return inside;
}

/** The record for one task line's capture, its blocker comment taken off. */
function taskInfoOf(capture: string, lineNum: number, status: TaskInfo['status']): TaskInfo {
  const { text, blocker } = splitBlockerComment(capture.trim());
  return blocker === null
    ? { task: text, lineNum, status }
    : { task: text, lineNum, status, blocker };
}

/**
 * Finds the next task to execute in a tracker file.
 *
 * Blocked tasks are resumed first; otherwise the first unchecked task wins.
 * Only lines starting with `- [ ]` / `- [BLOCKED]` count — headings, stage
 * comments, and prose between items are ignored, so plans may carry stage
 * headings without confusing the loop.
 *
 * ## A line inside a `rafa:*` block is never a task
 *
 * Every place the loop quotes a task back — the prompt header, the
 * operator log, the commit subject and the commit body — quotes the text
 * this function answers, so this is where the declaration strip rule
 * reaches `rafa:*` blocks. A declaration sits ON a task line, and each
 * quoting site takes it off (`utils/declaration.ts`). A block sits AROUND
 * lines, and only a reader holding the whole document can tell that a
 * line is its body. Without this rule a `- [ ] ` at column 0 in a
 * `rafa:context` body was dispatched as a task, and its text reached all
 * four sites, the git history among them. So an open or blocked task
 * line inside a block is that block's body, as `plan/parse.ts` reads it,
 * whatever the block's kind: a `rafa:report`, or a kind a later phase
 * names, included.
 *
 * Blocks are found by `plan/blocks.ts`, which tracks fences the way a
 * renderer shows them. Every other fence stays transparent: a `- [ ] `
 * at column 0 inside a `text` illustration fence is dispatched as it
 * always was, and so is one inside a `rafa:` fence nested in such an
 * illustration, that fence being the illustration's body and no block.
 * A plan illustrating the format indents its example lines.
 *
 * A block NEVER CLOSED is the one exception: the lines after its fence
 * are read as they always were. An unclosed fence runs to the end of the
 * document, which is where a plan's remaining tasks sit, and taking them
 * as its body would answer null. `start.ts` reads null as a finished
 * plan, so the run would wrap up and push with those tasks never run.
 * `parsePlan` reports such a block as `unclosed-block`, and each open
 * task line after its fence as `task-in-block`.
 *
 * ## A blocker comment comes off the text here
 *
 * A blocked task's line may trail `<!-- blocked: <text> -->` after its
 * declaration ({@link writeTrackerBlocker}). It comes off here, before
 * anything else reads the line: {@link TaskInfo.task} never holds it,
 * and its text rides on {@link TaskInfo.blocker}. Any later would be too
 * late for the declaration, whose block is anchored at end of text: with
 * the comment still on, the block reads as task text, and the task would
 * be dispatched at the loop's defaults with the comment quoted in its
 * prompt, its log line and its commit. The comment comes off an
 * unchecked line too, one an operator unblocked by hand.
 */
export function findNextTask(trackerContent: string): TaskInfo | null {
  const lines = trackerContent.split('\n');
  const inBlock = closedBlockLines(trackerContent);

  // Prefer resuming a blocked task first
  for (let i = 0; i < lines.length; i++) {
    if (inBlock.has(i)) continue;
    const match = lines[i]!.match(/^- \[BLOCKED\] (.+)/);
    if (match?.[1]) return taskInfoOf(match[1], i, 'blocked');
  }

  // Otherwise find the next unchecked task
  for (let i = 0; i < lines.length; i++) {
    if (inBlock.has(i)) continue;
    const match = lines[i]!.match(/^- \[ \] (.+)/);
    if (match?.[1]) return taskInfoOf(match[1], i, 'unchecked');
  }

  return null;
}

/**
 * Rewrites one tracker line to the given status.
 *
 * `done` ticks the box and takes a blocker comment off the line, the
 * task no longer being blocked on anything. `blocked` changes the box
 * alone, so a line already carrying a comment keeps it byte-identical:
 * a task blocked again by a failed session or a refused commit, which
 * write no text of their own, keeps the text it was last blocked on.
 */
export function updateTrackerLine(
  trackerPath: string,
  lineNum: number,
  newStatus: 'done' | 'blocked',
): void {
  const lines = fs.readFileSync(trackerPath, 'utf8').split('\n');
  const line = lines[lineNum];
  if (!line) return;

  if (newStatus === 'done') {
    lines[lineNum] = withoutBlockerComment(line)
      .replace(/^- \[ \]/, '- [x]')
      .replace(/^- \[BLOCKED\]/, '- [x]');
  } else {
    lines[lineNum] = line.replace(/^- \[ \]/, '- [BLOCKED]');
    // Already [BLOCKED]? No change needed.
  }
  fs.writeFileSync(trackerPath, lines.join('\n'), 'utf8');
}

/**
 * Marks one task line `[BLOCKED]` and writes `blocker` into it as its
 * trailing comment, answering whether the line was written.
 *
 * The comment goes after everything the line holds, its declaration
 * included, two spaces after it, and replaces a comment the line already
 * trails rather than stacking a second: the text is what blocked the task
 * most recently. A blank `blocker` writes no comment and takes an earlier
 * one off. The next `findNextTask` answers the text on
 * {@link TaskInfo.blocker}, and the dispatch hands it to the task's
 * session as a line of its prompt (`start/dispatch.ts`).
 *
 * The text is untrusted, a session having written it, and every reader
 * of a tracker matches from the start of a line, so it is escaped rather
 * than written as it is ({@link escapeBlockerText}). Raw, a line break in
 * it opens a line of its own, where a `- [ ] ` is dispatched as a task,
 * and a `-->` closes the comment early and leaves the rest, the opener
 * with it, in the task text. `tracker.test.ts` plants both and reads the
 * same text written raw as its control.
 *
 * Only an open or blocked task line with text before the comment is
 * written: `lineNum` is the one `findNextTask` answered. A ticked line, a
 * line that is no task, a line past the end and a task line with no text
 * answer false with the file left as it was, the last because the comment
 * would be the whole of its text and read back as the task. A carriage
 * return ending the line stays on it; spaces the text trailed do not.
 */
export function writeTrackerBlocker(
  trackerPath: string,
  lineNum: number,
  blocker: string,
): boolean {
  const lines = fs.readFileSync(trackerPath, 'utf8').split('\n');
  const line = lines[lineNum];
  if (line === undefined) return false;

  const { body, cr } = splitCarriageReturn(line);
  const prefix = OPEN_TASK_PREFIX.exec(body)?.[0];
  if (prefix === undefined) return false;

  const rest = body.slice(prefix.length);
  const text = (findBlockerComment(rest)?.before ?? rest).trimEnd();
  if (text.trim().length === 0) return false;

  const comment = blocker.trim().length === 0
    ? ''
    : `${BLOCKER_GAP}${blockerComment(blocker)}`;
  lines[lineNum] = `- [BLOCKED] ${text}${comment}${cr}`;
  fs.writeFileSync(trackerPath, lines.join('\n'), 'utf8');
  return true;
}

/**
 * Derives the tracker path for a plan file: `PLAN.md` → `PLAN_TRACKER.md`,
 * `PLAN-foo.md` → `PLAN_TRACKER-foo.md`. Keeping one tracker per plan lets
 * several plans coexist without clobbering each other's progress.
 */
export function trackerPathFor(planPath: string): string {
  return planPath.replace(/PLAN(-[^/]*)?\.md$/, (_m, stub: string | undefined) => `PLAN_TRACKER${stub ?? ''}.md`);
}
