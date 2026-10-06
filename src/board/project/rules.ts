/**
 * The project's field rules: facts in, values out, one pure function per
 * field of the GitHub project (`.rafa/specs/rafa-791-github-project-each-repository.md`).
 * Nothing here reads the network or the clock; every function takes its
 * facts as arguments, and `null` means "leave the field empty".
 *
 * ## Stage
 *
 * {@link stageOf} places an issue in one of the eleven
 * {@link STAGE_OPTIONS}, spelled exactly as the template names its
 * options, because the project is matched by name. The rightmost matching
 * column wins, so the checks run from the right:
 *
 * 1. closed as not planned or duplicate → Cancelled;
 * 2. closed otherwise (completed, or with no close reason) → In review
 *    while a merged pull request's shipping fragment is still on the base
 *    branch, else Done;
 * 3. open with a merged pull request — merged into an integration branch,
 *    since `Closes #n` closes an issue only from the default branch → In
 *    review when that pull request added a shipping fragment, else Done;
 * 4. a linked pull request open → Waiting for approval;
 * 5. the labels, rightmost first: `rafa:in-development`, `rafa:claimed`,
 *    `spec:blocked`, `spec:ready`, `spec:needs-work`, `needs-triage`;
 * 6. nothing → Backlog.
 *
 * A fragment with `level: none` is no fragment: nothing ships from it.
 * `rafa release settle` deletes each fragment it folds, so one still on
 * the base branch is merged and not yet released; for an open issue the
 * fragment sits on the integration branch, so where it is now is not read.
 * An epic (`type:epic`) gets no Stage; the Issues view leaves it out.
 *
 * ## Horizon
 *
 * {@link horizonOptionOf} places an epic in one of the five
 * {@link HORIZON_OPTIONS}, by the template's exact names: Cancelled when
 * closed as not planned or duplicate, Done when closed otherwise, else the
 * option its one `horizon:now|next|later` label names. An open epic whose
 * `horizon:` labels name no single known horizon — none, two or more, or
 * an unknown value — gets null, an empty field: `rafa roadmap` groups such
 * an epic under `later` (`horizonOf`, `../roadmap-epic-rows.ts`), but the
 * project shows no column it was not given, and `rafa doctor`'s epic
 * problems (`../epic-problems.ts`) name the fault. Only epics get a
 * Horizon; any other issue gets null.
 *
 * ## Progress
 *
 * {@link progressTextOf} writes an epic's `done / total` exactly as
 * `readEpics` (`../epics.ts`) counted it, in either `board.relationships`
 * mode: members closed as not planned count on neither side, so an epic
 * whose every member was dropped reads `0 / 0`, as does one with no
 * members. An epic read off a failed listing (`unknown`) has no counts to
 * show and gets null, as does an issue that is no epic.
 *
 * ## Rank
 *
 * {@link ranksOf} numbers the home board's order, 1 first, as `rafa
 * roadmap` and `rafa epic show` read it: each line of the board, in the
 * order `parseRoadmapBody` (`../roadmap.ts`) answers them, takes the
 * next number, and a line naming an epic is followed at once by that
 * epic's members, then the board's next line. The members are taken in
 * the order {@link epicLines} (`../epic-walk.ts`) spells, the one the
 * walk reads and `rafa epic show` prints: in `labels` mode the epic's
 * checklist, then its open members missing from it by ascending number.
 *
 * Ticked items keep their Rank, so finishing one shifts no number below
 * it: every board line and every checklist line is numbered, ticked or
 * not. In `native` mode nothing is ticked and the epic's sub-issue order
 * is its checklist, so every sub-issue `readEpics` hands over is
 * numbered, closed ones included, in that order: `epicLines` drops the
 * closed ones because the walk has no use for them, and taking its lines
 * as they are would renumber the rest each time a sub-issue closed. A
 * `labels`-mode member closed while missing from the checklist sits on no
 * line and has no Rank, as the spec words it.
 *
 * An issue on no line has none: {@link rankOf} answers null for it. An
 * issue named on two lines keeps the Rank of the first, and its second
 * line takes no number, so the numbers run without a gap. Only the
 * board's own lines are opened: an epic named on another epic's checklist
 * takes one number and its own members are not read there, as the walk
 * descends one level only. A board line naming an issue `epics` does not
 * hold — no epic, or one the listing left out — takes one number.
 *
 * ## Blocked by
 *
 * {@link blockedByTextOf} writes the blockers still holding an issue back,
 * read by the relations port's `blockersOf` (`../relations/port.ts`) in
 * whichever `board.relationships` mode the board is in, joined by `, `:
 * `#119, #120`, a blocker in another repository as `owner/name#12`, each
 * in the mode's own order. A blocker holds exactly when the port's
 * {@link isWaiting} says it does, asked of it alone: one read `OPEN`, or
 * one on this board whose state was not read. A blocker read closed,
 * whatever the reason, is left out, and so is a `labels`-mode foreign one,
 * whose state that mode never asks. Null, an empty field, when none holds,
 * when the issue waits on nothing, and for a `labels`-mode fault: a broken
 * `Blocked by:` line names no blocker to trust, and `rafa doctor` names
 * the fault. A `native` list `gh` cut short names the open blockers it
 * read; the field shows no count past them.
 *
 * The label names are imported from the modules that own them, never
 * spelled again here. `needs-triage` and `spec:blocked` are the github
 * tracker's (`GITHUB_LABELS`): the board's own `SPEC_BLOCKED_LABEL` sits
 * behind the relations import boundary
 * (`src/tests/relations-import-boundary.sweep.test.ts`), which closes it to
 * modules learning a relationship. Stage reads the label only to pick a
 * column, so it takes the tracker's spelling of the same name.
 */
