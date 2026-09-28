/**
 * What `rafa epic defer` and `rafa epic promote` share: the line they
 * read, the one board listing, the reason and the keep question, the
 * writes over the horizon core, and the lines they print
 * (`.rafa/specs/rafa-246-epic-lifecycle.md`). `./defer.ts` and
 * `./promote.ts` are the two commands, each holding its own declaration
 * and handing {@link runEpicHorizon} its {@link HorizonAction}.
 *
 * ## The line
 *
 * One argument, the epic's number, a whole number from 1, and `--to`,
 * required and one of the action's {@link HorizonAction.targets}:
 * `next` or `later` to defer, `now` or `next` to promote. `--reason`
 * is optional text. Each is refused with exit code 1 before anything is
 * read.
 *
 * ## What is read, and what is refused
 *
 * The board listing is read once (`createGhBoardListing`, through
 * `BOARD_LIST_FIELDS` and `parseBoardListing`), and a listing that
 * cannot be read is refused with {@link EPIC_HORIZON_REFUSAL_EXIT}. The
 * horizon core (`src/board/epic-horizon.ts`) reads the change off it and
 * refuses, with the same exit code, an issue that is not an open epic, an
 * epic whose standing horizon cannot be read, and a target equal to it.
 * The DIRECTION is refused here, with the same code: a defer has to move
 * the epic later (`now` → `next` → `later`) and a promote earlier, so
 * `rafa epic defer 40 --to=next` on an epic standing on `later` is
 * refused naming the promote that would do it. Every refusal comes
 * before the first question and the first write.
 *
 * ## The questions, asked before any write
 *
 * A question is asked only where standard input is a terminal
 * ({@link EpicHorizonSeams.isTerminal}), through a line prompter on
 * stderr opened on the first question and closed at the end of the run.
 *
 * 1. THE REASON, from `--reason`, else asked once with the trail's
 *    `reasonQuestion` (`readReason`, `src/board/epic-trail.ts`). With no
 *    terminal and no `--reason`, nothing changes and the question is
 *    printed (`unaskedReasonMessage`): the run ends `unasked`. A reason
 *    that is blank, or an input that ended before one, changes nothing
 *    either and ends `blank`. Both exit 0, as `rafa issue unblock` does
 *    with nobody to ask: the json result's `status` tells them apart from
 *    a move.
 * 2. THE KEEP QUESTION, for a DEFER of an epic the core read as
 *    `in-progress` with an open branch or pull request among its open
 *    members: the work is named and {@link keepWorkQuestion} asks whether
 *    to keep it, spelled `[Y/n]`, so anything but `n` or `no` keeps it,
 *    an input that ended included. With no terminal the work is kept and
 *    named. A promote asks nothing about work: moving an epic earlier
 *    parks nothing.
 *
 * ## The writes, in order
 *
 * 1. The swap and the comment, `applyHorizonChange`: one `gh issue edit`
 *    taking the standing `horizon:` label off and putting the target on,
 *    then the trail's `Moved <from> → <to>: <reason>` on the epic. A
 *    failed write is refused with exit code 1, naming the board's
 *    message; a failed swap posts no comment.
 * 2. On a no to the keep question, each open pull request closed through
 *    `IssueBoard.closePullRequest` with the trail's
 *    `renderParkedPullRequestComment`, in ascending number. No branch is
 *    deleted: `gh pr close` is sent without `--delete-branch`, and no
 *    `git` write is made anywhere on this path. A close that fails is
 *    that pull request's own line, the rest are still closed, and the run
 *    then ends with exit code 1 naming the ones left open.
 *
 * A reading the core carried as a problem (the branch scan, the pull
 * request listing, the plan dir) is a `warn` line saying the open work
 * named may be short.
 *
 * ## What it writes
 *
 * In text mode, the move and where the work stands. In json mode the
 * terminal result's `data` is an {@link EpicHorizonResult}. It starts no
 * session, so neither command declares `spends`.
 */
