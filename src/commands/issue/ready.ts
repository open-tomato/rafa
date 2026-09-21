/**
 * `rafa issue ready <n>`: the two checks a person would otherwise make
 * by eye before a `gh issue edit`, printed, and the one label swap that
 * marks the spec ready, made only on a typed yes.
 *
 * Adding `spec:ready` is the decision the readiness gate's check 1
 * waits on (`src/board/readiness.ts`, `context/pull-requests.md`), and
 * until now it was a trip to the browser or to `gh` with nothing
 * checked on the way. This command makes the same decision inside rafa
 * and shows the two readings the operator would otherwise guess at:
 * whether the account that opened the issue may change this repository
 * at all, and whether the body fills the spec template
 * (`.rafa/specs/rafa-63-one-command-next-step.md`).
 *
 * ## It always asks
 *
 * There is no `--yes` and no flag that skips the question: marking an
 * issue ready is a person's decision, and the spec keeps `ready` out of
 * `rafa next`'s `--yes` list for the same reason. The question is
 * {@link readyQuestion}, `Mark #<n> spec:ready? [y/N] `, put through the
 * {@link Prompter} `rafa init`, `pr merge` and `issue unblock` read an
 * answer with, so a json-mode stdout stays NDJSON. An answer that is
 * not `y` or `yes` declines, the empty answer and an input that ended
 * included ({@link answeredYes}): the question is spelled `[y/N]`.
 *
 * Without a terminal nothing is asked and nothing is written. The two
 * readings are printed anyway and the run reports `unasked`, with the
 * line naming the command to run where an answer can be typed —
 * printing the result and refusing to label is what the spec asks for,
 * and refusing the whole command would make it fail inside a script
 * over a label a person has to choose to add.
 *
 * ## The order, and what each check costs
 *
 * Three readings, in this order, and the first that refuses ends the
 * run:
 *
 *  1. the AUTHOR's trust (`src/board/trust.ts`), through
 *     `requireTrustedBoardAuthor`: exit 2 for a login with no write
 *     access to the repository and for one no lookup could answer for.
 *     It runs BEFORE the body is read any further and before the
 *     question, so an outsider's issue is refused without an operator
 *     being asked anything, and no heading off that body reaches a
 *     printed sentence. It costs one `gh api` per run, none for a login
 *     in `board.trustedAuthors`;
 *  2. the body's COMPLETENESS, through `requireCompleteSpec`
 *     (`src/board/readiness.ts`): exit 2 naming every gap with its
 *     heading, which is the same sentence `plan create` refuses an
 *     incomplete spec with, so an operator who marks an issue ready
 *     here cannot be refused by the gate for a gap this run could see;
 *  3. the `spec:ready` label already on the issue, which is not a
 *     refusal but an `already`: there is nothing to add, so nothing is
 *     asked and nothing is written.
 *
 * The label reading is LAST of the three on purpose. An issue somebody
 * labelled ready whose body has gaps is refused with them named rather
 * than reported as already done, since the gaps are what the operator
 * came for and the gate would refuse the same body later at the price
 * of a `plan create` run.
 *
 * ## The one write
 *
 * `swapLabels` ({@link IssueBoard}): one
 * `gh issue edit <n> --remove-label spec:needs-work --add-label spec:ready`,
 * the swap the spec asks for, made after the yes and never before it.
 * Both labels are the board's own, created by `rafa init --board`
 * (`src/board/setup.ts`), and a swap `gh` refuses is a refusal with
 * exit code {@link READY_WRITE_EXIT} naming what it said — nothing is
 * reported as marked that was not written.
 *
 * No body is edited, no comment is posted, no issue is closed and no
 * session is spawned anywhere on this path.
 *
 * ## Nothing here spawns
 *
 * GitHub arrives through the {@link GhRunner} seam, `git` through
 * {@link ReadySeams.openGit} — it reads only the repository label a
 * trust sentence names (`boardRepoLabel`) — and the terminal and the
 * prompter through the remaining two seams. So every case in
 * `./ready.test.ts` drives a recorded runner and a scripted prompter,
 * and none of them reaches GitHub, spawns `gh` or `git`, or waits on an
 * answer.
 */
