/**
 * The readings `ghNextBoard` (`./sources.ts`) walks the board with that
 * read a RELATIONSHIP between issues: a line's `Blocked by:` reading and
 * its labels, the walk down a board or inside one epic, the pick that
 * passes waiting lines under `roadmap`, and the hop's decision and next
 * `now` epic. `./sources.ts` wires them over its one `gh` runner, its
 * memoised issue reader and its one listing; nothing here spawns a
 * process or reads a config, and every reading is the one that module
 * composed before they were split out of it.
 *
 * What each reading answers, and when it is read at all, is the module
 * note of `./sources.ts`: its "Where the walk starts", "The hop, under
 * `roadmap`" and "The mode" sections are the authority, and the TSDoc
 * below points at them rather than saying it twice.
 *
 * Every relationship is asked of the board's relationships port
 * (`src/board/relations/port.ts`) the readings are handed: `blocking`
 * through `blockingOf`, an epic's lines through `readEpics` and
 * `epicLines`, the hop through `decideHop` and `nextNowEpic`. Left out,
 * each reads `labels` mode, what every reading read before the port.
 * {@link pickerFor} chooses how the walk picks among lines, and it is
 * the one place a reading here differs by mode: in `native` mode no
 * line is left for the `unblock` row of `./state.ts`.
 */
import type { HopDecision, TakenReadings } from './hop-chain.js';
import type { HopRecord } from './hop-record.js';
import type { DryEpic, HopTarget, NextBoard, NextHopReading, TakenBlocker, WaitingLine } from './readings.js';
import type { BlockedLine, BlockerWaiting } from '../board/blocked-line.js';
import type { BoardView } from '../board/epic-board.js';
import type { EpicDescentSeams } from '../board/epic-walk.js';
import type { EpicRelations } from '../board/epics.js';
import type { SpecIssueReader } from '../board/issue.js';
import type { BoardListing } from '../board/roadmap-board.js';
import type { RoadmapLine, RoadmapReadings } from '../board/roadmap.js';
import type { Place, Position } from '../project/position.js';

import { blockingOf } from '../board/blocked-line.js';
import { descendRoadmap, epicLines, nextNowEpic } from '../board/epic-walk.js';
import { readEpics } from '../board/epics.js';
import { samePlace } from '../board/place.js';
import { hasSpecReadyLabel } from '../board/readiness.js';
import { parseRoadmapBody, pickNextRoadmapLine } from '../board/roadmap.js';
import { messageOf } from '../config-sections.js';
import { readPositionFile } from '../project/position.js';

import { decideHop, takenBy } from './hop-chain.js';
import { readHopRecord, staleAgainst } from './hop-record.js';

/** What a defect here names, being `rafa next`'s own walk. */
const PREFIX = 'rafa next';

/**
 * The two readings over a line's issue, both off `issues`: `blocking`,
 * what it waits on with each blocker's state, and `isReady`, its
 * `spec:ready` label. `blocking` is `blockingOf`'s in the mode `waiting`
 * names: left out, or in `labels` mode, the `Blocked by:` line read off
 * the memoised reader, costing no `gh issue view` beyond the walk's own;
 * in `native` mode the `blockedBy` nodes of the line's row on `waiting`'s
 * listing. See `./sources.ts`'s module note.
 */
export function blockedLineReadings(issues: SpecIssueReader, waiting?: BlockerWaiting): Pick<NextBoard, 'blocking' | 'isReady'> {
  return {
    blocking: blockingOf(waiting === undefined
      ? { issues }
      : { issues, waiting }),
    isReady: async (issue: number): Promise<boolean> => hasSpecReadyLabel((await issues(issue)).labels),
  };
}

/** What one walk answers: the line it picked, how many lines it passed, and the epic it ran dry in. */
export interface WalkAnswer {
  readonly line: RoadmapLine | null;
  readonly passed: number;
  readonly dry: DryEpic | null;
  /** The epic the line was read in: the place's, or the one walked into; null when none. */
  readonly epic: number | null;
  /** The lines passed as waiting; always empty without `roadmap`. */
  readonly waiting: readonly WaitingLine[];
}

/** What a pick over one list of lines answers. */
export interface LinePick {
  readonly line: RoadmapLine | null;
  readonly passed: number;
  readonly waiting: readonly WaitingLine[];
}

/**
 * How the walk picks among lines: `pickNextRoadmapLine` alone, or passing
 * waiting or blocked lines too. `epic` is the epic the lines are read in,
 * null for a board's own checklist, which the `native` pick under
 * `roadmap` reads the hop at.
 */
export type LinePicker = (lines: readonly RoadmapLine[], readings: RoadmapReadings, epic: number | null) => Promise<LinePick>;

