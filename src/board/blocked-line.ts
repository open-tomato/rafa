/**
 * A blocked line in the `--next` walk: the `spec:blocked` reading of the
 * issue the roadmap points at, and the first line after it that is
 * ready, not blocked and not taken.
 *
 * `./blocked.ts` reads ONE body — the label, the `Blocked by: #24 #26`
 * line and the four faults it refuses to guess at — and knows nothing of
 * the board or of the roadmap. `./roadmap.ts` walks the roadmap's lines
 * and knows nothing of blocking. This module is the join, and it is what
 * `plan create --next` consults when the line its walk picked turns out
 * to be waiting on something
 * (`.rafa/specs/rafa-63-one-command-next-step.md`).
 *
 * Nothing here spawns, prints or asks. Every reading arrives through a
 * seam ({@link PlannableReadings}), the sentences are pure functions of
 * what was read, and whether an operator says yes is the caller's
 * ({@link AlternativeOffer}, filled by
 * `src/commands/plan/blocked-offer.ts`). So every case in
 * `./blocked-line.test.ts` is a literal issue and a planted reading.
 *
 * ## What makes a line blocked, and what does not
 *
 * Three things have to hold, in this order, and the first that does not
 * answers "not blocked" — the line is planned exactly as it was before
 * this module existed:
 *
 *  1. the issue carries `spec:blocked`. The LABEL is what a person set,
 *     and a body carrying a `Blocked by:` line without it is not a claim
 *     that the work waits (`./blocked.ts`);
 *  2. its `Blocked by:` line reads. One of the four faults is blocked
 *     too, with the fault sentence in place of the blockers — see below;
 *  3. some blocker is still OPEN, or its state was not read. Every
 *     blocker closed is the work the label waited for, done: the line is
 *     plannable and `rafa issue unblock` is what takes the label off.
 *
 * A blocker whose state this run could not read counts as NOT cleared
 * and is named `#26 (state not read)`, the wording `rafa issue unblock`
 * uses for the same reading. Counting an unreadable blocker as closed
 * would plan work over a dependency nobody checked, which is the silent
 * failure the whole reading exists to avoid.
 *
 * ## The mode
 *
 * What a line waits on is a relationship, read through the board's
 * relationships port (`./relations/port.ts`) in the mode
 * `board.relationships` names: {@link blockedLineOf} turns the port's
 * `blockersOf` reading into a {@link BlockedLine}, in either mode, and
 * the port's `isWaiting` is what answers "not blocked".
 *
 * In `labels` mode, the default and what the three readings above spell,
 * {@link readBlockedLine} asks the `labels` adapter's own reading
 * (`labelsBlockersOf`, `./relations/labels.ts`) for the label, the line
 * and its fault, and fills each blocker's state from the walk's
 * {@link BlockerStates}, as it did before the port: that reader also
 * reads a blocker older than the board listing, which the listing's own
 * rows would answer as not read.
 *
 * In `native` mode the line's issue is read off the one board listing
 * the caller holds ({@link BlockerWaiting}), and what it waits on is its
 * `blockedBy` nodes, each with the state GitHub holds for it: no
 * `spec:blocked` label, `Blocked by:` line or per-blocker read is asked,
 * and {@link blockerStatesOf} is not used. So:
 *
 *  - a blocker closed as `NOT_PLANNED` is closed, and clears the line as
 *    one closed as done does;
 *  - a blocker on another repository still open holds the line, and is
 *    named `owner/name#7 (open)` from {@link BlockedLine.foreignOpen};
 *  - a `blockedBy` list `gh` stopped short of holds the line whatever
 *    the nodes read, and names the rest as not read, from
 *    {@link BlockedLine.truncated};
 *  - an issue the listing does not hold is a fault
 *    ({@link notOnListingMessage}): its links were not read, and a line
 *    whose waiting nobody read is not one that waits on nothing.
 *
 * Both keys are left out, never set to undefined, when there is nothing
 * to say, so a `labels` reading never carries them.
 *
 * ## A fault is blocked, and is reported rather than resolved
 *
 * An issue labelled `spec:blocked` whose line is missing, names itself
 * or names an id the board has no issue for is REPORTED and never
 * guessed at (`./blocked.ts`). Here that means: the label stands, so the
 * line is blocked, and {@link blockedLineSentence} says what is wrong
 * with it in `blockedFaultMessage`'s own words instead of naming
 * blockers there are none of. Nothing is cleared and no label moves —
 * planning the line anyway would be the guess, and so would skipping it
 * silently.
 *
 * ## What the walk that follows looks for
 *
 * {@link pickPlannableLine} walks on from the blocked line and answers
 * the first that is ready, not blocked and not taken — the spec's three
 * words, read as three readings:
 *
 * | Word | Reading |
 * |---|---|
 * | not taken | `./roadmap.ts`'s own done and taken readings, whole |
 * | not blocked | {@link readBlockedLine} over the line's issue |
 * | ready | the `spec:ready` label (`./readiness.ts`) |
 *
 * READY is the one the ordinary walk does not ask, and it is asked here
 * because of what the answer is FOR: the ordinary walk stops at its line
 * and the operator is offered the label on it
 * (`src/commands/plan/ready-offer.ts`), while this walk names an issue
 * nobody typed and asks for one yes to plan it. An issue that yes cannot
 * plan without a second question is not the one to name, so a line
 * carrying no `spec:ready` is passed over here and stays exactly where
 * it is on the roadmap for the run that reaches it in order.
 *
 * Every line passed is carried out in {@link PlannablePick.passed} with
 * the sentence that says why, so the caller prints the walk rather than
 * jumping from a blocked line to a number with nothing in between.
 */