import type { GhRunner } from '../../adapters/tracker/github.js';
import type { IssueBoard } from '../../board/issue-board.js';
import type { SpecIssueReader } from '../../board/issue.js';
import type { BoardTrust, TrustReading, TrustSource } from '../../board/trust.js';
import type { RafaCommand, RafaContext } from '../../cli/command.js';
import type { GitRunner } from '../../pr/git.js';
import type { Prompter } from '../../project/root-choice.js';

import { createGhRunner } from '../../adapters/tracker/github.js';
import { SPEC_NEEDS_WORK_LABEL } from '../../board/gate.js';
import { createGhIssueBoard } from '../../board/issue-board.js';
import { createGhSpecIssueReader } from '../../board/issue.js';
import { boardRepoLabel, issueSource } from '../../board/plan-spec.js';
import { hasSpecReadyLabel, requireCompleteSpec, SPEC_READY_LABEL } from '../../board/readiness.js';
import { ghBoardTrust, requireTrustedBoardAuthor } from '../../board/trust.js';
import { CommandExit } from '../../cli/command.js';
import { messageOf } from '../../config-sections.js';
import { createGitRunner } from '../../pr/git.js';
import { createLinePrompter } from '../../project/root-choice.js';
import { answeredYes } from '../../start/branch-decision.js';

import { issueProject, issueSubjectConfig, lineRefusal } from './issue-tracker.js';

/** The usage line a refusal names. */
export const READY_USAGE = 'rafa issue ready <n>';

/** The exit code a label swap `gh` refused ends with. */
export const READY_WRITE_EXIT = 1;

/** An issue number as a line types it: a whole number from 1. */
const ISSUE_NUMBER = /^[1-9]\d*$/u;

/** What one run came to. */
export type ReadyStatus =
  /** The question was answered yes and the labels were swapped. */
  | 'marked'
  /** The question was answered no, so nothing was written. */
  | 'declined'
  /** There was no terminal to ask on, so nothing was written. */
  | 'unasked'
  /** The issue already carries `spec:ready`, so there was nothing to add. */
  | 'already';

/** What one run came to, and the lines it is reported with. */
export interface ReadyReport {
  /** The issue the line named. */
  readonly issue: number;
  readonly status: ReadyStatus;
  /** The login that opened the issue, as the board spelled it. */
  readonly author: string;
  /** Which answer trusted the author, or null when neither did, which no report reaches. */
  readonly trustedBy: TrustSource | null;
  /** The sentence the trust reading is printed as. */
  readonly trust: string;
  /** The sentence the completeness reading is printed as. */
  readonly checked: string;
  /** The sentence the outcome is printed as. */
  readonly message: string;
}

/** Puts the one question and answers whether it was said yes to. */
export type ReadyAsk = (question: string) => Promise<boolean>;

/** What {@link runIssueReady} reads and writes through. */
export interface ReadyOptions {
  /** Runs every `gh` command, in the repository the board belongs to. */
  readonly gh: GhRunner;
  /** The issue to mark. */
  readonly issue: number;
  /** The permission lookup, the allow-list and the repository label check 0 is read through. */
  readonly trust: BoardTrust;
  /** Asks the one question, or null when there is nobody to ask. */
  readonly ask: ReadyAsk | null;
  /** Makes the label swap. Made over `gh` when left out. */
  readonly board?: IssueBoard;
  /** Reads the issue by number. Made over `gh` when left out. */
  readonly readIssue?: SpecIssueReader;
}

/** The one question, as the spec spells it. */
export function readyQuestion(issue: number): string {
  return `Mark #${String(issue)} ${SPEC_READY_LABEL}? [y/N] `;
}

/**
 * The sentence a TRUSTED reading is printed as: who opened the issue,
 * and which of the two answers trusted them.
 *
 * The refusal's own clause is `trustRefusalClause`
 * (`src/board/trust.ts`), which throws for a trusted reading; this is
 * the other half, and it is spelled here because this is the one
 * command that prints a reading that passed. It names the allow-list by
 * its config key, since a login trusted that way had no lookup made for
 * it and an operator reading `has write access` would believe one did.
 *
 * Throws a `TypeError` for an untrusted reading, as the refusal spelling
 * does for a trusted one: a caller asking for it has read the reading
 * backwards.
 */