/** `pickNextRoadmapLine`, as every walk without `roadmap` picks. */
export const plainPick: LinePicker = async (lines, readings) => {
  const pick = await pickNextRoadmapLine(lines, readings);
  return { line: pick.line, passed: pick.skipped.length, waiting: [] };
};

/**
 * The blockers `blocked` waits on, each with what took it, when every open
 * or unread one is taken; else null. A `native` line held by a blocker on
 * another repository, or by a list `gh` stopped short of, is never
 * waiting: nothing here can read whether those are taken.
 */
async function everyBlockerTaken(blocked: BlockedLine | null, readings: RoadmapReadings): Promise<readonly TakenBlocker[] | null> {
  if (blocked === null || blocked.fault !== null) return null;
  if (blocked.foreignOpen !== undefined || blocked.truncated !== undefined) return null;
  const held = blocked.blockers.filter((id) => blocked.open.includes(id) || blocked.unread.includes(id));
  if (held.length === 0) return null;
  let taken: readonly TakenBlocker[] = [];
  for (const issue of held) {
    const by = await takenBy(issue, readings);
    if (by === null) return null;
    taken = [...taken, Object.freeze({ issue, taken: Object.freeze(by) })];
  }
  return Object.freeze(taken);
}

/** What a picker makes of the line `pickNextRoadmapLine` answered: stop at it, pass it, or pass it as waiting. */
type LineVerdict =
  | { readonly kind: 'stop' }
  | { readonly kind: 'pass' }
  | { readonly kind: 'wait'; readonly blockers: readonly TakenBlocker[] };

/** Reads the verdict on one line, in the epic the lines are read in. */
type LineJudge = (line: RoadmapLine, readings: RoadmapReadings, epic: number | null) => Promise<LineVerdict>;

const STOP: LineVerdict = Object.freeze({ kind: 'stop' });
const PASS: LineVerdict = Object.freeze({ kind: 'pass' });

/** A pick walking on past every line `judge` passes, each counted in `passed` and a waiting one named. */
function passingPick(judge: LineJudge): LinePicker {
  const pick = async (lines: readonly RoadmapLine[], readings: RoadmapReadings, epic: number | null, before: LinePick): Promise<LinePick> => {
    const next = await pickNextRoadmapLine(lines, readings);
    const passed = before.passed + next.skipped.length;
    if (next.line === null) return { line: null, passed, waiting: before.waiting };
    const verdict = await judge(next.line, readings, epic);
    if (verdict.kind === 'stop') return { line: next.line, passed, waiting: before.waiting };
    const waiting = verdict.kind === 'wait'
      ? [...before.waiting, Object.freeze({ line: next.line, blockers: verdict.blockers })]
      : before.waiting;
    return pick(lines.slice(lines.indexOf(next.line) + 1), readings, epic, { line: null, passed: passed + 1, waiting });
  };
  return (lines, readings, epic) => pick(lines, readings, epic, { line: null, passed: 0, waiting: [] });
}

/** The waiting verdict on `blocked`, or null when some blocker is free. */
async function waitingVerdict(blocked: BlockedLine | null, readings: RoadmapReadings): Promise<LineVerdict | null> {
  const blockers = await everyBlockerTaken(blocked, readings);
  return blockers === null
    ? null
    : { kind: 'wait', blockers };
}

/** A picker passing, as waiting, every line whose open blockers are all taken; see `./sources.ts`'s module note, "The hop, under `roadmap`". */
export function waitingPick(blocking: NextBoard['blocking']): LinePicker {
  return passingPick(async (line, readings) => await waitingVerdict(await blocking(line.issue), readings) ?? STOP);
}

/**
 * The `native` picker without `roadmap`: every blocked line passed,
 * counted in `passed`, since the tracker clears a blocker when it closes
 * and nothing is left to unblock; see `./sources.ts`'s module note,
 * "The mode".
 */
export function nativePick(blocking: NextBoard['blocking']): LinePicker {
  return passingPick(async (line) => await blocking(line.issue) === null
    ? STOP
    : PASS);
}

/**
 * The walk inside `epic` alone, whatever its horizon: its lines as
 * `epicLines` orders them, its members read in `relations`' mode, picked
 * with the roadmap's own readings. See `./sources.ts`'s module note,
 * "Where the walk starts".
 */
