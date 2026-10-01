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
 * ## The mode
 *
 * Which epic holds C is a relationship, read through the board's
 * relationships port (`./relations/port.ts`) in the mode
 * `board.relationships` names, {@link BlockerEpicRequest.relations};
 * left out, the mode is `labels` (`LABELS_READS`,
 * `./relations/labels.ts`), which is what every caller before the port
 * read. The locator reads no label and no body line itself.
 *
 * C arrives as `labels` mode's `readBlockedBy` keeps it, a local number
 * or a foreign `owner/repo#<n>` token, or as `native` mode's `blockedBy`
 * node, a port {@link RelatedIssue}: a node whose `repository` is null
 * is this board's issue and read like a local number, and one naming a
 * repository is located there, answered `cross-repository` and named
 * `owner/name#<n>` from the node. The board listing is this repository's
 * alone, so a foreign C's epic is never read; a foreign `#7` is never
 * this board's `#7`.
 *
 * ## The epic that holds C
 *
 * The port's `epicOf` answers C's epic. In `labels` mode that is the
 * `epic:<slug>` label, read as `./epics.ts` reads it: C is a member of
 * every epic whose slug it carries, and an epic's slug is its OWN first
 * `epic:` label, on a row the listing types `epic`. Two epic rows
 * claiming one slug are a fault `./epic-problems.ts` names; the
 * lowest-numbered is taken here, the first owner the port names. When C
 * carries the home epic's slug among others, it is in H's epic, and that
 * answer wins over any other slug: a hop would leave an epic C is still a
 * member of. Otherwise C's first slug names its epic. In `native` mode it
 * is C's `parent`, one per issue, which holds C when it is an epic row on
 * the listing.
 *
 * A C the listing types `epic` is its own epic in both modes: working on
 * it is working in it. The port reads an epic row as in no epic, so the
 * locator answers it before asking. In `labels` mode an epic row with no
 * `epic:` label of its own is still `no-epic-label`, as it read before
 * the port.
 *
 * The located answer's `slug` is the epic's own, as `readEpics` reads
 * it: its first `epic:` label in `labels` mode, and null in `native`
 * mode, where an epic is named by its number.
 *
 * ## The board that epic sits on
 *
 * `boardOfEpic` (`./epic-board.ts`), the pick `rafa switch <epic>` makes,
 * asked with home's board as the current one: home's board when it lists
 * the epic, then the default board, then the lowest-numbered open board.
 * `boardOfEpic` falls back to the default board even when that board
 * does not list the epic; the locator checks the board it answers really
 * lists it, open, and otherwise answers `no-open-board`. A board's
 * checklist is its roadmap, not a relationship, so it is read in both
 * modes.
 *
 * ## Why it cannot hop
 *
 * Checked in this order, the first that holds answering; the two
 * `native` reasons stand where their `labels` counterparts do, so each
 * mode's sentence names the mark it reads:
 *
 * ```text
 * cross-repository  C is on another repository: it is not on this listing
 * not-on-listing    C's number is not on the listing
 * no-epic-label     labels: C carries no epic:<slug> label
 * no-parent         native: C has no parent
 * same-epic         C is in the home epic
 * no-epic           labels: no epic row carries C's slug as its own
 * parent-not-epic   native: C's parent is no epic row on the listing
 * closed-epic       C's epic is closed
 * no-open-board     no open board's checklist lists C's epic
 * ```
 *
 * `not-on-listing`, `no-epic` and `parent-not-epic` are not waits the
 * plan names; they are what the listing can say, and answering them
 * keeps the locator total.
 */
import type { BoardView } from './epic-board.js';
import type { EpicRelations } from './epics.js';
import type { RelatedIssue } from './relations/port.js';
import type { BoardIssue } from './roadmap-board.js';
import type { Place } from '../project/position.js';

import { boardListsEpic, boardOfEpic } from './epic-board.js';
import { readEpics } from './epics.js';
import { LABELS_READS } from './relations/labels.js';

/** Why C cannot be hopped to; see the module note for the order they are read in. */
export type NoHopReason =
  | 'cross-repository'
  | 'not-on-listing'
  | 'no-epic-label'
  | 'no-parent'
  | 'same-epic'
  | 'no-epic'
  | 'parent-not-epic'
  | 'closed-epic'
  | 'no-open-board';

/** C, located: its epic and the board that epic sits on. */
export interface LocatedBlocker {
  readonly kind: 'located';
  /** C's issue number. */
  readonly blocker: number;
  /** The epic issue holding C. */
  readonly epic: number;
  /** That epic's own slug in `labels` mode; null in `native` mode. See the module note. */
  readonly slug: string | null;
  /** The open board whose checklist lists the epic. */
  readonly board: number;
}

