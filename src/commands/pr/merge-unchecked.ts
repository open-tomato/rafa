/**
 * The part of `rafa pr merge --skip-checks` that is not an ordinary
 * merge: the workflow count read, the workflow files on the base read,
 * the refusals they decide, the warning, the question, and the one
 * comment posted after the merge.
 *
 * What each of those SAYS is `src/pr/unchecked.ts`'s, a pure reading
 * over the workflow count and what the base's workflow files said.
 * Whether `--skip-checks` is allowed at all — verdict `none` alone — is
 * `readMergeRefusal`'s in `src/pr/merge.ts`, read before anything here.
 * This module is the half that acts: it asks the provider for the count,
 * reads the base's workflow files through git, refuses, prints, asks the
 * terminal and posts. The merge itself and the clean-up after it stay
 * `./merge.ts`'s, which calls in here at three points.
 *
 * ## The three calls, in `./merge.ts`'s own order
 *
 *  1. {@link readUncheckedMerge}, after `readMergeRefusal` and BEFORE the
 *     summary line is written. It reads the count, and the base's
 *     workflow files where the count reads one or more, and makes the two
 *     refusals this flag adds, so a run that is refused writes nothing to
 *     stdout, which is the rule `./merge.ts` already keeps for its own
 *     no-terminal refusal.
 *  2. {@link confirmUncheckedMerge}, after the summary line and in place
 *     of `Merge? [y/N]`. It prints the warning, then asks
 *     `Merge #<n> with no checks? [y/N]` — or, where `--yes` was allowed
 *     to answer, prints the warning and asks nothing. The warning is
 *     printed EVERY time, `--yes` or not: the spec answers "the flag
 *     becomes a habit" with a warning that is never skipped.
 *  3. {@link commentIfUnchecked}, once the provider has merged, which
 *     posts through {@link postUncheckedComment} and prints the URL.
 *
 * What the result carries for the flag is {@link uncheckedReport}'s.
 *
 * ## The two refusals, and their order
 *
 * `--yes` in the workflows-exist case is refused first, then no terminal
 * without `--yes`. The first is a refusal of what the operator TYPED, so
 * it answers whatever the terminal is; the second only arises where
 * nothing was typed to answer the question. Both are exit 1, like every
 * `pr merge` refusal, and both carry the count line, the warning and the
 * summary, since a refused run prints nothing else that would say why.
 *
 * The no-terminal refusal is this module's and not `./merge.ts`'s
 * because its advice differs by case: `./merge.ts`'s says "merge it
 * without the question with --yes", which in the workflows-exist case
 * names a flag that is refused. Here that advice is given only where
 * `--yes` may answer; otherwise the refusal says a person has to.
 *
 * ## A count that could not be read
 *
 * The port answers null for it and never throws
 * (`PullRequests.workflowCount`, `src/pr/types.ts`). A provider that
 * throws anyway is read here as null too, rather than failing the
 * command: null is the riskier reading, the one that refuses `--yes`,
 * so nothing an outage does can relax the rule.
 *
 * ## The workflow files on the base
 *
 * A count of one or more does not say that anything tests THIS pull
 * request: `verify.yml` runs on `pull_request` into `main` and on `push`
 * to `stretch/**`, so a pull request into `stretch/1` reports no checks
 * by design. So where the count reads one or more, and only there,
 * {@link readBaseWorkflows} runs `git fetch origin <base>`, lists
 * `.github/workflows/` on `origin/<base>` with
 * `git ls-tree --full-tree -z` (the top of the tree, whichever directory
 * the project root is), keeps the `*.yml` and `*.yaml` blobs, reads each
 * with `git cat-file blob`, and hands the texts to
 * `src/pr/workflow-triggers.ts`. Where none has a `pull_request`
 * trigger naming the base, the case is `no-pull-request-workflow` and
 * `--yes` may answer.
 *
 * Every git step goes through the command's own `GitRunner`, so a test
 * double and a real repository with a bare `origin` drive the same path.
 * Any reading that fails answers null, and null is today's count rule:
 *
 *  - a base that is empty or opens with `-`, which git would read as an
 *    option rather than a branch;
 *  - `fetch`, `ls-tree` or any `cat-file` exiting non-zero;
 *  - a base with no workflow file at all. The count says workflows
 *    exist, so ones this reading cannot see — a dynamic workflow such as
 *    CodeQL's default setup, or a file on another branch — may run on
 *    pull requests into it, and the riskier reading stands.
 *
 * A count of zero or one that could not be read never reaches git: zero
 * already lets `--yes` answer, and an unreadable count keeps refusing it
 * whatever the files say (see `src/pr/unchecked.ts`).
 *
 * ## The comment, and why its failure is a warning
 *
 * It is posted once the provider has merged, and by then nothing about
 * the comment can un-merge anything. A comment that would not post is
 * therefore a warning naming it, carrying the body so the operator can
 * post it by hand, and the command keeps its exit code — the reasoning
 * `./merge-tick.ts` gives for the roadmap tick. For the same reason
 * `./merge.ts` should post it straight after the merge rather than
 * behind the local clean-up, which can fail and would silently drop it.
 */
