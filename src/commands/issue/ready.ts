/**
 * `rafa issue ready <n> [--yes]`: the two checks a person would
 * otherwise make by eye before a `gh issue edit`, printed, and the one
 * label swap that marks the spec ready, made on a typed yes or under
 * `--yes`.
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
 * ## It asks, unless the line says `--yes`
 *
 * The question is
 * {@link readyQuestion}, `Mark #<n> spec:ready? [y/N] `, put through the
 * {@link Prompter} `rafa init`, `pr merge` and `issue unblock` read an
 * answer with, so a json-mode stdout stays NDJSON. An answer that is
 * not `y` or `yes` declines, the empty answer and an input that ended
 * included ({@link answeredYes}): the question is spelled `[y/N]`.
 *
 * Without a terminal and without `--yes` nothing is asked and nothing
 * is written. The two readings are printed anyway and the run reports
 * `unasked`, with the line naming the command to run where an answer
 * can be typed — printing the result and refusing to label is what the
 * spec asks for, and refusing the whole command would make it fail
 * inside a script over a label a person has to choose to add.
 *
 * `--yes` ({@link ReadyOptions.yes}) is the answer typed on the line
 * instead: the run makes every check below in the same order and, once
 * all pass, swaps the labels with no question, terminal or not. It
 * answers the QUESTION only. An outsider's issue, a body with gaps and
 * two `epic:` labels are refused exactly as without it, with nothing
 * written, so the flag lets through only an issue an account with write
 * access could have labelled by hand (#752). It exists for a script or
 * an agent driving the command where no answer can be typed. `rafa
 * next` never passes it (`src/next/actions.ts`), and its ceiling still
 * refuses `--yes=ready` (`src/next/ceiling.ts`): a chain reaching this
 * step asks. A value given to it (`--yes=maybe`) is a line refusal with
 * exit code 1, read before anything is opened.
 *
 * ## The ending, on a label that is on
 *
 * A run that MARKED the issue, under `--yes` or on a typed yes, and
 * one that found it marked already, ends by naming the one step that
 * follows — for a roadmap line that is ready and unblocked, the plan
 * (`src/next/ending.ts`, `--no-hint` to turn it off). The declined run
 * and the one with no terminal end without it: no label moved, so the
 * state still reads as an issue carrying no `spec:ready`, and the hint
 * would put the very question that was just answered no, or name this
 * command to the run that has nobody to answer it.
 *
 * `--no-hint` skips no question of this command's: it turns off the
 * ENDING, and the marking question is put whether or not it is typed.
 * `--yes` is the one flag that skips the marking question.
 *
 * ## The other place this run is made
 *
 * {@link runIssueReady} is also what `plan create --issue` and
 * `plan create --next` offer an operator when the issue they were
 * pointed at carries no `spec:ready` label and there is a terminal to
 * ask on: `../plan/ready-offer.ts` fills the offer seam of
 * `src/board/plan-spec.ts` with it, handing over the issue that route
 * already read so no second `gh issue view` is spent. Nothing here
 * knows about that caller; it hands over `readIssue` and reads the
 * report, and a run with no terminal keeps the refusal it always had.
 *
 * ## The order, and what each check costs
 *
 * Four readings, in this order, and the first that refuses ends the
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
 *  3. the issue's `epic:` LABELS, through {@link requireOneEpic}: exit 2
 *     for an issue carrying two or more, naming every one. The finding is
 *     `readEpicProblems`'s own (`src/board/epic-problems.ts`), asked of
 *     the one issue already read and its `several-epic-labels` answer
 *     alone kept, so no board listing is spent and the sentence is the
 *     one `doctor` and the views print. An issue belongs to one epic, and
 *     one marked ready while carrying two would be counted by both. It
 *     runs under `board.relationships: labels` only, the default: in
 *     `native` mode an epic is the issue's one sub-issue parent, which
 *     the tracker never lets be two, and no `epic:` label is read to
 *     learn a relationship, so the reading is skipped and costs nothing;
 *  4. the `spec:ready` label already on the issue, which is not a
 *     refusal but an `already`: there is nothing to add, so nothing is
 *     asked and nothing is written.
 *
 * The `spec:ready` reading is LAST of the four on purpose. An issue somebody
 * labelled ready whose body has gaps is refused with them named rather
 * than reported as already done, since the gaps are what the operator
 * came for and the gate would refuse the same body later at the price
 * of a `plan create` run. Two `epic:` labels on an issue marked ready
 * already are refused for the same reason: the label is a fault the
 * operator has to fix, and `already` would pass it over.
 *
 * ## The one write
 *
 * `swapLabels` ({@link IssueBoard}): one
 * `gh issue edit <n> --remove-label spec:needs-work --add-label spec:ready`,
 * the swap the spec asks for, made after the yes, or after the last
 * check under `--yes`, and never before either.
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
import type { SpecIssue, SpecIssueReader } from '../../board/issue.js';
import type { BoardIssue } from '../../board/roadmap-board.js';
import type { BoardTrust, TrustReading, TrustSource } from '../../board/trust.js';
import type { RafaCommand, RafaContext } from '../../cli/command.js';
import type { Prompter } from '../../cli/prompt/confirm.js';
import type { BoardRelationshipMode } from '../../config-sections.js';
import type { NextEndingSeams } from '../../next/ending.js';
import type { GitRunner } from '../../pr/git.js';

import { createGhRunner, moduleOfLabels, typeOfLabels } from '../../adapters/tracker/github.js';
import { epicProblemMessage, readEpicProblems } from '../../board/epic-problems.js';
import { SPEC_NEEDS_WORK_LABEL } from '../../board/gate.js';
import { createGhIssueBoard } from '../../board/issue-board.js';
import { createGhSpecIssueReader } from '../../board/issue.js';
import { boardRepoLabel, issueSource } from '../../board/plan-spec.js';
import {
  hasSpecReadyLabel,
  READINESS_REFUSAL_EXIT,
  requireCompleteSpec,
  SPEC_READY_LABEL,
} from '../../board/readiness.js';
import { ghBoardTrust, requireTrustedBoardAuthor } from '../../board/trust.js';
import { CommandExit } from '../../cli/command.js';
import { createLinePrompter } from '../../cli/prompt/confirm.js';
import { messageOf } from '../../config-sections.js';
import { endWithNextStep, HINT_FLAG_SPEC } from '../../next/ending.js';
import { createGitRunner } from '../../pr/git.js';
import { answeredYes } from '../../start/branch-decision.js';

import { issueProject, issueSubjectConfig, lineRefusal } from './issue-tracker.js';

/** The usage line a refusal names. */
export const READY_USAGE = 'rafa issue ready <n> [--yes]';

