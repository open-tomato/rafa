/**
 * The hop rows of the state table: the five rows `./state.ts` reads only
 * when `NextSources.roadmap` (`./readings.ts`) is set, which `rafa next
 * --roadmap` sets (`.rafa/specs/rafa-247-rafa-next-roadmap.md`). Without
 * the key the table is the thirteen rows it always was, and none of
 * these is asked; `./state.ts` holds where each is read and why there.
 *
 * Like the rest of the table they decide over readings and do nothing
 * else: the hop reading comes off the board's walk
 * ({@link NextRoadmapReading.hop}, `./sources.ts`), the owner gate off
 * {@link NextRoadmapSources.ownerApproval}, and nothing here writes the
 * position or the hop record. What the `hop` and `home` actions write is
 * carried out as `NextState.hop`, a {@link NextHopStep}, on the
 * rows that propose them and on no other row.
 *
 * ## The five rows
 *
 * | {@link NextStateId} | Action | Matches |
 * | --- | --- | --- |
 * | `pr-owner-review` | none | the open pull request would merge, and the owner gate is neither `not-gated` nor `approved` |
 * | `away-ended` | `home` | a hop is away and its work ended: C closed, C's pull request open, or C's spec not ready |
 * | `hop-halt` | `home` | the one-hop decision for the line the walk answered is a halt |
 * | `hop-blocked` | `hop` | that decision is a hop to C's epic, and no hop is away |
 * | `hop-dry` | `hop` | the walked epic ran dry, a next `now` epic follows it, and no hop is away |
 *
 * Every row but `pr-owner-review` reads the board, and so is read on the
 * base branch alone, as rows 10 to 13 are (`./readings.ts`). A board
 * whose walk carries no `hop` key, one built without `roadmap`, answers
 * none of them.
 *
 * ## `pr-owner-review`: the owner gate
 *
 * Read after rows 5 and 6, so what reaches it is a pull request green
 * or with no check at all that merges: exactly what rows 7 and 8 would
 * merge. The gate (`src/pr/owner-approval.ts`) lets it through only as
 * `not-gated` or `approved`; `waiting`, `unresolved` and `unknown` answer
 * `none`, reading `waiting on #C (owner review)`, and a gate reading that
 * REJECTS is read as `unknown`, so a failed reading never lets a merge
 * through. C is the hop record's target when the record names this pull
 * request (its `pullRequest`, or the away target's open one); a pull
 * request no hop record names is named by its own number, since the
 * issue it closes is not read here.
 *
 * ## `away-ended`: the way home
 *
 * A blocker hop is away while the record reads `away`. Its work has
 * ended, and the row proposes `home`, once the walk read C
 * ({@link NextHopReading.target}) closed (closing `merged`) or with an
 * open pull request (closing `waiting`), or once the walk answered C as
 * the line and C carries no `spec:ready` and is not blocked (closing
 * `halted`): the readiness gate `plan create` runs would refuse it as it
 * would at home. C blocked in turn is `hop-halt`'s, with its chain.
 *
 * A DRY hop is away the same way. The epic it went to running dry in
 * turn ends it too (closing `halted`): a second dry hop would have
 * neither end at home, and the one-hop rule halts it and goes home.
 *
 * ## The hop rows
 *
 * `hop-halt` answers every halt the walk's decision carries, at home or
 * away, reading the decision's own sentence with its chain
 * (`halt: #H ← #C ← #B: …`, `hopDecisionSentence` in `./hop-chain.ts`)
 * and proposing `home`. `hop-blocked` answers a `hop` decision read at
 * home, reading the spec's log line (`hop from epic #e: #H blocked by
 * #C, in epic #f`). `hop-dry` answers a dry epic with a next `now` epic
 * when the move passes {@link oneHopAllows}, read from the dry epic with
 * home the position's own while it stands away, else the dry epic
 * itself, as `./sources.ts` reads H's place.
 *
 * The record a hop opens is homed at the position's `home`, so the next
 * turn's staleness check (`staleAgainst`, `./hop-record.ts`) follows it;
 * with no position file, at the walked board with no epic chosen, the
 * place a first `rafa switch` resolves as home.
 */
