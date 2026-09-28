/**
 * The checklist edit every epic command makes on an issue body: the three
 * pure line edits, and the read, write and re-read that carries one of
 * them onto GitHub with the retry a concurrent edit gets.
 *
 * An epic's body stores intent, and its ordered `- [ ] #<n>` checklist is
 * the one part rafa writes itself (`./epic-body.ts`,
 * `.rafa/specs/rafa-246-epic-lifecycle.md`): `rafa epic move` takes a
 * member's line out of one epic's body and puts it into another's,
 * `rafa epic new` adds the epic's line to the current board, and
 * `rafa pr merge` ticks a merged member's line. Titles and the prose of a
 * body are never rewritten, so each edit here changes the checklist lines
 * it names and keeps every other byte of the body, line breaks included.
 *
 * ## The three line edits
 *
 * Each is a pure function from a body to a body, and answers the body it
 * was handed, the same string, when there is nothing to do. The lines are
 * the ones {@link parseRoadmapBody} reads, so a `- [ ] #12` shown inside a
 * fenced block is not a line to any of them, and the body is cut with
 * {@link splitKeepingBreaks}, which keeps each separator beside its line:
 * a CRLF body comes back CRLF.
 *
 * - {@link removeLine} drops every line naming the issue, ticked or not,
 *   each with the break that ended it. A body that ended without a break
 *   still does, so dropping a body's last line drops the break before it
 *   as well: `removeLine(appendLine(body, n), n)` is `body` again.
 * - {@link appendLine} writes `- [ ] #<n> <why>` after the last checklist
 *   line, with that line's own indentation and bullet, or after the last
 *   line holding any text when the body has no checklist yet — which, for
 *   a body rendered from `./templates/epic.md`, is under its `Specs`
 *   heading. The new line takes the break of the line it follows, else
 *   the body's first break, else `\n`. A body naming the issue already
 *   is answered as it is, so a list never gains a duplicate.
 * - {@link tickLine} ticks every unticked line naming the issue, through
 *   `./roadmap-tick.ts`'s {@link tickRoadmapLines}, so an epic's tick and
 *   the roadmap's are one rule.
 *
 * ## Read, write, re-read
 *
 * {@link editChecklist} carries one edit onto one issue over a
 * {@link RoadmapBody}; `createGhRoadmapBody` in `./roadmap-tick.ts` is
 * the `gh api` pair, read and PATCH, and nothing here spells a second
 * one. An attempt reads the body, applies the edit, writes the result and
 * reads the body again. The edit is CONFIRMED when the re-read body needs
 * no edit — the edit applied to it answers it unchanged — and not when it
 * equals what was sent. The difference is somebody else's edit landing
 * between the write and the re-read: it keeps ours, so an equality check
 * would retry, find nothing left to do and report a line that moved as
 * `nothing-to-edit`.
 *
 * `gh` sends no conditional request and the issues API takes no
 * `If-Match`, so a body edited between the read and the write is a lost
 * update GitHub does not report. What it leaves is a re-read the edit
 * still changes, and that attempt is retried: the next one reads the body
 * afresh and edits whatever is there now, so the other edit's lines are
 * kept. A write or a read that failed is retried the same way, up to
 * {@link TICK_ATTEMPTS} attempts in all, the bound the roadmap tick
 * keeps, and never a further time.
 *
 * Each body answers one {@link ChecklistEditStatus}:
 *
 * | Status | When |
 * |---|---|
 * | `edited` | a write was made and the re-read confirmed it |
 * | `nothing-to-edit` | a read found the body needing no edit |
 * | `failed` | every attempt failed or went unconfirmed |
 *
 * `nothing-to-edit` after a failed attempt (`attempts` above 0) means an
 * earlier write may have landed after all; the body is right either way.
 * Nothing here throws for the board: the caller gets what happened, and
 * the one that posts a comment posts it for an `edited` body only.
 * {@link editChecklists} runs several edits one after another and answers
 * one result per body in the order handed, a failure on one body not
 * stopping the next; the order a move writes in is the caller's.
 */
import type { RoadmapBody } from './roadmap-tick.js';

import { describeValue, messageOf } from '../config-sections.js';

