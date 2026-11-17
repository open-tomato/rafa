/**
 * What `rafa release tag` prints in text mode, and the exit it refuses
 * with: the rendering half of `./tag.ts`, moved here so the command
 * module keeps the readings, the decisions and the writes, and stays
 * under the 800-line ceiling. Nothing here reads git or the config;
 * every function is pure over what `./tag.ts` already decided.
 *
 * A refusal is one `❌` line per sentence, then a `Next:` heading over
 * the steps that clear them (`./tag-next-steps.ts`), then the usage. A
 * run that tagged gives one `Tagged` line per tag, its `Pushed` line
 * when `--push` pushed it, a `Skipped` line per skipped unit, and a
 * `Next:` heading over every unit's follow-ups
 * (`./tag-follow-ups.ts`), each written `<command> — <why>`.
 *
 * Every step is rendered by `./step-cases.ts`, already placed by
 * `./tag.ts` where it must run. A refusal's steps carry the refusal's
 * case, so under `hints.skills: true` each is followed by its skill
 * line; a follow-up of a run that tagged has no case and never is.
 */
import type { ReleaseStep } from './step-cases.js';
import type { ReleaseTagUnit, TagReady } from './tag.js';

import { CommandExit } from '@open-tomato/rafa/core/command';

import { renderNextSteps, renderStep } from './step-cases.js';
import { ciPublishSentence, readPublishTarget } from './tag-follow-ups.js';

/** The usage line this action's refusals name. */
export const RELEASE_TAG_USAGE = 'rafa release tag [--push]';

/** What every line under a heading is indented by, as `pr merge` indents its follow-ups. */
const INDENT = '  ';

/** How many characters of a commit hash a line names it by. */
const SHORT_COMMIT = 7;

/** `steps` with each repeat after its first dropped, as two refused units of one reason give the same step. */
function distinctSteps(steps: readonly ReleaseStep[]): readonly ReleaseStep[] {
  const keyOf = (step: ReleaseStep): string => `${step.command} — ${step.why} — ${step.case ?? ''}`;
  return [...new Map(steps.map((step) => [keyOf(step), step] as const)).values()];
}

/**
 * The exit a run refused with: one `❌` line per sentence, then a `Next:`
 * heading over the steps that clear them (`./tag-next-steps.ts`), each
 * without repeats and, under `skills`, the `hints.skills` switch,
 * followed by its skill line, then the usage.
 */
export function refusal(
  messages: readonly string[],
  steps: readonly ReleaseStep[] = [],
  skills = false,
): CommandExit {
  const lines = [...new Set(messages)].map((message) => `❌ ${message}`);
  const next = renderNextSteps(distinctSteps(steps), skills);
  return new CommandExit(1, [...lines, ...next, `Usage: ${RELEASE_TAG_USAGE}`].join('\n'));
}

/** The `Next:` lines of one unit: its follow-ups, then the CI publish sentence when it has one. */
function nextLines(unit: ReleaseTagUnit): readonly string[] {
  // A follow-up has no case, so the hints.skills switch changes nothing here.
  const lines = unit.followUps.flatMap((followUp) => renderStep({ ...followUp, case: null }, false));
  if (unit.publish !== 'ci' || unit.decision.kind !== 'ready') return lines;
  const { tag, version } = unit.decision;
  const sentence = ciPublishSentence(tag, version, readPublishTarget(unit.inputs.version.text));
  return sentence === null
    ? lines
    : [...lines, `${INDENT}${sentence}`];
}

/** The warning a run prints when HEAD is past the tagged commit, or null when HEAD is the tagged commit. */
export function pastReleaseWarning(written: TagReady, branch: string): string | null {
  if (written.ahead === 0) return null;
  const commits = written.ahead === 1
    ? '1 commit'
    : `${String(written.ahead)} commits`;
  return `HEAD of ${branch} is ${commits} past ${written.commit.slice(0, SHORT_COMMIT)}, where ${written.version}`
    + ` was set; they are not in ${written.tag}.`;
}

/** The lines of one unit: its `Tagged` and `Pushed` lines, or its `Skipped` line. */
function unitLines(unit: ReleaseTagUnit, branch: string): readonly string[] {
  const decision = unit.decision;
  if (decision.kind === 'skipped') return [`Skipped: ${decision.message}.`];
  if (decision.kind === 'refused') return [];
  const where = decision.ahead === 0
    ? `the HEAD of ${branch}`
    : `${decision.commit.slice(0, SHORT_COMMIT)}, the commit of ${branch} that set ${decision.version}`;
  return [
    `✅ Tagged ${decision.tag} at ${where}.`,
    ...(unit.pushed === undefined
      ? []
      : [`✅ Pushed ${unit.pushed.tag} to ${unit.pushed.remote}.`]),
  ];
}

/**
 * The lines text mode writes for a run that tagged on `branch`: one
 * `Tagged` line per tag in unit order, each with its `Pushed` line when
 * the tag was pushed, a `Skipped` line per skipped unit, and the
 * `Next:` heading only over follow-ups there are, every unit's in unit
 * order, a unit under `release.publish: ci` giving its CI publish
 * sentence where its publish line would stand.
 */
export function renderTagged(units: readonly ReleaseTagUnit[], branch: string): readonly string[] {
  const lines = units.flatMap(nextLines);
  const next = lines.length === 0
    ? []
    : ['Next:', ...lines];
  return [...units.flatMap((unit) => unitLines(unit, branch)), ...next];
}
