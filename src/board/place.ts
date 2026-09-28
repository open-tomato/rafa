/**
 * The current place: where this checkout stands, as a (board, epic) pair,
 * and its home, read from the position file (`src/project/position.ts`)
 * and checked against ONE board listing (`./roadmap-board.ts`) the caller
 * has already read. Nothing here lists the board or spawns `gh`: the
 * listing is handed in, and the default board arrives through a seam asked
 * at most once, and only when an answer needs it.
 *
 * ## Which place
 *
 * {@link resolvePlace} answers the file's `current` and `home` when each
 * still stands. A place STANDS when:
 *
 * - its board is on the listing, open and labelled `type:roadmap`
 *   ({@link ROADMAP_LABEL}), or is the default board itself, which may be
 *   an unlabelled issue titled "Roadmap" or a `roadmap.issue` the listing
 *   does not hold; a CLOSED board never stands, the default included;
 * - its epic is null, or is on the listing, open and typed `epic` (the
 *   listing's own `type`, as `firstNowEpic` reads it). An epic need not
 *   be on its board's checklist: a switch to an epic no board lists moves
 *   with the default board.
 *
 * A place that does not stand is LOST, and each thing lost is named with
 * why: `closed`, `unlabelled` (a board without `type:roadmap`, an epic
 * without `type:epic`) or `missing` (not on the listing). A lost place
 * falls back; the file is not rewritten, since only a switch writes it.
 * `previous` is kept as read and never checked: only `rafa switch -`
 * reads it, and a switch checks its target.
 *
 * ## The fallback
 *
 * The FALLBACK is the default board and its first `now` epic that is not
 * done: the board's checklist, read off its listing row with
 * `parseRoadmapBody`, asked through `firstNowEpic`
 * (`src/commands/epics.ts`), the pick `rafa epics` makes with no number.
 * The epics are read with `readEpics` and no claims: a claim only tells
 * `in-progress` from `backlog`, never `done` from the rest, so the pick
 * is the same. A default board the listing does not hold has no
 * checklist to read, so its fallback epic is null and the notice says
 * why. The fallback is computed once and serves every slot that needs it.
 *
 * ## Notices
 *
 * Every answer carries its notices, each with the sentence a report
 * prints; the caller decides which to print.
 *
 * - `unset` — the file reads unset (`absent`, `unreadable`,
 *   `invalid-json` or `wrong-shape`), the sentence opening with the
 *   reader's own detail, which names the file. Current and home are then
 *   both the fallback. A project with no position file gets an `absent`
 *   notice too, so a caller keeping today's output filters that one out.
 * - `lost` — one per distinct lost place, naming each slot it held
 *   (`current`, `home`, or both when they were one place), each thing
 *   lost with why, and the fallback it fell to.
 *
 * ## gh calls
 *
 * None. The `defaultBoard` seam (`resolveDefaultBoard` in `./boards.ts`
 * behind a caller's closure) is asked only for the fallback and for a
 * board that is on the listing but unlabelled, or not on it at all, and
 * its rejection propagates as it came: a default board that cannot be
 * found is the caller's to refuse.
 */
import type { BoardIssue } from './roadmap-board.js';
import type { Place, Position, PositionUnsetReason } from '../project/position.js';

import { firstNowEpic } from '../commands/epics.js';
import { readPositionFile } from '../project/position.js';

import { readEpics } from './epics.js';
import { parseRoadmapBody } from './roadmap.js';
import { ROADMAP_LABEL } from './setup.js';

/** The slot of the position a lost place held. */
export type PlaceSlot = 'current' | 'home';

/** Why a board or an epic no longer stands. */
export type LossReason = 'closed' | 'unlabelled' | 'missing';

/** One thing a lost place lost. */
export interface PlaceLoss {
  readonly what: 'board' | 'epic';
  readonly number: number;
  readonly why: LossReason;
}

/** The default board and its first `now` epic not done; see the module note. */
export interface FallbackPlace {
  readonly place: Place;
  /** False when the listing does not hold the default board, so no checklist was read. */
  readonly boardListed: boolean;
}

