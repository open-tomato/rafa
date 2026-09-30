/**
 * `rafa epic cancel <n> [--reason="<why>"]`: an epic closed as not
 * planned, after asking what becomes of every issue outside it that its
 * open members block (`.rafa/specs/rafa-246-epic-lifecycle.md`). Several
 * teams can strand work in each other's epics, so a cancel asks about
 * each such issue instead of leaving it blocked forever.
 *
 * ## What is read, and what is refused
 *
 * The line is one epic number, a whole number from 1, and `--reason`,
 * optional text for the epic's comment; anything else is refused with
 * exit code 1. The board listing is read once (`createGhBoardListing`);
 * one that cannot be read is refused with {@link EPIC_CANCEL_REFUSAL_EXIT}.
 * Off it, {@link readEpicToCancel} refuses with the same exit code an
 * issue not on the listing, one that is not `type:epic`, and an epic
 * closed as completed, since a finished epic is not cancelled. An epic
 * already closed as NOT PLANNED — by hand on GitHub, or by an earlier
 * cancel whose writes did not all land — is not refused: the close is
 * skipped and the questions are asked.
 *
 * The dependents are `readEpicDependents`'s (`src/board/epic-dependents.ts`):
 * every open issue outside the epic whose `Blocked by:` line names one of
 * its open members, in ascending number. An unreadable line naming a
 * member is a `warn` line and is not asked about.
 *
 * ## The mode
 *
 * Who is in the epic and who waits on it are relationships, read in the
 * mode `board.relationships` names through the board's relationships
 * port (`src/board/relations/port.ts`), {@link EpicCancelSeams.relations};
 * left out, the mode is `labels` (`LABELS_READS`), and everything here
 * reads and writes as it did before the port, over the same one listing.
 *
 * In `native` mode the listing is read with the native fields
 * (`boardListFields`), and `readEpicDependents` reads the members as the
 * epic's sub-issues and the dependents as the open issues outside it
 * with a `blockedBy` link to an open member; no `epic:` label and no
 * `Blocked by:` line is read, and no line is ever unreadable. A native
 * epic is named by its number and title, as every line here already
 * names an epic. The cancel CLEARS NOTHING in `native` mode: an unblock
 * answer writes its note and its comment, takes no label off and removes
 * no blocked-by link, and says so ({@link keptLinksLine},
 * `./cancel-unblock.ts`), since GitHub stops holding an issue back once
 * its blocker closes. What the note names as still blocking the issue is
 * `./cancel-unblock.ts`'s reading in each mode. A move answer is read by
 * `readEpicMove`, which reads `epic:` labels, so in `native` mode it
 * refuses the target and the question is asked again.
 *
 * ## The questions
 *
 * The list is printed first, one issue a line with the members it waits
 * on. Then, where standard input is a terminal ({@link EpicCancelSeams.isTerminal}),
 * each dependent is asked about in turn through a line prompter on
 * stderr, {@link dependentQuestion}: `m` or `move`, `u` or `unblock`, `c`
 * or `cancel`, any case. Any other answer is told the three and asked
 * again. A move asks {@link targetQuestion} for the epic, and reads the
 * move with `readEpicMove` (`./move.ts`), so a target `epic move` would
 * refuse — not an open epic, its own epic — and the epic being cancelled
 * are said and the question is asked again. Every answer is taken BEFORE
 * any write, so an input that ends early changes nothing.
 *
 * With no terminal and at least one dependent, nothing changes: the list
 * is printed with {@link unaskedCancelMessage}, exit 0. With no
 * dependent there is nothing to ask, and the cancel goes ahead with or
 * without a terminal.
 *
 * ## The writes, in order
 *
 * Each dependent, in the order asked, then the epic. A write that fails
 * is a `warn` line and the run goes on; it then ends with exit code 1
 * naming what to finish by hand.
 *
 * - **Move**: `applyEpicMove` (`./move.ts`), the same swap, checklist
 *   lines and move comment `rafa epic move` makes, with the trail's
 *   `cancelMoveReason` as the reason.
 * - **Unblock**: the trail's `renderUnblockNote` appended below the
 *   dependent's body through `editChecklist`'s read, write and re-read
 *   ({@link appendNote}, every byte of the body kept), naming the members
 *   dropped and what its line still names; then `spec:blocked` taken off
 *   (`IssueBoard.removeLabel`) when it carries the label and nothing its
 *   line still names is open on the listing or on another repository,
 *   whose state is not read; then `renderDependentComment('unblocked')`.
 * - **Cancel**: one `IssueBoard.closeIssue` with reason `not planned` and
 *   `renderDependentComment('cancelled')`.
 * - **The epic**: one `IssueBoard.closeIssue` with reason `not planned`
 *   and `renderCancelComment`, listing each dependent whose own write
 *   landed. An epic closed as not planned already is not closed again;
 *   when a dependent was answered the same comment is posted on it, and
 *   otherwise nothing is written. A close `gh` refuses is exit 1.
 *
 * The epic's own members are not touched, and no issue is created. A
 * moved or unblocked dependent's `Blocked by:` line still names the
 * member it waited on, and `readBlockedBy` reads the first such line,
 * never the note below it, so the dependents query keeps listing it.
 *
 * ## What it writes
 *
 * Every line goes through the command's output, `info` or `warn`, in text
 * and json mode alike; json mode ends with an {@link EpicCancelResult} as
 * the terminal result's `data`. It starts no session, so it declares no
 * `spends`.
 */
