/**
 * What `rafa pr triage` prints for one pull request: the class, the
 * evidence it was read from, and the follow-up prompt a session is
 * handed.
 *
 * One pure function over one record, as `pr show`'s {@link renderShow}
 * is, so every shape — assessed, already assessed, waiting on a run,
 * green, a comment written, a comment refused, a log that could not be
 * read — is driven by calling it rather than by provoking a provider
 * into each one. The command gathers; this renders.
 *
 * ## Why the console lines are not the comment's lines
 *
 * `src/pr/triage/comment.ts` renders the same assessment for GitHub:
 * backticked paths, a `<details>` fold, a fenced excerpt. That is
 * markdown for a web page. These are lines for a terminal, and they
 * differ in what markdown would cost rather than in what they say: a
 * backtick pasted into a shell is not the path, and a fold is not a
 * thing a terminal has. So the two renderers share the ASSESSMENT and
 * not the formatting, and each is read where it is shown. The section
 * ORDER is the same in both — why, files, step, checks, verdict — so
 * one reading does not look like two.
 *
 * ## The four re-run readings are one line each
 *
 * `readTriageRerun` (`src/pr/triage/rerun.ts`) already answers a
 * headline for every reading it makes, so this module prints that
 * sentence and never re-words it: "already assessed at <time>", the
 * moved head with a run still going, the head that is assessed again,
 * and the green one. Under the first two, and under green, there is no
 * assessment to show, so what follows is the STORED triage — the
 * comment's URL, its author, and the block it carries — which is the
 * spec's "show the comment".
 *
 * ## An ignored comment is a line of its own
 *
 * A marker comment written by an account nobody trusted is dropped
 * before the reading is built (`./triage-trust.ts`), and its whole
 * sentence is printed under the re-run line, indented like the other
 * evidence. That is the REPORT half of "ignored and reported": the
 * command exits 0 over one, so the only place a person learns a comment
 * was planted is here and in the `ignored` list json mode carries.
 *
 * ## An excerpt is quoted, never folded
 *
 * The log excerpt is capped at {@link FAILED_LOG_TAIL_LINES} by the
 * evidence reader before it gets here, and `excerptCaption` says how
 * much of the log that was. It is printed under its caption, indented
 * like every other evidence line, so a terminal reader sees the same 40
 * lines the comment and the follow-up prompt carry.
 *
 * ## A no-checks assessment ends with how to merge it anyway
 *
 * `no-checks` has nothing to fix, so what a reader needs under it is
 * the decision `rafa pr merge --skip-checks` would ask for, in the
 * words that command prints before its question (`src/pr/unchecked.ts`):
 * the workflow count read, the warning of its case, and the command
 * itself — {@link skipChecksCommand} — with whether `--yes` may answer
 * it. The count is {@link TriageReading.workflows}, which
 * `readWorkflowCount` (`./triage-read.ts`) asked for on this reading;
 * where it was not handed one, the count reads as unread, the riskier
 * case, and never as "no workflow". The lines follow the verdict, in
 * the same place in `src/pr/triage/comment.ts`.
 *
 * ## The prompt is printed whole, unindented
 *
 * The follow-up prompt exists to be COPIED into a session, so it is
 * written exactly as `buildFollowUpPrompt` made it: no indent, no
 * wrapping, no prefix. Indenting it would put four spaces at the head
 * of every line a person pastes, which in markdown is a code block.
 */
import type { ConflictFilesReading, FailedLogsReading, WorkflowCountReading } from './triage-read.js';
import type { IgnoredTriageComment } from './triage-trust.js';
import type { PullRequestDetail } from '../../pr/index.js';
import type { TriageAssessment } from '../../pr/triage/classify.js';
import type { TriageBlock, TriageCommentWrite } from '../../pr/triage/comment.js';
import type { FailedLogEvidence } from '../../pr/triage/evidence.js';
import type { RerunReading } from '../../pr/triage/rerun.js';

import { excerptCaption, excerptLines } from '../../pr/triage/follow-up.js';
import { readUnchecked, skipChecksCommand } from '../../pr/unchecked.js';

import { SEPARATOR } from './current.js';

/** What a line under the headline is indented by, as `formatRows` indents a check row. */
const INDENT = '   ';

/** How many characters of a commit sha a line names it by. */
const SHORT_SHA = 7;