import type { GhRunner } from '../../adapters/tracker/github.js';
import type { EpicOpenWork, HorizonChangeReading } from '../../board/epic-horizon.js';
import type { HorizonChange } from '../../board/epic-trail.js';
import type { Epic } from '../../board/epics.js';
import type { IssueBoard } from '../../board/issue-board.js';
import type { Horizon } from '../../board/roadmap-epic-rows.js';
import type { PlanNames } from '../../board/roadmap-rows.js';
import type { RafaContext } from '../../cli/command.js';
import type { Prompter } from '../../cli/prompt/confirm.js';
import type { GitRunner } from '../../pr/git.js';

import { createGhRunner } from '../../adapters/tracker/github.js';
import { applyHorizonChange, EPIC_HORIZON_REFUSAL_EXIT, readHorizonChange } from '../../board/epic-horizon.js';
import {
  blankReasonMessage,
  REASON_FLAG,
  readReason,
  renderParkedPullRequestComment,
  unaskedReasonMessage,
} from '../../board/epic-trail.js';
import { createGhIssueBoard } from '../../board/issue-board.js';
import { createGhBoardListing } from '../../board/roadmap-board.js';
import { HORIZONS } from '../../board/roadmap-epic-rows.js';
import { createPlanDirNames } from '../../board/roadmap-rows.js';
import { createGhOpenPullRequests } from '../../board/roadmap.js';
import { CommandExit } from '../../cli/command.js';
import { createLinePrompter } from '../../cli/prompt/confirm.js';
import { messageOf } from '../../config-sections.js';
import { createGitRunner } from '../../pr/git.js';
import { issueProject, issueSubjectConfig, lineRefusal, readChoiceFlag, readTextFlag } from '../issue/issue-tracker.js';
import { plansDirAt } from '../plan/plan-files.js';

/** The flag naming the horizon the epic moves to. */
export const TO_FLAG = 'to';

/** An issue number as a line types it: a whole number from 1. */
const ISSUE_NUMBER = /^[1-9]\d*$/u;

/** The answers to the keep question that close the work; it is spelled `[Y/n]`. */
const NO_ANSWERS: readonly string[] = ['n', 'no'];

/** One of the two commands, as {@link runEpicHorizon} is handed it. */
export interface HorizonAction {
  /** The action's word. */
  readonly name: 'defer' | 'promote';
  /** The horizons `--to` takes, in {@link HORIZONS} order. */
  readonly targets: readonly Horizon[];
  /** The usage line a refusal names. */
  readonly usage: string;
}

/** `rafa epic defer`'s action. */
export const DEFER_ACTION: HorizonAction = Object.freeze({
  name: 'defer',
  targets: Object.freeze(['next', 'later'] as const),
  usage: 'rafa epic defer <n> --to=next|later [--reason="<why>"]',
});

/** `rafa epic promote`'s action. */
export const PROMOTE_ACTION: HorizonAction = Object.freeze({
  name: 'promote',
  targets: Object.freeze(['now', 'next'] as const),
  usage: 'rafa epic promote <n> --to=now|next [--reason="<why>"]',
});

/** What a line asks for, read before anything is opened. */
export interface HorizonLine {
  readonly epic: number;
  readonly to: Horizon;
  /** `--reason` as typed, or null when it was not passed. */
  readonly reason: string | null;
}

/** What became of the open work of the epic. */
export type WorkDecision =
  /** There was no open work to ask about, or the action was a promote. */
  | 'none'
  /** The keep question was answered yes. */
  | 'kept'
  /** There was no terminal to ask on, so the work is kept. */
  | 'unasked'
  /** The keep question was answered no, and each pull request was closed or tried. */
  | 'closed';

/** One pull request a no closed, or tried to. */
export interface ClosedPullRequest {
  readonly number: number;
  readonly status: 'closed' | 'failed';
  /** What the board said when the close failed; empty when it closed. */
  readonly problem: string;
}

/** How a run ended. */
export type HorizonRunStatus =
  /** The label was swapped and the reason commented. */
  | 'moved'
  /** No `--reason` and no terminal: nothing changed. */
  | 'unasked'
  /** The reason came out empty: nothing changed. */
  | 'blank';

