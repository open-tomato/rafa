/**
 * What `rafa pr merge --skip-checks` says and allows, read from the
 * repository's workflow count alone.
 *
 * A pull request whose checks read verdict `none` (`./checks.ts`) has
 * no check row at all, and zero rows mean one of two different things.
 * The only reading code can take to tell them apart is the workflow
 * count, `PullRequests.workflowCount` (`./types.ts`), so this module
 * turns that count into everything the command prints and decides
 * around the question, and nothing else: no provider, no terminal, no
 * git. Whether `--skip-checks` is allowed at all is `readMergeRefusal`'s
 * answer in `./merge.ts`, read before anything here.
 *
 * ## The two cases
 *
 *  - `no-workflow`: the count read zero. Nothing on GitHub was ever
 *    going to test the branch, so an unchecked merge is a choice the
 *    operator can make ahead of time, and `--yes` may answer.
 *  - `workflows-exist`: the count read one or more, OR it could not be
 *    read (the port answers null on any failure). Here "no checks" is
 *    more likely a fault than a choice — a path filter, a draft, Actions
 *    disabled, or a run not yet registered — so `--yes` may NOT answer
 *    and a person must. An unreadable count lands here on purpose: an
 *    outage or a missing permission must never pass for "this
 *    repository has no workflow", which is the case that relaxes the
 *    rule.
 *
 * ## The spellings
 *
 * The two warnings, the question and the comment's first sentence are
 * spelled as `.rafa/specs/rafa-86-merge-pull-request-reports.md` spells
 * them, and each is exported once so the command, `rafa next` and
 * `rafa pr triage` cannot spell them two ways. The count line is shared
 * by the warning and the comment, so what the operator saw before the
 * question and what the pull request's history records say the same.
 */

/** Which of the two readings of "no checks" a workflow count gives; see the module note. */
export type UncheckedCase = 'no-workflow' | 'workflows-exist';

/** The warning printed when the repository defines no workflow. */
export const NO_WORKFLOW_WARNING = 'nothing on GitHub has tested this branch; you are relying on the checks run locally';

/** The warning printed when workflows exist, or their count could not be read. */
export const WORKFLOWS_EXIST_WARNING = 'CI may not have started (a path filter, a draft, Actions disabled, or it has not registered yet); this is probably not what you want';

/** The first sentence of the comment posted after an unchecked merge. */
export const UNCHECKED_MERGE_SENTENCE = 'Merged with no checks reported, by rafa pr merge --skip-checks.';

/** Everything the command needs around the question, read from one workflow count. */
export interface UncheckedReading {
  /** Which reading of "no checks" the count gives. */
  readonly case: UncheckedCase;
  /** The lines printed before the question: the count read, then the warning. */
  readonly warning: readonly string[];
  /** Whether `--yes` may answer the question; false means a person must. */
  readonly yesMayAnswer: boolean;
  /** The question asked, `Merge #<n> with no checks? [y/N]`. */
  readonly question: string;
  /** The body of the one comment posted on the pull request after the merge. */
  readonly comment: string;
}

/**
 * The case a workflow count gives: zero is `no-workflow`; one or more,
 * or null (a count that could not be read), is `workflows-exist`.
 */
export function uncheckedCaseOf(workflowCount: number | null): UncheckedCase {
  return workflowCount === 0
    ? 'no-workflow'
    : 'workflows-exist';
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
 * and, as its own paragraph, the workflow count that was read.
 */
export function uncheckedComment(workflowCount: number | null): string {
  return `${UNCHECKED_MERGE_SENTENCE}\n\n${workflowCountLine(workflowCount)}`;
}

/**
 * Reads pull request `number`'s unchecked merge from the repository's
 * workflow count: its case, the warning lines, whether `--yes` may
 * answer, the question and the comment body.
 */
export function readUnchecked(number: number, workflowCount: number | null): UncheckedReading {
  const which = uncheckedCaseOf(workflowCount);
  const warning = which === 'no-workflow'
    ? NO_WORKFLOW_WARNING
    : WORKFLOWS_EXIST_WARNING;
  return Object.freeze({
    case: which,
    warning: Object.freeze([workflowCountLine(workflowCount), warning]),
    yesMayAnswer: which === 'no-workflow',
    question: uncheckedQuestion(number),
    comment: uncheckedComment(workflowCount),
  });
}