import type { EpicMoveReading, EpicMoveWrites } from './move.js';
import type { GhRunner } from '../../adapters/tracker/github.js';
import type { EpicDependent } from '../../board/epic-dependents.js';
import type { DependentAnswer } from '../../board/epic-trail.js';
import type { EpicRelations } from '../../board/epics.js';
import type { BoardIssue } from '../../board/roadmap-board.js';
import type { OpenPullRequestLister } from '../../board/roadmap.js';
import type { RafaCommand, RafaContext } from '../../cli/command.js';
import type { Prompter } from '../../cli/prompt/confirm.js';
import type { GitRunner } from '../../pr/git.js';

import { createGhRunner } from '../../adapters/tracker/github.js';
import { SPEC_BLOCKED_LABEL } from '../../board/blocked.js';
import { editChecklist } from '../../board/epic-checklist.js';
import { readEpicDependents } from '../../board/epic-dependents.js';
import {
  cancelMoveReason,
  REASON_FLAG,
  renderCancelComment,
  renderDependentComment,
  renderUnblockNote,
} from '../../board/epic-trail.js';
import { isNotPlanned, localDay } from '../../board/epics.js';
import { createGhIssueBoard } from '../../board/issue-board.js';
import { LABELS_READS } from '../../board/relations/labels.js';
import { createGhBoardListing } from '../../board/roadmap-board.js';
import { createGhRoadmapBody } from '../../board/roadmap-tick.js';
import { createGhOpenPullRequests } from '../../board/roadmap.js';
import { CommandExit } from '../../cli/command.js';
import { createLinePrompter } from '../../cli/prompt/confirm.js';
import { messageOf } from '../../config-sections.js';
import { createGitRunner } from '../../pr/git.js';
import { issueProject, lineRefusal, readTextFlag } from '../issue/issue-tracker.js';

import { keptLinksLine, readUnblockStill } from './cancel-unblock.js';
import { applyEpicMove, readEpicMove } from './move.js';

/** The exit code every refusal of a cancel ends the command with. */
export const EPIC_CANCEL_REFUSAL_EXIT = 2;

/** The usage line a refusal names. */
const USAGE = 'rafa epic cancel <n> [--reason="<why>"]';

/** An issue number as a line types it: a whole number from 1. */
const ISSUE_NUMBER = /^[1-9]\d*$/u;

/** An epic number as an answer types it: `50` or `#50`. */
const EPIC_ANSWER = /^#?([1-9]\d*)$/u;

/** A line break as a body spells it. */
const LINE_BREAK = /\r\n|\n|\r/u;

/** A body's last line break, when it ends with one. */
const TRAILING_BREAK = /(?:\r\n|\n|\r)$/u;

/** What the person answers for one dependent. */
export type CancelChoice = 'move' | 'unblock' | 'cancel';

/** What a line asks for, read before anything is opened. */
export interface CancelLine {
  readonly epic: number;
  /** `--reason` as typed, or null when it was not passed. */
  readonly reason: string | null;
}

/** The epic a cancel reads off the listing, with its dependents. */
export interface EpicToCancel {
  readonly epic: BoardIssue;
  /** True when it is closed as not planned already, so the close is skipped. */
  readonly closedAlready: boolean;
  /** Every issue outside it waiting on its open members, in ascending number. */
  readonly dependents: readonly EpicDependent[];
  /** A sentence per unreadable line naming an open member. */
  readonly problems: readonly string[];
}