/** What json mode gives as the terminal result's `data`. */
export interface EpicHorizonResult {
  readonly action: HorizonAction['name'];
  readonly status: HorizonRunStatus;
  readonly epic: number;
  readonly from: Horizon;
  readonly to: Horizon;
  /** The reason commented, or null when nothing changed. */
  readonly reason: string | null;
  /** The reason question a run with no terminal would have asked; null otherwise. */
  readonly question: string | null;
  /** The epic's computed state. */
  readonly state: Epic['state'];
  /** The open work of an in-progress epic; null for any other state. */
  readonly work: EpicOpenWork | null;
  readonly decision: WorkDecision;
  /** The pull requests a no closed or tried to, ascending; empty for any other decision. */
  readonly closed: readonly ClosedPullRequest[];
  /** A sentence per reading the core could not make. */
  readonly problems: readonly string[];
}

/** How the commands reach `gh`, `git`, the plan dir and the terminal; each left out is the system's own. */
export interface EpicHorizonSeams {
  readonly gh?: GhRunner;
  readonly git?: GitRunner;
  /** Reads the file names in the plan dir. `createPlanDirNames` when left out. */
  readonly planNames?: (dir: string) => PlanNames;
  /** True when a question can be answered. `process.stdin.isTTY` when left out. */
  readonly isTerminal?: () => boolean;
  /** Opens the prompter the questions are asked through. Called only to ask. */
  readonly openPrompter?: () => Prompter;
}

/** `#40`. */
function ref(issue: number): string {
  return `#${String(issue)}`;
}

/**
 * What a line asks for; a refusal with exit code 1 for no epic number,
 * several, one that is no whole number from 1, a missing `--to`, a `--to`
 * outside the action's targets and a `--reason` given no value.
 */
export function readHorizonLine(context: Pick<RafaContext, 'args' | 'flags'>, action: HorizonAction): HorizonLine {
  const { args, flags } = context;
  const [word] = args;
  if (args.length !== 1 || word === undefined) {
    const got = args.length === 0
      ? 'none'
      : `${String(args.length)}: ${args.join(' ')}`;
    throw lineRefusal(`Expected one epic number, got ${got}`, action.usage);
  }
  if (!ISSUE_NUMBER.test(word)) {
    throw lineRefusal(`"${word}" is no epic number, which is a whole number from 1`, action.usage);
  }
  const to = readChoiceFlag(flags, TO_FLAG, action.targets, action.usage);
  if (to === undefined) throw lineRefusal(`--${TO_FLAG} is required: --${TO_FLAG}=<horizon>`, action.usage);
  const reason = readTextFlag(flags, REASON_FLAG, action.usage) ?? null;
  return Object.freeze({ epic: Number(word), to, reason });
}

/** The place of `horizon` in {@link HORIZONS}: `now` first. */
function rankOf(horizon: Horizon): number {
  return HORIZONS.indexOf(horizon);
}

/**
 * The refusal of a change that goes the other way from `action`: a defer
 * moves an epic later, a promote earlier. Null when it goes the right way.
 */
export function wrongDirection(action: HorizonAction, change: HorizonChange): CommandExit | null {
  const later = rankOf(change.to) > rankOf(change.from);
  if (later === (action.name === 'defer')) return null;
  const other = action.name === 'defer'
    ? 'promote'
    : 'defer';
  const verb = later
    ? 'a deferral'
    : 'a promotion';
  return new CommandExit(
    EPIC_HORIZON_REFUSAL_EXIT,
    `❌ Epic ${ref(change.epic)} stands on ${change.from}, so ${change.from} → ${change.to} is ${verb};`
      + ` run rafa epic ${other} ${String(change.epic)} --${TO_FLAG}=${change.to}. Nothing was changed`,
  );
}

/** `branch feat/rafa-12-x, pull request #7`, the open work as the lines name it. */
export function workPhrase(work: EpicOpenWork): string {
  return [
    ...work.branches.map((branch) => `branch ${branch}`),
    ...work.pullRequests.map((pullRequest) => `pull request ${ref(pullRequest)}`),
  ].join(', ');
}

/** True when `work` names a branch or a pull request. */
function hasWork(work: EpicOpenWork | null): work is EpicOpenWork {
  return work !== null && work.branches.length + work.pullRequests.length > 0;
}