import type { Prompter } from '../../cli/prompt/confirm.js';
import type { GitRunner, PullRequestComment, PullRequests } from '../../pr/index.js';
import type { BaseWorkflowReading, UncheckedCase, UncheckedReading } from '../../pr/unchecked.js';

import { CommandExit } from '../../cli/command.js';
import { createLinePrompter } from '../../cli/prompt/confirm.js';
import { messageOf } from '../../config-sections.js';
import { readUnchecked } from '../../pr/unchecked.js';
import { workflowsRunOnPullRequestsInto } from '../../pr/workflow-triggers.js';

/** The indent a refusal's quoted lines carry, as `./merge.ts` indents them. */
const INDENT = '   ';

/** The answers that mean yes to a question spelled `[y/N]`. */
const YES_ANSWERS: readonly string[] = ['y', 'yes'];

/** Where GitHub reads workflow files from, at the top of the tree; the slash lists what is inside. */
const WORKFLOWS_DIR = '.github/workflows/';

/** The endings GitHub reads a workflow file under. */
const WORKFLOW_ENDINGS: readonly string[] = ['.yml', '.yaml'];

/** One `git ls-tree` entry: mode, type, object id, then the path after a tab. */
const LS_TREE_ENTRY = /^\d+ (\w+) ([0-9a-f]+)\t(.+)$/s;

/** What {@link readUncheckedMerge} is asked. */
export interface UncheckedMergeOptions {
  /** The provider the count is read from. */
  readonly pulls: PullRequests;
  /** The pull request being merged. */
  readonly number: number;
  /** Whether `--yes` was given. */
  readonly yes: boolean;
  /** The line the question is asked under, which a refusal carries once. */
  readonly summary: string;
  /** True when a question can be answered. Standard input being a TTY when left out. */
  readonly isTerminal?: () => boolean;
  /** The pull request's base branch, whose workflow files are read; the count rule alone when left out. */
  readonly base?: string;
  /** The git runner the base's workflow files are read through; the count rule alone when left out. */
  readonly git?: GitRunner;
}

/** What an unchecked merge read, allowed past both refusals. */
export interface UncheckedMerge {
  /** The workflow count read, or null where it could not be read. */
  readonly workflowCount: number | null;
  /** What the base's workflow files said, or null where they were not read; see the module note. */
  readonly baseWorkflows: BaseWorkflowReading | null;
  /** Everything `src/pr/unchecked.ts` reads from that count. */
  readonly reading: UncheckedReading;
  /** Whether `--yes` was given, and so answers the question; see the module note. */
  readonly yes: boolean;
}

/** A refusal of an unchecked merge, exit code 1, carrying why and the summary. */
function refusal(head: string, reading: UncheckedReading, summary: string, tail: string): CommandExit {
  return new CommandExit(1, [
    `❌ ${head}`,
    ...reading.warning.map((line) => `${INDENT}${line}`),
    `${INDENT}${summary}`,
    tail,
  ].join('\n'));
}