export async function walkEpic(
  epic: number,
  listing: BoardListing,
  readings: RoadmapReadings,
  picker: LinePicker,
  relations?: EpicRelations,
): Promise<WalkAnswer> {
  const rows = await listing();
  const read = readEpics({ issues: rows, claims: new Set(), today: new Date(0), relations }).epics
    .find((candidate) => candidate.number === epic);
  const row = rows.find((issue) => issue.number === epic);
  if (read === undefined || row === undefined) {
    throw new Error(`${PREFIX}: epic #${String(epic)}, the current place, is not on the board listing, so its members cannot be read`);
  }
  const pick = await picker(epicLines(read, row).lines, readings, epic);
  return {
    line: pick.line,
    passed: pick.passed,
    dry: pick.line === null
      ? { number: read.number, title: read.title }
      : null,
    epic,
    waiting: pick.waiting,
  };
}

/** The hop record as one turn follows it; see `./sources.ts`'s module note, "The hop, under `roadmap`". */
export interface FollowedHop {
  readonly record: HopRecord | null;
  readonly stale: HopRecord | null;
  readonly position: Position | null;
  readonly problems: readonly string[];
}

/** The position and the hop record under `root`, the record kept only when the position's home is its home. */
export function followHopRecord(root: string | undefined): FollowedHop {
  if (root === undefined) return { record: null, stale: null, position: null, problems: [] };
  const placed = readPositionFile(root);
  const position = placed.set
    ? placed.position
    : null;
  const hop = readHopRecord(root);
  if (!hop.set) {
    const problems = hop.reason === 'absent'
      ? []
      : [`${hop.detail}, so no hop is followed`];
    return { record: null, stale: null, position, problems };
  }
  return position === null || staleAgainst(hop.record, position)
    ? { record: null, stale: hop.record, position, problems: [] }
    : { record: hop.record, stale: null, position, problems: [] };
}

/** C, when `record` is a blocker hop still away; else null. */
export function awayTargetOf(record: HopRecord | null): number | null {
  if (record?.state !== 'away' || record.kind !== 'blocker') return null;
  return record.target;
}

/** The walk while a blocker hop is away: C alone, answered while it is open with no pull request. */
export async function walkTarget(record: HopRecord, target: number, readings: RoadmapReadings): Promise<{ walk: WalkAnswer; target: HopTarget }> {
  const closed = await readings.isClosed(target);
  const pullRequest = closed
    ? null
    : await readings.pullRequestFor(target);
  const line: RoadmapLine | null = closed || pullRequest !== null
    ? null
    : Object.freeze({ issue: target, ticked: false, why: '', lineNumber: 0 });
  return {
    walk: { line, passed: 0, dry: null, epic: record.targetEpic, waiting: [] },
    target: Object.freeze({ issue: target, closed, pullRequest }),
  };
}

/** Taken readings answering nothing taken: C is the away hop's own work, its branch included. */
const NOTHING_TAKEN: TakenReadings = Object.freeze({
  branchFor: () => null,
  pullRequestFor: () => Promise.resolve(null),
});

/** What the hop's decision and next epic are read over. */
export interface HopSeams {
  readonly blocking: NextBoard['blocking'];
  readonly readings: RoadmapReadings;
  readonly listing: BoardListing;
  readonly fallback: number;
  readonly roadmap: number;
  /** The board's relationships, which read C's epic, what C waits on and an epic's members; `labels` mode when left out. */
  readonly relations?: EpicRelations;
}

/** The turn's one listing as a {@link BoardView}, the default board already resolved. */
async function boardView(seams: HopSeams): Promise<BoardView> {
  const listing = await seams.listing();
  return {
    listing,
    rows: new Map(listing.map((row) => [row.number, row])),
    defaultBoard: () => Promise.resolve(seams.fallback),
  };
}

/** The decision for H read at `places.current`: the first of its open or unread blockers that is not a wait. */
async function decideAtHome(line: RoadmapLine, places: Pick<Position, 'current' | 'home'>, seams: HopSeams): Promise<HopDecision | null> {
  const blocked = await seams.blocking(line.issue);
  if (blocked === null || blocked.fault !== null) return null;
  const held = blocked.blockers.filter((id) => blocked.open.includes(id) || blocked.unread.includes(id));
  const view = await boardView(seams);
  let last: HopDecision | null = null;
  for (const blocker of held) {
    last = await decideHop({ blocked: line.issue, blocker, position: places, view, taken: seams.readings, relations: seams.relations });
    if (last.kind !== 'wait') return last;
  }
  return last;
}

/** The decision for the away target C when it is blocked: the record's own hop, read again from home. */
async function decideAway(record: HopRecord, target: number, seams: HopSeams): Promise<HopDecision | null> {
  if (record.blocked === null || await seams.blocking(target) === null) return null;
  return decideHop({
    blocked: record.blocked,
    blocker: target,
    position: { current: record.from, home: record.home },
    view: await boardView(seams),
    taken: NOTHING_TAKEN,
    relations: seams.relations,
  });
}

