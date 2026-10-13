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
  /**
   * The text of the repairs comment the line trails, unescaped: the plan
   * task a repair's line names ({@link insertTrackerTask}). Absent when
   * the line trails none, or a blank one, which is every line that is no
   * repair, a repair of the whole suite, and a repair written before
   * the comment was.
   */
  repairs?: string;
}

/** What opens a blocker comment. */
const BLOCKER_OPEN = '<!-- blocked: ';

/** What opens a repairs comment. */
const REPAIRS_OPEN = '<!-- repairs: ';

/** What closes either. */
const BLOCKER_CLOSE = ' -->';

/** The spaces written before a comment, as a tracker spells a declaration's. */
const BLOCKER_GAP = '  ';

/** The two comments a tracker line may trail, by the word each opens with. */
type CommentKind = 'blocked' | 'repairs';

/**
 * A blocker or repairs comment at the end of a task's text, after
 * whitespace. The first capture is its kind and the second its escaped
 * text, which holds neither `<!--` nor `-->`, so only the text's last
 * opener can start a match.
 */
const TRAILING_COMMENT = /\s<!-- (blocked|repairs): ((?:(?!<!--|-->).)*) -->$/;

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
interface TrailingComments {
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
function splitTrailingComments(taskText: string): TrailingComments {
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
function commentText(escaped: string | null): string | null {
  if (escaped === null) return null;
  const text = unescapeBlockerText(escaped);
  return text.trim().length === 0
    ? null
    : text;
}

/** `escaped`, a repairs comment's text as a line holds it, written back after a gap; nothing for null. */
function keptRepairs(escaped: string | null): string {
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
 * is answered by `findNextTask` alone, as {@link TaskInfo.repairs}.
 */
export function splitBlockerComment(taskText: string): BlockerSplit {
  const { text, blocked } = splitTrailingComments(taskText);
  return { text, blocker: commentText(blocked) };
}

/** A line split from the carriage return a CRLF tracker ends it with. */
function splitCarriageReturn(line: string): { body: string; cr: string } {
  return line.endsWith('\r')
    ? { body: line.slice(0, -1), cr: '\r' }
    : { body: line, cr: '' };
}

/**
 * An open or blocked task line with its blocker comment off, or the
 * line as it was. A repairs comment stays on it, after the text.
 */
function withoutBlockerComment(line: string): string {
  const { body, cr } = splitCarriageReturn(line);
  const prefix = OPEN_TASK_PREFIX.exec(body)?.[0];
  if (prefix === undefined) return line;
  const found = splitTrailingComments(body.slice(prefix.length));
  return found.blocked === null
    ? line
    : `${prefix}${found.text}${keptRepairs(found.repairs)}${cr}`;
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

/** A task line of any status, ticked ones included, as {@link listTrackerTasks} answers it. */
export interface TrackerTask extends Omit<TaskInfo, 'status'> {
  status: TaskInfo['status'] | 'done';
}

/** The record for one task line's capture, its blocker and repairs comments taken off. */
function taskInfoOf(capture: string, lineNum: number, status: TrackerTask['status']): TrackerTask {
  const found = splitTrailingComments(capture.trim());
  const blocker = commentText(found.blocked);
  const repairs = commentText(found.repairs);
  return {
    task: found.text,
    lineNum,
    status,
    ...(blocker === null
      ? {}
      : { blocker }),
    ...(repairs === null
      ? {}
      : { repairs }),
  };
}

/** Each checkbox a task line opens with, and the status it reads as. */
const TASK_LINE_STATUSES: readonly (readonly [RegExp, TrackerTask['status']])[] = [
  [/^- \[BLOCKED\] (.+)/, 'blocked'],
  [/^- \[ \] (.+)/, 'unchecked'],
  [/^- \[x\] (.+)/, 'done'],
];

/** What {@link findNextTask} may be told besides the tracker. */
export interface FindNextTaskOptions {
  /**
   * Zero-based lines never answered, blocked or unchecked: the tasks a
   * `--continue` run passes over (`start/pass-over.ts`). The tracker is
   * not written; a line holding no open task is ignored.
   */
  readonly skipLines?: ReadonlySet<number>;
}

/** No line skipped. */
const NO_LINES: ReadonlySet<number> = new Set();

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
 *
 * ## So does a repairs comment
 *
 * A repair task exists in the tracker alone, so its line says which
 * plan task it repairs: `<!-- repairs: <text> -->`, written after the
 * declaration and before the blocker comment ({@link insertTrackerTask}).
 * It comes off here with the blocker comment and for the same reason,
 * read on either side of it, and its text rides on
 * {@link TaskInfo.repairs}, unescaped. A line trailing none answers no
 * `repairs`: a plan task, a repair that names nothing, and every repair
 * a tracker held before the comment was written. The comment stays on
 * the line when it is ticked and when a blocker is written on it again
 * ({@link updateTrackerLine}, {@link writeTrackerBlocker}), so a repair
 * blocked a second time still names its task.
 *
 * ## Lines a run passes over
 *
 * {@link FindNextTaskOptions.skipLines} names lines never answered,
 * whatever their status, so a `--continue` run can go on past a task it
 * jumped or deferred while the tracker keeps its `[BLOCKED]` line.
 */
export function findNextTask(
  trackerContent: string,
  options: FindNextTaskOptions = {},
): TaskInfo | null {
  const skip = options.skipLines ?? NO_LINES;
  const open = listOpenTasks(trackerContent).filter((task) => !skip.has(task.lineNum));
  return open.find((task) => task.status === 'blocked')
    ?? open.find((task) => task.status === 'unchecked')
    ?? null;
}

/**
 * Every task line of a tracker, ticked ones included, in tracker order,
 * read by the rules {@link findNextTask} answers one by: only a line
 * opening `- [ ] `, `- [BLOCKED] ` or `- [x] ` counts, never one inside
 * a closed `rafa:*` block, and a blocker or repairs comment comes off
 * the text. A `--continue` run counts the copies of a repeated task text
 * over these (`start/pass-over.ts`), so ticking one copy renumbers no
 * other.
 */
export function listTrackerTasks(trackerContent: string): TrackerTask[] {
  const lines = trackerContent.split('\n');
  const inBlock = closedBlockLines(trackerContent);
  const tasks: TrackerTask[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (inBlock.has(i)) continue;
    for (const [pattern, status] of TASK_LINE_STATUSES) {
      const capture = lines[i]!.match(pattern)?.[1];
      if (!capture) continue;
      tasks.push(taskInfoOf(capture, i, status));
      break;
    }
  }

  return tasks;
}

/** True for a task line that is still open, blocked or unchecked. */
function isOpenTask(task: TrackerTask): task is TaskInfo {
  return task.status !== 'done';
}

/**
 * Every open task of a tracker, blocked or unchecked, in tracker order:
 * {@link listTrackerTasks} with the ticked lines left out.
 */
export function listOpenTasks(trackerContent: string): TaskInfo[] {
  return listTrackerTasks(trackerContent).filter(isOpenTask);
}

/**
 * Rewrites one tracker line to the given status.
 *
 * `done` ticks the box and takes a blocker comment off the line, the
 * task no longer being blocked on anything; a repairs comment stays,
 * the line still being that task's repair. `blocked` changes the box
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
 * session as a line of its prompt (`start/dispatch.ts`). A repairs
 * comment the line trails is kept as it is written and stays before the
 * blocker comment, moved there when a hand put it after.
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

  const found = splitTrailingComments(body.slice(prefix.length));
  const text = found.text.trimEnd();
  if (text.trim().length === 0) return false;

  const comment = blocker.trim().length === 0
    ? ''
    : `${BLOCKER_GAP}${blockerComment(blocker)}`;
  lines[lineNum] = `- [BLOCKED] ${text}${keptRepairs(found.repairs)}${comment}${cr}`;
  fs.writeFileSync(trackerPath, lines.join('\n'), 'utf8');
  return true;
}

/** Any task line's checkbox, ticked included, as `plan/parse.ts` reads the checklist. */
const ANY_TASK_PREFIX = /^- \[(?: |x|BLOCKED)\] /;

/** A character that ends a line for a tracker reader or for JavaScript's `.`. */
const LINE_TERMINATOR = /[\n\r\u2028\u2029]/;

/** A task line {@link insertTrackerTask} writes. */
export interface InsertedTask {
  /** The task's sentence: one line, not blank. */
  readonly task: string;
  /**
   * The declaration's entries, without the braces, such as
   * `agent=build-error-resolver`: one line, holding neither brace.
   */
  readonly declaration: string;
  /** The text of its blocker comment, escaped as {@link writeTrackerBlocker} escapes it. */
  readonly blocker: string;
  /**
   * The text of the plan task the line repairs, written as its repairs
   * comment and escaped as the blocker is. Absent or blank writes no
   * such comment: the line names no task.
   */
  readonly repairs?: string;
}

/** Throws unless `entry` writes one task line whose declaration is the last brace group. */
function assertInsertable(entry: InsertedTask): void {
  if (entry.task.trim().length === 0 || LINE_TERMINATOR.test(entry.task)) {
    throw new Error('insertTrackerTask: the task text must be one line and not blank');
  }
  if (entry.declaration.trim().length === 0 || /[{}]/.test(entry.declaration) || LINE_TERMINATOR.test(entry.declaration)) {
    throw new Error('insertTrackerTask: the declaration must be one line of entries holding no brace');
  }
}

/** The index after the last task line outside a closed block, or the end of the text. */
function endOfChecklist(lines: readonly string[], inBlock: ReadonlySet<number>): number {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (!inBlock.has(i) && ANY_TASK_PREFIX.test(lines[i]!)) return i + 1;
  }
  const last = lines.length - 1;
  return lines[last] === ''
    ? last
    : lines.length;
}

/**
 * Inserts a `[BLOCKED]` task line into the tracker and answers its line,
 * counting from zero.
 *
 * The line is `- [BLOCKED] <task>  {<declaration>}  <!-- blocked: ... -->`,
 * read by the parser as any plan task: it starts at column 0, its
 * declaration is the last brace group of its text, and its blocker
 * comment follows that, escaped as {@link writeTrackerBlocker} escapes
 * one, so a `-->` or a line break in the blocker stays inside the one
 * comment on the one line. Being blocked, it is the line `findNextTask`
 * answers first, wherever it sits.
 *
 * With {@link InsertedTask.repairs} the line names the plan task it
 * repairs, in a comment of its own between the declaration and the
 * blocker:
 * `- [BLOCKED] <task>  {<declaration>}  <!-- repairs: ... -->  <!-- blocked: ... -->`.
 * The text is a plan task's, which may hold a `-->`, a brace group or
 * a backtick, so it is escaped as the blocker is and no reader takes
 * part of it for the line's declaration or for a second comment. The
 * blocker stays the comment the line ends on. `findNextTask` answers
 * the name as {@link TaskInfo.repairs}.
 *
 * With `beforeLine` it goes directly above that task line, so it sits
 * under the stage heading of the task it precedes and the task moves
 * down one line. With null it goes directly after the checklist's last
 * task line, ticked lines included, under the last task's heading and
 * above whatever prose or stamp follows the list; a tracker with no task
 * line takes it at its end. Lines inside a closed `rafa:*` block are no
 * tasks here, as they are none to `findNextTask`.
 *
 * It throws, with the file left as it was, on a task text that is blank
 * or spans lines, a declaration that is blank, spans lines or holds a
 * brace, and a `beforeLine` that is no task line outside a block: each
 * would write a line that reads back as something else. A CRLF tracker,
 * read off its first line, gets a carriage return on the inserted line.
 */
export function insertTrackerTask(
  trackerPath: string,
  entry: InsertedTask,
  beforeLine: number | null,
): number {
  assertInsertable(entry);
  const content = fs.readFileSync(trackerPath, 'utf8');
  const lines = content.split('\n');
  const inBlock = closedBlockLines(content);

  if (beforeLine !== null) {
    const target = lines[beforeLine];
    if (target === undefined || inBlock.has(beforeLine) || !ANY_TASK_PREFIX.test(target)) {
      throw new Error(`insertTrackerTask: line ${beforeLine} is no task line`);
    }
  }

  const at = beforeLine ?? endOfChecklist(lines, inBlock);
  const { cr } = splitCarriageReturn(lines[0] ?? '');
  const repaired = entry.repairs ?? '';
  const repairs = repaired.trim().length === 0
    ? ''
    : `${BLOCKER_GAP}${repairsComment(repaired)}`;
  const line = `- [BLOCKED] ${entry.task.trim()}${BLOCKER_GAP}{${entry.declaration.trim()}}`
    + `${repairs}${BLOCKER_GAP}${blockerComment(entry.blocker)}${cr}`;
  const written = [...lines.slice(0, at), line, ...lines.slice(at)];
  fs.writeFileSync(trackerPath, written.join('\n'), 'utf8');
  return at;
}

/**
 * Derives the tracker path for a plan file: `PLAN.md` → `PLAN_TRACKER.md`,
 * `PLAN-foo.md` → `PLAN_TRACKER-foo.md`. Keeping one tracker per plan lets
 * several plans coexist without clobbering each other's progress.
 */
export function trackerPathFor(planPath: string): string {
  return planPath.replace(/PLAN(-[^/]*)?\.md$/, (_m, stub: string | undefined) => `PLAN_TRACKER${stub ?? ''}.md`);
}