/** One dependent's answer, read and checked before any write. */
export type DependentChoice =
  | { readonly kind: 'move'; readonly reading: EpicMoveReading }
  | { readonly kind: 'unblock' }
  | { readonly kind: 'cancel' };

/** One dependent and the answer given for it. */
export interface ChosenDependent {
  readonly dependent: EpicDependent;
  readonly choice: DependentChoice;
}

/** A line of output, and whether it is written at `warn`. */
export interface CancelLineOut {
  readonly text: string;
  readonly warn: boolean;
}

/** What the writes for one dependent did. */
export interface DependentApplied {
  readonly issue: number;
  /** The members of the epic it waited on. */
  readonly waitsOn: readonly number[];
  readonly answer: DependentAnswer;
  /** True when the write the answer stands on landed: the swap, the note or the close. */
  readonly landed: boolean;
  /** What each write did, in order. */
  readonly lines: readonly CancelLineOut[];
  /** What is left to finish by hand, one clause each; empty when every write landed. */
  readonly left: readonly string[];
}

/** How a run ended. */
export type CancelRunStatus =
  /** The answers were applied and the epic closed, or found closed already. */
  | 'cancelled'
  /** A dependent and no terminal: nothing changed. */
  | 'unasked'
  /** The input ended before every dependent was answered: nothing changed. */
  | 'ended';

/** What json mode gives as the terminal result's `data`. */
export interface EpicCancelResult {
  readonly status: CancelRunStatus;
  readonly epic: number;
  readonly closedAlready: boolean;
  readonly dependents: readonly { readonly issue: number; readonly waitsOn: readonly number[] }[];
  /** A sentence per unreadable line naming an open member. */
  readonly problems: readonly string[];
  /** What each answered dependent's writes did; empty when nothing changed. */
  readonly applied: readonly DependentApplied[];
  /** What was done to the epic itself; null when nothing changed. */
  readonly epicWrite: 'closed' | 'commented' | 'untouched' | 'failed' | null;
  /** Everything left to finish by hand. */
  readonly left: readonly string[];
}

/** How the command reaches `gh`, `git`, the clock and the terminal; each left out is the system's own. */
export interface EpicCancelSeams {
  readonly gh?: GhRunner;
  readonly git?: GitRunner;
  /** True when a question can be answered. `process.stdin.isTTY` when left out. */
  readonly isTerminal?: () => boolean;
  /** Opens the prompter the questions are asked through. Called only to ask. */
  readonly openPrompter?: () => Prompter;
  /** Now, for the day the unblock note names. `new Date()` when left out. */
  readonly now?: () => Date;
  /** The board's relationships, which read the members and their dependents; `labels` mode when left out. See the module note. */
  readonly relations?: EpicRelations;
}

/** `#40`. */
function ref(issue: number): string {
  return `#${String(issue)}`;
}

/** `#12 #14`. */
function refs(issues: readonly number[]): string {
  return issues.map(ref).join(' ');
}

/** A refusal before anything was changed. */
function refusal(message: string): CommandExit {
  return new CommandExit(EPIC_CANCEL_REFUSAL_EXIT, `❌ ${message}; nothing was changed`);
}

/** What a line asks for; a refusal with exit code 1 for anything but one epic number and a valued `--reason`. */
export function readCancelLine(context: Pick<RafaContext, 'args' | 'flags'>): CancelLine {
  const { args, flags } = context;
  const [word] = args;
  if (args.length !== 1 || word === undefined) {
    const got = args.length === 0
      ? 'none'
      : `${String(args.length)}: ${args.join(' ')}`;
    throw lineRefusal(`Expected one epic number, got ${got}`, USAGE);
  }
  if (!ISSUE_NUMBER.test(word)) throw lineRefusal(`"${word}" is no epic number, which is a whole number from 1`, USAGE);
  const reason = readTextFlag(flags, REASON_FLAG, USAGE) ?? null;
  return Object.freeze({ epic: Number(word), reason });
}

/**
 * The epic `number` names on `issues`, with its dependents read in the
 * mode `relations` answers, `labels` when left out; see the module note.
 *
 * @throws CommandExit with {@link EPIC_CANCEL_REFUSAL_EXIT} for an issue
 *   not on the listing, one that is not `type:epic`, and an epic closed as
 *   completed.
 */
