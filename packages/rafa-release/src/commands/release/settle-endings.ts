/**
 * How a `rafa release settle` ends: the step after it, so that
 * `settle && tag` never runs the tag on the version before or on
 * nothing (#1533). One ending per outcome, each a `Next:` block of
 * `<command> — <why>` steps as `./step-cases.ts` renders them:
 *
 * | Outcome | Ends with |
 * |---|---|
 * | push delivery | `git merge --ff-only <remote>/<branch>`, then `rafa release tag --push` |
 * | pull request delivery | `rafa pr wait <n>`, then once it merges the same two |
 * | nothing to settle | `Nothing to tag either: every unit keeps its version.` |
 * | dry run that would fold | `rafa release settle`, without `--dry-run` |
 *
 * ## Which outcome is which
 *
 * A push delivery is a push that landed, or one another settle beat to
 * the same fragments (`superseded`): either way the base holds a
 * release the caller's branch is behind. When `release.tag: settle`
 * tagged and pushed it already, the tag step is left out and only the
 * merge remains. A pull request delivery is one that `delivered`; its
 * merge and tag steps wait for the pull request to merge. Nothing to
 * settle is a reading or a build that found no fragment shipping a
 * release, the dry run's included: the sentence follows
 * `Nothing to settle: …` and carries no step. A run that refused, by
 * its delivery or its tag, ends on its refusal and gets no ending.
 *
 * ## Where each step runs
 *
 * The merge and the tag run on the release branch, so they are placed
 * by core's `placeLine` at the checkout holding it, read by
 * `readBranchHolder` (`./tag-next-steps.ts`) after the scratch worktree
 * is gone. With no holder, or a holder whose path is gone, they are
 * placed at the project root and preceded by a `git switch <branch>`
 * step. `rafa pr wait` and the dry run's `rafa release settle` run
 * anywhere in the project, so they are placed at its root.
 *
 * ## Cases
 *
 * Every step of an outcome carries its case (`settle-push`, `settle-pr`),
 * and the nothing sentence carries `settle-nothing`, so under
 * `hints.skills: true` each is followed by its skill line. The dry run's
 * step has no case: the outcome it would reach is not known yet. JSON
 * mode carries the steps as the result's `next` list
 * ({@link ReleaseStepEntry}); the nothing sentence is a line, not a
 * step, so its `next` is empty.
 */
import type { ReleaseSettleResult } from './settle.js';
import type { ReleaseCase, ReleaseStep, ReleaseStepEntry } from './step-cases.js';
import type { StepPlacing } from './tag-next-steps.js';

import { placeLine } from '@open-tomato/rafa/core/git';

import { caseOf, caseSkill, renderNextSteps, stepEntry } from './step-cases.js';
import { placedAtRoot } from './tag-next-steps.js';

/** The sentence a settle with nothing to fold ends on, after its `Nothing to settle` line. */
export const NOTHING_TO_TAG = 'Nothing to tag either: every unit keeps its version.';

/** The command that settles for real once a dry run read what it would fold. */
const SETTLE_COMMAND = 'rafa release settle';

/** The command that tags the release commit once the branch holds it. */
const TAG_PUSH_COMMAND = 'rafa release tag --push';

/** What a skill line under a sentence is indented by. */
const SKILL_INDENT = '  ';

/** Which ending a run reached; see the module note. */
export type SettleEnded =
  | { readonly kind: 'push'; readonly tagged: boolean }
  | { readonly kind: 'pr'; readonly pull: number }
  | { readonly kind: 'nothing' }
  | { readonly kind: 'fold' }
  | { readonly kind: 'none' };

/** Where the steps of an ending are placed. */
export interface SettleEndingPlace {
  /** The release branch: `pr.base`, or the default. */
  readonly branch: string;
  /** The remote the base was fetched from. */
  readonly remote: string;
  /** The checkout holding the release branch, or null when none does or git did not answer. */
  readonly holder: string | null;
  /** The project root and the seams `placeLine` reads. */
  readonly placing: StepPlacing;
}

/** An ending: its steps, and the sentence a run with nothing to fold ends on. */
export interface SettleEnding {
  /** The `Next:` steps, in order; empty for nothing to settle and for a refusal. */
  readonly steps: readonly ReleaseStep[];
  /** The closing sentence and its case, or null when the ending is its steps alone. */
  readonly sentence: { readonly line: string; readonly case: ReleaseCase } | null;
}

/** A step without its case, as the outcomes below spell it. */
type StepText = Omit<ReleaseStep, 'case'>;

/** The ending of a run that ended on its refusal, or of nothing to end. */
const NO_ENDING: SettleEnding = Object.freeze({ steps: [], sentence: null });

/** True when `build` found no fragment that ships a release. */
function isNothing(build: { readonly outcome: string }): boolean {
  return build.outcome === 'nothing';
}