/** A sentence the caller may print; see the module note. */
export type PlaceNotice =
  | {
    readonly kind: 'unset';
    readonly reason: PositionUnsetReason;
    readonly message: string;
  }
  | {
    readonly kind: 'lost';
    /** Every slot the lost place held, `current` first. */
    readonly slots: readonly PlaceSlot[];
    /** The place as the file held it. */
    readonly place: Place;
    /** The board first, then the epic, each only when lost. */
    readonly losses: readonly PlaceLoss[];
    readonly message: string;
  };

/** What {@link resolvePlace} answers. */
export interface ResolvedPlace {
  readonly current: Place;
  readonly home: Place;
  /** The position file as read, or null when it reads unset. */
  readonly position: Position | null;
  /** The fallback, when an answer needed it; null when the file's places both stand. */
  readonly fallback: FallbackPlace | null;
  readonly notices: readonly PlaceNotice[];
}

/** What {@link resolvePlace} reads. */
export interface PlaceOptions {
  /** The project root whose `.rafa/position.json` is read. */
  readonly root: string;
  /** The one board listing, already read. */
  readonly listing: readonly BoardIssue[];
  /** The default board's number, asked at most once; see the module note. */
  readonly defaultBoard: () => Promise<number>;
}

/** True when `left` and `right` are the same (board, epic) pair. */
export function samePlace(left: Place, right: Place): boolean {
  return left.board === right.board && left.epic === right.epic;
}

/** `thunk`, asked at most once. */
function once<T>(thunk: () => Promise<T>): () => Promise<T> {
  let answer: Promise<T> | null = null;
  return () => {
    answer ??= thunk();
    return answer;
  };
}

/** Why `board` does not stand, or null when it does. */
async function boardLoss(
  board: number,
  rows: ReadonlyMap<number, BoardIssue>,
  defaultBoard: () => Promise<number>,
): Promise<LossReason | null> {
  const row = rows.get(board);
  if (row?.state === 'CLOSED') return 'closed';
  if (row?.labels.includes(ROADMAP_LABEL) === true) return null;
  if (board === await defaultBoard()) return null;
  return row === undefined
    ? 'missing'
    : 'unlabelled';
}

/** Why `epic` does not stand, or null when it does. */
function epicLoss(epic: number, rows: ReadonlyMap<number, BoardIssue>): LossReason | null {
  const row = rows.get(epic);
  if (row === undefined) return 'missing';
  if (row.state === 'CLOSED') return 'closed';
  return row.type === 'epic'
    ? null
    : 'unlabelled';
}

/** Everything `place` lost, the board first; empty when it stands. */
async function lossesOf(
  place: Place,
  rows: ReadonlyMap<number, BoardIssue>,
  defaultBoard: () => Promise<number>,
): Promise<readonly PlaceLoss[]> {
  const board = await boardLoss(place.board, rows, defaultBoard);
  const epic = place.epic === null
    ? null
    : epicLoss(place.epic, rows);
  const losses: PlaceLoss[] = [];
  if (board !== null) losses.push({ what: 'board', number: place.board, why: board });
  if (epic !== null && place.epic !== null) losses.push({ what: 'epic', number: place.epic, why: epic });
  return Object.freeze(losses);
}

/** The fallback over `listing`; see the module note. */
async function fallbackOf(listing: readonly BoardIssue[], defaultBoard: () => Promise<number>): Promise<FallbackPlace> {
  const board = await defaultBoard();
  const row = listing.find((issue) => issue.number === board);
  if (row === undefined) return Object.freeze({ place: Object.freeze({ board, epic: null }), boardListed: false });
  const epics = readEpics({ issues: listing, claims: new Set(), today: new Date() });
  const epic = firstNowEpic(parseRoadmapBody(row.body), listing, epics)?.number ?? null;
  return Object.freeze({ place: Object.freeze({ board, epic }), boardListed: true });
}

/** `#<n>`. */
function id(number: number): string {
  return `#${String(number)}`;
}