/** The flag that marks the issue with no question once every check passes. */
const YES_FLAG = 'yes';

/** The exit code a label swap `gh` refused ends with. */
export const READY_WRITE_EXIT = 1;

/** An issue number as a line types it: a whole number from 1. */
const ISSUE_NUMBER = /^[1-9]\d*$/u;

/** What one run came to. */
export type ReadyStatus =
  /** The question was answered yes, or `--yes` answered it, and the labels were swapped. */
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
  /**
   * Marks the issue with no question once every check passes, so `ask`
   * is never called and a null `ask` does not stop the write. Every
   * check refuses as it does without it. False when left out.
   */
  readonly yes?: boolean;
  /** Makes the label swap. Made over `gh` when left out. */
  readonly board?: IssueBoard;
  /** Reads the issue by number. Made over `gh` when left out. */
  readonly readIssue?: SpecIssueReader;
  /**
   * The project's `board.relationships`; the two-`epic:`-labels reading
   * runs in `labels` mode only. `labels`, the default, when left out.
   */
  readonly relationships?: BoardRelationshipMode;
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

/**
 * Lets an issue carrying at most one `epic:` label through, and throws
 * `CommandExit(2)` for one carrying two or more, the sentence naming
 * every label it carries. See the module note's third reading.
 *
 * The issue is handed to `readEpicProblems` as a one-issue listing and
 * only its `several-epic-labels` answer is read: an orphan label is a
 * fault of the board, which one issue cannot show, and is `doctor`'s.
 */
