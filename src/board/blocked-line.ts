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
import type { RoadmapLine, RoadmapReadings, RoadmapSkip } from './roadmap.js';

import { blockedFaultMessage, hasSpecBlockedLabel, readBlockedBy, SPEC_BLOCKED_LABEL } from './blocked.js';
import { hasSpecReadyLabel, SPEC_READY_LABEL } from './readiness.js';
import { readRoadmapSkip, skipSentence } from './roadmap.js';

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
}

/** One reading, spelled and frozen. */
function blocked(
  issue: number,
  blockers: readonly number[],
  open: readonly number[],
  unread: readonly number[],
  fault: string | null,
): BlockedLine {
  return Object.freeze({
    issue,
    blockers: Object.freeze([...blockers]),
    open: Object.freeze([...open]),
    unread: Object.freeze([...unread]),
    fault,
  });
}

/** Each blocker of `read`, with what the board said of it, in line order. */
async function heldStates(
  blockers: readonly number[],
  states: BlockerStates,
): Promise<readonly { readonly id: number; readonly state: BlockerState }[]> {
  let held: readonly { id: number; state: BlockerState }[] = [];
  for (const id of blockers) {
    held = [...held, { id, state: await states(id) }];
  }
  return held;
}

/**
 * Why `issue` is blocked, or null when it is not: no `spec:blocked`
 * label, or every blocker closed. The module note holds the three
 * readings in the order they run and why a fault answers blocked.
 */
export async function readBlockedLine(
  issue: SpecIssue,
  states: BlockerStates,
): Promise<BlockedLine | null> {
  if (!hasSpecBlockedLabel(issue.labels)) return null;

  const read = readBlockedBy(issue.number, issue.body);
  if (read.kind !== 'blocked') {
    return blocked(issue.number, read.blockers, [], [], blockedFaultMessage(read));
  }

  const held = await heldStates(read.blockers, states);
  const open = held.filter((one) => one.state === 'OPEN').map((one) => one.id);
  const unread = held.filter((one) => one.state === null).map((one) => one.id);
  return open.length + unread.length === 0
    ? null
    : blocked(issue.number, read.blockers, open, unread, null);
}

/** `#24 (open), #26 (state not read)` — the blockers a sentence names. */
function nameBlockers(line: BlockedLine): string {
  return [
    ...line.open.map((id) => `#${String(id)} (open)`),
    ...line.unread.map((id) => `#${String(id)} (state not read)`),
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

/** What {@link plannableReadings} is built over. */
export interface PlannableReadingsOptions {
  /** Reads one issue by number; the walk's own memoised reader. */
  readonly issues: SpecIssueReader;
  /** The done and taken readings the walk already made. */
  readonly readings: RoadmapReadings;
}

/**
 * The three readings over one issue reader and the walk's own done and
 * taken readings, so a caller composes none of them itself.
 *
 * The blocker states go through the same reader
 * ({@link blockerStatesOf}), which is what keeps a blocked line's own
 * check to the reads the walk had already made wherever its blockers are
 * on the roadmap too.
 */
export function plannableReadings(options: PlannableReadingsOptions): PlannableReadings {
  const { issues, readings } = options;
  const states = blockerStatesOf(issues);

  return Object.freeze({
    skip: (line: RoadmapLine): Promise<RoadmapSkip | null> => readRoadmapSkip(line, readings),
    blocking: async (issue: number): Promise<BlockedLine | null> => readBlockedLine(await issues(issue), states),
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
