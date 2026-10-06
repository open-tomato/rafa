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
 * The label names are imported from the modules that own them, never
 * spelled again here. `needs-triage` and `spec:blocked` are the github
 * tracker's (`GITHUB_LABELS`): the board's own `SPEC_BLOCKED_LABEL` sits
 * behind the relations import boundary
 * (`src/tests/relations-import-boundary.sweep.test.ts`), which closes it to
 * modules learning a relationship. Stage reads the label only to pick a
 * column, so it takes the tracker's spelling of the same name.
 */
import type { PlanReleaseLevel } from '../../plan/parse.js';
import type { BoardIssue } from '../roadmap-board.js';

import { GITHUB_LABELS } from '../../adapters/tracker/github.js';
import { CLAIMED_LABEL, IN_DEVELOPMENT_LABEL } from '../../claims/stale.js';
import { EPIC_TYPE_LABEL } from '../epic-context.js';
import { NOT_PLANNED_REASON } from '../epics.js';
import { SPEC_NEEDS_WORK_LABEL } from '../gate.js';
import { SPEC_READY_LABEL } from '../readiness.js';

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
function ships(fragment: StageFragment | null): fragment is StageFragment {
  return fragment !== null && fragment.level !== NO_SHIPPING_LEVEL;
}

/** The merged pull requests of `facts`. */
function mergedOf(facts: StageFacts): readonly StagePullRequest[] {
  return facts.pullRequests.filter(({ state }) => state === 'MERGED');
}

/** The Stage of a closed issue: Cancelled, In review or Done. */
function closedStage(facts: StageFacts): StageOption {
  if (facts.stateReason === NOT_PLANNED_REASON || facts.stateReason === DUPLICATE_REASON) {
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