import type { PlanReleaseLevel } from '../../plan/parse.js';
import type { Epic } from '../epics.js';
import type { Blocker, BlockersReading } from '../relations/port.js';
import type { BoardIssue } from '../roadmap-board.js';
import type { Horizon } from '../roadmap-epic-rows.js';
import type { RoadmapLine } from '../roadmap.js';

import { GITHUB_LABELS } from '../../adapters/tracker/github.js';
import { CLAIMED_LABEL, IN_DEVELOPMENT_LABEL } from '../../claims/stale.js';
import { EPIC_TYPE_LABEL } from '../epic-context.js';
import { HORIZON_LABEL_PREFIX } from '../epic-problems.js';
import { epicLines } from '../epic-walk.js';
import { NOT_PLANNED_REASON } from '../epics.js';
import { SPEC_NEEDS_WORK_LABEL } from '../gate.js';
import { SPEC_READY_LABEL } from '../readiness.js';
import { isWaiting } from '../relations/port.js';
import { HORIZONS } from '../roadmap-epic-rows.js';

/** The Stage field's options, left to right, by the template's exact names. */
export const STAGE_OPTIONS = Object.freeze([
  'Backlog',
  'Triage',
  'Needs work',
  'Ready',
  'Blocked',
  'Claimed',
  'In development',
  'Waiting for approval',
  'In review',
  'Done',
  'Cancelled',
] as const);

/** One option of the Stage field. */
export type StageOption = (typeof STAGE_OPTIONS)[number];

/** The close reason `gh` writes for an issue closed as a duplicate. */
export const DUPLICATE_REASON = 'DUPLICATE';

/** The level of a fragment that ships nothing, so counts as no fragment. */
const NO_SHIPPING_LEVEL: PlanReleaseLevel = 'none';

/**
 * The label rows of the outline, rightmost column first: the first label
 * the issue carries decides its Stage.
 */
const LABEL_STAGES: readonly (readonly [label: string, stage: StageOption])[] = Object.freeze([
  [IN_DEVELOPMENT_LABEL, 'In development'],
  [CLAIMED_LABEL, 'Claimed'],
  [GITHUB_LABELS.specBlocked, 'Blocked'],
  [SPEC_READY_LABEL, 'Ready'],
  [SPEC_NEEDS_WORK_LABEL, 'Needs work'],
  [GITHUB_LABELS.needsTriage, 'Triage'],
] as const);