/** How a sentence names `fallback`. */
export function fallbackPhrase(fallback: FallbackPlace): string {
  const { board, epic } = fallback.place;
  const named = `the default board ${id(board)}`;
  if (!fallback.boardListed) return `${named}, with no epic: the board listing does not hold ${id(board)}, so its checklist was not read`;
  return epic === null
    ? `${named}, with no epic: it names no now epic that is not done`
    : `${named} at epic ${id(epic)}`;
}

/** The label a thing lost as `unlabelled` lacks. */
function labelOf(what: PlaceLoss['what']): string {
  return what === 'board'
    ? ROADMAP_LABEL
    : 'type:epic';
}

/** How a sentence names one loss. */
function lossPhrase(loss: PlaceLoss): string {
  const why: Record<LossReason, string> = {
    closed: 'which is closed',
    unlabelled: `which does not carry ${labelOf(loss.what)}`,
    missing: 'which is not on the board listing',
  };
  return `${loss.what} ${id(loss.number)}, ${why[loss.why]}`;
}

/** How a sentence names the slots a lost place held. */
function slotsPhrase(slots: readonly PlaceSlot[]): string {
  if (slots.length === 2) return 'The current place and home';
  return slots[0] === 'home'
    ? 'Home'
    : 'The current place';
}

/** The sentence a `lost` notice prints. */
export function lostMessage(slots: readonly PlaceSlot[], losses: readonly PlaceLoss[], fallback: FallbackPlace): string {
  const lost = losses.map(lossPhrase).join(', and ');
  return `${slotsPhrase(slots)} lost ${lost}; falling back to ${fallbackPhrase(fallback)}`;
}

/** The sentence an `unset` notice prints, opening with the reader's `detail`. */
export function unsetMessage(detail: string, fallback: FallbackPlace): string {
  return `${detail}; the current place is ${fallbackPhrase(fallback)}`;
}

/** The answer for a file that reads unset. */
async function unsetPlace(
  reason: PositionUnsetReason,
  detail: string,
  fallback: () => Promise<FallbackPlace>,
): Promise<ResolvedPlace> {
  const fell = await fallback();
  const notice: PlaceNotice = Object.freeze({ kind: 'unset', reason, message: unsetMessage(detail, fell) });
  return Object.freeze({
    current: fell.place,
    home: fell.place,
    position: null,
    fallback: fell,
    notices: Object.freeze([notice]),
  });
}

/**
 * The current and home places, read from `options.root`'s position file
 * and checked against `options.listing`, each falling back as the module
 * note says, with a notice for every fallback. Never reads the listing
 * itself; rejects only when `options.defaultBoard` does.
 */
export async function resolvePlace(options: PlaceOptions): Promise<ResolvedPlace> {
  const { root, listing } = options;
  const defaultBoard = once(options.defaultBoard);
  const fallback = once(() => fallbackOf(listing, defaultBoard));
  const reading = readPositionFile(root);
  if (!reading.set) return unsetPlace(reading.reason, reading.detail, fallback);

  const { position } = reading;
  const rows = new Map(listing.map((issue) => [issue.number, issue]));
  const oneSlot = samePlace(position.current, position.home);
  const currentLosses = await lossesOf(position.current, rows, defaultBoard);
  const homeLosses = oneSlot
    ? currentLosses
    : await lossesOf(position.home, rows, defaultBoard);

  const notices: PlaceNotice[] = [];
  const answer = async (slots: readonly PlaceSlot[], place: Place, losses: readonly PlaceLoss[]): Promise<Place> => {
    if (losses.length === 0) return place;
    const fell = await fallback();
    notices.push(Object.freeze({
      kind: 'lost',
      slots: Object.freeze([...slots]),
      place,
      losses,
      message: lostMessage(slots, losses, fell),
    }));
    return fell.place;
  };

  const current = await answer(oneSlot
    ? ['current', 'home']
    : ['current'], position.current, currentLosses);
  const home = oneSlot
    ? current
    : await answer(['home'], position.home, homeLosses);
  const needed = currentLosses.length > 0 || homeLosses.length > 0;
  return Object.freeze({
    current,
    home,
    position,
    fallback: needed
      ? await fallback()
      : null,
    notices: Object.freeze(notices),
  });
}