import type { HopDecision, HopHalt, HopMove } from './hop-chain.js';
import type { HopKind, HopRecord } from './hop-record.js';
import type { DryEpic, NextHopReading, NextRoadmapReading, NextRoadmapSources, NextWorld } from './readings.js';
import type { NextStateId, RowAnswer } from './state.js';
import type { NextNowEpic } from '../board/epic-walk.js';
import type { OwnerApproval } from '../pr/owner-approval.js';
import type { Place } from '../project/position.js';

import { samePlace } from '../board/place.js';
import { SPEC_READY_LABEL } from '../board/readiness.js';
import { messageOf } from '../config-sections.js';

import { hopDecisionSentence, oneHopAllows } from './hop-chain.js';
import { onBase } from './readings.js';

/** What the `hop` action writes as the record's own, less its state, pull request and start time. */
export interface HopOpening {
  readonly kind: HopKind;
  /** Where the hop comes back to: the position's home. */
  readonly home: Place;
  /** Where the hop leaves from: the place H was read, or the dry epic. */
  readonly from: Place;
  /** H; null on a dry hop. */
  readonly blocked: number | null;
  /** C; null on a dry hop. */
  readonly target: number | null;
  readonly targetEpic: number;
  readonly targetBoard: number;
}

/** What the `home` action closes the record as. */
export type HopClosing = 'waiting' | 'merged' | 'halted';

/** The `hop` action's step: the record it opens. */
export interface HopOut {
  readonly action: 'hop';
  readonly opening: HopOpening;
}

/** The `home` action's step: where home is, and why the hop ends. */
export interface HopHome {
  readonly action: 'home';
  readonly home: Place;
  readonly closing: HopClosing;
  /** The target's open pull request when the hop closes `waiting`, else null. */
  readonly pullRequest: number | null;
}

/** What `NextState.hop` carries on the rows that propose `hop` or `home`. */
export type NextHopStep = HopOut | HopHome;

/** The ids of the five hop rows, in the order the module note lists them. */
export type HopRowId = Extract<NextStateId, 'pr-owner-review' | 'away-ended' | 'hop-halt' | 'hop-blocked' | 'hop-dry'>;

/** The walk and its hop reading, on the base branch under a board that read one; else null. */
interface HopView {
  readonly reading: NextRoadmapReading;
  readonly hop: NextHopReading;
}

/** A sentence on one line: every run of whitespace a space. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** `#<n>`. */
function ref(issue: number): string {
  return `#${String(issue)}`;
}

/** `epic #40 on board #11`, or `board #11` with no epic chosen. */
export function placeText(place: Place): string {
  return place.epic === null
    ? `board ${ref(place.board)}`
    : `epic ${ref(place.epic)} on board ${ref(place.board)}`;
}

/** The dry form of the hop log line: `hop from epic #20: it ran dry, next \`now\` epic #30 on board #10`. */
export function dryHopSentence(dry: Pick<DryEpic, 'number'>, next: Pick<NextNowEpic, 'number' | 'board'>): string {
  return `hop from epic ${ref(dry.number)}: it ran dry, next \`now\` epic ${ref(next.number)} on board ${ref(next.board)}`;
}

/** The walk's hop reading, read only on the base branch; null off it or on a walk carrying none. */
async function hopView(world: NextWorld): Promise<HopView | null> {
  if (!onBase(world)) return null;
  const reading = await world.roadmap();
  return reading.hop === undefined
    ? null
    : { reading, hop: reading.hop };
}

/** The followed record while its hop is away, else null. */
function awayRecord(hop: NextHopReading): HopRecord | null {
  return hop.record?.state === 'away'
    ? hop.record
    : null;
}

/** Where a hop opened this turn comes back to; see the module note. */
function homeOf(view: HopView): Place {
  return view.hop.position?.home ?? { board: view.reading.roadmap, epic: null };
}

