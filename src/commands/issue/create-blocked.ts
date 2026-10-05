/**
 * The `Blocked by:` line of a spec `rafa issue create` files: read
 * through `readBlockedBy` (`src/board/blocked.ts`), turned into the
 * draft's `specBlocked` on a `blocked` reading, and refused, the fault
 * named, on any other reading that names a line at all.
 *
 * Only a draft of type `spec` is read, as the spec template is the one
 * that carries the field. A spec whose body holds no `Blocked by:` line
 * (`no-line`) is filed as it is, with no mark: nothing here sets
 * `specBlocked: false` either, so such a draft is the draft the flags
 * made. Every other draft type is never read, whatever its body says.
 *
 * ## Two readings, the first before the chain
 *
 * {@link readSpecLine} reads the body alone, with no board, before the
 * tracker chain is resolved. It refuses `no-ids` there — `Blocked by:
 * the API work` names nothing the board could hold, and no listing
 * changes that — so such a line reads no config and runs no preflight.
 *
 * {@link settleSpecLine} reads it again on the tracker the chain landed
 * on, with the board's numbers, and refuses the two faults only a board
 * can tell: `self-reference` and `unknown-issue`. Both happen before
 * `create` is called, so a refusal files nothing.
 *
 * ## The board's numbers
 *
 * {@link readBoardNumbers} asks the tracker's `find` for every issue it
 * holds, open and closed alike, up to {@link KNOWN_LIST_LIMIT}: the
 * `github` adapter lists `--state all` (`adapters/tracker/github.ts`),
 * and `local` every issue file it can read. A closed issue is still an
 * issue the board has: a blocker is cleared by being closed, and calling
 * a closed one unknown is the false report `src/commands/doctor-blocked.ts`
 * reads `--state all` to avoid. A listing that rejects refuses the
 * command, naming the tracker, as any other tracker call does.
 *
 * A new issue has no number until it is filed, so "the line names the
 * issue it sits in" is read against the number the issue would take:
 * one past the highest number the board answered, or 1 on an empty
 * board. That is the number the `local` adapter gives. On GitHub it is
 * the lowest number the issue can take, since pull requests share the
 * sequence and are not in the listing; a higher number is not on the
 * board either, so an id past the board's highest is refused in every
 * case, as a `self-reference` when it is that number and as an
 * `unknown-issue` otherwise.
 *
 * ## An id is checked only when the whole board was read
 *
 * A listing that comes back holding {@link KNOWN_LIST_LIMIT} issues may
 * be a prefix of the board, and an id past its end is not an unknown
 * issue but one this run did not read; `local`'s listing is oldest first,
 * so its highest number may be missing too. The same holds for a tracker
 * that answered an id that is not an issue number: its numbering is not
 * the one a `#<n>` names. In both cases no id is checked against the
 * board and no number is predicted: the line is read without `known`,
 * so only `no-ids` refuses it, the spec is filed with `specBlocked`, and
 * {@link SpecLineSettled.unchecked} carries the sentence saying why,
 * which `create` writes at `warn`. That is `doctor-blocked.ts`'s rule,
 * for the same reason.
 *
 * ## The fault sentence
 *
 * `blockedFaultMessage` speaks of a filed issue by its number and says
 * to take the `spec:blocked` label off, and neither fits an issue that
 * is not filed yet; {@link specLineFault} names the line, what is wrong
 * with it and the remedy for the body instead.
 */
import type { BlockedReading } from '../../board/blocked.js';
import type { IssueDraft, Tracker } from '../../ports/index.js';

import { BLOCKED_BY_FIELD, readBlockedBy } from '../../board/blocked.js';
import { CommandExit } from '../../cli/command.js';

import { onTracker } from './issue-tracker.js';

/**
 * How many issues the board listing asks for. `gh issue list` honours
 * a limit above 100, as `OPEN_ISSUES_LIMIT` in
 * `adapters/tracker/github.ts` records.
 */
export const KNOWN_LIST_LIMIT = 1000;

/** The issue number the body-only reading is made for: no `#<n>` names it. */
const UNFILED = 0;

/** What a refusal tells the author to do about the line. */
const REMEDY = `name the issues it waits on as "${BLOCKED_BY_FIELD}: #24 #26", or take the line out`;

/** The board's issue numbers, as {@link readBoardNumbers} read them. */
export interface BoardNumbers {
  /** Every number the board answered, or undefined when no id can be checked against them. */
  readonly known: ReadonlySet<number> | undefined;
  /** The number the issue would be filed as, or {@link UNFILED} when it cannot be told. */
  readonly next: number;
  /** Why no id is checked against the board; null when every one is. */
  readonly unchecked: string | null;
}