/** The fragment a pull request added under `release.fragments`. */
export interface StageFragment {
  /** The bump it asks for; `none` ships nothing, so counts as no fragment. */
  readonly level: PlanReleaseLevel;
  /** Whether the file is still on the base branch, i.e. not yet folded by `rafa release settle`. */
  readonly onBase: boolean;
}

/** A pull request that closes the issue. */
export interface StagePullRequest {
  readonly state: 'OPEN' | 'MERGED';
  /** The fragment it added, or null when it added none. */
  readonly fragment: StageFragment | null;
}

/** The facts the Stage rule reads of one issue. */
export interface StageFacts extends Pick<BoardIssue, 'state' | 'stateReason' | 'labels'> {
  /** The pull requests that close the issue, open or merged; a closed unmerged one is left out. */
  readonly pullRequests: readonly StagePullRequest[];
}

/** True when `fragment` is there and ships something. */
export function ships(fragment: StageFragment | null): fragment is StageFragment {
  return fragment !== null && fragment.level !== NO_SHIPPING_LEVEL;
}

/** True when an issue's close reason reads not planned or duplicate. */
function cancelled(facts: Pick<BoardIssue, 'stateReason'>): boolean {
  return facts.stateReason === NOT_PLANNED_REASON || facts.stateReason === DUPLICATE_REASON;
}

/** The merged pull requests of `facts`. */
function mergedOf(facts: StageFacts): readonly StagePullRequest[] {
  return facts.pullRequests.filter(({ state }) => state === 'MERGED');
}

/** The Stage of a closed issue: Cancelled, In review or Done. */
function closedStage(facts: StageFacts): StageOption {
  if (cancelled(facts)) {
    return 'Cancelled';
  }
  const unreleased = mergedOf(facts).some(({ fragment }) => ships(fragment) && fragment.onBase);

  return unreleased
    ? 'In review'
    : 'Done';
}

/** The Stage of an open issue: its pull requests first, then its labels. */
function openStage(facts: StageFacts): StageOption {
  const merged = mergedOf(facts);

  if (merged.length > 0) {
    return merged.some(({ fragment }) => ships(fragment))
      ? 'In review'
      : 'Done';
  }
  if (facts.pullRequests.some(({ state }) => state === 'OPEN')) {
    return 'Waiting for approval';
  }
  const row = LABEL_STAGES.find(([label]) => facts.labels.includes(label));

  return row === undefined
    ? 'Backlog'
    : row[1];
}

/**
 * The Stage of the issue `facts` describe, by the outline in the module
 * note, or null for an epic, which gets no Stage.
 */
export function stageOf(facts: StageFacts): StageOption | null {
  if (facts.labels.includes(EPIC_TYPE_LABEL)) {
    return null;
  }

  return facts.state === 'CLOSED'
    ? closedStage(facts)
    : openStage(facts);
}

/** The Horizon field's options, left to right, by the template's exact names. */
export const HORIZON_OPTIONS = Object.freeze([
  'Later',
  'Next',
  'Now',
  'Done',
  'Cancelled',
] as const);

/** One option of the Horizon field. */
export type HorizonOption = (typeof HORIZON_OPTIONS)[number];

/** The option each `horizon:` label's value names. */
const HORIZON_LABEL_OPTIONS: Readonly<Record<Horizon, HorizonOption>> = Object.freeze({
  now: 'Now',
  next: 'Next',
  later: 'Later',
});

/** The facts the Horizon rule reads of one issue. */
export type HorizonFacts = Pick<BoardIssue, 'state' | 'stateReason' | 'labels'>;

/** The option the one known `horizon:` label of `labels` names, or null for none, several or an unknown value. */
function labelledHorizon(labels: readonly string[]): HorizonOption | null {
  const found = labels.filter((label) => label.startsWith(HORIZON_LABEL_PREFIX));
  if (found.length !== 1) return null;
  const value = (found[0] ?? '').slice(HORIZON_LABEL_PREFIX.length);
  const known = HORIZONS.find((horizon) => horizon === value);

  return known === undefined
    ? null
    : HORIZON_LABEL_OPTIONS[known];
}