/** The workflow count, with a provider that threw read as null; see the module note. */
async function workflowCountOf(pulls: PullRequests): Promise<number | null> {
  try {
    return await pulls.workflowCount();
  } catch {
    return null;
  }
}

/** The object ids of the `*.yml` and `*.yaml` blobs a `git ls-tree -z` listing names. */
export function workflowBlobsOf(listing: string): readonly string[] {
  return listing.split('\0')
    .map((entry) => LS_TREE_ENTRY.exec(entry))
    .filter((match) => match !== null)
    .filter(([, type, , path]) => type === 'blob' && WORKFLOW_ENDINGS.some((ending) => path?.endsWith(ending) === true))
    .map(([, , oid]) => oid ?? '');
}

/**
 * Reads the workflow files on `origin/<base>` after `git fetch origin
 * <base>`, through `git`, and answers whether any of them runs on pull
 * requests into `base` — or null where any step failed or the base has
 * no workflow file, which is the count rule. Never throws; see the
 * module note.
 *
 * @param git - The command's git runner, at the project root.
 * @param base - The pull request's base branch.
 * @returns What the base's workflow files said, or null where they could not be read.
 */
export function readBaseWorkflows(git: GitRunner, base: string): BaseWorkflowReading | null {
  if (base === '' || base.startsWith('-')) return null;
  if (!git(['fetch', 'origin', base]).ok) return null;
  const listed = git(['ls-tree', '--full-tree', '-z', `origin/${base}`, WORKFLOWS_DIR]);
  if (!listed.ok) return null;
  const blobs = workflowBlobsOf(listed.stdout);
  if (blobs.length === 0) return null;
  const shown = blobs.map((oid) => git(['cat-file', 'blob', oid]));
  if (shown.some((result) => !result.ok)) return null;
  const texts = shown.map((result) => result.stdout);
  return Object.freeze({ base, runsOnPullRequests: workflowsRunOnPullRequestsInto(texts, base) });
}

/** The base's workflow files, read only where the count read one or more and git and the base were given. */
function baseWorkflowsOf(options: UncheckedMergeOptions, workflowCount: number | null): BaseWorkflowReading | null {
  const { git, base } = options;
  if (workflowCount === null || workflowCount === 0 || git === undefined || base === undefined) return null;
  return readBaseWorkflows(git, base);
}

/**
 * Reads the workflow count for an unchecked merge of pull request
 * `number` and, where it reads one or more, the workflow files on its
 * base, and refuses, exit 1, where `--yes` was given in the
 * workflows-exist case or where there is no terminal and no `--yes`.
 * Writes nothing; see the module note for when it is called.
 */
export async function readUncheckedMerge(options: UncheckedMergeOptions): Promise<UncheckedMerge> {
  const { pulls, number, yes, summary } = options;
  const workflowCount = await workflowCountOf(pulls);
  const baseWorkflows = baseWorkflowsOf(options, workflowCount);
  const reading = readUnchecked(number, workflowCount, baseWorkflows);

  if (yes && !reading.yesMayAnswer) {
    throw refusal(
      `rafa pr merge refuses --yes for #${number} with no checks: workflows exist, or their count could not be read.`,
      reading,
      summary,
      'That is more likely a fault than a choice, so a person has to answer. Run it again without --yes on a terminal.',
    );
  }

  const isTerminal = options.isTerminal ?? ((): boolean => process.stdin.isTTY === true);
  if (!yes && !isTerminal()) {
    const tail = reading.yesMayAnswer
      ? 'Merge it without the question with --yes.'
      : '--yes is refused here, so run it on a terminal and answer it.';
    throw refusal(
      `rafa pr merge asks before merging #${number} with no checks, and standard input is no terminal.`,
      reading,
      summary,
      tail,
    );
  }

  return Object.freeze({ workflowCount, baseWorkflows, reading, yes });
}