import type { SpecIssue, SpecIssueReader } from './issue.js';
import type {
  Blocker,
  BlockersReading,
  BoardRelations,
  RelatedIssue,
  RelationsReading,
  Truncation,
} from './relations/port.js';
import type { BoardIssue, BoardListing } from './roadmap-board.js';
import type { RoadmapLine, RoadmapReadings, RoadmapSkip } from './roadmap.js';

import { SPEC_BLOCKED_LABEL } from './blocked.js';
import { hasSpecReadyLabel, SPEC_READY_LABEL } from './readiness.js';
import { labelsBlockersOf } from './relations/labels.js';
import { isWaiting } from './relations/port.js';
import { readRoadmapSkip, skipSentence } from './roadmap.js';

/** No listing: the `labels` reading of one issue asks its blockers' states of the walk's reader instead. */
const NO_ROWS: ReadonlyMap<number, Pick<BoardIssue, 'state'>> = new Map();

/** What the board holds a blocker as, or null when this run read no state for it. */
export type BlockerState = 'OPEN' | 'CLOSED' | null;

/** One blocker's state, asked of the board. */
export type BlockerStates = (issue: number) => Promise<BlockerState>;

/**
 * The states over the issue reader a walk already has, so a blocker that
 * is itself a roadmap line costs nothing (`./spec-source.ts` memoises
 * the reader for the length of one resolution).
 *
 * A read that FAILS answers null rather than throwing: an id the board
 * has no issue for, or a `gh` that could not answer, is a blocker whose
 * state was not read, which {@link readBlockedLine} counts as not
 * cleared and names as such. The module note holds why that is the safe
 * direction.
 */
export function blockerStatesOf(issues: SpecIssueReader): BlockerStates {
  return async (issue: number): Promise<BlockerState> => {
    try {
      return (await issues(issue)).state;
    } catch {
      return null;
    }
  };
}

/** One roadmap line's `spec:blocked` reading, when the line is blocked. */
export interface BlockedLine {
  /** The issue the roadmap line points at. */
  readonly issue: number;
  /** Every id its `Blocked by:` line named, in line order; empty on a fault. */
  readonly blockers: readonly number[];
  /** The named ids the board still holds open, in line order. */
  readonly open: readonly number[];
  /** The named ids this run read no state for, in line order. */
  readonly unread: readonly number[];
  /** The fault its line was reported with, or null when the line read. */
  readonly fault: string | null;
  /**
   * The blockers on another repository still open, in the order `gh`
   * answered them. `native` mode only, and only when there is one; left
   * out otherwise.
   */
  readonly foreignOpen?: readonly RelatedIssue[];
  /**
   * GitHub's count of the blockers, kept when `gh` answered fewer, whose
   * rest were not read. `native` mode only; left out otherwise.
   */
  readonly truncated?: Truncation;
}