/** What {@link settleSpecLine} came to. */
export interface SpecLineSettled {
  /** The draft to file: the one handed over, `specBlocked: true` when the line read as `blocked`. */
  readonly draft: IssueDraft;
  /** Why the line's ids were not checked against the board; null when they were or there was no line. */
  readonly unchecked: string | null;
}

/** `#24 #26`, the way a sentence names a list of ids. */
function nameIds(ids: readonly number[]): string {
  return ids.map((id) => `#${String(id)}`).join(' ');
}

/** What is wrong with a line, before the remedy. */
function faultClause(read: BlockedReading): string {
  if (read.kind === 'no-ids' && read.foreign.length > 0) {
    return `names only issues on other repositories: ${read.foreign.join(' ')}`;
  }
  if (read.kind === 'no-ids') return `names no issue: "${read.text ?? ''}"`;
  if (read.kind === 'self-reference') {
    return `names #${String(read.issue)}, the number this issue would be filed as`;
  }
  return `names ${nameIds(read.unknown)}, which the board has no issue for`;
}

/**
 * The sentence a refused line is named with: where it sits, what is
 * wrong with it, and what to do. Throws a `TypeError` for a `blocked`
 * or a `no-line` reading, neither of which is refused.
 */
export function specLineFault(read: BlockedReading): string {
  if (read.kind === 'blocked' || read.kind === 'no-line') {
    throw new TypeError(`issue create: a ${read.kind} reading of the "${BLOCKED_BY_FIELD}:" line has no fault to name`);
  }
  return `The spec's "${BLOCKED_BY_FIELD}:" line, line ${String(read.line ?? 0)} of the body, `
    + `${faultClause(read)}: ${REMEDY}`;
}

/** A refusal with exit code 1 naming the fault; nothing is filed. */
function faultRefusal(read: BlockedReading): CommandExit {
  return new CommandExit(1, `❌ ${specLineFault(read)}`);
}

/**
 * The body-only reading of a spec draft's `Blocked by:` line, or null
 * when the draft is not a spec or its body carries no line; a refusal
 * with exit code 1 for a line naming no local `#<n>`. See the module
 * note.
 */
export function readSpecLine(draft: IssueDraft): BlockedReading | null {
  if (draft.type !== 'spec') return null;
  const read = readBlockedBy(UNFILED, draft.body);
  if (read.kind === 'no-line') return null;
  if (read.kind === 'no-ids') throw faultRefusal(read);
  return read;
}

/** The issue numbers `ids` hold, or null when one of them is not a positive whole number in decimal. */
function issueNumbers(ids: readonly string[]): readonly number[] | null {
  const numbers: number[] = [];
  for (const id of ids) {
    if (!/^[1-9]\d*$/u.test(id)) return null;
    const number = Number(id);
    if (!Number.isSafeInteger(number)) return null;
    numbers.push(number);
  }
  return numbers;
}

/** The numbers when none can be checked, and the sentence saying why. */
function uncheckedNumbers(why: string): BoardNumbers {
  return { known: undefined, next: UNFILED, unchecked: `${why}, so no "${BLOCKED_BY_FIELD}:" id was checked against it` };
}

/**
 * Every issue number `tracker` holds, open and closed, and the number a
 * new issue would take there; a refusal with exit code 1 when the
 * listing rejects. See the module note.
 */
export async function readBoardNumbers(tracker: Pick<Tracker, 'kind' | 'find'>): Promise<BoardNumbers> {
  const refs = await onTracker(tracker, 'list the board\'s issues', () => tracker.find({ limit: KNOWN_LIST_LIMIT }));
  if (refs.length >= KNOWN_LIST_LIMIT) {
    return uncheckedNumbers(`the ${tracker.kind} tracker answered the ${String(KNOWN_LIST_LIMIT)} issues the listing asked for and may hold more`);
  }

  const numbers = issueNumbers(refs.map((ref) => ref.externalId));
  if (numbers === null) {
    return uncheckedNumbers(`the ${tracker.kind} tracker answered an issue id that is not an issue number`);
  }
  return { known: new Set(numbers), next: Math.max(0, ...numbers) + 1, unchecked: null };
}

/**
 * The draft to file once `read`, the body-only reading
 * {@link readSpecLine} answered, is read again against `tracker`'s
 * board: `specBlocked: true` on a `blocked` reading, a refusal with exit
 * code 1 naming a `self-reference` or an `unknown-issue`. See the module
 * note.
 */
export async function settleSpecLine(
  draft: IssueDraft,
  tracker: Pick<Tracker, 'kind' | 'find'>,
): Promise<SpecLineSettled> {
  const board = await readBoardNumbers(tracker);
  const read = readBlockedBy(board.next, draft.body, board.known);
  if (read.kind !== 'blocked') throw faultRefusal(read);
  return { draft: { ...draft, specBlocked: true }, unchecked: board.unchecked };
}