/** The `home` step's answer: `reading`, the proposal naming home, and the closing. */
function homeAnswer(id: HopRowId, reading: string, step: HopHome, issue: number | null): RowAnswer {
  return {
    id,
    action: 'home',
    reading,
    proposal: `go back home to ${placeText(step.home)}`,
    ...issue === null
      ? {}
      : { issue },
    ...step.pullRequest === null
      ? {}
      : { pullRequest: step.pullRequest },
    hop: Object.freeze(step),
  };
}

/** The gate for `pullRequest`, a rejection read as `unknown`; see the module note. */
async function readGate(roadmap: NextRoadmapSources, pullRequest: number): Promise<OwnerApproval> {
  try {
    return await roadmap.ownerApproval(pullRequest);
  } catch (error) {
    return {
      state: 'unknown',
      reason: `could not read the owner gate of ${ref(pullRequest)}: ${oneLine(messageOf(error))}`,
      owners: [],
    };
  }
}

/** C, when the hop record names `pullRequest` as its target's; null when no record does or the walk failed. */
async function waitingIssue(world: NextWorld, pullRequest: number): Promise<number | null> {
  let hop: NextHopReading | undefined;
  try {
    hop = (await world.roadmap()).hop;
  } catch {
    return null;
  }
  const record = hop?.record ?? null;
  if (record?.target === null || record === null) return null;
  const named = record.pullRequest === pullRequest || hop?.target?.pullRequest === pullRequest;
  return named
    ? record.target
    : null;
}

/**
 * `pr-owner-review`: the open pull request would merge and the owner gate
 * does not let it; see the module note. Asked only under `roadmap`.
 */
export async function readPrOwnerReview(world: NextWorld): Promise<RowAnswer | null> {
  const { roadmap } = world.sources;
  if (roadmap === undefined) return null;
  const open = await world.openPull();
  if (open === null || open.mergeable !== 'mergeable') return null;
  if (open.verdict !== 'green' && open.verdict !== 'none') return null;

  const pullRequest = open.summary.number;
  const gate = await readGate(roadmap, pullRequest);
  if (gate.state === 'not-gated' || gate.state === 'approved') return null;

  const issue = await waitingIssue(world, pullRequest);
  return {
    id: 'pr-owner-review',
    action: 'none',
    reading: `waiting on ${ref(issue ?? pullRequest)} (owner review)`,
    proposal: `leave ${ref(pullRequest)} to its owner's review, which rafa does not merge past: ${oneLine(gate.reason)}`,
    pullRequest,
    ...issue === null
      ? {}
      : { issue },
  };
}

/** `away-ended` for a dry hop: the epic it went to ran dry in turn. */
function dryEnded(view: HopView, record: HopRecord): RowAnswer | null {
  const { dryEpic, line } = view.reading;
  if (line !== null || dryEpic === undefined) return null;
  const step: HopHome = { action: 'home', home: record.home, closing: 'halted', pullRequest: null };
  const reading = `epic ${ref(dryEpic.number)}, where the dry hop went, has no line left, and a second hop would leave home behind`;
  return homeAnswer('away-ended', reading, step, null);
}

/** `away-ended` for C open with no pull request: its spec not ready, and not blocked. */
async function notReadyEnded(world: NextWorld, record: HopRecord, target: number): Promise<RowAnswer | null> {
  const picked = await world.picked();
  if (picked === null || picked.line.issue !== target || picked.ready || picked.blocked !== null) return null;
  const step: HopHome = { action: 'home', home: record.home, closing: 'halted', pullRequest: null };
  const reading = `${ref(target)}, the hop's target in epic ${ref(record.targetEpic)}, carries no \`${SPEC_READY_LABEL}\`, so its spec is refused as not ready`;
  return homeAnswer('away-ended', reading, step, target);
}