export function readEpicToCancel(issues: readonly BoardIssue[], number: number, relations: EpicRelations = LABELS_READS): EpicToCancel {
  const epic = issues.find((issue) => issue.number === number);
  if (epic === undefined) throw refusal(`${ref(number)} is not on the board listing`);
  const read = readEpicDependents(issues, number, { relations });
  if (read === null) throw refusal(`${ref(number)} is not an epic: it carries no type:epic label`);
  if (epic.state === 'CLOSED' && !isNotPlanned(epic)) {
    throw refusal(`Epic ${ref(number)} is closed as completed, and a finished epic is not cancelled`);
  }
  return Object.freeze({
    epic,
    closedAlready: epic.state === 'CLOSED',
    dependents: read.dependents,
    problems: Object.freeze(read.problems.map((problem) => `Not asked about: ${problem.message}`)),
  });
}

/** The question put for one dependent of epic `epic`. */
export function dependentQuestion(epic: number, dependent: EpicDependent): string {
  const { issue } = dependent;
  return `${ref(issue.number)} "${issue.title}" waits on ${refs(dependent.waitsOn)} of epic ${ref(epic)}.`
    + ' Move it to another epic, unblock it, or cancel it? [m/u/c] ';
}

/** The question put for a move's target epic. */
export function targetQuestion(issue: number): string {
  return `Move ${ref(issue)} to which open epic? Its number: `;
}

/** What an answer that is none of the three is told. */
export const CHOICE_HINT = 'Answer m to move it to another epic, u to unblock it, or c to cancel it.';

/** The choice an answer names, or null for none: `m`, `move`, `u`, `unblock`, `c`, `cancel`, any case. */
export function readChoiceWord(answer: string): CancelChoice | null {
  switch (answer.trim().toLowerCase()) {
    case 'm':
    case 'move': {
      return 'move';
    }
    case 'u':
    case 'unblock': {
      return 'unblock';
    }
    case 'c':
    case 'cancel': {
      return 'cancel';
    }
    default: {
      return null;
    }
  }
}

/** What a run with a dependent and no terminal prints after the list. */
export function unaskedCancelMessage(epic: number): string {
  return 'No terminal to ask on, so nothing changed: for each issue listed it would have asked whether to move'
    + ` it to another epic, unblock it, or cancel it. Run rafa epic cancel ${String(epic)} where there is a terminal.`;
}

/** What a run whose input ended before every answer prints. */
export function endedCancelMessage(epic: number): string {
  return `The input ended before every issue was answered, so nothing changed and epic ${ref(epic)} was not closed.`;
}

/** What {@link askDependents} reads and asks through. */
export interface AskDependentsInput {
  readonly epic: number;
  readonly issues: readonly BoardIssue[];
  readonly dependents: readonly EpicDependent[];
  readonly prompter: Prompter;
  readonly git: GitRunner;
  readonly pullRequests: OpenPullRequestLister;
}

/** A refusal's message without its mark, for a line the prompter says. */
function plainMessage(error: unknown): string {
  return messageOf(error).replace(/^❌\s*/u, '');
}

/** The move of `dependent` to the epic `answer` names, or the sentence saying why not. */
async function moveTo(input: AskDependentsInput, issue: number, answer: string): Promise<EpicMoveReading | string> {
  const found = EPIC_ANSWER.exec(answer.trim());
  if (found === null) return `"${answer.trim()}" is no epic number, which is a whole number from 1.`;
  const to = Number(found[1]);
  if (to === input.epic) return `Epic ${ref(to)} is the epic being cancelled; name another.`;
  try {
    return await readEpicMove({ issues: input.issues, issue, to, git: input.git, pullRequests: input.pullRequests });
  } catch (error) {
    return `Cannot move ${ref(issue)} to epic ${ref(to)}: ${plainMessage(error)}`;
  }
}

/** One dependent's answer, asked until it is one; null once the input has ended. */
async function askOne(input: AskDependentsInput, dependent: EpicDependent): Promise<DependentChoice | null> {
  const { prompter } = input;
  for (;;) {
    const answer = await prompter.ask(dependentQuestion(input.epic, dependent));
    if (answer === null) return null;
    const word = readChoiceWord(answer);
    if (word === null) {
      prompter.say(CHOICE_HINT);
      continue;
    }
    if (word !== 'move') return { kind: word };
    const target = await prompter.ask(targetQuestion(dependent.issue.number));
    if (target === null) return null;
    const move = await moveTo(input, dependent.issue.number, target);
    if (typeof move !== 'string') return { kind: 'move', reading: move };
    prompter.say(move);
  }
}