export function trustPassLine(issue: number, repo: string, reading: TrustReading): string {
  if (!reading.trusted) {
    throw new TypeError(`issue ready: ${reading.login} is not trusted, and has no pass to name`);
  }
  const because = reading.source === 'allow-list'
    ? 'listed in board.trustedAuthors'
    : `who has write access to ${repo}`;
  return `#${String(issue)} was opened by ${reading.login}, ${because}`;
}

/** The sentence a body with no gap is printed as. */
export function completeLine(issue: number): string {
  return `#${String(issue)} fills every heading the spec template asks for, with no placeholder left`;
}

/** The sentence a run with no terminal to ask on is reported with. */
function unaskedMessage(issue: number): string {
  const number = String(issue);
  return `#${number} is ready to mark; there is no terminal to ask on, so ${SPEC_READY_LABEL} was not added.`
    + ` Run rafa issue ready ${number} where an answer can be typed`;
}

/** One report, spelled. */
function readyReport(
  issue: number,
  status: ReadyStatus,
  reading: TrustReading,
  lines: { readonly trust: string; readonly checked: string; readonly message: string },
): ReadyReport {
  return Object.freeze({
    issue,
    status,
    author: reading.login,
    trustedBy: reading.source,
    trust: lines.trust,
    checked: lines.checked,
    message: lines.message,
  });
}

/**
 * The issue `options` names, read off the board, checked, asked about
 * and labelled on a yes. See the module note for the order of the
 * checks, what each costs and the one write.
 *
 * Throws the `CommandExit` of every refusal: exit 2 for an untrusted
 * author and for a body with gaps, and exit {@link READY_WRITE_EXIT}
 * for a swap `gh` refused. An issue that could not be read at all
 * rejects with the reader's own `Error` naming the command.
 */
export async function runIssueReady(options: ReadyOptions): Promise<ReadyReport> {
  const { gh, issue, trust, ask } = options;
  const board = options.board ?? createGhIssueBoard({ gh });
  const readIssue = options.readIssue ?? createGhSpecIssueReader({ gh });

  const found = await readIssue(issue);
  const reading = await requireTrustedBoardAuthor({ kind: 'issue', number: issue }, trust, found.author);
  requireCompleteSpec(issueSource(issue), found.body);

  const lines = { trust: trustPassLine(issue, trust.repo, reading), checked: completeLine(issue) };
  if (hasSpecReadyLabel(found.labels)) {
    return readyReport(issue, 'already', reading, {
      ...lines,
      message: `#${String(issue)} is already marked ${SPEC_READY_LABEL}`,
    });
  }
  if (ask === null) {
    return readyReport(issue, 'unasked', reading, { ...lines, message: unaskedMessage(issue) });
  }
  if (!await ask(readyQuestion(issue))) {
    return readyReport(issue, 'declined', reading, {
      ...lines,
      message: `#${String(issue)} was left unmarked`,
    });
  }

  try {
    await board.swapLabels(issue, SPEC_NEEDS_WORK_LABEL, SPEC_READY_LABEL);
  } catch (error) {
    throw new CommandExit(
      READY_WRITE_EXIT,
      `❌ ${SPEC_READY_LABEL} could not be put on #${String(issue)}: ${messageOf(error)}`,
    );
  }
  return readyReport(issue, 'marked', reading, {
    ...lines,
    message: `Marked #${String(issue)} ${SPEC_READY_LABEL}, and took ${SPEC_NEEDS_WORK_LABEL} off it`,
  });
}

/**
 * The issue a line named, or a refusal with exit code 1 naming the
 * usage: a line naming no issue, one naming a second word, and a word
 * that is no whole number from 1.
 *
 * Read BEFORE anything is opened, so a refused line sends no command
 * and reads no config.
 */
export function readReadyIssue(context: RafaContext): number {
  const { args } = context;
  if (args.length > 1) {
    throw lineRefusal(`Expected one issue number, got ${String(args.length)}: ${args.join(' ')}`, READY_USAGE);
  }

  const word = args[0];
  if (word === undefined) {
    throw lineRefusal('Name the issue number to mark ready', READY_USAGE);
  }
  if (!ISSUE_NUMBER.test(word)) {
    throw lineRefusal(`"${word}" is no issue number, which is a whole number from 1`, READY_USAGE);
  }
  return Number(word);
}