export function requireOneEpic(found: SpecIssue): void {
  const listed: BoardIssue = {
    number: found.number,
    title: found.title,
    body: found.body,
    state: found.state,
    stateReason: null,
    labels: found.labels,
    type: typeOfLabels(found.labels),
    module: moduleOfLabels(found.labels),
  };
  const several = readEpicProblems([listed]).find((problem) => problem.kind === 'several-epic-labels');
  if (several === undefined) return;
  throw new CommandExit(
    READINESS_REFUSAL_EXIT,
    `issue #${String(found.number)} cannot be marked ${SPEC_READY_LABEL}: ${epicProblemMessage(several)}`,
  );
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
 * and labelled on a yes, or labelled with no question under
 * {@link ReadyOptions.yes}. See the module note for the order of the
 * checks, what each costs and the one write.
 *
 * Throws the `CommandExit` of every refusal: exit 2 for an untrusted
 * author, for a body with gaps and for two `epic:` labels, and exit {@link READY_WRITE_EXIT}
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
  if ((options.relationships ?? 'labels') === 'labels') requireOneEpic(found);

  const lines = { trust: trustPassLine(issue, trust.repo, reading), checked: completeLine(issue) };
  if (hasSpecReadyLabel(found.labels)) {
    return readyReport(issue, 'already', reading, {
      ...lines,
      message: `#${String(issue)} is already marked ${SPEC_READY_LABEL}`,
    });
  }
  if (options.yes !== true) {
    if (ask === null) {
      return readyReport(issue, 'unasked', reading, { ...lines, message: unaskedMessage(issue) });
    }
    if (!await ask(readyQuestion(issue))) {
      return readyReport(issue, 'declined', reading, {
        ...lines,
        message: `#${String(issue)} was left unmarked`,
      });
    }
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

/**
 * Whether the line typed `--yes`, or a refusal with exit code 1 naming
 * the usage for a value given to it. Read before anything is opened.
 */
export function readReadyYes(context: RafaContext): boolean {
  const value = context.flags[YES_FLAG];
  if (value === undefined) return false;
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 'false') return value === 'true';
  throw lineRefusal(`--${YES_FLAG} takes no value, and read "${value}" as one`, READY_USAGE);
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
  /** How the ending hint reaches the state and the terminal. The system's own when left out. */
  readonly ending?: NextEndingSeams;
}

/** The seams the registered command runs with: the system's own, every one. */
export const DEFAULT_READY_SEAMS: ReadySeams = Object.freeze({});

/**
 * The prompter the one question goes through, opened to ask it and
 * closed by `close`. Nothing is opened by a run that never asks.
 *
 * Exported for `../plan/ready-offer.ts`, which puts this command's
 * question inside a `plan create` run, for `../next.ts`, which puts
 * one question per step of its chain, and for `../cleanup.ts`, which
 * asks after its checklist: each must open and close the terminal the
 * same way rather than spelling the pair again.
 */
export function lazyPrompter(open: () => Prompter): { ask: ReadyAsk; close: () => void } {
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
 * question through the prompter when there is a terminal and the line
 * did not type `--yes`.
 */
export async function markIssueReady(context: RafaContext, seams: ReadySeams): Promise<ReadyReport> {
  const issue = readReadyIssue(context);
  const yes = readReadyYes(context);
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
      relationships: config.boardRelationships,
      yes,
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
      + ' the repository, refuses a body that does not fill the spec template, refuses an issue carrying two'
      + ' `epic:` labels (with board.relationships set to labels, the default), and then asks whether to mark it'
      + ` ${SPEC_READY_LABEL}. On a yes it swaps the labels in one write, adding ${SPEC_READY_LABEL} and`
      + ` removing ${SPEC_NEEDS_WORK_LABEL}. \`--yes\` makes the swap with no question once every check passes,`
      + ' with or without a terminal, and refuses everything the checks refuse without it; without a terminal and'
      + ' without `--yes` it prints both readings and adds no label. A run that marks the issue, or finds'
      + ' it marked already, ends by naming the one step that follows, which `--no-hint` turns off. With'
      + ' `--output=json` the report is the data of the terminal result event.',
    args: [
      {
        name: 'n',
        description: 'The issue number on the GitHub board.',
        type: 'string',
        required: true,
      },
    ],
    flags: [
      {
        name: YES_FLAG,
        description: `Marks the issue ${SPEC_READY_LABEL} without asking, once its author and its body check out;`
          + ' a check that refuses still refuses. Needed where standard input is no terminal.',
        type: 'boolean',
      },
      HINT_FLAG_SPEC,
    ],
    examples: [
      {
        cmd: 'rafa issue ready 57',
        note: `Checks #57 and asks whether to mark it ${SPEC_READY_LABEL}.`,
      },
      {
        cmd: 'rafa issue ready 57 --yes',
        note: `Checks #57 and marks it ${SPEC_READY_LABEL} with no question, from a script or an agent.`,
      },
    ],
    outputs: ['text', 'json'],
    run: async (context) => {
      const made = await markIssueReady(context, seams);
      if (context.outputMode === 'json') context.output.result(made);
      else writeReport(context, made);
      // A run that added no label left the project where it was; see the module note.
      if (made.status === 'marked' || made.status === 'already') {
        await endWithNextStep(context, seams.ending);
      }
    },
  };
  return Object.freeze(command);
}

export default createIssueReadyCommand();
