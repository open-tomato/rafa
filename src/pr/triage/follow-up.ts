/**
 * The follow-up prompt: everything one triage read, written out as text
 * another session is started with.
 *
 * `rafa pr triage` assesses in CODE (`./classify.ts`), and the spec's
 * last output line is "a ready FOLLOW-UP PROMPT for another session that
 * carries all of it, so that session does not assess again". This module
 * is that prompt. It is the reason the assessment is worth doing in code
 * at all: the class, the conflicting files, the failing step and the log
 * excerpt are already in hand, and a session handed them has no reason
 * to spend a turn re-running `gh pr view`, `gh pr checks`,
 * `gh run view --log-failed` or `git merge-tree` — three of which need
 * network and one of which needs a fetched head.
 *
 * So the prompt is written to be SELF-SUFFICIENT, and that shapes two
 * decisions:
 *
 *   - Every section is always present. A section with nothing in it
 *     carries a sentence saying what was not read and why that is the
 *     whole reading ({@link NO_FILES}, {@link NO_STEP},
 *     {@link NO_EXCERPT}) rather than being dropped. A dropped section
 *     is an invitation to go and look: a session that finds no "Failing
 *     step" heading cannot tell whether the step was unreadable or
 *     whether the prompt forgot it, and the cheapest way to settle that
 *     is the very command this prompt exists to avoid.
 *   - The instruction not to re-assess NAMES the commands
 *     ({@link REASSESS_COMMANDS}). "Do not assess again" is a sentence a
 *     reader has to interpret; a list of the four commands whose answers
 *     are already below is one it can check itself against.
 *
 * ## Pure, total, and it never throws
 *
 * Nothing here spawns, awaits or reads a file: it is a function from one
 * {@link FollowUpInput} to a string, so every case drives it from
 * literals. It has no failure mode either — a prompt that threw on an
 * odd reading would lose the assessment that was already paid for, when
 * the honest answer is a prompt whose evidence sections say what was
 * missing.
 *
 * ## Why the excerpt is capped HERE as well
 *
 * `./evidence.ts` already caps its tail at {@link FAILED_LOG_TAIL_LINES}
 * counted from the END, and on evidence that came from `readFailedLog`
 * the cap in this module is a no-op. It is applied anyway because this
 * text is pasted into a session's context, where an uncapped excerpt is
 * not merely long but expensive, and because {@link FollowUpInput} takes
 * a {@link FailedLogEvidence} from any caller — a stored comment read
 * back, a fixture, a future reader with its own cap. The two omission
 * counts are ADDED ({@link excerptLines}), so a prompt that shows 40 of
 * 5413 lines says 5373 were dropped whether the dropping happened once
 * or twice.
 *
 * ## The fence
 *
 * The excerpt goes in a fence one backtick longer than any backtick run
 * it holds, the rule `src/triage/triage.ts` already keeps for the text a
 * session wrote: a CI log that prints a fenced snippet of its own would
 * otherwise close the excerpt early and spill the rest of the prompt
 * into the reader's own markdown. The helper is local rather than shared
 * with that module because it is six lines and the two modules share no
 * other concern.
 *
 * ## One task line per class
 *
 * {@link FOLLOW_UP_TASKS} carries a sentence for every member of
 * `TRIAGE_CLASSES` and for no other key, so the class set stays closed
 * through this module the way it is closed through the classifier: a
 * tenth class is a compile error here rather than a prompt whose "What
 * to do" section is blank. `green` and `pending` get a line too, and
 * theirs says there is nothing to fix and nothing to wait for
 * respectively, and `no-checks` gets one saying there is nothing to fix
 * — a caller may build a prompt for any assessment, and a prompt that
 * quietly omitted the work for three of the eleven classes would
 * be a worse reading than one that says the work is none.
 *
 * The lines name the SHAPE of the work and never a plan file: the
 * pinned resolve plans (`src/pr/plans/resolve-<class>.md`) are the
 * `--resolve` path's own, they exist for four classes only, and a prompt
 * that pointed at one for the other seven would point at nothing.
 */