/** The question a defer of an in-progress epic with open work asks. */
export function keepWorkQuestion(epic: number, work: EpicOpenWork): string {
  return `Epic ${ref(epic)} has open work: ${workPhrase(work)}. Keep it? A no closes each pull request`
    + ' with a comment and deletes no branch. [Y/n] ';
}

/** True when an answer to the keep question is no; see the module note. */
function isNo(answer: string | null): boolean {
  return answer !== null && NO_ANSWERS.includes(answer.trim().toLowerCase());
}

/** The prompter a run asks through, opened on the first question and closed by `close`. */
function lazyPrompter(open: () => Prompter): { ask: (question: string) => Promise<string | null>; close: () => void } {
  let prompter: Prompter | null = null;
  return {
    ask: async (question) => {
      prompter ??= open();
      return prompter.ask(question);
    },
    close: () => {
      prompter?.close();
      prompter = null;
    },
  };
}

/** Reads what `read` answers; a refusal with {@link EPIC_HORIZON_REFUSAL_EXIT} when it fails. */
async function readOrRefuse<T>(what: string, read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    throw new CommandExit(EPIC_HORIZON_REFUSAL_EXIT, `❌ Could not read ${what}, so nothing was changed: ${messageOf(error)}`);
  }
}

/** The result of a run that changed nothing, or of one about to write. */
function resultOf(
  action: HorizonAction,
  reading: HorizonChangeReading,
  fields: Pick<EpicHorizonResult, 'status' | 'reason' | 'question' | 'decision' | 'closed'>,
): EpicHorizonResult {
  return Object.freeze({
    action: action.name,
    epic: reading.change.epic,
    from: reading.change.from,
    to: reading.change.to,
    state: reading.state,
    work: reading.work,
    problems: reading.problems,
    ...fields,
  });
}

/** What becomes of the work: none to ask about, unasked, or the answer to the keep question. */
async function decideWork(
  action: HorizonAction,
  reading: HorizonChangeReading,
  ask: ((question: string) => Promise<string | null>) | null,
): Promise<WorkDecision> {
  if (action.name !== 'defer' || !hasWork(reading.work)) return 'none';
  if (ask === null) return 'unasked';
  return isNo(await ask(keepWorkQuestion(reading.change.epic, reading.work)))
    ? 'closed'
    : 'kept';
}

/** Closes each open pull request of `work` with the trail's comment; a failure is its own outcome. */
async function closeWork(board: IssueBoard, change: HorizonChange, reason: string, work: EpicOpenWork): Promise<readonly ClosedPullRequest[]> {
  const comment = renderParkedPullRequestComment(change, reason);
  const closed: ClosedPullRequest[] = [];
  for (const number of work.pullRequests) {
    try {
      await board.closePullRequest(number, comment);
      closed.push(Object.freeze({ number, status: 'closed', problem: '' }));
    } catch (error) {
      closed.push(Object.freeze({ number, status: 'failed', problem: messageOf(error) }));
    }
  }
  return Object.freeze(closed);
}

/** Reads the line and the board, asks, and writes; see the module note. */
export async function changeEpicHorizon(context: RafaContext, action: HorizonAction, seams: EpicHorizonSeams): Promise<EpicHorizonResult> {
  const line = readHorizonLine(context, action);
  const project = issueProject(context);
  const config = issueSubjectConfig(project, (message) => {
    context.output.warn(message);
  });
  const gh = seams.gh ?? createGhRunner({ cwd: project.root });
  const listing = await readOrRefuse('the board', () => createGhBoardListing({ gh })());
  const reading = await readHorizonChange({
    issues: listing,
    epic: line.epic,
    to: line.to,
    git: seams.git ?? createGitRunner(project.root),
    pullRequests: createGhOpenPullRequests({ gh }),
    planNames: (seams.planNames ?? createPlanDirNames)(plansDirAt(project.root, config.planDir).path),
  });
  const refused = wrongDirection(action, reading.change);
  if (refused !== null) throw refused;

  const isTerminal = seams.isTerminal ?? ((): boolean => process.stdin.isTTY === true);
  const prompter = lazyPrompter(seams.openPrompter ?? ((): Prompter => createLinePrompter(process.stdin, process.stderr)));
  const ask = isTerminal()
    ? prompter.ask
    : null;
  try {
    const reason = await readReason(reading.change, line.reason, ask);
    if (reason.status !== 'given') {
      const question = reason.status === 'unasked'
        ? reason.question
        : null;
      return resultOf(action, reading, { status: reason.status, reason: null, question, decision: 'none', closed: [] });
    }
    const decision = await decideWork(action, reading, ask);
    prompter.close();

    const board = createGhIssueBoard({ gh });
    try {
      await applyHorizonChange(board, reading, reason.reason);
    } catch (error) {
      throw new CommandExit(1, `❌ Could not move epic ${ref(line.epic)} ${reading.change.from} → ${reading.change.to}:`
        + ` ${messageOf(error)}\nRead its labels and comments before running the same line again.`);
    }
    const closed = decision === 'closed' && reading.work !== null
      ? await closeWork(board, reading.change, reason.reason, reading.work)
      : [];
    return resultOf(action, reading, { status: 'moved', reason: reason.reason, question: null, decision, closed });
  } finally {
    prompter.close();
  }
}