/**
 * Every dependent's answer, asked in turn; null when the input ended
 * before the last, so the caller changes nothing. Writes nothing.
 */
export async function askDependents(input: AskDependentsInput): Promise<readonly ChosenDependent[] | null> {
  const chosen: ChosenDependent[] = [];
  for (const dependent of input.dependents) {
    const choice = await askOne(input, dependent);
    if (choice === null) return null;
    chosen.push(Object.freeze({ dependent, choice }));
  }
  return Object.freeze(chosen);
}

/**
 * `body` with `note` appended below it after a blank line, in the body's
 * own line break, every other byte kept; `body` itself when a line of it
 * is `note` already, so a re-read that carries the note needs no edit.
 */
export function appendNote(body: string, note: string): string {
  if (body.split(LINE_BREAK).includes(note)) return body;
  if (body === '') return note;
  const lineBreak = LINE_BREAK.exec(body)?.[0] ?? '\n';
  return TRAILING_BREAK.test(body)
    ? `${body}${lineBreak}${note}${lineBreak}`
    : `${body}${lineBreak}${lineBreak}${note}`;
}

/** Where the answers are written. */
export type CancelWrites = EpicMoveWrites;

/** What applying one answer is handed. */
interface ApplyInput {
  readonly writes: CancelWrites;
  readonly epic: number;
  readonly issues: readonly BoardIssue[];
  readonly day: string;
  /** The board's relationships, which read what an unblocked dependent still waits on. */
  readonly relations: EpicRelations;
}

/** A line at `info`. */
function info(text: string): CancelLineOut {
  return { text, warn: false };
}

/** A line at `warn`. */
function warn(text: string): CancelLineOut {
  return { text, warn: true };
}

/** Posts `body` on `issue`; the problem sentence, or the empty string when it was posted. */
async function commentOn(writes: CancelWrites, issue: number, body: string): Promise<string> {
  try {
    await writes.board.comment(issue, body);
    return '';
  } catch (error) {
    return messageOf(error);
  }
}

/** Runs the move `reading` holds, with the cancel's reason. */
async function applyMove(input: ApplyInput, dependent: EpicDependent, reading: EpicMoveReading): Promise<DependentApplied> {
  const { change } = reading;
  const base = { issue: change.issue, waitsOn: dependent.waitsOn, answer: { kind: 'moved', to: change.to } as const };
  try {
    const outcome = await applyEpicMove(input.writes, reading, cancelMoveReason(input.epic));
    const lines = [info(`Moved ${ref(change.issue)} from epic ${ref(change.from)} to ${ref(change.to)}.`)];
    const left: string[] = [];
    if (outcome.added.status === 'failed') {
      lines.push(warn(`Could not add its line to epic ${ref(change.to)}'s checklist: ${outcome.added.problem}`));
      left.push(`add ${ref(change.issue)}'s line to epic ${ref(change.to)}'s checklist`);
    }
    if (outcome.removed.status === 'failed') {
      lines.push(warn(`Could not take its line off epic ${ref(change.from)}'s checklist: ${outcome.removed.problem}`));
      left.push(`take ${ref(change.issue)}'s line off epic ${ref(change.from)}'s checklist`);
    }
    if (outcome.commentProblem !== '') {
      lines.push(warn(`Could not comment on ${ref(change.issue)}: ${outcome.commentProblem}`));
      left.push(`comment the move on ${ref(change.issue)}`);
    }
    return Object.freeze({ ...base, landed: true, lines, left });
  } catch (error) {
    return Object.freeze({
      ...base,
      landed: false,
      lines: [warn(`Could not move ${ref(change.issue)} to epic ${ref(change.to)}: ${messageOf(error)}`)],
      left: [`move ${ref(change.issue)} to epic ${ref(change.to)}`],
    });
  }
}

/** The `spec:blocked` label as `issue` spells it, or undefined when it carries none. */
function blockedLabelOf(issue: BoardIssue): string | undefined {
  return issue.labels.find((label) => label.trim().toLowerCase() === SPEC_BLOCKED_LABEL);
}