/**
 * The Horizon of the issue `facts` describe, by the module note: null for
 * an issue that is no epic, and for an open epic with no single known
 * `horizon:` label.
 */
export function horizonOptionOf(facts: HorizonFacts): HorizonOption | null {
  if (!facts.labels.includes(EPIC_TYPE_LABEL)) return null;
  if (facts.state === 'CLOSED') {
    return cancelled(facts)
      ? 'Cancelled'
      : 'Done';
  }

  return labelledHorizon(facts.labels);
}

/**
 * The Progress text of `epic` as `readEpics` read it, `done / total`, or
 * null for an issue that is no epic (`epic` null) and for an `unknown`
 * epic, whose listing failed. See the module note.
 */
export function progressTextOf(epic: Pick<Epic, 'state' | 'progress'> | null): string | null {
  if (epic === null || epic.state === 'unknown') return null;
  const { done, total } = epic.progress;

  return `${String(done)} / ${String(total)}`;
}

/** What the Rank rule reads: the home board's lines and the epics read off the listing. */
export interface RankFacts {
  /** The home board's lines, every one, ticked included, as `parseRoadmapBody` reads them. */
  readonly lines: readonly RoadmapLine[];
  /** The epics `readEpics` or `readListedEpics` read off the board listing, in either mode. */
  readonly epics: readonly Epic[];
}

/**
 * The listing row `epicLines` numbers its label-only lines past; Rank
 * reads which issue each line names and never its line number.
 */
const UNREAD_ROW: Pick<BoardIssue, 'body'> = Object.freeze({ body: '' });

/** `epic`'s members in Rank order; the module note holds why `native` mode keeps the closed ones. */
function memberOrder(epic: Epic): readonly number[] {
  return epic.order === 'sub-issues'
    ? epic.members.map(({ number }) => number)
    : epicLines(epic, UNREAD_ROW).lines.map(({ issue }) => issue);
}

/**
 * Every ranked issue's Rank, by issue number, 1 first: the home board's
 * lines in order, each epic's members right after it. See the module note.
 */
export function ranksOf(facts: RankFacts): ReadonlyMap<number, number> {
  const epics = new Map(facts.epics.map((epic) => [epic.number, epic]));
  const order = facts.lines.flatMap(({ issue }) => {
    const epic = epics.get(issue);

    return epic === undefined
      ? [issue]
      : [issue, ...memberOrder(epic)];
  });

  return new Map([...new Set(order)].map((issue, index) => [issue, index + 1]));
}

/** The Rank of issue `issue` in `ranks`, or null for an issue on no line. */
export function rankOf(ranks: ReadonlyMap<number, number>, issue: number): number | null {
  return ranks.get(issue) ?? null;
}

/** The separator between two blockers in the Blocked by field, as the template's example spells it. */
const BLOCKER_SEPARATOR = ', ';

/** True when `blocker` alone still holds `issue` back, by the port's own {@link isWaiting}. */
function holds(issue: number, blocker: Blocker): boolean {
  return isWaiting({ kind: 'blocked', issue, blockers: [blocker] });
}

/** `blocker` as the field names it: `#n` on this board, `owner/name#n` on another. */
function blockerReference(blocker: Blocker): string {
  return `${blocker.repository ?? ''}#${String(blocker.number)}`;
}

/**
 * The Blocked by text of the issue `reading` describes, `#119, #120`, or
 * null when no blocker holds it, it waits on nothing, or its `Blocked by:`
 * line is a fault. See the module note.
 */
export function blockedByTextOf(reading: BlockersReading): string | null {
  if (reading.kind !== 'blocked') return null;
  const holding = reading.blockers.filter((blocker) => holds(reading.issue, blocker));

  return holding.length === 0
    ? null
    : holding.map(blockerReference).join(BLOCKER_SEPARATOR);
}
