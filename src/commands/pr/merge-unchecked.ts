/**
 * The part of `rafa pr merge --skip-checks` that is not an ordinary
 * merge: the workflow count read, the refusals it decides, the warning,
 * the question, and the one comment posted after the merge.
 *
 * What each of those SAYS is `src/pr/unchecked.ts`'s, a pure reading
 * over one workflow count. Whether `--skip-checks` is allowed at all —
 * verdict `none` alone — is `readMergeRefusal`'s in `src/pr/merge.ts`,
 * read before anything here. This module is the half that acts: it asks
 * the provider for the count, refuses, prints, asks the terminal and
 * posts. The merge itself and the clean-up after it stay
 * `./merge.ts`'s, which calls in here at three points.
 *
 * ## The three calls, in `./merge.ts`'s own order
 *
 *  1. {@link readUncheckedMerge}, after `readMergeRefusal` and BEFORE the
 *     summary line is written. It reads the count and makes the two
 *     refusals this flag adds, so a run that is refused writes nothing to
 *     stdout, which is the rule `./merge.ts` already keeps for its own
 *     no-terminal refusal.
 *  2. {@link confirmUncheckedMerge}, after the summary line and in place
 *     of `Merge? [y/N]`. It prints the warning, then asks
 *     `Merge #<n> with no checks? [y/N]` — or, where `--yes` was allowed
 *     to answer, prints the warning and asks nothing. The warning is
 *     printed EVERY time, `--yes` or not: the spec answers "the flag
 *     becomes a habit" with a warning that is never skipped.
 *  3. {@link postUncheckedComment}, once the provider has merged.
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
import type { PullRequestComment, PullRequests } from '../../pr/index.js';
import type { UncheckedReading } from '../../pr/unchecked.js';

import { CommandExit } from '../../cli/command.js';
import { createLinePrompter } from '../../cli/prompt/confirm.js';
import { messageOf } from '../../config-sections.js';
import { readUnchecked } from '../../pr/unchecked.js';

/** The indent a refusal's quoted lines carry, as `./merge.ts` indents them. */
const INDENT = '   ';

/** The answers that mean yes to a question spelled `[y/N]`. */
const YES_ANSWERS: readonly string[] = ['y', 'yes'];

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
}

/** What an unchecked merge read, allowed past both refusals. */
export interface UncheckedMerge {
  /** The workflow count read, or null where it could not be read. */
  readonly workflowCount: number | null;
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

/**
 * Reads the workflow count for an unchecked merge of pull request
 * `number` and refuses, exit 1, where `--yes` was given in the
 * workflows-exist case or where there is no terminal and no `--yes`.
 * Writes nothing; see the module note for when it is called.
 */
export async function readUncheckedMerge(options: UncheckedMergeOptions): Promise<UncheckedMerge> {
  const { pulls, number, yes, summary } = options;
  const workflowCount = await workflowCountOf(pulls);
  const reading = readUnchecked(number, workflowCount);

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

  return Object.freeze({ workflowCount, reading, yes });
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
 * `number` — the unchecked-merge sentence and the workflow count read —
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