/** Takes `spec:blocked` off when nothing still named may be open; the lines and what is left. */
async function unblockLabel(input: ApplyInput, issue: BoardIssue, maybeOpen: readonly string[]): Promise<{ line: CancelLineOut | null; left: string | null }> {
  const label = blockedLabelOf(issue);
  if (label === undefined) return { line: null, left: null };
  if (maybeOpen.length > 0) {
    return { line: info(`${ref(issue.number)} keeps ${label}: its line still names ${maybeOpen.join(' ')}, not known to be closed.`), left: null };
  }
  try {
    await input.writes.board.removeLabel(issue.number, label);
    return { line: info(`Took ${label} off ${ref(issue.number)}.`), left: null };
  } catch (error) {
    return { line: warn(`Could not take ${label} off ${ref(issue.number)}: ${messageOf(error)}`), left: `take ${label} off ${ref(issue.number)}` };
  }
}

/**
 * Appends the note, takes `spec:blocked` off when nothing else may block
 * (in `labels` mode; `native` clears nothing, see the module note), and
 * comments.
 */
async function applyUnblock(input: ApplyInput, dependent: EpicDependent): Promise<DependentApplied> {
  const { issue, waitsOn } = dependent;
  const still = readUnblockStill(input.relations, input.issues, issue, waitsOn);
  const note = renderUnblockNote(input.day, input.epic, waitsOn, still.named);
  const edit = await editChecklist({ issue: issue.number, edit: (body) => appendNote(body, note), board: input.writes.bodies });

  const lines: CancelLineOut[] = [];
  const left: string[] = [];
  if (edit.status === 'failed') {
    lines.push(warn(`Could not add the note to ${ref(issue.number)}'s body: ${edit.problem}`));
    left.push(`add the note to ${ref(issue.number)}'s body: ${note}`);
  } else {
    const verb = waitsOn.length === 1
      ? 'blocks'
      : 'block';
    lines.push(info(edit.status === 'edited'
      ? `Unblocked ${ref(issue.number)}: noted below its body that ${refs(waitsOn)} no longer ${verb} it.`
      : `Unblocked ${ref(issue.number)}: its body carries the note already.`));
  }
  const label = input.relations.mode === 'native'
    ? { line: info(keptLinksLine(issue.number, waitsOn)), left: null }
    : await unblockLabel(input, issue, still.maybeOpen);
  if (label.line !== null) lines.push(label.line);
  if (label.left !== null) left.push(label.left);
  const problem = await commentOn(input.writes, issue.number, renderDependentComment('unblocked', input.epic, waitsOn));
  if (problem !== '') {
    lines.push(warn(`Could not comment on ${ref(issue.number)}: ${problem}`));
    left.push(`comment the unblock on ${ref(issue.number)}`);
  }
  return Object.freeze({ issue: issue.number, waitsOn, answer: { kind: 'unblocked' } as const, landed: edit.status !== 'failed', lines, left });
}

/** Closes the dependent as not planned, with its comment. */
async function applyCancel(input: ApplyInput, dependent: EpicDependent): Promise<DependentApplied> {
  const { issue, waitsOn } = dependent;
  const base = { issue: issue.number, waitsOn, answer: { kind: 'cancelled' } as const };
  try {
    await input.writes.board.closeIssue(issue.number, 'not planned', renderDependentComment('cancelled', input.epic, waitsOn));
    return Object.freeze({ ...base, landed: true, lines: [info(`Closed ${ref(issue.number)} as not planned.`)], left: [] });
  } catch (error) {
    return Object.freeze({
      ...base,
      landed: false,
      lines: [warn(`Could not close ${ref(issue.number)} as not planned: ${messageOf(error)}`)],
      left: [`close ${ref(issue.number)} as not planned`],
    });
  }
}

/** Applies one answer; never throws for the board. */
async function applyChoice(input: ApplyInput, chosen: ChosenDependent): Promise<DependentApplied> {
  const { choice, dependent } = chosen;
  switch (choice.kind) {
    case 'move': {
      return applyMove(input, dependent, choice.reading);
    }
    case 'unblock': {
      return applyUnblock(input, dependent);
    }
    case 'cancel': {
      return applyCancel(input, dependent);
    }
  }
}

/** What the epic's own write did, with its line and what is left. */
interface EpicWrite {
  readonly kind: NonNullable<EpicCancelResult['epicWrite']>;
  readonly line: CancelLineOut;
  readonly left: string | null;
}