/** A line of text mode, and whether it is written at `warn`. */
export interface HorizonLineOut {
  readonly text: string;
  readonly warn: boolean;
}

/** The lines naming the open work, by what became of it. */
function workLines(result: EpicHorizonResult): HorizonLineOut[] {
  const { work } = result;
  if (!hasWork(work)) return [];
  const info = (text: string): HorizonLineOut => ({ text, warn: false });
  switch (result.decision) {
    case 'none': {
      return result.status === 'moved' || result.action !== 'defer'
        ? []
        : [info(`Its open work: ${workPhrase(work)}.`)];
    }
    case 'kept': {
      return [info(`Its open work is kept: ${workPhrase(work)}.`)];
    }
    case 'unasked': {
      return [info(`No terminal to ask on, so its open work is kept: ${workPhrase(work)}.`)];
    }
    case 'closed': {
      const lines = result.closed.map((pull): HorizonLineOut => (pull.status === 'closed'
        ? info(`Closed pull request ${ref(pull.number)} with a comment.`)
        : { text: `Could not close pull request ${ref(pull.number)}: ${pull.problem}`, warn: true }));
      const kept = work.branches.length === 0
        ? 'No branch was deleted.'
        : `No branch was deleted: ${work.branches.join(', ')}.`;
      return [...lines, info(kept)];
    }
  }
}

/** The lines text mode writes for `result`, in order. */
export function renderEpicHorizon(result: EpicHorizonResult): readonly HorizonLineOut[] {
  const problems = result.problems.map((problem) => ({ text: `The open work named may be short: ${problem}`, warn: true }));
  const head: HorizonLineOut = result.status === 'moved'
    ? { text: `Moved epic ${ref(result.epic)} ${result.from} → ${result.to}: ${String(result.reason)}`, warn: false }
    : result.status === 'unasked'
      ? { text: unaskedReasonMessage(result.question ?? ''), warn: false }
      : { text: blankReasonMessage(), warn: true };
  return Object.freeze([head, ...workLines(result), ...problems]);
}

/** The refusal a run ends with when a pull request it meant to close is still open; null when none is. */
export function closeFailure(result: EpicHorizonResult): CommandExit | null {
  const failed = result.closed.filter((pull) => pull.status === 'failed').map((pull) => ref(pull.number));
  if (failed.length === 0) return null;
  return new CommandExit(1, `❌ Epic ${ref(result.epic)} moved ${result.from} → ${result.to}, but ${failed.join(', ')}`
    + ' could not be closed and stay open; close them by hand, deleting no branch.');
}

/** Runs one `epic defer` or `epic promote` line with `seams`, writing it in the line's output mode. */
export async function runEpicHorizon(context: RafaContext, action: HorizonAction, seams: EpicHorizonSeams): Promise<void> {
  const result = await changeEpicHorizon(context, action, seams);
  const failure = closeFailure(result);
  if (context.outputMode === 'json') {
    if (failure !== null) throw failure;
    context.output.result(result);
    return;
  }
  for (const line of renderEpicHorizon(result)) {
    if (line.warn) context.output.warn(line.text);
    else context.output.info(line.text);
  }
  if (failure !== null) throw failure;
}