/** One reading, spelled and frozen; `extra` holds the native keys that are present. */
function blocked(
  issue: number,
  lists: Pick<BlockedLine, 'blockers' | 'open' | 'unread'>,
  fault: string | null,
  extra: Pick<BlockedLine, 'foreignOpen' | 'truncated'> = {},
): BlockedLine {
  return Object.freeze({
    issue,
    blockers: Object.freeze([...lists.blockers]),
    open: Object.freeze([...lists.open]),
    unread: Object.freeze([...lists.unread]),
    fault,
    ...extra,
  });
}

/** The keys a `native` reading adds, each kept only when it has something to say. */
function nativeExtra(
  foreign: readonly Blocker[],
  truncated: Truncation | undefined,
): Pick<BlockedLine, 'foreignOpen' | 'truncated'> {
  const open = foreign
    .filter((blocker) => blocker.state === 'OPEN')
    .map((blocker): RelatedIssue => Object.freeze({ number: blocker.number, repository: blocker.repository }));
  return {
    ...open.length === 0
      ? {}
      : { foreignOpen: Object.freeze(open) },
    ...truncated === undefined
      ? {}
      : { truncated: Object.freeze({ total: truncated.total }) },
  };
}

/**
 * The line the port's `reading` comes to, in either mode, or null when
 * it does not hold its issue back (`isWaiting`, `./relations/port.ts`).
 * A fault is blocked with its sentence and the ids its line named; a
 * blocked reading names this board's blockers still open and not read,
 * in the reading's order, and the module note holds the two keys a
 * `native` reading may add.
 */
export function blockedLineOf(reading: BlockersReading): BlockedLine | null {
  if (reading.kind === 'none') return null;
  if (reading.kind === 'fault') {
    return blocked(reading.issue, { blockers: reading.line.blockers, open: [], unread: [] }, reading.message);
  }
  if (!isWaiting(reading)) return null;

  const local = reading.blockers.filter((blocker) => blocker.repository === null);
  const idsOf = (state: BlockerState): readonly number[] => local
    .filter((blocker) => blocker.state === state)
    .map((blocker) => blocker.number);
  return blocked(
    reading.issue,
    { blockers: local.map((blocker) => blocker.number), open: idsOf('OPEN'), unread: idsOf(null) },
    null,
    nativeExtra(reading.blockers.filter((blocker) => blocker.repository !== null), reading.truncated),
  );
}

/** `reading` with each of this board's blockers' state asked of `states`, one at a time, in its order. */
async function withStates(reading: BlockersReading, states: BlockerStates): Promise<BlockersReading> {
  if (reading.kind !== 'blocked') return reading;
  let held: readonly Blocker[] = [];
  for (const blocker of reading.blockers) {
    const state = blocker.repository === null
      ? await states(blocker.number)
      : blocker.state;
    held = [...held, Object.freeze({ ...blocker, state })];
  }
  return Object.freeze({ ...reading, blockers: Object.freeze(held) });
}

/**
 * Why `issue` is blocked in `labels` mode, or null when it is not: no
 * `spec:blocked` label, or every blocker closed. The module note holds
 * the three readings in the order they run, why a fault answers blocked,
 * and why each state is asked of `states` rather than of a listing.
 */
export async function readBlockedLine(
  issue: SpecIssue,
  states: BlockerStates,
): Promise<BlockedLine | null> {
  return blockedLineOf(await withStates(labelsBlockersOf(issue, NO_ROWS), states));
}

/** `#24 (open), owner/name#7 (open), #26 (state not read)` — the blockers a sentence names. */
function nameBlockers(line: BlockedLine): string {
  return [
    ...line.open.map((id) => `#${String(id)} (open)`),
    ...(line.foreignOpen ?? []).map((one) => `${one.repository ?? ''}#${String(one.number)} (open)`),
    ...line.unread.map((id) => `#${String(id)} (state not read)`),
    ...line.truncated === undefined
      ? []
      : [`the rest of its ${String(line.truncated.total)} blockers (state not read)`],
  ].join(', ');
}

/**
 * What a blocked line is named with: `#57 is blocked by #24 (open)`, the
 * spec's own wording, or the fault sentence when its line does not read.
 */
export function blockedLineSentence(line: BlockedLine): string {
  return line.fault ?? `#${String(line.issue)} is blocked by ${nameBlockers(line)}`;
}

/** Why a line the walk after a blocked one passed is not the one offered. */
export type PassedReason = 'skipped' | 'blocked' | 'not-ready';

