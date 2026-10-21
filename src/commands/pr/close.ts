/**
 * `rafa pr close <n> --reason=<text> [--delete-branch] [--yes]`: one open
 * pull request closed WITHOUT merging it, through `PullRequests.close`,
 * with the reason left as its closing comment. Starts no Claude session
 * and declares no `spends`.
 *
 * ## What it reads, in order
 *
 * The line first: the two switches, then exactly one pull request
 * number, then `--reason`, required and not blank. The switches are read
 * ahead of the number for the reason `pr-context.ts` gives, so a
 * `--yes 41` is refused naming the order that works and not as a line
 * naming no pull request. The number must be on the line: a close acts
 * on a pull request the caller already holds, not on the branch checked
 * out. Then the config and the provider through `openPrContext`, so a
 * line refused for its words reads no config, makes no provider and
 * spawns no `gh`, the rule `pr-context.ts` keeps for every `pr` action.
 *
 * Then `get(n)`, the one read of the run. It answers the state, and the
 * port leaves the state to its caller: what a provider answers to a close
 * of a pull request that is not open is not held there (`src/pr/types.ts`),
 * so no close is ever sent for one. A pull request the repository does
 * not hold, one already merged and one already closed are each refused
 * naming which it is.
 *
 * ## What it prints, and the question
 *
 * Three lines ({@link summaryLines}): the number and the title, the head
 * branch, and the issues a merge would have closed, saying they stay
 * open. Those issues are the provider's link (`PullRequestDetail.closes`),
 * each written `owner/name#<n>` with the repository the provider
 * answered, since one of them can live in another repository. Closing a
 * pull request closes none of them, which is why the line is there.
 *
 * Then `Close #<n> without merging? [y/N]`, asked through a line
 * prompter on standard error. An answer that is not `y` or `yes`, the
 * empty answer and an input that ended included, declines: it prints
 * that nothing was closed and exits 0. `--yes` answers the question and
 * opens no prompter. Without a terminal and without `--yes` the command
 * refuses, and that is read BEFORE the three lines are written, so the
 * refusal carries them once and the run writes nothing to stdout, as
 * `pr merge` does.
 *
 * Nothing is sent to the provider before the question is answered: the
 * close is the last thing the run does, and the only write.
 *
 * ## The head branch
 *
 * It stays where it is unless the line carries `--delete-branch`, which
 * is passed to the provider as it is. On `gh` that switch deletes the
 * LOCAL branch as well as the remote one, by the words of
 * `gh pr close --help` that `src/pr/gh-close.ts` quotes, and `gh` runs at
 * the project root. What `gh` does when that branch is the one checked
 * out there was not measured, and nothing here guards it.
 *
 * ## Exit codes
 *
 * 0 for a pull request closed and for a declined question. 2 for a
 * provider that is not `gh`, as every `pr` action refuses. 1 for every
 * other refusal: no number, a second word, a word that is no number, a
 * switch that swallowed the number, `--reason` left out, bare or blank, a
 * config that cannot be used, a pull request the repository does not
 * hold, one already merged or closed, no terminal without `--yes`, and a
 * provider call that rejected. With `--output=json` the
 * {@link PrCloseResult} is the data of the terminal result event.
 */
import type { LineFlags, PrSeams } from './pr-context.js';
import type { ClosingIssue, PullRequestDetail } from '../../pr/index.js';
import type { Prompter, RafaCommand, RafaContext } from '@open-tomato/rafa/core/command';

import { readRequiredFlag } from '@open-tomato/rafa-board';

import { CommandExit, createLinePrompter } from '@open-tomato/rafa/core/command';

import { PR_CLOSE_DECLARATION } from './declarations.js';
import {
  DEFAULT_PR_SEAMS,
  lineRefusal,
  onProvider,
  openPrContext,
  PR_USAGE,
  readBooleanFlag,
  readPullArgument,
} from './pr-context.js';

/** The usage line this action's refusals name. */
const USAGE = PR_USAGE.close;

/** The answers that mean yes to the question, which is spelled `[y/N]`. */
const YES_ANSWERS: readonly string[] = ['y', 'yes'];

/** What the second and third printed lines open with, under the pull request they belong to. */
const INDENT = '   ';

/** How this action reaches the terminal, beside what every `pr` action reaches. */
export interface CloseSeams extends PrSeams {
  /** True when a question can be answered. Standard input being a TTY when left out. */
  readonly isTerminal?: () => boolean;
  /** Opens the prompter the question is asked through. Called only to ask. */
  readonly openPrompter?: () => Prompter;
}

/** The seams the command runs with unless a caller names its own: the system's, every one. */
export const DEFAULT_CLOSE_SEAMS: CloseSeams = DEFAULT_PR_SEAMS;

/** What json mode gives as the terminal result's `data`. */
export interface PrCloseResult {
  /** The pull request the line named. */
  readonly number: number;
  /** Its title, as the provider answered it. */
  readonly title: string;
  /** Its head branch. */
  readonly head: string;
  /** The issues a merge would have closed, in the provider's order. This run closes none of them. */
  readonly issues: readonly ClosingIssue[];
  /** True when this run closed it, false when the question was answered with anything but yes. */
  readonly closed: boolean;
  /** True when the close was sent with `--delete-branch`. Never true for a pull request left open. */
  readonly branchDeleted: boolean;
}

/** The words of a line: the pull request, why it is closed, and the two switches. */
export interface PrCloseLine {
  readonly number: number;
  /** The closing comment, exactly as the line typed it. */
  readonly reason: string;
  readonly deleteBranch: boolean;
  readonly yes: boolean;
}