/** What one pull request's triage came to, and everything printed about it. */
export interface TriageReading {
  /** The pull request in full, which everything hangs off. */
  readonly detail: PullRequestDetail;
  /** Which of the four re-run readings this was; see the module note. */
  readonly rerun: RerunReading;
  /**
   * The marker comments passed over because nobody trusted who wrote
   * them, newest first, and empty when none was
   * (`./triage-trust.ts`). One line each; see the module note.
   */
  readonly ignored: readonly IgnoredTriageComment[];
  /** What the classifier concluded, or null when this reading assessed nothing. */
  readonly assessment: TriageAssessment | null;
  /** The failing job logs, or null when none was asked for. */
  readonly logs: FailedLogsReading | null;
  /**
   * The repository's workflow count, or null when it was not asked for:
   * `readWorkflowCount` asks only on verdict `none`. See the module note.
   */
  readonly workflows: WorkflowCountReading | null;
  /** The conflicting file list, or null when GitHub said the head merges. */
  readonly conflict: ConflictFilesReading | null;
  /** The follow-up prompt, or null when nothing was assessed. */
  readonly prompt: string | null;
  /** What the comment write did, or null when none was made. */
  readonly write: TriageCommentWrite | null;
  /** What kept a comment from being written, or null when nothing did. */
  readonly writeProblem: string | null;
  /** The resolve attempts the stored block carried, 0 when it carried none. */
  readonly attempts: number;
  /** `--max-attempts`, which a `--resolve` run would stop at. */
  readonly maxAttempts: number;
}

/** One line per marker comment the trust check passed over; see the module note. */
function ignoredLines(ignored: readonly IgnoredTriageComment[]): readonly string[] {
  return ignored.map((comment) => `${INDENT}${comment.reason}`);
}

/** The evidence the reading carries, or `undefined` when no log was read. */
export function evidenceOf(reading: TriageReading): FailedLogEvidence | undefined {
  return reading.logs?.chosen?.evidence;
}

/**
 * The workflow count the reading carries: the count read, null when it
 * could not be read, and `undefined` when it was never asked for.
 */
export function workflowCountOf(reading: TriageReading): number | null | undefined {
  return reading.workflows === null
    ? undefined
    : reading.workflows.count;
}

/** The `#n title — head → base — head <sha>` line every reading opens with. */
function headLine(detail: PullRequestDetail): string {
  const title = detail.title.trim();
  const head = title === ''
    ? `#${detail.number}`
    : `#${detail.number} ${title}`;
  return [
    head,
    `${detail.headRefName} → ${detail.baseRefName}`,
    `head ${detail.headRefOid.slice(0, SHORT_SHA)}`,
  ].join(SEPARATOR);
}

/** `simple` or `not simple`, the word `--resolve` reads. */
function simpleWord(simple: boolean): string {
  return simple
    ? 'simple'
    : 'not simple';
}

/** How many resolve attempts have been spent, against the cap the line set. */
function attemptWord(reading: TriageReading): string {
  return `attempts ${reading.attempts} of ${reading.maxAttempts}`;
}

/** A list of paths, or the sentence for none. */
function pathList(files: readonly string[], none: string): string {
  return files.length === 0
    ? none
    : files.join(', ');
}

/** What the conflicting-files line says when the list is empty. */
function noFiles(reading: TriageReading): string {
  const conflict = reading.conflict;
  if (conflict === null) return 'none; the head merges cleanly';
  if (conflict.kind === 'unread') {
    return `none read; no ref of ${conflict.tried.join(', ')} resolves here, so the head was not merged locally`;
  }
  if (conflict.kind === 'error') {
    return `none read; git could not merge ${conflict.head ?? '?'} into ${conflict.base ?? '?'}`;
  }
  return 'none; the head merges cleanly';
}

/** The log excerpt under its caption, each line indented; empty when there is none. */
function excerptBlock(reading: TriageReading): readonly string[] {
  const evidence = evidenceOf(reading);
  if (evidence === undefined) return [];
  const excerpt = excerptLines(evidence);
  if (excerpt.lines.length === 0) return [];
  return [
    `${INDENT}${excerptCaption(excerpt)}`,
    ...excerpt.lines.map((line) => `${INDENT}${INDENT}${line}`),
  ];
}

/**
 * The lines under a `no-checks` assessment: the workflow count, the
 * warning of its case and the `--skip-checks` line; empty for every
 * other class. See the module note.
 */
export function noChecksLines(reading: TriageReading, assessment: TriageAssessment): readonly string[] {
  if (assessment.triageClass !== 'no-checks') return [];
  const number = reading.detail.number;
  const unchecked = readUnchecked(number, workflowCountOf(reading) ?? null);
  const [count = '', warning = ''] = unchecked.warning;
  const yes = unchecked.yesMayAnswer
    ? '--yes may answer it'
    : '--yes is refused, so a person must answer it';
  return [
    `${INDENT}Workflows: ${count}`,
    `${INDENT}Warning: ${warning}`,
    `${INDENT}To merge it anyway: ${skipChecksCommand(number)} (it asks first; ${yes})`,
  ];
}