/** C, not hopped to, and why. */
export interface UnhoppableBlocker {
  readonly kind: 'no-hop';
  /** C as named: a local number, or `owner/repo#<n>` as written or as its node names it. */
  readonly blocker: number | string;
  readonly reason: NoHopReason;
  /** The epic holding C when one was found, else null. */
  readonly epic: number | null;
}

/** What {@link locateBlockerEpic} answers. */
export type BlockerEpic = LocatedBlocker | UnhoppableBlocker;

/** What {@link locateBlockerEpic} reads. */
export interface BlockerEpicRequest {
  /**
   * C: a local issue number or a foreign `owner/repo#<n>` token, as
   * `readBlockedBy` keeps it, or a port blocker, as a `native`
   * `blockedBy` node names it. See the module note.
   */
  readonly blocker: number | string | RelatedIssue;
  /** Home: H's board and epic. */
  readonly home: Place;
  /** The turn's one listing and its default board. */
  readonly view: BoardView;
  /** The board's relationships, which read C's epic; `labels` mode when left out. */
  readonly relations?: EpicRelations;
}

/** The sentence each reason is printed with, after `#<C>`. */
const REASON_SENTENCES: Readonly<Record<NoHopReason, string>> = Object.freeze({
  'cross-repository': 'is on another repository, which the board listing does not read',
  'not-on-listing': 'is not on the board listing',
  'no-epic-label': 'carries no epic:<slug> label, so no epic holds it',
  'no-parent': 'has no parent issue, so no epic holds it',
  'same-epic': 'is in the home epic, so there is no other epic to hop to',
  'no-epic': 'carries an epic label no epic issue owns',
  'parent-not-epic': 'has a parent that is no epic issue on the board listing',
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

/** C as the answer names it: this board's number, or `owner/name#<n>` for another repository's. */
function nameOf(blocker: number | string | RelatedIssue): number | string {
  if (typeof blocker !== 'object') return blocker;
  return blocker.repository === null
    ? blocker.number
    : `${blocker.repository}#${String(blocker.number)}`;
}

/**
 * The epics C's marks name, each as its lowest-numbered owner or
 * undefined for none, in the order the board holds the marks; C itself
 * when it is an epic row, unless `labels` mode reads it with no slug of
 * its own. See the module note.
 */
function epicsNamedBy(row: BoardIssue, listing: readonly BoardIssue[], relations: EpicRelations): readonly (number | undefined)[] {
  if (row.type === 'epic') {
    return relations.mode === 'labels' && slugOf(row.number, listing, relations) === null
      ? []
      : [row.number];
  }
  const epic = relations.read(listing).epicOf(row);
  if (epic.kind === 'none') return [];
  if (epic.kind === 'epic') return [epic.epic];
  return epic.marks.map((mark) => mark.owners[0]);
}

/** Epic `number`'s own slug as `readEpics` reads it in `relations`' mode, or null. */
function slugOf(number: number, listing: readonly BoardIssue[], relations: EpicRelations): string | null {
  return readEpics({ issues: listing, claims: new Set(), today: new Date(0), relations }).epics
    .find((epic) => epic.number === number)?.slug ?? null;
}

/** A frozen no-hop answer. */
function noHop(blocker: number | string, reason: NoHopReason, epic: number | null = null): UnhoppableBlocker {
  return Object.freeze({ kind: 'no-hop', blocker, reason, epic });
}

/** The epic holding C and its board, or why C cannot be hopped to; see the module note. */
export async function locateBlockerEpic(request: BlockerEpicRequest): Promise<BlockerEpic> {
  const { home, view } = request;
  const relations = request.relations ?? LABELS_READS;
  const native = relations.mode === 'native';
  const blocker = nameOf(request.blocker);
  if (typeof blocker === 'string') return noHop(blocker, 'cross-repository');
  const row = view.rows.get(blocker);
  if (row === undefined) return noHop(blocker, 'not-on-listing');
  const owners = epicsNamedBy(row, view.listing, relations);
  if (owners.length === 0) return noHop(blocker, native
    ? 'no-parent'
    : 'no-epic-label');

  if (home.epic !== null && owners.includes(home.epic)) return noHop(blocker, 'same-epic', home.epic);
  const epic = owners[0] === undefined
    ? undefined
    : view.rows.get(owners[0]);
  if (epic === undefined) return noHop(blocker, native
    ? 'parent-not-epic'
    : 'no-epic');
  if (epic.state === 'CLOSED') return noHop(blocker, 'closed-epic', epic.number);

  const board = await boardOfEpic(epic.number, home, view);
  if (!boardListsEpic(board, epic.number, view)) return noHop(blocker, 'no-open-board', epic.number);
  const slug = slugOf(epic.number, view.listing, relations);
  return Object.freeze({ kind: 'located', blocker, epic: epic.number, slug, board });
}