/** The ending `result` reached; see the module note. */
export function settleEndedOf(result: ReleaseSettleResult): SettleEnded {
  if (result.problem !== null) return { kind: 'none' };
  if (result.delivered === null) {
    if (result.reading.outcome === 'folded') return { kind: 'fold' };
    return isNothing(result.reading)
      ? { kind: 'nothing' }
      : { kind: 'none' };
  }
  const { outcome } = result.delivered;
  if (outcome.outcome === 'unsettled') {
    return isNothing(outcome.build)
      ? { kind: 'nothing' }
      : { kind: 'none' };
  }
  if (outcome.outcome === 'pushed' || outcome.outcome === 'superseded') {
    return { kind: 'push', tagged: result.tag?.outcome === 'tagged' };
  }
  if (outcome.outcome === 'delivered') return { kind: 'pr', pull: outcome.pull.number };
  return { kind: 'none' };
}

/**
 * The merge and, unless `tagged`, the tag step, placed at the branch's
 * holder, or at the root after a `git switch` step when none is there.
 * `after` opens each why, as a pull request's steps wait for its merge.
 */
function branchSteps(place: SettleEndingPlace, tagged: boolean, after: string): readonly StepText[] {
  const upstream = `${place.remote}/${place.branch}`;
  const steps: readonly StepText[] = [
    { command: `git merge --ff-only ${upstream}`, why: `${after}the release commit is on ${upstream}; this brings ${place.branch} up to it` },
    ...tagged
      ? []
      : [{ command: TAG_PUSH_COMMAND, why: `${after}tags the release commit and pushes the tag` }],
  ];
  const { holder } = place;
  const held = holder === null
    ? []
    : steps.flatMap((step) => {
      const answer = placeLine(step.command, holder, place.placing.seams);
      return answer.kind === 'placed'
        ? [{ ...step, command: answer.line }]
        : [];
    });
  if (holder !== null && held.length === steps.length) return held;
  const atRoot = (step: StepText): StepText => ({ ...step, command: placedAtRoot(step.command, place.placing) });
  return [
    atRoot({ command: `git switch ${place.branch}`, why: `no checkout has ${place.branch} checked out; the merge and the tag run on it` }),
    ...steps.map(atRoot),
  ];
}

/** The steps of `ended` without their case. */
function stepsOf(ended: SettleEnded, place: SettleEndingPlace): readonly StepText[] {
  switch (ended.kind) {
    case 'push':
      return branchSteps(place, ended.tagged, '');
    case 'pr': {
      const wait: StepText = {
        command: placedAtRoot(`rafa pr wait ${String(ended.pull)}`, place.placing),
        why: `waits for the checks of release pull request #${String(ended.pull)}; merge it once they pass`,
      };
      return [wait, ...branchSteps(place, false, `once #${String(ended.pull)} merges, `)];
    }
    case 'fold':
      return [{ command: placedAtRoot(SETTLE_COMMAND, place.placing), why: 'the dry run wrote nothing; this folds the fragments and delivers the release' }];
    case 'nothing':
    case 'none':
      return [];
  }
}

/** The case each step of `ended` carries, or null for the dry run's, whose outcome is not known yet. */
function caseOfEnded(ended: Extract<SettleEnded, { kind: 'push' | 'pr' | 'fold' }>): ReleaseCase | null {
  return ended.kind === 'fold'
    ? null
    : caseOf(ended.kind);
}

/** The ending of `ended`, each step placed by `place`; see the module note. */
export function settleEnding(ended: SettleEnded, place: SettleEndingPlace): SettleEnding {
  if (ended.kind === 'none') return NO_ENDING;
  if (ended.kind === 'nothing') return { steps: [], sentence: { line: NOTHING_TO_TAG, case: caseOf('nothing') } };
  const stepCase = caseOfEnded(ended);
  return { steps: stepsOf(ended, place).map((step) => ({ ...step, case: stepCase })), sentence: null };
}

/**
 * The text lines of `ending`, `skills` the `hints.skills` switch: the
 * sentence and its skill line, or the `Next:` block over the steps.
 */
export function renderSettleEnding(ending: SettleEnding, skills: boolean): readonly string[] {
  if (ending.sentence === null) return renderNextSteps(ending.steps, skills);
  const skill = caseSkill(ending.sentence.case, skills);
  return skill === null
    ? [ending.sentence.line]
    : [ending.sentence.line, `${SKILL_INDENT}skill: ${skill}`];
}

/** The steps of `ending` as JSON mode's `next` list carries them. */
export function settleNext(ending: SettleEnding, skills: boolean): readonly ReleaseStepEntry[] {
  return ending.steps.map((step) => stepEntry(step, skills));
}

/** `result` with `ending` appended to its lines and carried as its `next` list. */
export function withSettleEnding(result: ReleaseSettleResult, ending: SettleEnding, skills: boolean): ReleaseSettleResult {
  return {
    ...result,
    lines: [...result.lines, ...renderSettleEnding(ending, skills)],
    next: settleNext(ending, skills),
  };
}