/** The evidence lines of an assessment: why, the files, the step, the checks, the verdict. */
function evidenceLines(reading: TriageReading, assessment: TriageAssessment): readonly string[] {
  const step = assessment.step === undefined
    ? 'none named'
    : assessment.step.name;
  return [
    `${INDENT}Why: ${assessment.reason}`,
    `${INDENT}Conflicting files: ${pathList(assessment.files, noFiles(reading))}`,
    `${INDENT}Failing step: ${step}`,
    `${INDENT}Failing checks: ${pathList(assessment.failing.map((row) => row.name), 'none failing')}`,
    `${INDENT}Checks verdict: ${assessment.verdict}`,
    ...noChecksLines(reading, assessment),
    ...excerptBlock(reading),
  ];
}

/** The stored block as one line, for a reading that assessed nothing. */
function storedBlockLine(block: TriageBlock): string {
  const words = [
    `class ${block.class ?? 'unreadable'}`,
    block.simple === null
      ? null
      : simpleWord(block.simple),
    block.attempts === null
      ? null
      : `attempts ${block.attempts}`,
    block.files === null || block.files.length === 0
      ? null
      : `files ${block.files.join(', ')}`,
  ].filter((word): word is string => word !== null);
  return `${INDENT}${words.join(SEPARATOR)}`;
}

/** The stored triage: the comment it is in, its block, and what did not read in it. */
function storedLines(reading: TriageReading): readonly string[] {
  const comment = reading.rerun.comment;
  if (comment === null) return [];
  return [
    `${INDENT}${comment.url}${SEPARATOR}by ${comment.author.login}`,
    ...reading.rerun.block === null
      ? []
      : [storedBlockLine(reading.rerun.block)],
    ...reading.rerun.problems.map((problem) => `${INDENT}${problem}`),
  ];
}

/** The line naming the comment this run wrote, or why it wrote none. */
function writeLines(reading: TriageReading): readonly string[] {
  if (reading.writeProblem !== null) {
    return [`The triage comment could not be written${SEPARATOR}${reading.writeProblem}`];
  }
  if (reading.write === null) {
    return reading.rerun.write === 'none' && reading.assessment !== null
      ? ['No comment was written.']
      : [];
  }
  const action = reading.write.action === 'posted'
    ? 'Posted'
    : 'Edited';
  return [`${action} the triage comment: ${reading.write.comment.url}`];
}

/** What the log reader could not read, one warning line each. */
function logProblemLines(reading: TriageReading): readonly string[] {
  const logs = reading.logs;
  if (logs === null) return [];
  const unlinked = logs.unlinked.length === 0
    ? []
    : [`${INDENT}no Actions run is linked from ${logs.unlinked.join(', ')}, so no log was read for it`];
  return [...logs.problems.map((problem) => `${INDENT}${problem}`), ...unlinked];
}

/** The class line and the evidence under it, for a reading that assessed. */
function assessedLines(reading: TriageReading, assessment: TriageAssessment): readonly string[] {
  return [
    [assessment.triageClass, simpleWord(assessment.simple), attemptWord(reading)].join(SEPARATOR),
    ...evidenceLines(reading, assessment),
    ...logProblemLines(reading),
  ];
}

/**
 * The whole report for one pull request: the head line, the re-run
 * reading, the class with its evidence or the stored triage, what was
 * written, and the follow-up prompt. Pure and total; see the module
 * note.
 */
export function renderTriage(reading: TriageReading): string {
  const { assessment } = reading;
  const body = assessment === null
    ? storedLines(reading)
    : assessedLines(reading, assessment);
  const blocks: readonly (readonly string[])[] = [
    [headLine(reading.detail), reading.rerun.headline, ...ignoredLines(reading.ignored), ...body],
    writeLines(reading),
    reading.prompt === null
      ? []
      : ['Follow-up prompt:', reading.prompt.trimEnd()],
  ];
  return blocks
    .filter((block) => block.length > 0)
    .map((block) => block.join('\n'))
    .join('\n\n');
}

/** Every pull request's report, blank line between, as the command writes them. */
export function renderTriages(readings: readonly TriageReading[]): string {
  return readings.map((reading) => renderTriage(reading)).join('\n\n');
}
