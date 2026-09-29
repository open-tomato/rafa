/**
 * The blocker epic locator: for H, an issue of the home epic that the
 * walk reached blocked, and C, one of its blockers, the epic that holds C
 * and the board that epic sits on, or the reason `rafa next --roadmap`
 * cannot hop to it (`.rafa/specs/rafa-247-rafa-next-roadmap.md`).
 *
 * It reads; it writes neither the board, the position nor the hop record.
 * {@link locateBlockerEpic} reads ONE board listing handed in through a
 * {@link BoardView}, the one a turn already read, and lists nothing
 * again. The only thing it may ask is the view's default board thunk,
 * and only when `boardOfEpic` needs it; a thunk that rejects rejects the
 * locator with it, since a board it could not read is no answer.
 *
 * ## The epic that holds C
 *
 * Membership is the `epic:<slug>` label, read as `./epics.ts` reads it:
 * C is a member of every epic whose slug it carries, and an epic's slug is
 * its OWN first `epic:` label, on a row the listing types `epic`. Two
 * epic rows claiming one slug are a fault `./epic-problems.ts` names; the
 * lowest-numbered is taken here. When C carries the home epic's slug among
 * others, it is in H's epic, and that answer wins over any other slug: a
 * hop would leave an epic C is still a member of. Otherwise C's first
 * slug names its epic.
 *
 * ## The board that epic sits on
 *
 * `boardOfEpic` (`./epic-board.ts`), the pick `rafa switch <epic>` makes,
 * asked with home's board as the current one: home's board when it lists
 * the epic, then the default board, then the lowest-numbered open board.
 * `boardOfEpic` falls back to the default board even when that board
 * does not list the epic; the locator checks the board it answers really
 * lists it, open, and otherwise answers `no-open-board`.
 *
 * ## Why it cannot hop
 *
 * Checked in this order, the first that holds answering:
 *
 * ```text
 * cross-repository  C was named owner/repo#<n>: it is not on this listing
 * not-on-listing    C's number is not on the listing
 * no-epic-label     C carries no epic:<slug> label
 * same-epic         C carries the home epic's slug
 * no-epic           no epic row carries C's slug as its own
 * closed-epic       C's epic is closed
 * no-open-board     no open board's checklist lists C's epic
 * ```
 *
 * `not-on-listing` and `no-epic` are not waits the plan names; they are
 * what the listing can say, and answering them keeps the locator total.
 */
import type { BoardView } from './epic-board.js';
import type { BoardIssue } from './roadmap-board.js';
import type { Place } from '../project/position.js';

import { boardListsEpic, boardOfEpic } from './epic-board.js';
import { EPIC_LABEL_PREFIX, epicSlugsOf } from './epics.js';

/** Why C cannot be hopped to; see the module note for the order they are read in. */
export type NoHopReason =
  | 'cross-repository'
  | 'not-on-listing'
  | 'no-epic-label'
  | 'same-epic'
  | 'no-epic'
  | 'closed-epic'
  | 'no-open-board';

/** C, located: its epic and the board that epic sits on. */
export interface LocatedBlocker {
  readonly kind: 'located';
  /** C's issue number. */
  readonly blocker: number;
  /** The epic issue holding C. */
  readonly epic: number;
  /** That epic's slug, as C's label carries it. */
  readonly slug: string;
  /** The open board whose checklist lists the epic. */
  readonly board: number;
}

/** C, not hopped to, and why. */
export interface UnhoppableBlocker {
  readonly kind: 'no-hop';
  /** C as named: a local number, or `owner/repo#<n>` as written. */
  readonly blocker: number | string;
  readonly reason: NoHopReason;
  /** The epic holding C when one was found, else null. */
  readonly epic: number | null;
}

/** What {@link locateBlockerEpic} answers. */
export type BlockerEpic = LocatedBlocker | UnhoppableBlocker;

/** What {@link locateBlockerEpic} reads. */
export interface BlockerEpicRequest {
  /** C: a local issue number, or a foreign `owner/repo#<n>` token as `readBlockedBy` keeps it. */
  readonly blocker: number | string;
  /** Home: H's board and epic. */
  readonly home: Place;
  /** The turn's one listing and its default board. */
  readonly view: BoardView;
}

/** The sentence each reason is printed with, after `#<C>`. */
const REASON_SENTENCES: Readonly<Record<NoHopReason, string>> = Object.freeze({
  'cross-repository': 'is on another repository, which the board listing does not read',
  'not-on-listing': 'is not on the board listing',
  'no-epic-label': `carries no ${EPIC_LABEL_PREFIX}<slug> label, so no epic holds it`,
  'same-epic': 'is in the home epic, so there is no other epic to hop to',
  'no-epic': 'carries an epic label no epic issue owns',
  'closed-epic': 'is in a closed epic',
  'no-open-board': 'is in an epic no open board lists',
});

/** The sentence saying why `answer` was not hopped to. */
export function noHopSentence(answer: UnhoppableBlocker): string {
  const name = typeof answer.blocker === 'number'
    ? `#${String(answer.blocker)}`
    : answer.blocker;
  const epic = answer.epic === null
    ? ''
    : ` (epic #${String(answer.epic)})`;
  return `${name}${epic} ${REASON_SENTENCES[answer.reason]}`;
}

/** The lowest-numbered epic row whose own first slug is `slug`, or undefined. */
function epicOfSlug(slug: string, listing: readonly BoardIssue[]): BoardIssue | undefined {
  return listing
    .filter((row) => row.type === 'epic' && epicSlugsOf(row.labels)[0] === slug)
    .sort((a, b) => a.number - b.number)[0];
}

/** A frozen no-hop answer. */
function noHop(blocker: number | string, reason: NoHopReason, epic: number | null = null): UnhoppableBlocker {
  return Object.freeze({ kind: 'no-hop', blocker, reason, epic });
}

/** The epic holding C and its board, or why C cannot be hopped to; see the module note. */
export async function locateBlockerEpic(request: BlockerEpicRequest): Promise<BlockerEpic> {
  const { blocker, home, view } = request;
  if (typeof blocker === 'string') return noHop(blocker, 'cross-repository');
  const row = view.rows.get(blocker);
  if (row === undefined) return noHop(blocker, 'not-on-listing');
  const slugs = epicSlugsOf(row.labels);
  if (slugs.length === 0) return noHop(blocker, 'no-epic-label');

  const epics = slugs.map((slug) => ({ slug, epic: epicOfSlug(slug, view.listing) }));
  if (home.epic !== null && epics.some(({ epic }) => epic?.number === home.epic)) {
    return noHop(blocker, 'same-epic', home.epic);
  }
  const [first] = epics;
  if (first?.epic === undefined) return noHop(blocker, 'no-epic');
  const { slug, epic } = first;
  if (epic.state === 'CLOSED') return noHop(blocker, 'closed-epic', epic.number);

  const board = await boardOfEpic(epic.number, home, view);
  if (!boardListsEpic(board, epic.number, view)) return noHop(blocker, 'no-open-board', epic.number);
  return Object.freeze({ kind: 'located', blocker, epic: epic.number, slug, board });
}