import { splitKeepingBreaks, TICK_ATTEMPTS, tickRoadmapLines } from './roadmap-tick.js';
import { parseRoadmapBody } from './roadmap.js';

/** What every failure this module reports opens with. */
const PREFIX = 'board epic checklist';

/** The indentation and bullet a checklist line opens with. */
const BULLET = /^\s*[-*+]\s+/u;

/** The bullet a new line takes when the body has no checklist line to copy. */
const DEFAULT_BULLET = '- ';

/** A line break as a body spells it. */
const LINE_BREAK = /\r\n|\n|\r/u;

/** The break a new line takes when the body spells none. */
const DEFAULT_BREAK = '\n';

/** One line of a split body, with the break that ended it; empty for the last. */
interface BodyPart {
  readonly text: string;
  readonly lineBreak: string;
}

/** `body` as its lines, each with its own break, so joining them is the body again. */
function partsOf(body: string): readonly BodyPart[] {
  const split = splitKeepingBreaks(body);
  const parts: BodyPart[] = [];
  for (let index = 0; index < split.length; index += 2) {
    parts.push({ text: split[index] ?? '', lineBreak: split[index + 1] ?? '' });
  }
  return parts;
}

/** The parts as one body. */
function joinParts(parts: readonly BodyPart[]): string {
  return parts.map((part) => part.text + part.lineBreak).join('');
}

/** `issue`, checked to be a positive whole number, for `member`. */
function checkedIssue(issue: number, member: string): number {
  if (!Number.isSafeInteger(issue) || issue < 1) {
    throw new TypeError(
      `${PREFIX}: ${member} refused issue number ${describeValue(issue)}, expected a positive whole number`,
    );
  }
  return issue;
}

/** Where, counting from 0, the checklist lines naming `issue` sit in `body`. */
function lineIndicesOf(body: string, issue: number): readonly number[] {
  return parseRoadmapBody(body)
    .filter((line) => line.issue === issue)
    .map((line) => line.lineNumber - 1);
}

/**
 * `body` without any checklist line naming `issue`, every other byte
 * kept; `body` itself when it has none. The module note holds the rule
 * for the last line's break.
 */
export function removeLine(body: string, issue: number): string {
  const indices = lineIndicesOf(body, checkedIssue(issue, 'removeLine'));
  if (indices.length === 0) return body;

  const parts = partsOf(body);
  const kept = parts.filter((_part, index) => !indices.includes(index));
  const endedBare = (parts.at(-1)?.lineBreak ?? '') === '';
  const last = kept.at(-1);
  if (!endedBare || last === undefined) return joinParts(kept);
  return joinParts([...kept.slice(0, -1), { text: last.text, lineBreak: '' }]);
}

/** The first break `body` spells, or `\n` when it spells none. */
function firstBreakOf(body: string): string {
  return LINE_BREAK.exec(body)?.[0] ?? DEFAULT_BREAK;
}

/** Where a new line goes: after the last line holding any text, when there is no checklist line. */
function lastTextIndex(parts: readonly BodyPart[]): number {
  let anchor = -1;
  parts.forEach((part, index) => {
    if (part.text.trim() !== '') anchor = index;
  });
  return anchor;
}

/**
 * `body` with `- [ ] #<issue> <why>` after its last checklist line, every
 * other byte kept; `body` itself when a line names `issue` already. The
 * module note holds where the line goes and which break it takes.
 */
export function appendLine(body: string, issue: number, why = ''): string {
  checkedIssue(issue, 'appendLine');
  if (LINE_BREAK.test(why)) {
    throw new TypeError(`${PREFIX}: appendLine refused a why spanning several lines: ${describeValue(why)}`);
  }
  if (lineIndicesOf(body, issue).length > 0) return body;

  const parts = partsOf(body);
  const lastLine = parseRoadmapBody(body).at(-1);
  const anchorIndex = lastLine === undefined
    ? lastTextIndex(parts)
    : lastLine.lineNumber - 1;
  const anchor = parts[anchorIndex];
  const bullet = lastLine === undefined
    ? DEFAULT_BULLET
    : BULLET.exec(anchor?.text ?? '')?.[0] ?? DEFAULT_BULLET;
  const trimmedWhy = why.trim();
  const text = trimmedWhy === ''
    ? `${bullet}[ ] #${String(issue)}`
    : `${bullet}[ ] #${String(issue)} ${trimmedWhy}`;

  if (anchor === undefined) return `${body}${text}`;
  if (anchor.lineBreak === '') return `${body}${firstBreakOf(body)}${text}`;
  return joinParts([
    ...parts.slice(0, anchorIndex + 1),
    { text, lineBreak: anchor.lineBreak },
    ...parts.slice(anchorIndex + 1),
  ]);
}