/**
 * The line's switches, number and `--reason`, read in that order; see
 * the module note. Refuses a switch handed a value, a missing number, a
 * stray word and a reason left out, bare or blank.
 */
export function readCloseLine(args: readonly string[], flags: LineFlags): PrCloseLine {
  const yes = readBooleanFlag(flags, 'yes', USAGE);
  const deleteBranch = readBooleanFlag(flags, 'delete-branch', USAGE);
  const number = readPullArgument(args, USAGE);
  if (number === null) {
    throw lineRefusal('Expected the number of the pull request to close', USAGE);
  }
  const reason = readRequiredFlag(flags, 'reason', USAGE);
  return { number, reason, deleteBranch, yes };
}

/** The question asked about pull request `number`, spelled `[y/N]` so that the default is no. */
export function closeQuestion(number: number): string {
  return `Close #${String(number)} without merging? [y/N] `;
}

/** The issues line: each issue with the repository the provider answered, or that there is none. */
function issuesLine(issues: readonly ClosingIssue[]): string {
  if (issues.length === 0) return 'issues a merge would have closed: none';
  const named = issues.map((issue) => `${issue.repository}#${String(issue.number)}`);
  return `issues a merge would have closed, which stay open: ${named.join(', ')}`;
}

/**
 * The three lines printed ahead of the question: the number with the
 * title, the head branch, and the issues a merge would have closed. A
 * blank title leaves the number alone on the first line.
 */
export function summaryLines(detail: PullRequestDetail): readonly string[] {
  const title = detail.title.trim();
  const first = title === ''
    ? `#${String(detail.number)}`
    : `#${String(detail.number)} ${title}`;
  return [
    first,
    `${INDENT}head: ${detail.headRefName}`,
    `${INDENT}${issuesLine(detail.closes)}`,
  ];
}

/** Refuses a pull request that is not open, naming the state it is in. */
function requireOpen(detail: PullRequestDetail): void {
  if (detail.state === 'open') return;
  throw new CommandExit(
    1,
    `❌ Pull request #${String(detail.number)} is already ${detail.state}, so there is nothing to close.`,
  );
}

/**
 * Refuses when there is no terminal to ask on. Read BEFORE the summary
 * is written, so the refusal carries it once and the run that cannot be
 * answered writes nothing to stdout.
 */
function requireTerminal(seams: CloseSeams, summary: readonly string[]): void {
  const isTerminal = seams.isTerminal ?? ((): boolean => process.stdin.isTTY === true);
  if (isTerminal()) return;
  throw new CommandExit(1, [
    '❌ rafa pr close asks before closing, and standard input is no terminal.',
    ...summary.map((line) => `${INDENT}${line}`),
    'Close it without the question with --yes.',
  ].join('\n'));
}

/** Whether the operator answered the question about `number` with yes. */
async function confirmed(seams: CloseSeams, number: number): Promise<boolean> {
  const open = seams.openPrompter ?? ((): Prompter => createLinePrompter(process.stdin, process.stderr));
  const prompter = open();
  try {
    const answer = await prompter.ask(closeQuestion(number));
    return answer !== null && YES_ANSWERS.includes(answer.trim().toLowerCase());
  } finally {
    prompter.close();
  }
}

/** The line a close prints: what was closed, and what became of the head branch. */
function closedLine(result: PrCloseResult): string {
  return result.branchDeleted
    ? `Closed #${String(result.number)} without merging and deleted the branch ${result.head}.`
    : `Closed #${String(result.number)} without merging. The branch ${result.head} stays on the remote.`;
}

/**
 * Closes the pull request a line names without merging it, once it is
 * read as open and the question is answered with yes, printing each line
 * as it goes; see the module note.
 */
export async function closePull(context: RafaContext, seams: CloseSeams): Promise<PrCloseResult> {
  const line = readCloseLine(context.args, context.flags);
  const pr = await openPrContext(context, seams);

  const detail = await onProvider(`read pull request #${String(line.number)}`, () => pr.pulls.get(line.number));
  if (detail === null) {
    throw lineRefusal(`No pull request #${String(line.number)} in the repository at ${pr.project.root}`, USAGE);
  }
  requireOpen(detail);

  const summary = summaryLines(detail);
  if (!line.yes) requireTerminal(seams, summary);
  for (const printed of summary) context.output.info(printed);

  // What the run answers if it stops at the question, and the base of what it answers if it does not.
  const left: PrCloseResult = {
    number: detail.number,
    title: detail.title,
    head: detail.headRefName,
    issues: detail.closes,
    closed: false,
    branchDeleted: false,
  };
  if (!line.yes && !await confirmed(seams, detail.number)) {
    context.output.info('Nothing was closed.');
    return left;
  }

  await onProvider(
    `close pull request #${String(detail.number)}`,
    () => pr.pulls.close(detail.number, line.reason, { deleteBranch: line.deleteBranch }),
  );
  const closed: PrCloseResult = { ...left, closed: true, branchDeleted: line.deleteBranch };
  context.output.info(closedLine(closed));
  return closed;
}

/** The command, reaching the provider and the terminal through `seams`; see the module note. */
export function createPrCloseCommand(seams: CloseSeams = DEFAULT_CLOSE_SEAMS): RafaCommand {
  const command: RafaCommand = {
    ...PR_CLOSE_DECLARATION,
    run: async (context) => {
      const result = await closePull(context, seams);
      if (context.outputMode === 'json') context.output.result(result);
    },
  };
  return Object.freeze(command);
}

const command: RafaCommand = createPrCloseCommand();
export default command;