/** Closes the epic, or comments on one closed already; see the module note. */
async function writeEpic(writes: CancelWrites, target: EpicToCancel, reason: string | null, applied: readonly DependentApplied[]): Promise<EpicWrite> {
  const epic = target.epic.number;
  const outcomes = applied.filter((each) => each.landed).map(({ issue, answer }) => ({ issue, answer }));
  const comment = renderCancelComment(reason, outcomes);
  if (!target.closedAlready) {
    try {
      await writes.board.closeIssue(epic, 'not planned', comment);
      return { kind: 'closed', line: info(`Closed epic ${ref(epic)} as not planned.`), left: null };
    } catch (error) {
      return { kind: 'failed', line: warn(`Could not close epic ${ref(epic)} as not planned: ${messageOf(error)}`), left: `close epic ${ref(epic)} as not planned` };
    }
  }
  if (outcomes.length === 0) {
    return { kind: 'untouched', line: info(`Epic ${ref(epic)} was closed as not planned already, so nothing was written on it.`), left: null };
  }
  const problem = await commentOn(writes, epic, comment);
  return problem === ''
    ? { kind: 'commented', line: info(`Epic ${ref(epic)} was closed as not planned already; commented what became of each issue.`), left: null }
    : { kind: 'failed', line: warn(`Could not comment on epic ${ref(epic)}: ${problem}`), left: `comment the cancel on epic ${ref(epic)}` };
}

/** The lines listing the dependents. */
export function dependentLines(epic: number, dependents: readonly EpicDependent[]): readonly string[] {
  if (dependents.length === 0) return [`No issue outside epic ${ref(epic)} waits on its open members.`];
  const count = dependents.length === 1
    ? '1 issue outside it waits'
    : `${String(dependents.length)} issues outside it wait`;
  return [
    `Epic ${ref(epic)}: ${count} on its open members:`,
    ...dependents.map(({ issue, waitsOn }) => `- ${ref(issue.number)} ${issue.title}, waiting on ${refs(waitsOn)}`),
  ];
}

/** The result a run that changed nothing answers. */
function unchanged(status: CancelRunStatus, target: EpicToCancel): EpicCancelResult {
  return resultOf(target, { status, applied: [], epicWrite: null, left: [] });
}

/** The result for `target` with the fields a run fills in. */
function resultOf(target: EpicToCancel, fields: Pick<EpicCancelResult, 'status' | 'applied' | 'epicWrite' | 'left'>): EpicCancelResult {
  return Object.freeze({
    epic: target.epic.number,
    closedAlready: target.closedAlready,
    dependents: target.dependents.map(({ issue, waitsOn }) => ({ issue: issue.number, waitsOn })),
    problems: target.problems,
    ...fields,
  });
}

/** Reads the listing with `relations`' fields; a refusal with {@link EPIC_CANCEL_REFUSAL_EXIT} when it fails. */
async function readListing(gh: GhRunner, relations: EpicRelations): Promise<readonly BoardIssue[]> {
  try {
    return await createGhBoardListing({ gh, mode: relations.mode })();
  } catch (error) {
    throw new CommandExit(EPIC_CANCEL_REFUSAL_EXIT, `❌ Could not read the board, so nothing was changed: ${messageOf(error)}`);
  }
}

/** Writes one line through the output. */
function print(context: RafaContext, line: CancelLineOut): void {
  if (line.warn) context.output.warn(line.text);
  else context.output.info(line.text);
}

/** The answers, asked where there is a terminal; the prompter is closed before it answers. */
async function askAll(input: Omit<AskDependentsInput, 'prompter'>, seams: EpicCancelSeams): Promise<readonly ChosenDependent[] | null> {
  const prompter = (seams.openPrompter ?? ((): Prompter => createLinePrompter(process.stdin, process.stderr)))();
  try {
    return await askDependents({ ...input, prompter });
  } finally {
    prompter.close();
  }
}