/** How the board, the terminal and the question are reached; each left out is the system's own. */
export interface ReadySeams {
  /** Opens the runner every `gh` command goes through. `gh` spawned in the project root when left out. */
  readonly openGh?: (root: string) => GhRunner;
  /** Opens the runner the repository label is read through. `git` spawned in the project root when left out. */
  readonly openGit?: (root: string) => GitRunner;
  /** True when a question can be answered. `process.stdin.isTTY` when left out. */
  readonly isTerminal?: () => boolean;
  /** Opens the prompter the question is asked through. Called only to ask. */
  readonly openPrompter?: () => Prompter;
}

/** The seams the registered command runs with: the system's own, every one. */
export const DEFAULT_READY_SEAMS: ReadySeams = Object.freeze({});

/** The prompter the one question goes through, opened to ask it and closed by `close`. */
function lazyPrompter(open: () => Prompter): { ask: ReadyAsk; close: () => void } {
  let prompter: Prompter | null = null;
  return {
    ask: async (question: string): Promise<boolean> => {
      prompter ??= open();
      return answeredYes(await prompter.ask(question));
    },
    close: (): void => {
      prompter?.close();
      prompter = null;
    },
  };
}

/**
 * Runs the marking a line asks for: the line, the project's
 * `board.trustedAuthors`, the repository label off `origin`, and the
 * question through the prompter when there is a terminal.
 */
export async function markIssueReady(context: RafaContext, seams: ReadySeams): Promise<ReadyReport> {
  const issue = readReadyIssue(context);
  const project = issueProject(context);
  const config = issueSubjectConfig(project, (message: string) => {
    context.output.warn(message);
  });
  const openGh = seams.openGh ?? ((dir: string): GhRunner => createGhRunner({ cwd: dir }));
  const openGit = seams.openGit ?? createGitRunner;
  const isTerminal = seams.isTerminal ?? ((): boolean => process.stdin.isTTY === true);
  const openPrompter = seams.openPrompter ?? ((): Prompter => createLinePrompter(process.stdin, process.stderr));

  const gh = openGh(project.root);
  const trust = ghBoardTrust({
    gh,
    trustedAuthors: config.boardTrustedAuthors,
    repo: boardRepoLabel(openGit(project.root)),
  });
  const prompter = lazyPrompter(openPrompter);
  try {
    return await runIssueReady({
      gh,
      issue,
      trust,
      ask: isTerminal()
        ? prompter.ask
        : null,
    });
  } finally {
    prompter.close();
  }
}

/** Writes what a report came to as the three lines a person reads. */
function writeReport(context: RafaContext, report: ReadyReport): void {
  context.output.info(report.trust);
  context.output.info(report.checked);
  context.output.info(report.message);
}

/** The command, reading the board with `seams`; see the module note. */
export function createIssueReadyCommand(seams: ReadySeams = DEFAULT_READY_SEAMS): RafaCommand {
  const command: RafaCommand = {
    name: 'issue ready',
    subject: 'issue',
    action: 'ready',
    summary: `mark an issue ${SPEC_READY_LABEL} once its author and its body check out`,
    description: 'Reads the issue on the GitHub board, refuses one opened by an account without write access to'
      + ' the repository, refuses a body that does not fill the spec template, and then asks whether to mark it'
      + ` ${SPEC_READY_LABEL}. On a yes it swaps the labels in one write, adding ${SPEC_READY_LABEL} and`
      + ` removing ${SPEC_NEEDS_WORK_LABEL}. It always asks and declares no flag that skips the question;`
      + ' without a terminal it prints both readings and adds no label. With `--output=json` the report is the'
      + ' data of the terminal result event.',
    args: [
      {
        name: 'n',
        description: 'The issue number on the GitHub board.',
        type: 'string',
        required: true,
      },
    ],
    flags: [],
    examples: [
      {
        cmd: 'rafa issue ready 57',
        note: `Checks #57 and asks whether to mark it ${SPEC_READY_LABEL}.`,
      },
    ],
    outputs: ['text', 'json'],
    run: async (context) => {
      const made = await markIssueReady(context, seams);
      if (context.outputMode === 'json') {
        context.output.result(made);
        return;
      }
      writeReport(context, made);
    },
  };
  return Object.freeze(command);
}

export default createIssueReadyCommand();