/** One line passed over on the way to the alternative, and why. */
export interface PassedLine {
  /** The line passed. */
  readonly line: RoadmapLine;
  /** Which reading passed it. */
  readonly reason: PassedReason;
  /** What that reading said, as the caller prints it. */
  readonly sentence: string;
}

/** The three readings {@link pickPlannableLine} asks of a line, cheapest first. */
export interface PlannableReadings {
  /** Done and taken, `./roadmap.ts`'s own reading of one line. */
  readonly skip: (line: RoadmapLine) => Promise<RoadmapSkip | null>;
  /** Why the line's issue is blocked, or null when it is not. */
  readonly blocking: (issue: number) => Promise<BlockedLine | null>;
  /** Whether the line's issue carries `spec:ready`. */
  readonly isReady: (issue: number) => Promise<boolean>;
}

/**
 * The part of the relationships port (`./relations/port.ts`) the
 * waiting reading asks: the mode, and the reads over one listing. A
 * whole `BoardRelations`, as `selectBoardRelations` makes it, is one.
 */
export type BlockerRelations = Pick<BoardRelations, 'mode' | 'read'>;

/** The port, and the one board listing a `native` reading reads its rows off. */
export interface BlockerWaiting {
  /** The board's relationships, whose mode picks the reading. */
  readonly relations: BlockerRelations;
  /** The board listing, read in `native` mode only, and read through at most once per listing it answers. */
  readonly listing: BoardListing;
}

/** What {@link blockingOf} is built over. */
export interface BlockingOptions {
  /** Reads one issue by number; the walk's own memoised reader. */
  readonly issues: SpecIssueReader;
  /** The port and the listing; `labels` mode, over `issues` alone, when left out. */
  readonly waiting?: BlockerWaiting;
}

/** The fault an issue the `native` listing does not hold is blocked with. */
export function notOnListingMessage(issue: number): string {
  return `#${String(issue)} is not on the board listing, so its blocked-by links were not read;`
    + ' it is held back rather than planned over a dependency nobody checked';
}

/** The `native` reading of one issue, off the listing `waiting` answers; the module note holds the reading. */
function nativeBlocking(waiting: BlockerWaiting): (issue: number) => Promise<BlockedLine | null> {
  let read: { readonly rows: readonly BoardIssue[]; readonly reading: RelationsReading } | null = null;
  return async (issue: number): Promise<BlockedLine | null> => {
    const rows = await waiting.listing();
    if (read?.rows !== rows) read = { rows, reading: waiting.relations.read(rows) };
    const row = rows.find((candidate) => candidate.number === issue);
    return row === undefined
      ? blocked(issue, { blockers: [], open: [], unread: [] }, notOnListingMessage(issue))
      : blockedLineOf(read.reading.blockersOf(row));
  };
}

/**
 * Why the issue numbered is blocked, or null when it is not, in the mode
 * `options.waiting` names; the module note holds both. In `labels` mode,
 * and when `waiting` is left out, the listing is never asked and the
 * blocker states go through the same reader ({@link blockerStatesOf}),
 * which keeps a blocked line's own check to the reads the walk had
 * already made wherever its blockers are on the roadmap too.
 */
export function blockingOf(options: BlockingOptions): (issue: number) => Promise<BlockedLine | null> {
  const { issues, waiting } = options;
  if (waiting?.relations.mode === 'native') return nativeBlocking(waiting);
  const states = blockerStatesOf(issues);
  return async (issue: number): Promise<BlockedLine | null> => readBlockedLine(await issues(issue), states);
}

/** What {@link plannableReadings} is built over. */
export interface PlannableReadingsOptions extends BlockingOptions {
  /** The done and taken readings the walk already made. */
  readonly readings: RoadmapReadings;
}

/**
 * The three readings over one issue reader and the walk's own done and
 * taken readings, so a caller composes none of them itself. Whether a
 * line is blocked is {@link blockingOf}'s, in the mode `options.waiting`
 * names.
 */
export function plannableReadings(options: PlannableReadingsOptions): PlannableReadings {
  const { issues, readings } = options;

  return Object.freeze({
    skip: (line: RoadmapLine): Promise<RoadmapSkip | null> => readRoadmapSkip(line, readings),
    blocking: blockingOf(options),
    isReady: async (issue: number): Promise<boolean> => hasSpecReadyLabel((await issues(issue)).labels),
  });
}