import type { TriageClass } from './classes.js';
import type { TriageAssessment } from './classify.js';
import type { FailedLogEvidence } from './evidence.js';
import type { PullRequestDetail } from '../types.js';

import { FAILED_LOG_TAIL_LINES } from './evidence.js';

/**
 * How many excerpt lines the prompt shows, counted from the END. The
 * same cap `./evidence.ts` reads, deliberately: a prompt that showed
 * more than the evidence reader keeps would be showing lines no other
 * reader of the same triage ever saw.
 */
export const FOLLOW_UP_EXCERPT_LINES = FAILED_LOG_TAIL_LINES;

/**
 * The commands whose answers are already in the prompt, named in the
 * instruction not to re-assess; see the module note for why they are
 * named rather than implied.
 */
export const REASSESS_COMMANDS: readonly string[] = Object.freeze([
  'gh pr view',
  'gh pr checks',
  'gh run view --log-failed',
  'git merge-tree',
] as const);

/** What the "Conflicting files" section says when there are none. */
export const NO_FILES
  = 'None were read. A `conflict-*` class with no files means the conflict was'
    + ' reported by GitHub but the head was not fetched locally, so treat the file'
    + ' list as unknown rather than empty.';

/** What the "Failing step" section says when no log named one. */
export const NO_STEP
  = 'No step was named. The run was cancelled, timed out, or GitHub no longer'
    + ' serves its log, so the class was not read from a step name.';

/** What the "Log excerpt" section says when there is no evidence. */
export const NO_EXCERPT
  = 'No failing-job log was read. There was none to read: the pull request is not'
    + ' red on a check, or its run produced no log.';

/** The heading the prompt opens with. */
export const FOLLOW_UP_TITLE = 'Assessed pull request: act on this triage';

/**
 * The work each class asks for, one sentence each, keyed over the whole
 * closed class set; see the module note.
 */
export const FOLLOW_UP_TASKS: Readonly<Record<TriageClass, string>> = Object.freeze({
  'green': 'Nothing to fix: every check passed and the head merges cleanly. If you'
    + ' were sent here to fix something, the pull request moved since it was'
    + ' assessed; say so rather than inventing work.',
  'pending': 'Nothing to fix yet: checks are still running. Wait for them and read'
    + ' the outcome; do not change the branch on a partial reading.',
  'no-checks': 'Nothing to fix: the pull request reported no checks at all, so'
    + ' nothing failed and nothing is running. Do not change the branch; merging'
    + ' without checks is a decision for rafa pr merge --skip-checks, not a fix.',
  'conflict-lockfile': 'Merge the base branch into the head, take the BASE branch'
    + ' lockfile for every conflicting lockfile below, reinstall to regenerate it,'
    + ' run the gates, then commit and push. Never force-push.',
  'conflict-manifest': 'Merge the base branch into the head and resolve the manifest'
    + ' by keeping BOTH sides entries, taking the higher version where both bumped'
    + ' one, then reinstall, run the gates, commit and push. Never force-push.',
  'conflict-other': 'Merge the base branch into the head and resolve the conflicting'
    + ' files below by hand; they are ordinary source, so the resolution needs to'
    + ' know what the pull request was for. Run the gates before pushing.',
  'ci-install': 'The install step failed. Read the excerpt below, fix what it names'
    + ' — an unresolvable version, a lockfile out of step with the manifest, a'
    + ' missing platform build — then reinstall, run the gates and push.',
  'ci-lint': 'The lint step failed. Read the excerpt below, fix the rules it names'
    + ' in the source rather than by widening the lint configuration, then run the'
    + ' gates and push.',
  'ci-types': 'The type check failed. Read the excerpt below and fix the types it'
    + ' names; do not silence them with a cast or a suppression comment. Run the'
    + ' gates and push.',
  'ci-test': 'A test failed. Read the excerpt below, reproduce the named test'
    + ' locally, and fix the implementation rather than the assertion unless the'
    + ' assertion is itself wrong. Run the gates and push.',
  'ci-other': 'A step nothing recognised failed. Read the excerpt below, work out'
    + ' from the step name what that job does, and fix it; there is no pinned plan'
    + ' for this class, so nothing has been assumed about the fix.',
} as const);

