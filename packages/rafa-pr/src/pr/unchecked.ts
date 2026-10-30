/**
 * What `rafa pr merge --skip-checks` says and allows, read from the
 * repository's workflow count and, where they were read, the workflow
 * files on the pull request's base.
 *
 * A pull request whose checks read verdict `none` (`./checks.ts`) has
 * no check row at all, and zero rows mean one of several different
 * things. The workflow count, `PullRequests.workflowCount`
 * (`./types.ts`), tells the first two apart; the workflow files on the
 * base, read by the command and judged by `./workflow-triggers.ts`, tell
 * the third. This module turns those readings into everything the
 * command prints and decides around the question, and nothing else: no
 * provider, no terminal, no git. Whether `--skip-checks` is allowed at
 * all is `readMergeRefusal`'s answer in `./merge.ts`, read before
 * anything here.
 *
 * ## The three cases
 *
 *  - `no-workflow`: the count read zero. Nothing on GitHub was ever
 *    going to test the branch, so an unchecked merge is a choice the
 *    operator can make ahead of time, and `--yes` may answer.
 *  - `no-pull-request-workflow`: the count read one or more, AND the
 *    workflow files on the base were read and none of them has a
 *    `pull_request` trigger naming the base. The workflows that exist
 *    test something else (a push, another base), so nothing was going
 *    to test this pull request either, and `--yes` may answer. Its
 *    warning is the one line saying why,
 *    `no workflow runs on pull requests into <base>`.
 *  - `workflows-exist`: every other reading — the count read one or
 *    more and the files were not read or name the base, OR the count
 *    could not be read (the port answers null on any failure). Here "no
 *    checks" is more likely a fault than a choice — a path filter, a
 *    draft, Actions disabled, or a run not yet registered — so `--yes`
 *    may NOT answer and a person must. An unreadable count lands here on
 *    purpose, whatever the files said: an outage or a missing permission
 *    must never pass for a case that relaxes the rule.
 *
 * Callers that read the count alone (`rafa pr triage`, its comment)
 * leave the base reading out, and read the first and the last case only,
 * as they always have.
 *
 * ## The spellings
 *
 * The two count-rule warnings, the question and the comment's first
 * sentence are spelled as `.rafa/specs/rafa-86-merge-pull-request-reports.md`
 * spells them, and each is exported once so the command, `rafa next` and
 * `rafa pr triage` cannot spell them two ways. The count line is shared
 * by the warning and the comment, and so is the base line of the third
 * case, so what the operator saw before the question and what the pull
 * request's history records say the same.
 */

/** Which reading of "no checks" the workflow count and the base's workflow files give; see the module note. */
export type UncheckedCase = 'no-workflow' | 'no-pull-request-workflow' | 'workflows-exist';

/**
 * What the workflow files on a pull request's base said, where the
 * command could read them: the base, and whether any of the files has a
 * `pull_request` trigger naming it (`./workflow-triggers.ts`).
 */
export interface BaseWorkflowReading {
  /** The pull request's base branch, such as `stretch/1`. */
  readonly base: string;
  /** True when at least one workflow file on the base runs on pull requests into it. */
  readonly runsOnPullRequests: boolean;
}

/** The warning printed when the repository defines no workflow. */
export const NO_WORKFLOW_WARNING = 'nothing on GitHub has tested this branch; you are relying on the checks run locally';

/** The warning printed when workflows exist, or their count could not be read. */
export const WORKFLOWS_EXIST_WARNING = 'CI may not have started (a path filter, a draft, Actions disabled, or it has not registered yet); this is probably not what you want';

/** The first sentence of the comment posted after an unchecked merge. */
export const UNCHECKED_MERGE_SENTENCE = 'Merged with no checks reported, by rafa pr merge --skip-checks.';

/** Everything the command needs around the question, read from the workflow count and the base's files. */
export interface UncheckedReading {
  /** Which reading of "no checks" the count and the base's files give. */
  readonly case: UncheckedCase;
  /** The lines printed before the question: the count read, then the warning or the base line. */
  readonly warning: readonly string[];
  /** Whether `--yes` may answer the question; false means a person must. */
  readonly yesMayAnswer: boolean;
  /** The question asked, `Merge #<n> with no checks? [y/N]`. */
  readonly question: string;
  /** The body of the one comment posted on the pull request after the merge. */
  readonly comment: string;
}