/** `body` with every unticked checklist line naming `issue` ticked, every other byte kept. */
export function tickLine(body: string, issue: number): string {
  return tickRoadmapLines(body, [checkedIssue(issue, 'tickLine')]).body;
}

/** One of the edits above with its issue bound: a body in, the edited body out. */
export type ChecklistEdit = (body: string) => string;

/** How one body's edit ended; the module note holds each. */
export type ChecklistEditStatus = 'edited' | 'nothing-to-edit' | 'failed';

/** What one body's edit came to, as the caller reports it. */
export interface ChecklistEditResult {
  /** The issue whose body was edited. */
  readonly issue: number;
  readonly status: ChecklistEditStatus;
  /** How many writes were made: 0 when none was needed, at most {@link TICK_ATTEMPTS}. */
  readonly attempts: number;
  /** What went wrong on the last attempt, for a warning. Empty unless the status is `failed`. */
  readonly problem: string;
}

/** A re-read the edit still changes, as a problem sentence. */
function unconfirmedProblem(issue: number): string {
  return `${PREFIX}: issue #${String(issue)} read back without the edit that was written,`
    + ' so somebody edited it in between';
}

/** One read, edit, write and re-read; answers the result, or the problem to retry on. */
async function attemptEdit(
  issue: number,
  edit: ChecklistEdit,
  board: RoadmapBody,
  attempt: number,
): Promise<ChecklistEditResult | string> {
  const answered: ChecklistEditResult = { issue, status: 'nothing-to-edit', attempts: attempt - 1, problem: '' };
  try {
    const before = await board.read(issue);
    const after = edit(before);
    if (after === before) return Object.freeze(answered);

    await board.write(issue, after);
    const reread = await board.read(issue);
    return edit(reread) === reread
      ? Object.freeze({ ...answered, status: 'edited' as const, attempts: attempt })
      : unconfirmedProblem(issue);
  } catch (error) {
    return messageOf(error);
  }
}

/**
 * Carries `options.edit` onto the body of issue `options.issue`, reading,
 * writing and re-reading, and retrying up to {@link TICK_ATTEMPTS}
 * attempts when the edit did not land; see the module note. Never throws
 * for the board.
 */
export async function editChecklist(options: {
  readonly issue: number;
  readonly edit: ChecklistEdit;
  readonly board: RoadmapBody;
}): Promise<ChecklistEditResult> {
  const { edit, board } = options;
  const issue = checkedIssue(options.issue, 'editChecklist');
  let problem = '';

  for (let attempt = 1; attempt <= TICK_ATTEMPTS; attempt += 1) {
    const outcome = await attemptEdit(issue, edit, board, attempt);
    if (typeof outcome !== 'string') return outcome;
    problem = outcome;
  }

  return Object.freeze({ issue, status: 'failed' as const, attempts: TICK_ATTEMPTS, problem });
}

/** One body to edit, and the edit. */
export interface ChecklistEditRequest {
  readonly issue: number;
  readonly edit: ChecklistEdit;
}

/**
 * Carries each edit onto its body one after another, answering one
 * result per body in the order handed; a failed body does not stop the
 * next. Never throws for the board.
 */
export async function editChecklists(options: {
  readonly edits: readonly ChecklistEditRequest[];
  readonly board: RoadmapBody;
}): Promise<readonly ChecklistEditResult[]> {
  let results: readonly ChecklistEditResult[] = [];
  for (const request of options.edits) {
    results = [...results, await editChecklist({ ...request, board: options.board })];
  }
  return Object.freeze(results);
}