/** The part of a pull request the prompt identifies it by. */
export type FollowUpPullRequest = Pick<
  PullRequestDetail,
  'baseRefName' | 'headRefName' | 'headRefOid' | 'isCrossRepository' | 'number' | 'title' | 'url'
>;

/** Everything the prompt is written from. */
export interface FollowUpInput {
  /** The pull request, as the port answered it. */
  readonly pr: FollowUpPullRequest;
  /** What the classifier concluded, files and step included. */
  readonly assessment: TriageAssessment;
  /**
   * The failing job's log reading, or `undefined` when there was no
   * failing job to read one from.
   */
  readonly evidence?: FailedLogEvidence | undefined;
  /**
   * The cap on the excerpt, {@link FOLLOW_UP_EXCERPT_LINES} when unset.
   * A value that is not a positive whole number is ignored rather than
   * refused: this module never throws, and a cap of zero would leave the
   * evidence section empty; see the module note.
   */
  readonly maxExcerptLines?: number;
}

/** What one capped excerpt came to. */
export interface ExcerptReading {
  /** The lines shown, in the log's own order. */
  readonly lines: readonly string[];
  /** How many lines were dropped off the front, both caps counted. */
  readonly omitted: number;
  /** How many lines the whole log held. */
  readonly total: number;
}

/** The shortest fence an excerpt is shown in. */
const MIN_FENCE_LENGTH = 3;

/** Whether `value` is a cap this module will apply. */
function isUsableCap(value: number | undefined): value is number {
  return value !== undefined && Number.isInteger(value) && value > 0;
}

/**
 * The excerpt the prompt shows: the last `maxLines` of what the
 * evidence carried, with both caps omission counts added.
 */
export function excerptLines(
  evidence: FailedLogEvidence,
  maxLines?: number,
): ExcerptReading {
  const cap = isUsableCap(maxLines)
    ? maxLines
    : FOLLOW_UP_EXCERPT_LINES;
  const dropped = Math.max(0, evidence.lines.length - cap);
  return {
    lines: evidence.lines.slice(dropped),
    omitted: evidence.omitted + dropped,
    total: evidence.total,
  };
}