/** What {@link confirmUncheckedMerge} prints through and asks on. */
export interface UncheckedConfirmOptions {
  /** Where the count line and the warning are printed. */
  readonly warn: (message: string) => void;
  /** Opens the prompter the question is asked through. Called only to ask. */
  readonly openPrompter?: () => Prompter;
}

/** An answer to a question spelled `[y/N]`: yes for `y` or `yes`, however it is cased and padded. */
function isYes(answer: string | null): boolean {
  return answer !== null && YES_ANSWERS.includes(answer.trim().toLowerCase());
}

/**
 * Prints the count line and the warning, then answers whether to merge:
 * true at once where `--yes` was given (and {@link readUncheckedMerge}
 * already allowed it), otherwise the answer to
 * `Merge #<n> with no checks? [y/N]`, where anything but `y` or `yes`,
 * the empty answer and an ended input included, is no.
 */
export async function confirmUncheckedMerge(
  unchecked: UncheckedMerge,
  options: UncheckedConfirmOptions,
): Promise<boolean> {
  for (const line of unchecked.reading.warning) options.warn(line);
  if (unchecked.yes) return true;

  const open = options.openPrompter ?? ((): Prompter => createLinePrompter(process.stdin, process.stderr));
  const prompter = open();
  try {
    return isYes(await prompter.ask(`${unchecked.reading.question} `));
  } finally {
    prompter.close();
  }
}

/** What a comment that would not post says; see the module note. */
export function commentProblemLine(number: number, problem: string, body: string): string {
  const quoted = body.split('\n')
    .map((line) => `${INDENT}${line}`)
    .join('\n');
  return `the unchecked-merge comment was not posted on #${number}: ${problem}. Post it yourself:\n${quoted}`;
}

/**
 * Posts the one comment an unchecked merge leaves on pull request
 * `number` — the unchecked-merge sentence, the workflow count read and,
 * in the `no-pull-request-workflow` case, the base line —
 * and answers it as posted, or null where it would not post, which is a
 * warning through `warn` and nothing else. Never throws.
 */
export async function postUncheckedComment(
  pulls: PullRequests,
  number: number,
  unchecked: UncheckedMerge,
  warn: (message: string) => void,
): Promise<PullRequestComment | null> {
  const body = unchecked.reading.comment;
  try {
    return await pulls.comment(number, body);
  } catch (error) {
    warn(commentProblemLine(number, messageOf(error), body));
    return null;
  }
}

/** What `--skip-checks` read and posted, as `pr merge`'s result carries it. */
export interface UncheckedMergeReport {
  /** The workflow count read, or null where it could not be read. */
  readonly workflowCount: number | null;
  /** Which reading of "no checks" that count and the base's workflow files give. */
  readonly case: UncheckedCase;
  /** The URL of the comment posted after the merge; null for a declined merge or a comment that would not post. */
  readonly commentUrl: string | null;
}

/** What `pr merge`'s result carries for `--skip-checks`, or null without it. */
export function uncheckedReport(unchecked: UncheckedMerge | null, commentUrl: string | null): UncheckedMergeReport | null {
  return unchecked === null
    ? null
    : { workflowCount: unchecked.workflowCount, case: unchecked.reading.case, commentUrl };
}

/**
 * Posts the unchecked-merge comment where `--skip-checks` was given and
 * says so through `report.info`; its URL, or null without the flag or
 * where it would not post. Never throws.
 */
export async function commentIfUnchecked(
  pulls: PullRequests,
  number: number,
  unchecked: UncheckedMerge | null,
  report: { readonly info: (message: string) => void; readonly warn: (message: string) => void },
): Promise<string | null> {
  if (unchecked === null) return null;
  const posted = await postUncheckedComment(pulls, number, unchecked, report.warn);
  if (posted === null) return null;
  report.info(`Commented on #${number} that it was merged with no checks: ${posted.url}`);
  return posted.url;
}