/** `away-ended`: a hop is away and its work ended; see the module note. */
export async function readAwayEnded(world: NextWorld): Promise<RowAnswer | null> {
  const view = await hopView(world);
  const record = view === null
    ? null
    : awayRecord(view.hop);
  if (view === null || record === null) return null;
  if (record.kind === 'dry') return dryEnded(view, record);

  const target = view.hop.target;
  if (target === null) return null;
  const where = `${ref(target.issue)}, the hop's target in epic ${ref(record.targetEpic)}`;
  if (target.closed) {
    const step: HopHome = { action: 'home', home: record.home, closing: 'merged', pullRequest: null };
    return homeAnswer('away-ended', `${where}, is closed`, step, target.issue);
  }
  if (target.pullRequest !== null) {
    const step: HopHome = { action: 'home', home: record.home, closing: 'waiting', pullRequest: target.pullRequest };
    return homeAnswer('away-ended', `${where}, has pull request ${ref(target.pullRequest)} open`, step, target.issue);
  }
  return notReadyEnded(world, record, target.issue);
}

/** The walk's decision when it is of `kind`, else null. */
function decisionOf<K extends HopDecision['kind']>(view: HopView | null, kind: K): Extract<HopDecision, { kind: K }> | null {
  const decision = view?.hop.decision ?? null;
  return decision?.kind === kind
    ? decision as Extract<HopDecision, { kind: K }>
    : null;
}

/** `hop-halt`: the decision is a halt, printed with its chain; proposes `home`. */
export async function readHopHalt(world: NextWorld): Promise<RowAnswer | null> {
  const view = await hopView(world);
  const halt: HopHalt | null = decisionOf(view, 'halt');
  if (view === null || halt === null) return null;

  const home = view.hop.record?.home ?? view.hop.position?.home ?? halt.from;
  const step: HopHome = { action: 'home', home, closing: 'halted', pullRequest: null };
  return homeAnswer('hop-halt', hopDecisionSentence(halt), step, halt.chain.blocked);
}

/** `hop-blocked`: the decision is a hop to C's epic, read at home; proposes `hop`. */
export async function readHopBlocked(world: NextWorld): Promise<RowAnswer | null> {
  const view = await hopView(world);
  const move: HopMove | null = decisionOf(view, 'hop');
  if (view === null || move === null || awayRecord(view.hop) !== null) return null;

  const opening: HopOpening = {
    kind: 'blocker',
    home: homeOf(view),
    from: move.from,
    blocked: move.blocked,
    target: move.blocker,
    targetEpic: move.epic,
    targetBoard: move.board,
  };
  return {
    id: 'hop-blocked',
    action: 'hop',
    reading: hopDecisionSentence(move),
    proposal: `hop to ${placeText(move.to)} and work ${ref(move.blocker)}, keeping home`,
    issue: move.blocker,
    hop: Object.freeze({ action: 'hop', opening: Object.freeze(opening) }),
  };
}

/** Where a dry hop is read from, and home for the one-hop rule: as `./sources.ts` reads H's place. */
function dryPlaces(view: HopView, dry: DryEpic): { readonly from: Place; readonly home: Place } {
  const from: Place = { board: view.reading.roadmap, epic: dry.number };
  const { position } = view.hop;
  return {
    from,
    home: position === null || samePlace(position.current, position.home)
      ? from
      : position.home,
  };
}

/** `hop-dry`: the walked epic ran dry and a next `now` epic follows it; proposes `hop`. */
export async function readHopDry(world: NextWorld): Promise<RowAnswer | null> {
  const view = await hopView(world);
  if (view === null || awayRecord(view.hop) !== null) return null;
  const { dryEpic, line } = view.reading;
  const next = view.hop.nextEpic;
  if (line !== null || dryEpic === undefined || next === null) return null;

  const { from, home } = dryPlaces(view, dryEpic);
  const to: Place = { board: next.board, epic: next.number };
  if (!oneHopAllows(from, to, home)) return null;

  const opening: HopOpening = {
    kind: 'dry',
    home: homeOf(view),
    from,
    blocked: null,
    target: null,
    targetEpic: next.number,
    targetBoard: next.board,
  };
  return {
    id: 'hop-dry',
    action: 'hop',
    reading: dryHopSentence(dryEpic, next),
    proposal: `hop to ${placeText(to)}, keeping home`,
    hop: Object.freeze({ action: 'hop', opening: Object.freeze(opening) }),
  };
}