/** A body in a fence one backtick longer than any run of backticks it holds. */
export function fencedBlock(body: string, language: string): string {
  const runs = Array.from(body.matchAll(/`+/g), (run) => run[0].length);
  const fence = '`'.repeat(Math.max(MIN_FENCE_LENGTH, ...runs.map((length) => length + 1)));
  const text = body.endsWith('\n') || body === ''
    ? body
    : `${body}\n`;
  return `${fence}${language}\n${text}${fence}`;
}

/** `1 line` or `3 lines`: a count with its noun pluralised, so a sentence reads. */
function counted(count: number, noun: string): string {
  return count === 1
    ? `1 ${noun}`
    : `${count} ${noun}s`;
}

/** The sentence above the fence, saying what part of the log is shown. */
export function excerptCaption(reading: ExcerptReading): string {
  const shown = counted(reading.lines.length, 'line');
  return reading.omitted === 0
    ? `The failing job log, all ${shown} of it.`
    : `The last ${shown} of the failing job log, ${counted(reading.omitted, 'earlier line')}`
      + ` omitted of ${reading.total} in all.`;
}

/** The "Pull request" section body. */
function pullRequestSection(pr: FollowUpPullRequest): string {
  const fork = pr.isCrossRepository
    ? '\n- Cross-repository: the head is on a FORK, so it cannot be checked out into a'
      + ' worktree of this repository and must never be pushed to directly.'
    : '';
  return `- #${pr.number} ${pr.title}\n`
    + `- ${pr.url}\n`
    + `- \`${pr.headRefName}\` -> \`${pr.baseRefName}\`\n`
    + `- Head commit: \`${pr.headRefOid}\`. This triage was read at that commit; if the`
    + ' head has moved, say so rather than acting on a stale reading.'
    + fork;
}

/** The "Class" section body. */
function classSection(assessment: TriageAssessment): string {
  const eligibility = assessment.simple
    ? 'simple, so a pinned resolve plan covers it'
    : 'not simple, so the fix needs judgement about what this pull request is for';
  const bump = assessment.dependencyBump
    ? 'yes'
    : 'no';
  const failing = counted(assessment.failing.length, 'failing row');
  return `- Class: \`${assessment.triageClass}\` (${eligibility})\n`
    + `- Why: ${assessment.reason}\n`
    + `- Checks verdict: \`${assessment.verdict}\`, ${failing} in the rollup\n`
    + `- Dependency bump: ${bump}`;
}

/** The "Conflicting files" section body. */
function filesSection(assessment: TriageAssessment): string {
  if (assessment.files.length === 0) {
    return assessment.conflicting
      ? NO_FILES
      : 'None: the head merges cleanly into the base.';
  }
  return assessment.files.map((file) => `- \`${file}\``).join('\n');
}

/** The "Failing step" section body. */
function stepSection(assessment: TriageAssessment): string {
  const { step } = assessment;
  if (step === undefined) return NO_STEP;
  const source = step.source === 'step-column'
    ? 'the log step column, so it is the name the workflow gave the step'
    : 'the runner group marker, so it is the COMMAND the step ran';
  return `- Step: \`${step.name}\`\n- Read from: ${source}`;
}

/** The "Log excerpt" section body. */
function excerptSection(input: FollowUpInput): string {
  const { evidence } = input;
  if (evidence === undefined) return NO_EXCERPT;
  const reading = excerptLines(evidence, input.maxExcerptLines);
  if (reading.lines.length === 0) return NO_EXCERPT;
  const jobs = evidence.jobs.length === 0
    ? ''
    : `${counted(evidence.jobs.length, 'failing job')}: `
      + `${evidence.jobs.map((job) => `\`${job}\``).join(', ')}.\n`;
  return `${jobs}${excerptCaption(reading)}\n\n`
    + fencedBlock(reading.lines.join('\n'), 'text');
}

/** The instruction not to assess again, with the commands named. */
function noReassessSection(): string {
  const commands = REASSESS_COMMANDS.map((command) => `\`${command}\``).join(', ');
  return 'This pull request has ALREADY been assessed, in code, and everything that'
    + ' reading produced is below. Do not assess it again: you do not need'
    + ` ${commands}. Start from the class and the evidence here and go straight to`
    + ' the work.';
}

/**
 * Writes the follow-up prompt for one assessment.
 *
 * Pure and total: no input reaches a throw, and every section is
 * present whatever was read; see the module note.
 */
export function buildFollowUpPrompt(input: FollowUpInput): string {
  const { assessment, pr } = input;
  const sections: readonly (readonly [heading: string, body: string])[] = [
    ['Pull request', pullRequestSection(pr)],
    ['Class', classSection(assessment)],
    ['Conflicting files', filesSection(assessment)],
    ['Failing step', stepSection(assessment)],
    ['Log excerpt', excerptSection(input)],
    ['What to do', FOLLOW_UP_TASKS[assessment.triageClass]],
  ];
  const body = sections
    .map(([heading, text]) => `## ${heading}\n\n${text}`)
    .join('\n\n');
  return `# ${FOLLOW_UP_TITLE}\n\n${noReassessSection()}\n\n${body}\n`;
}