/** Where H was read, and home: the position's home while it stands away, else that same place. */
function placesOf(epic: number | null, roadmap: number, position: Position | null): Pick<Position, 'current' | 'home'> {
  const current: Place = { board: roadmap, epic };
  const away = position !== null && !samePlace(position.current, position.home);
  return {
    current,
    home: away
      ? position.home
      : current,
  };
}

/** What one turn's hop reading holds but the record and position already read. */
export type HopAnswer = Pick<NextHopReading, 'decision' | 'nextEpic'> & { readonly problems: readonly string[] };

/** The decision for the line the walk answered: C's own while away, H's at home, none without a line. */
async function decisionFor(walk: WalkAnswer, followed: FollowedHop, seams: HopSeams): Promise<HopDecision | null> {
  if (walk.line === null) return null;
  const target = awayTargetOf(followed.record);
  if (followed.record !== null && target !== null) return decideAway(followed.record, target, seams);
  return decideAtHome(walk.line, placesOf(walk.epic, seams.roadmap, followed.position), seams);
}

/** The decision for the line the walk answered and the next `now` epic after a dry one; a failed reading a problem. */
export async function readHopAnswer(walk: WalkAnswer, followed: FollowedHop, seams: HopSeams): Promise<HopAnswer> {
  try {
    const decision = await decisionFor(walk, followed, seams);
    const nextEpic = walk.dry === null
      ? null
      : await nextNowEpic({
        after: walk.dry.number,
        board: seams.roadmap,
        listing: await seams.listing(),
        readings: seams.readings,
        relations: seams.relations,
      });
    return { decision, nextEpic, problems: [] };
  } catch (error) {
    return { decision: null, nextEpic: null, problems: [`the hop could not be read, so none is proposed: ${messageOf(error)}`] };
  }
}

/**
 * The walk down `roadmap`'s checklist, descending into its first open
 * `now` epic: `pickDescendedLine`'s descent and pick, the pick made by
 * `picker`.
 */
export async function walkBoard(roadmap: number, seams: EpicDescentSeams, picker: LinePicker): Promise<WalkAnswer> {
  const read = await seams.issues(roadmap);
  const descent = await descendRoadmap(parseRoadmapBody(read.body), seams);
  const pick = await picker(descent.lines, seams.readings, descent.epic?.number ?? null);
  return {
    line: pick.line,
    passed: descent.passed.length + pick.passed,
    dry: descent.epic !== null && pick.line === null
      ? { number: descent.epic.number, title: descent.epic.title }
      : null,
    epic: descent.epic?.number ?? null,
    waiting: pick.waiting,
  };
}

/**
 * True when the hop rows of `./hop-rows.ts` take `line`, blocked, read in
 * `epic`: its decision at home is a halt, or a hop while no hop is away,
 * as `hop-halt` and `hop-blocked` answer them. A decision that could not
 * be read keeps the line too, so `readHopAnswer` carries its problem.
 */
async function hopRowsTake(line: RoadmapLine, epic: number | null, followed: FollowedHop, seams: HopSeams): Promise<boolean> {
  try {
    const decision = await decideAtHome(line, placesOf(epic, seams.roadmap, followed.position), seams);
    if (decision?.kind === 'halt') return true;
    return decision?.kind === 'hop' && followed.record?.state !== 'away';
  } catch {
    return true;
  }
}

/**
 * The `native` picker under `roadmap`: a line whose blockers are all
 * taken passed as waiting, as {@link waitingPick} passes it; any other
 * blocked line passed unless the hop rows take it; see `./sources.ts`'s
 * module note, "The mode".
 */
export function nativeHopPick(followed: FollowedHop, seams: HopSeams): LinePicker {
  return passingPick(async (line, readings, epic) => {
    const blocked = await seams.blocking(line.issue);
    if (blocked === null) return STOP;
    const waiting = await waitingVerdict(blocked, readings);
    if (waiting !== null) return waiting;
    return await hopRowsTake(line, epic, followed, seams)
      ? STOP
      : PASS;
  });
}

/**
 * The picker a turn walks with: {@link plainPick} or {@link nativePick}
 * without `roadmap`, {@link waitingPick} or {@link nativeHopPick} with
 * it (`followed` not null), by the mode `seams.relations` names, left out
 * `labels`.
 */
export function pickerFor(followed: FollowedHop | null, seams: HopSeams): LinePicker {
  const native = seams.relations?.mode === 'native';
  if (followed === null) {
    return native
      ? nativePick(seams.blocking)
      : plainPick;
  }
  return native
    ? nativeHopPick(followed, seams)
    : waitingPick(seams.blocking);
}