/** Reads the line and the board, asks, writes and prints; see the module note. */
export async function cancelEpic(context: RafaContext, seams: EpicCancelSeams): Promise<EpicCancelResult> {
  const line = readCancelLine(context);
  const project = issueProject(context);
  const gh = seams.gh ?? createGhRunner({ cwd: project.root });
  const relations = seams.relations ?? LABELS_READS;
  const issues = await readListing(gh, relations);
  const target = readEpicToCancel(issues, line.epic, relations);
  const epic = target.epic.number;

  for (const text of dependentLines(epic, target.dependents)) print(context, info(text));
  for (const problem of target.problems) print(context, warn(problem));
  const isTerminal = seams.isTerminal ?? ((): boolean => process.stdin.isTTY === true);
  let chosen: readonly ChosenDependent[] = [];
  if (target.dependents.length > 0) {
    if (!isTerminal()) {
      print(context, info(unaskedCancelMessage(epic)));
      return unchanged('unasked', target);
    }
    const git = seams.git ?? createGitRunner(project.root);
    const answered = await askAll({ epic, issues, dependents: target.dependents, git, pullRequests: createGhOpenPullRequests({ gh }) }, seams);
    if (answered === null) {
      print(context, warn(endedCancelMessage(epic)));
      return unchanged('ended', target);
    }
    chosen = answered;
  }

  const writes: CancelWrites = { board: createGhIssueBoard({ gh }), bodies: createGhRoadmapBody({ gh }) };
  const input: ApplyInput = { writes, epic, issues, day: localDay((seams.now ?? ((): Date => new Date()))()), relations };
  const applied: DependentApplied[] = [];
  for (const each of chosen) {
    const done = await applyChoice(input, each);
    for (const out of done.lines) print(context, out);
    applied.push(done);
  }
  const written = await writeEpic(writes, target, line.reason, applied);
  print(context, written.line);
  const left = [...applied.flatMap((each) => each.left), ...(written.left === null
    ? []
    : [written.left])];
  return resultOf(target, { status: 'cancelled', applied, epicWrite: written.kind, left });
}

/** The refusal a run ends with when a write did not land; null when every one did. */
export function cancelFailure(result: EpicCancelResult): CommandExit | null {
  if (result.left.length === 0) return null;
  const closed = result.epicWrite === 'failed' && !result.closedAlready
    ? `Epic ${ref(result.epic)} is still open`
    : `Epic ${ref(result.epic)} is closed as not planned`;
  return new CommandExit(1, `❌ ${closed}, but not every write landed; by hand: ${result.left.join('; ')}.`
    + ` Running rafa epic cancel ${String(result.epic)} again asks about every issue still waiting on it.`);
}

/** Runs one `epic cancel` line with `seams`; json mode ends on the result. */
export async function runEpicCancel(context: RafaContext, seams: EpicCancelSeams): Promise<void> {
  const result = await cancelEpic(context, seams);
  const failure = cancelFailure(result);
  if (failure !== null) throw failure;
  if (context.outputMode === 'json') context.output.result(result);
}

/** The command, reaching `gh`, `git`, the clock and the terminal through `seams`; see the module note. */
export function createEpicCancelCommand(seams: EpicCancelSeams = {}): RafaCommand {
  const command: RafaCommand = {
    name: 'epic cancel',
    subject: 'epic',
    action: 'cancel',
    summary: 'cancel an epic, asking what becomes of each issue outside it that its open members block',
    description: 'Lists every open issue outside the epic whose "Blocked by:" line names one of its open members,'
      + ' and asks for each one: move it to another epic (the same move as rafa epic move), unblock it (an'
      + ' "Updated" note below its body, spec:blocked taken off when nothing else it names is open, and a'
      + ' comment), or cancel it (closed as not planned with a comment). Every answer is taken before any write.'
      + ' Then the epic is closed as not planned with a comment naming what became of each issue; an epic closed'
      + ' as not planned already is not closed again. With no terminal and an issue to ask about, the list is'
      + ' printed and nothing changes. An issue that is not an epic, and an epic closed as completed, are refused'
      + ' with exit code 2. With `--output=json` what each write did is the data of the terminal result event.',
    args: [
      {
        name: 'n',
        description: 'The epic\'s issue number.',
        type: 'string',
        required: true,
      },
    ],
    flags: [
      {
        name: REASON_FLAG,
        description: 'Why the epic is cancelled, written in its closing comment.',
        type: 'string',
      },
    ],
    examples: [
      {
        cmd: 'rafa epic cancel 40 --reason="sign-in moved to the platform team"',
        note: 'Asks about each issue #40\'s open members block, then closes #40 as not planned.',
      },
    ],
    outputs: ['text', 'json'],
    run: (context) => runEpicCancel(context, seams),
  };
  return Object.freeze(command);
}

export default createEpicCancelCommand();