/** The sentence a line carrying no `spec:ready` label is passed over with. */
export function notReadySentence(issue: number): string {
  return `#${String(issue)} not ready: it carries no ${SPEC_READY_LABEL} label`;
}

/** The first line that can be offered, and every line passed to reach it. */
export interface PlannablePick {
  /** The answer, or null when no line after the blocked one qualifies. */
  readonly line: RoadmapLine | null;
  /** Every line passed before it, in order, each with its reason. */
  readonly passed: readonly PassedLine[];
}

/** Why `line` is passed over, or null when it is the answer. */
async function passOf(line: RoadmapLine, readings: PlannableReadings): Promise<PassedLine | null> {
  const skip = await readings.skip(line);
  if (skip !== null) return { line, reason: 'skipped', sentence: skipSentence(skip) };

  const waiting = await readings.blocking(line.issue);
  if (waiting !== null) return { line, reason: 'blocked', sentence: blockedLineSentence(waiting) };

  return await readings.isReady(line.issue)
    ? null
    : { line, reason: 'not-ready', sentence: notReadySentence(line.issue) };
}

/**
 * The first line AFTER `after` that is ready, not blocked and not taken,
 * with every line passed to reach it and why.
 *
 * `after` is the blocked line the ordinary walk stopped at, and the walk
 * resumes at the line under it — the roadmap's order is kept, and the
 * only line the order is broken for is the one an operator says yes to.
 *
 * Where it resumes is read off {@link RoadmapLine.lineNumber} and not
 * off the object's identity, so a caller that parsed the body a second
 * time is answered the same as one passing the walk's own line back. A
 * line the body does not hold starts the walk at the top, where the
 * blocked line passes itself as blocked, so no caller is answered the
 * line it asked about.
 */
export async function pickPlannableLine(
  lines: readonly RoadmapLine[],
  after: RoadmapLine,
  readings: PlannableReadings,
): Promise<PlannablePick> {
  let passed: readonly PassedLine[] = [];

  const from = lines.findIndex((line) => line.lineNumber === after.lineNumber) + 1;
  for (const line of lines.slice(from)) {
    const over = await passOf(line, readings);
    if (over === null) return Object.freeze({ line, passed: Object.freeze(passed) });
    passed = [...passed, over];
  }

  return Object.freeze({ line: null, passed: Object.freeze(passed) });
}

/** What an offer is handed: the line that is blocked, and the one offered instead. */
export interface AlternativeOfferRequest {
  /** Why the roadmap's own next line cannot be planned. */
  readonly blocked: BlockedLine;
  /** The line offered in its place, as {@link pickPlannableLine} found it. */
  readonly line: RoadmapLine;
}

/**
 * Asks whether to plan the line offered instead, and answers whether the
 * answer was yes.
 *
 * Filled by `src/commands/plan/blocked-offer.ts`, which is where the
 * terminal and the prompter live; nothing in this module asks anything.
 * A run with nobody to ask is handed no offer at all and plans nothing,
 * which is {@link unaskedMessage}.
 */
export type AlternativeOffer = (request: AlternativeOfferRequest) => Promise<boolean>;

/** The question the line offered instead is named by number in. */
export function alternativeQuestion(issue: number): string {
  return `Plan #${String(issue)} instead? [y/N] `;
}

/** What a run naming no alternative at all says; the roadmap has nothing else to give. */
export function noAlternativeMessage(issue: number): string {
  const number = String(issue);
  return `no line under #${number} is ready, not blocked and not taken, so there is nothing to plan instead;`
    + ` take ${SPEC_BLOCKED_LABEL} off #${number} with rafa issue unblock ${number} once its blockers close`;
}

/** What a run with nobody to ask says about the alternative it found. */
export function unaskedMessage(issue: number, alternative: number): string {
  const number = String(alternative);
  return `#${number} takes a yes and this run has nobody to ask, so nothing was planned;`
    + ` plan it with rafa plan create --issue=${number},`
    + ` or clear #${String(issue)} with rafa issue unblock ${String(issue)}`;
}

/** What a run whose offer was declined says; the spec's "plans nothing without a yes". */
export function declinedMessage(alternative: number): string {
  return `#${String(alternative)} was not planned, and nothing was written`;
}
