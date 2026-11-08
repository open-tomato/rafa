/**
 * The case table of the `release` subject and the `Next:` block every
 * `rafa release` action ends with: each step written `<command> — <why>`,
 * as `./tag-follow-ups.ts` and `./tag-next-steps.ts` give it, and, under
 * `hints.skills: true`, followed by one indented line naming the case
 * file of the `rafa-release` skill that explains it:
 *
 * ```
 * Next:
 *   cd <checkout> && rafa release tag — integration is checked out there
 *     skill: rafa-release › tag-branch
 * ```
 *
 * ## One table, keyed by reason and outcome
 *
 * {@link RELEASE_CASES} is the one place a case name is spelled: a tag
 * refusal reason (`TagRefused['reason']`) or a settle outcome
 * ({@link SettleOutcome}) names the file
 * `.claude/skills/rafa-release/<case>.md`. The two key sets share no
 * word, so one flat map holds both. A step that no refusal or outcome
 * gave, such as a follow-up of a run that tagged, carries no case and so
 * prints no skill line whatever `hints.skills` says.
 *
 * ## Off by default
 *
 * `hints.skills` defaults to false, since a project without the skill
 * installed would otherwise read pointers to files it lacks. With it
 * off the block is the `<command> — <why>` lines alone, and JSON mode's
 * `skill` is null. Nothing here reads the config: the caller passes the
 * resolved switch in, so every function is pure.
 */
import type { TagRefusalReason } from './tag.js';

/** How a `rafa release settle` ended: it pushed, it opened a pull request, or it had nothing to fold. */
export type SettleOutcome = 'push' | 'pr' | 'nothing';

/** What a case is keyed by: a tag refusal reason or a settle outcome. */
export type ReleaseCaseKey = TagRefusalReason | SettleOutcome;

/** The name of a case file in the `rafa-release` skill, without its `.md`. */
export type ReleaseCase =
  | 'tag-branch'
  | 'tag-behind'
  | 'tag-version'
  | 'tag-tagged'
  | 'tag-changelog'
  | 'tag-git'
  | 'tag-receipt'
  | 'settle-push'
  | 'settle-pr'
  | 'settle-nothing';

/** The skill every release case file sits in. */
export const RELEASE_SKILL = 'rafa-release';

/** The case of each tag refusal reason and settle outcome; see the module note. */
export const RELEASE_CASES: Readonly<Record<ReleaseCaseKey, ReleaseCase>> = Object.freeze({
  branch: 'tag-branch',
  behind: 'tag-behind',
  version: 'tag-version',
  tagged: 'tag-tagged',
  changelog: 'tag-changelog',
  git: 'tag-git',
  receipt: 'tag-receipt',
  push: 'settle-push',
  pr: 'settle-pr',
  nothing: 'settle-nothing',
});

/** One step a release action names for the operator to take next. */
export interface ReleaseStep {
  /** The whole command, as the operator types it, its place already on the front. */
  readonly command: string;
  /** Why it applies, in a phrase, lower case and with no full stop. */
  readonly why: string;
  /** The case that explains it, or null when no refusal or outcome gave it. */
  readonly case: ReleaseCase | null;
}

/** A step as JSON mode carries it on the result's `next` list. */
export interface ReleaseStepEntry extends ReleaseStep {
  /** `rafa-release › <case>` under `hints.skills: true` when the step has a case, null otherwise. */
  readonly skill: string | null;
}

/** What a step line is indented by under the `Next:` heading. */
const STEP_INDENT = '  ';

/** What a skill line is indented by: one level under its step. */
const SKILL_INDENT = `${STEP_INDENT}  `;

/** The case of `key`, a tag refusal reason or a settle outcome. */
export function caseOf(key: ReleaseCaseKey): ReleaseCase {
  return RELEASE_CASES[key];
}

/** The skill reference of `step` with `skills` the `hints.skills` switch, or null when it gets none. */
export function skillOf(step: ReleaseStep, skills: boolean): string | null {
  return skills && step.case !== null
    ? `${RELEASE_SKILL} › ${step.case}`
    : null;
}

/** `step` as JSON mode's `next` list carries it, `skills` the `hints.skills` switch. */
export function stepEntry(step: ReleaseStep, skills: boolean): ReleaseStepEntry {
  return { command: step.command, why: step.why, case: step.case, skill: skillOf(step, skills) };
}

/**
 * The lines of one step under a `Next:` heading, `skills` the
 * `hints.skills` switch: its `<command> — <why>` line, then its skill
 * line when it has one. {@link renderNextSteps} gives the heading over
 * them; a caller that writes lines of its own between the steps, as a
 * run that tagged writes its CI publish sentence, renders each step here.
 */
export function renderStep(step: ReleaseStep, skills: boolean): readonly string[] {
  const line = `${STEP_INDENT}${step.command} — ${step.why}`;
  const skill = skillOf(step, skills);
  return skill === null
    ? [line]
    : [line, `${SKILL_INDENT}skill: ${skill}`];
}

/**
 * The `Next:` block over `steps`, in their order, `skills` the
 * `hints.skills` switch: the heading, then each step's line and, when
 * the switch is on and the step has a case, its skill line. No steps
 * give no lines, the heading included.
 */
export function renderNextSteps(steps: readonly ReleaseStep[], skills: boolean): readonly string[] {
  if (steps.length === 0) return [];
  return ['Next:', ...steps.flatMap((step) => renderStep(step, skills))];
}