/**
 * The case a workflow count and the base's workflow files give: zero is
 * `no-workflow`; one or more with files read that name no pull request
 * into the base is `no-pull-request-workflow`; anything else, null (a
 * count that could not be read) included, is `workflows-exist`.
 *
 * @param workflowCount - The repository's workflow count, or null where it could not be read.
 * @param baseWorkflows - What the base's workflow files said, or null or absent where they were not read.
 * @returns The case; see the module note.
 */
export function uncheckedCaseOf(
  workflowCount: number | null,
  baseWorkflows: BaseWorkflowReading | null = null,
): UncheckedCase {
  if (workflowCount === 0) return 'no-workflow';
  if (workflowCount !== null && baseWorkflows !== null && !baseWorkflows.runsOnPullRequests) {
    return 'no-pull-request-workflow';
  }
  return 'workflows-exist';
}

/** The line the `no-pull-request-workflow` case warns with, and its comment carries, for `base`. */
export function noPullRequestWorkflowLine(base: string): string {
  return `no workflow runs on pull requests into ${base}`;
}

/**
 * The one line saying what the workflow count read, or that it could not
 * be read, as the warning and the comment both print it.
 */
export function workflowCountLine(workflowCount: number | null): string {
  if (workflowCount === null) return 'The repository\'s workflow count could not be read.';
  const noun = workflowCount === 1
    ? 'workflow'
    : 'workflows';
  return `The repository defines ${workflowCount} ${noun}.`;
}

/**
 * The command that merges pull request `number` with no checks,
 * `rafa pr merge <n> --skip-checks`, as `rafa pr triage` prints it under
 * a `no-checks` assessment.
 */
export function skipChecksCommand(number: number): string {
  return `rafa pr merge ${number} --skip-checks`;
}

/** The question asked before an unchecked merge of pull request `number`. */
export function uncheckedQuestion(number: number): string {
  return `Merge #${number} with no checks? [y/N]`;
}

/**
 * The comment posted after an unchecked merge: {@link UNCHECKED_MERGE_SENTENCE}
 * and, as its own paragraph, the workflow count that was read, then the
 * `no-pull-request-workflow` case's base line where `baseLine` is given.
 */
export function uncheckedComment(workflowCount: number | null, baseLine: string | null = null): string {
  const countLine = workflowCountLine(workflowCount);
  const paragraphs = baseLine === null
    ? [UNCHECKED_MERGE_SENTENCE, countLine]
    : [UNCHECKED_MERGE_SENTENCE, countLine, baseLine];
  return paragraphs.join('\n\n');
}

/** The line after the count line: the case's warning, or the base line in the third case. */
function warningOf(which: UncheckedCase, baseWorkflows: BaseWorkflowReading | null): string {
  if (which === 'no-workflow') return NO_WORKFLOW_WARNING;
  if (which === 'no-pull-request-workflow' && baseWorkflows !== null) return noPullRequestWorkflowLine(baseWorkflows.base);
  return WORKFLOWS_EXIST_WARNING;
}

/**
 * Reads pull request `number`'s unchecked merge from the repository's
 * workflow count and, where they were read, the workflow files on its
 * base: its case, the warning lines, whether `--yes` may answer, the
 * question and the comment body. Left out, `baseWorkflows` reads as the
 * count rule alone.
 *
 * @param number - The pull request's number.
 * @param workflowCount - The repository's workflow count, or null where it could not be read.
 * @param baseWorkflows - What the base's workflow files said, or null or absent where they were not read.
 * @returns The reading, frozen.
 */
export function readUnchecked(
  number: number,
  workflowCount: number | null,
  baseWorkflows: BaseWorkflowReading | null = null,
): UncheckedReading {
  const which = uncheckedCaseOf(workflowCount, baseWorkflows);
  const warning = warningOf(which, baseWorkflows);
  const isBaseCase = which === 'no-pull-request-workflow';
  return Object.freeze({
    case: which,
    warning: Object.freeze([workflowCountLine(workflowCount), warning]),
    yesMayAnswer: which !== 'workflows-exist',
    question: uncheckedQuestion(number),
    comment: uncheckedComment(workflowCount, isBaseCase
      ? warning
      : null),
  });
}
