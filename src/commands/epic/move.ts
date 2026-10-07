/**
 * `rafa epic move <issue> --to=<epic> [--reason="<why>"]`: one issue
 * taken from the epic it belongs to and given to another, without being
 * recreated (`.rafa/specs/rafa-246-epic-lifecycle.md`). Its `epic:`
 * label is swapped, its checklist line leaves the old epic's body for the
 * new one's, and a comment on the issue says why. Its title, its body,
 * its comments, its branches and its pull request links stay as they
 * are, so nothing about the work on it changes; the comment names that
 * work so whoever finds the branch later knows it now serves another
 * epic.
 *
 * The move is two halves, both exported so that `rafa epic cancel` runs
 * the same move for a dependent the person chose to move:
 * {@link readEpicMove} reads the move off one board listing and refuses
 * what cannot move, and {@link applyEpicMove} makes it. The line, the
 * reason and the lines printed are this command's.
 *
 * ## The line
 *
 * One argument, the issue's number, and `--to`, required, the target
 * epic's number; each a whole number from 1. `--reason` is optional
 * text. Each is refused with exit code 1 before anything is read.
 *
 * ## What is read, and what is refused
 *
 * The board listing is read once (`createGhBoardListing`, through
 * `BOARD_LIST_FIELDS` and `parseBoardListing`); one that cannot be read
 * is refused with {@link EPIC_MOVE_REFUSAL_EXIT}. Off it,
 * {@link readEpicMove} refuses with the same exit code, before any
 * question and any write, each refusal saying nothing was changed:
 *
 * - an issue that is not on the listing;
 * - an issue that is itself an epic, which belongs to no epic
 *   (`src/board/epics.ts`);
 * - an issue with NO `epic:` label, which has no epic to leave;
 * - an issue with SEVERAL, since which one it leaves cannot be read —
 *   `./show.ts` names that fault, and the person fixes it first;
 * - a target that is not an OPEN EPIC: not on the listing, not
 *   `type:epic`, or closed;
 * - a target carrying no `epic:` label, which gives the issue no label to
 *   take;
 * - a move to ITS OWN EPIC: the target's slug is the one the issue
 *   carries;
 * - an issue whose slug no epic owns, or several do. An epic's slug is
 *   its first `epic:` label, as `readEpics` reads it; with no owner there
 *   is no epic `#A` for the comment to name and no body to take the line
 *   out of, and with two it cannot tell which. The owner may be closed:
 *   an issue can leave a finished epic.
 *
 * A closed issue moves too. Only an OPEN issue has its work read: every
 * scanned branch ref `branchClaims` reads as the issue's, named as a
 * person types it (`branchNameOf`, `src/board/epic-horizon.ts`), and every
 * open pull request whose body closes it or whose head branch claims it,
 * in ascending number. A reading that fails is a problem sentence, never
 * a throw, and the command warns that the work named may be short.
 *
 * ## The line that moves
 *
 * The new line carries the old one's why, or the issue's title when the
 * old epic's body lists no line for it, and is ticked when the old line
 * was, or, with no old line, when the issue is closed. Both are read off
 * the listing's body; the edits themselves read each body afresh.
 *
 * ## The reason
 *
 * `--reason`, else the trail's `reasonQuestion` asked once where standard
 * input is a terminal ({@link EpicMoveSeams.isTerminal}), through a line
 * prompter on stderr (`readReason`, `src/board/epic-trail.ts`). No
 * terminal and no `--reason` changes nothing and prints the question; a
 * blank reason changes nothing and warns. Both exit 0, and the json
 * result's `status` tells them apart from a move.
 *
 * ## The writes, in order
 *
 * {@link applyEpicMove} makes them, and the order leaves the least undone
 * when one fails. The move itself is the board's relationships port's
 * `setParent` (`src/board/relations/port.ts`), made with the listing the
 * move was read off, so no `gh` argv for it is spelled here; in `labels`
 * mode, the default, it is `setLabelsParent`
 * (`src/board/relations/labels-writes.ts`), which sends what this command
 * sent before the port, in the same order:
 *
 * 1. The swap: one `gh issue edit` taking the old `epic:` label off and
 *    putting the new one on. Membership IS the label, so this is the
 *    move; a failed swap rejects and nothing else is sent, refused with
 *    exit code 1.
 * 2. The new epic's body, the line appended with `appendLine`, then the
 *    old epic's body, the line taken off with `removeLine`, each carried
 *    by `editChecklist` (`src/board/epic-checklist.ts`): read, write,
 *    re-read, retried up to `TICK_ATTEMPTS`, every other byte kept. The
 *    new line goes in first, so an edit that fails leaves the line in two
 *    lists rather than in none. Each edit comes back as the port's write
 *    record carrying `editChecklist`'s attempts, and is answered as the
 *    {@link ChecklistEditResult} it was.
 * 3. The comment on the issue, the trail's `renderMoveComment` with the
 *    open work, posted once the label moved whatever became of the
 *    bodies, since the label is what changed on the issue.
 *
 * No issue is created or closed, and no `git` write is made. A body edit
 * that ends `failed` or a comment that could not be posted is a `warn`
 * line, and the run then ends with exit code 1 naming what to finish by
 * hand. A body that needed no edit (`nothing-to-edit`) is not a failure.
 *
 * ## Native mode
 *
 * The mode is the one `board.relationships` names in the project's
 * config (`./move-native.ts`, which also reads the board's repository in
 * `native` mode), or the one the relationships
 * {@link EpicMoveSeams.relations} answer when a caller hands them in; in
 * `labels`, the default, everything above holds. Under
 * `board.relationships: native` the listing is read with the native
 * fields, and the epic the issue leaves is its sub-issue parent, read
 * through the port's `epicOf` (`./move-native.ts`): an issue with no
 * parent, or a parent that is not an issue typed `epic` on the listing,
 * is refused with {@link EPIC_MOVE_REFUSAL_EXIT}, as is a move to its own
 * parent; no `epic:` label is read, and the target is refused only for
 * not being an open `type:epic` issue. Step 1 is then one
 * `gh issue edit <n> --parent <epic>`, which moves the issue out of its
 * old parent in the same call, and there is no step 2: no label, no
 * checklist line. The comment, step 3, is the same trail comment. Each
 * native-mode sentence names the mode, and the json result carries
 * `relationships: native` and leaves out the labels and the checklist
 * edits it has none of.
 *
 * ## The project refresh
 *
 * Once the move landed, with `board.project.number` set,
 * `./epic-project.ts` refreshes on the repository's project the issue,
 * both epics with their members, and every item whose Rank shifted. Its
 * lines are warnings written after the run's own, before json mode's
 * result, and never change the exit code.
 *
 * ## What it writes
 *
 * In text mode, the move and what became of each line. In json mode the
 * terminal result's `data` is an {@link EpicMoveResult}. It starts no
 * session, so it declares no `spends`.
 */
import type { EpicProjectSeams } from './epic-project.js';
import type { GhRunner } from '../../adapters/tracker/github.js';
import type { ChecklistEditResult } from '../../board/epic-checklist.js';
import type { MembershipChange, OpenWork } from '../../board/epic-trail.js';
import type { EpicRelations } from '../../board/epics.js';
import type { IssueBoard } from '../../board/issue-board.js';
import type { BoardRelations, RelationWrite } from '../../board/relations/port.js';
import type { BoardIssue } from '../../board/roadmap-board.js';
import type { OpenPullRequestLister, RoadmapPullRequest } from '../../board/roadmap.js';
import type { RafaCommand, RafaContext } from '../../cli/command.js';
import type { Prompter } from '../../cli/prompt/confirm.js';
import type { GitRunner } from '../../pr/git.js';

import { createGhRunner } from '../../adapters/tracker/github.js';
import { branchNameOf } from '../../board/epic-horizon.js';
import {
  blankReasonMessage,
  REASON_FLAG,
  readReason,
  renderMoveComment,
  unaskedReasonMessage,
} from '../../board/epic-trail.js';
import { EPIC_LABEL_PREFIX, epicSlugsOf } from '../../board/epics.js';
import { createGhIssueBoard } from '../../board/issue-board.js';
import { createGhBoardListing } from '../../board/roadmap-board.js';
import { branchClaims, closedIssuesIn, createGhOpenPullRequests, parseRoadmapBody, scanClaimBranches } from '../../board/roadmap.js';
import { CommandExit } from '../../cli/command.js';
import { createLinePrompter } from '../../cli/prompt/confirm.js';
import { messageOf } from '../../config-sections.js';
import { createGitRunner } from '../../pr/git.js';
import { issueProject, lineRefusal, readTextFlag } from '../issue/issue-tracker.js';

import { moveTarget, refreshProjectAfterEpic } from './epic-project.js';
import { TO_FLAG, workPhrase } from './horizon-change.js';
import {
  configuredMoveRelations,
  NATIVE_MODE,
  NATIVE_RETRY_HINT,
  nativeAlreadyMessage,
  nativeEpicLeft,
  nativeParentLine,
  readBoardRepository,
} from './move-native.js';

/** The exit code every refusal of a move ends the command with. */
export const EPIC_MOVE_REFUSAL_EXIT = 2;

/** The usage line a refusal names. */
const USAGE = 'rafa epic move <issue> --to=<epic> [--reason="<why>"]';

/** An issue number as a line types it: a whole number from 1. */
const ISSUE_NUMBER = /^[1-9]\d*$/u;

/** What a line asks for, read before anything is opened. */
export interface MoveLine {
  readonly issue: number;
  readonly to: number;
  /** `--reason` as typed, or null when it was not passed. */
  readonly reason: string | null;
}

/** What {@link readEpicMove} reads. */
export interface EpicMoveInput {
  /** The board listing, read once by the caller. */
  readonly issues: readonly BoardIssue[];
  /** The issue that moves. */
  readonly issue: number;
  /** The epic it moves to. */
  readonly to: number;
  /** Runs the branch scan's two git reads. */
  readonly git: GitRunner;
  /** The remote the branch scan asks; `origin` when left out. */
  readonly remote?: string;
  /** Every open pull request. */
  readonly pullRequests: OpenPullRequestLister;
  /** The board's relationships, which read the epic a native issue leaves; `labels` mode when left out. See the module note. */
  readonly relations?: EpicRelations;
}

/** The checklist line the target epic's body gains. */
export interface MovedLine {
  /** The why it carries: the old line's, or the issue's title. */
  readonly why: string;
  readonly ticked: boolean;
}

/** What {@link readEpicMove} answers for a move it does not refuse in `labels` mode. */
export interface LabelsMoveReading {
  /** The move, as the trail renders its comment. */
  readonly change: MembershipChange;
  /** The label the swap takes off: `epic:<old slug>`. */
  readonly removed: string;
  /** The label the swap puts on: `epic:<new slug>`. */
  readonly added: string;
  readonly line: MovedLine;
  /** The open branches and pull requests of an open issue; null for a closed one. */
  readonly work: OpenWork | null;
  /** A sentence per reading that failed; see the module note. */
  readonly problems: readonly string[];
}

/** What {@link readEpicMove} answers for a move it does not refuse in `native` mode: no label, no line. */
export interface NativeMoveReading {
  readonly change: MembershipChange;
  readonly relationships: 'native';
  readonly work: OpenWork | null;
  readonly problems: readonly string[];
}

/** What {@link readEpicMove} answers, in the mode it read. */
export type EpicMoveReading = LabelsMoveReading | NativeMoveReading;

/** True when `reading` was read in `native` mode. */
function isNativeReading(reading: EpicMoveReading): reading is NativeMoveReading {
  return 'relationships' in reading;
}

/** What {@link applyEpicMove} did past the move itself. */
export interface EpicMoveOutcome {
  /** The target epic's body gaining the line; `labels` mode only, left out in `native`. */
  readonly added?: ChecklistEditResult;
  /** The old epic's body losing it; `labels` mode only, left out in `native`. */
  readonly removed?: ChecklistEditResult;
  /** What the board said when the comment failed; empty when it was posted. */
  readonly commentProblem: string;
}

/** How a run ended. */
export type MoveRunStatus =
  /** The label was swapped. */
  | 'moved'
  /** No `--reason` and no terminal: nothing changed. */
  | 'unasked'
  /** The reason came out empty: nothing changed. */
  | 'blank';

/** What json mode gives as the terminal result's `data`. */
export interface EpicMoveResult {
  readonly status: MoveRunStatus;
  readonly issue: number;
  /** The epic it left, or would have. */
  readonly from: number;
  /** The epic it joined, or would have. */
  readonly to: number;
  /** The label taken off; `labels` mode only, left out in `native`. */
  readonly removedLabel?: string;
  /** The label put on; `labels` mode only, left out in `native`. */
  readonly addedLabel?: string;
  /** `native` in `native` mode; left out in `labels`. */
  readonly relationships?: 'native';
  /** The reason commented, or null when nothing changed. */
  readonly reason: string | null;
  /** The reason question a run with no terminal would have asked; null otherwise. */
  readonly question: string | null;
  readonly work: OpenWork | null;
  /** What the writes past the swap did; null when nothing changed. */
  readonly outcome: EpicMoveOutcome | null;
  readonly problems: readonly string[];
}

/** How the command reaches `gh`, `git`, the terminal and the project refresh; each left out is the system's own. */
export interface EpicMoveSeams extends EpicProjectSeams {
  readonly gh?: GhRunner;
  readonly git?: GitRunner;
  /** True when a question can be answered. `process.stdin.isTTY` when left out. */
  readonly isTerminal?: () => boolean;
  /** Opens the prompter the reason is asked through. Called only to ask. */
  readonly openPrompter?: () => Prompter;
  /**
   * The board's relationships, which read the move and make it, made over
   * the same `gh`; when left out, the ones the project's config names,
   * made over {@link EpicMoveSeams.gh}. See the module note.
   */
  readonly relations?: BoardRelations;
}

/** `#40`. */
function ref(issue: number): string {
  return `#${String(issue)}`;
}

/** The refusal `message` ends the command with. */
function refusal(message: string): CommandExit {
  return new CommandExit(EPIC_MOVE_REFUSAL_EXIT, `❌ ${message}; nothing was changed`);
}

/** `word` as an issue number; a refusal with exit code 1 naming `what` when it is not one. */
function issueNumber(word: string, what: string): number {
  if (!ISSUE_NUMBER.test(word)) throw lineRefusal(`"${word}" is no ${what}, which is a whole number from 1`, USAGE);
  return Number(word);
}

/**
 * What a line asks for; a refusal with exit code 1 for no issue number,
 * several, one that is no whole number from 1, a missing `--to`, one that
 * is no whole number from 1 and a `--reason` given no value.
 */
export function readMoveLine(context: Pick<RafaContext, 'args' | 'flags'>): MoveLine {
  const { args, flags } = context;
  const [word] = args;
  if (args.length !== 1 || word === undefined) {
    const got = args.length === 0
      ? 'none'
      : `${String(args.length)}: ${args.join(' ')}`;
    throw lineRefusal(`Expected one issue number, got ${got}`, USAGE);
  }
  const issue = issueNumber(word, 'issue number');
  const target = readTextFlag(flags, TO_FLAG, USAGE);
  if (target === undefined) throw lineRefusal(`--${TO_FLAG} is required: --${TO_FLAG}=<epic>`, USAGE);
  const to = issueNumber(target, 'epic number');
  const reason = readTextFlag(flags, REASON_FLAG, USAGE) ?? null;
  return Object.freeze({ issue, to, reason });
}

/** The issue that moves, on the listing and no epic; a refusal otherwise. */
function memberRow(issues: readonly BoardIssue[], number: number): BoardIssue {
  const issue = issues.find((candidate) => candidate.number === number);
  if (issue === undefined) throw refusal(`${ref(number)} is not on the board listing`);
  if (issue.type === 'epic') {
    throw refusal(`${ref(number)} is an epic, and an epic belongs to no epic; move its members one by one`);
  }
  return issue;
}

/** The issue that moves and the one slug it carries; a refusal otherwise. */
function movingIssue(issues: readonly BoardIssue[], number: number): { issue: BoardIssue; slug: string } {
  const issue = memberRow(issues, number);
  const slugs = epicSlugsOf(issue.labels);
  const [slug] = slugs;
  if (slug === undefined) {
    throw refusal(`${ref(number)} carries no ${EPIC_LABEL_PREFIX} label, so it is in no epic to move from`);
  }
  if (slugs.length > 1) {
    throw refusal(`${ref(number)} carries ${slugs.map((each) => `${EPIC_LABEL_PREFIX}${each}`).join(', ')},`
      + ' so the epic it leaves cannot be read; leave it exactly one epic: label and run again');
  }
  return { issue, slug };
}

/** The slug an epic owns: its first `epic:` label, as `readEpics` reads it; undefined for none. */
function ownSlug(epic: BoardIssue): string | undefined {
  return epicSlugsOf(epic.labels)[0];
}

/** The open epic `number`; a refusal when it is not one. */
function openEpic(issues: readonly BoardIssue[], number: number): BoardIssue {
  const epic = issues.find((candidate) => candidate.number === number);
  if (epic === undefined) throw refusal(`${ref(number)} is not on the board listing, so it is not an open epic`);
  if (epic.type !== 'epic') throw refusal(`${ref(number)} is not an epic: it carries no type:epic label`);
  if (epic.state !== 'OPEN') throw refusal(`Epic ${ref(number)} is closed, and an issue moves only to an open epic`);
  return epic;
}

/** The open epic `number` and its slug; a refusal when it is not one or carries no slug. */
function targetEpic(issues: readonly BoardIssue[], number: number): { epic: BoardIssue; slug: string } {
  const epic = openEpic(issues, number);
  const slug = ownSlug(epic);
  if (slug === undefined) {
    throw refusal(`Epic ${ref(number)} carries no ${EPIC_LABEL_PREFIX} label, so there is no label to move the issue to`);
  }
  return { epic, slug };
}

/** The one epic owning `slug`; a refusal for none or several. */
function owningEpic(issues: readonly BoardIssue[], slug: string, issue: number): BoardIssue {
  const owners = issues.filter((candidate) => candidate.type === 'epic' && ownSlug(candidate) === slug);
  const [owner] = owners;
  if (owner === undefined) {
    throw refusal(`No epic owns ${EPIC_LABEL_PREFIX}${slug}, the label ${ref(issue)} carries, so there is no epic to move it from`);
  }
  if (owners.length > 1) {
    throw refusal(`${EPIC_LABEL_PREFIX}${slug} is owned by epics ${owners.map((each) => ref(each.number)).join(', ')},`
      + ` so the epic ${ref(issue)} leaves cannot be read`);
  }
  return owner;
}

/** The line the target gains, read off the old epic's listed body; see the module note. */
function movedLineOf(from: BoardIssue, issue: BoardIssue): MovedLine {
  const old = parseRoadmapBody(from.body).find((line) => line.issue === issue.number);
  const why = old === undefined || old.why === ''
    ? issue.title
    : old.why;
  return Object.freeze({ why, ticked: old?.ticked ?? issue.state === 'CLOSED' });
}

/** True when `pull` is `issue`'s: its body closes it or its head branch claims it. */
function pullIsFor(pull: RoadmapPullRequest, issue: number): boolean {
  return closedIssuesIn(pull.body).includes(issue) || branchClaims(pull.headRefName, issue);
}

/** The open work of `issue`, with a sentence per reading that failed. */
async function openWorkOf(input: EpicMoveInput): Promise<{ work: OpenWork; problems: readonly string[] }> {
  const scan = scanClaimBranches(input.git, input.remote);
  const problems = [...scan.problems];
  let pulls: readonly RoadmapPullRequest[] = [];
  try {
    pulls = await input.pullRequests();
  } catch (error) {
    problems.push(`the open pull requests could not be read, so none is named: ${messageOf(error)}`);
  }
  const branches = scan.refs.filter((scanned) => branchClaims(scanned, input.issue)).map(branchNameOf);
  const numbers = pulls.filter((pull) => pullIsFor(pull, input.issue)).map((pull) => pull.number);
  return {
    work: Object.freeze({
      branches: Object.freeze([...new Set(branches)]),
      pullRequests: Object.freeze([...new Set(numbers)].sort((left, right) => left - right)),
    }),
    problems: Object.freeze(problems),
  };
}

/** The move `input` asks for, read in `native` mode through `relations`; see the module note. */
async function readNativeMove(input: EpicMoveInput, relations: EpicRelations): Promise<NativeMoveReading> {
  const issue = memberRow(input.issues, input.issue);
  const from = nativeEpicLeft(relations.read(input.issues).epicOf(issue));
  if (typeof from === 'string') throw refusal(from);
  openEpic(input.issues, input.to);
  if (from === input.to) throw refusal(nativeAlreadyMessage(input.issue, from));
  const read = issue.state === 'OPEN'
    ? await openWorkOf(input)
    : null;

  return Object.freeze({
    change: Object.freeze({ kind: 'move', issue: input.issue, from, to: input.to }),
    relationships: 'native',
    work: read?.work ?? null,
    problems: read?.problems ?? Object.freeze([]),
  });
}

/**
 * The move `input` asks for, read in the mode `input.relations` answers,
 * `labels` when left out; see the module note.
 *
 * @throws CommandExit with {@link EPIC_MOVE_REFUSAL_EXIT} for each
 *   refusal the module note lists, before any git or pull request read.
 */
export async function readEpicMove(input: EpicMoveInput): Promise<EpicMoveReading> {
  if (input.relations?.mode === 'native') return readNativeMove(input, input.relations);
  const moving = movingIssue(input.issues, input.issue);
  const target = targetEpic(input.issues, input.to);
  if (target.slug === moving.slug) {
    throw refusal(`${ref(input.issue)} is in epic ${ref(input.to)} already: it carries ${EPIC_LABEL_PREFIX}${moving.slug}`);
  }
  const from = owningEpic(input.issues, moving.slug, input.issue);
  const read = moving.issue.state === 'OPEN'
    ? await openWorkOf(input)
    : null;

  return Object.freeze({
    change: Object.freeze({ kind: 'move', issue: input.issue, from: from.number, to: input.to }),
    removed: `${EPIC_LABEL_PREFIX}${moving.slug}`,
    added: `${EPIC_LABEL_PREFIX}${target.slug}`,
    line: movedLineOf(from, moving.issue),
    work: read?.work ?? null,
    problems: read?.problems ?? Object.freeze([]),
  });
}

/** Where {@link applyEpicMove} writes. */
export interface EpicMoveWrites {
  /** The comment. */
  readonly board: IssueBoard;
  /** The board's relationships, in the mode the move was read in, which make the move itself. */
  readonly relations: BoardRelations;
  /** The listing the move was read off, which the relationships read what they edit from. */
  readonly issues: readonly BoardIssue[];
}

/** A checklist edit's status, read back off the write record the port answered it as. */
function checklistStatus(write: RelationWrite): ChecklistEditResult['status'] {
  if (write.status === 'failed') return 'failed';
  return write.status === 'written'
    ? 'edited'
    : 'nothing-to-edit';
}

/**
 * The checklist edit of `epic` among `writes`, past the move itself, as
 * `editChecklist` answered it; a `failed` one saying so when the port
 * answered none, so the run names it to finish by hand rather than
 * claiming a line it cannot show was written.
 */
function checklistEditOf(writes: readonly RelationWrite[], epic: number): ChecklistEditResult {
  const write = writes.slice(1).find((each) => each.issue === epic);
  if (write === undefined) {
    return Object.freeze({ issue: epic, status: 'failed', attempts: 0, problem: `no checklist edit of epic ${ref(epic)} was answered` });
  }
  return Object.freeze({ issue: epic, status: checklistStatus(write), attempts: write.attempts ?? 0, problem: write.problem ?? '' });
}

/** The mode `reading` was read in. */
function readingMode(reading: EpicMoveReading): BoardRelations['mode'] {
  return isNativeReading(reading)
    ? 'native'
    : 'labels';
}

/**
 * Makes `reading`'s move through `writes.relations`' `setParent`, then
 * posts the comment with `reason`; see the module note. Rejects with the
 * port's message when the move fails, and then nothing else is sent; past
 * it it never throws, answering what each write did. Throws a
 * `TypeError`, having sent nothing, when `writes.relations` answers
 * another mode than the one `reading` was read in.
 */
export async function applyEpicMove(writes: EpicMoveWrites, reading: EpicMoveReading, reason: string): Promise<EpicMoveOutcome> {
  const { change } = reading;
  const mode = readingMode(reading);
  if (writes.relations.mode !== mode) {
    throw new TypeError(`epic move: the move was read in ${mode} mode, but the relationships to write it answer ${writes.relations.mode}`);
  }
  const moved = await writes.relations.setParent(writes.issues, { issue: change.issue, parent: change.to });

  let commentProblem = '';
  try {
    await writes.board.comment(change.issue, renderMoveComment(change, reason, reading.work ?? undefined));
  } catch (error) {
    commentProblem = messageOf(error);
  }
  if (mode === 'native') return Object.freeze({ commentProblem });
  return Object.freeze({ added: checklistEditOf(moved, change.to), removed: checklistEditOf(moved, change.from), commentProblem });
}

/** Reads what `read` answers; a refusal with {@link EPIC_MOVE_REFUSAL_EXIT} when it fails. */
async function readOrRefuse<T>(what: string, read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    throw new CommandExit(EPIC_MOVE_REFUSAL_EXIT, `❌ Could not read ${what}, so nothing was changed: ${messageOf(error)}`);
  }
}

/** The result of `reading` with the fields a run fills in; see the module note for what native mode leaves out. */
function resultOf(reading: EpicMoveReading, fields: Pick<EpicMoveResult, 'status' | 'reason' | 'question' | 'outcome'>): EpicMoveResult {
  if (isNativeReading(reading)) {
    return Object.freeze({
      issue: reading.change.issue,
      from: reading.change.from,
      to: reading.change.to,
      relationships: reading.relationships,
      work: reading.work,
      problems: reading.problems,
      ...fields,
    });
  }
  return Object.freeze({
    issue: reading.change.issue,
    from: reading.change.from,
    to: reading.change.to,
    removedLabel: reading.removed,
    addedLabel: reading.added,
    work: reading.work,
    problems: reading.problems,
    ...fields,
  });
}

/** The reason, asked where there is a terminal; the prompter is closed before it answers. */
async function askReason(reading: EpicMoveReading, flag: string | null, seams: EpicMoveSeams): ReturnType<typeof readReason> {
  const isTerminal = seams.isTerminal ?? ((): boolean => process.stdin.isTTY === true);
  if (flag !== null || !isTerminal()) return readReason(reading.change, flag, null);
  const prompter = (seams.openPrompter ?? ((): Prompter => createLinePrompter(process.stdin, process.stderr)))();
  try {
    return await readReason(reading.change, flag, async (question) => prompter.ask(question));
  } finally {
    prompter.close();
  }
}

/** Reads the line and the board, asks, and writes; see the module note. */
export async function moveEpicIssue(context: RafaContext, seams: EpicMoveSeams): Promise<EpicMoveResult> {
  const line = readMoveLine(context);
  const project = issueProject(context);
  const gh = seams.gh ?? createGhRunner({ cwd: project.root });
  const relations = seams.relations
    ?? await configuredMoveRelations(project, gh, () => readOrRefuse('the board\'s repository', () => readBoardRepository(gh)));
  const listing = await readOrRefuse('the board', () => createGhBoardListing({ gh, mode: relations.mode })());
  const reading = await readEpicMove({
    issues: listing,
    issue: line.issue,
    to: line.to,
    git: seams.git ?? createGitRunner(project.root),
    pullRequests: createGhOpenPullRequests({ gh }),
    relations,
  });

  const reason = await askReason(reading, line.reason, seams);
  if (reason.status !== 'given') {
    const question = reason.status === 'unasked'
      ? reason.question
      : null;
    return resultOf(reading, { status: reason.status, reason: null, question, outcome: null });
  }
  let outcome: EpicMoveOutcome;
  try {
    outcome = await applyEpicMove({ board: createGhIssueBoard({ gh }), relations, issues: listing }, reading, reason.reason);
  } catch (error) {
    const hint = relations.mode === 'native'
      ? NATIVE_RETRY_HINT
      : 'Read its labels before running the same line again.';
    throw new CommandExit(1, `❌ Could not move ${ref(line.issue)} to epic ${ref(line.to)}: ${messageOf(error)}\n${hint}`);
  }
  return resultOf(reading, { status: 'moved', reason: reason.reason, question: null, outcome });
}

/** A line of text mode, and whether it is written at `warn`. */
export interface MoveLineOut {
  readonly text: string;
  readonly warn: boolean;
}

/** The line saying what became of the target's checklist. */
function addedLine(result: EpicMoveResult, edit: ChecklistEditResult): MoveLineOut {
  switch (edit.status) {
    case 'edited': {
      return { text: `Added its line to epic ${ref(result.to)}'s checklist.`, warn: false };
    }
    case 'nothing-to-edit': {
      return { text: `Epic ${ref(result.to)}'s checklist lists it already.`, warn: false };
    }
    case 'failed': {
      return { text: `Could not add its line to epic ${ref(result.to)}'s checklist: ${edit.problem}`, warn: true };
    }
  }
}

/** The line saying what became of the old epic's checklist. */
function removedLine(result: EpicMoveResult, edit: ChecklistEditResult): MoveLineOut {
  switch (edit.status) {
    case 'edited': {
      return { text: `Took its line off epic ${ref(result.from)}'s checklist.`, warn: false };
    }
    case 'nothing-to-edit': {
      return { text: `Epic ${ref(result.from)}'s checklist did not list it.`, warn: false };
    }
    case 'failed': {
      return { text: `Could not take its line off epic ${ref(result.from)}'s checklist: ${edit.problem}`, warn: true };
    }
  }
}

/** The lines text mode writes for a move that swapped the label. */
function movedLines(result: EpicMoveResult, outcome: EpicMoveOutcome): readonly MoveLineOut[] {
  const head = {
    text: `Moved ${ref(result.issue)} from epic ${ref(result.from)} to ${ref(result.to)}: ${String(result.reason)}`,
    warn: false,
  };
  const work = result.work === null || result.work.branches.length + result.work.pullRequests.length === 0
    ? []
    : [{ text: `Its open work stays as it is: ${workPhrase(result.work)}.`, warn: false }];
  const comment = outcome.commentProblem === ''
    ? []
    : [{ text: `Could not comment on ${ref(result.issue)}: ${outcome.commentProblem}`, warn: true }];
  const lines = outcome.added === undefined || outcome.removed === undefined
    ? [{ text: nativeParentLine(result.to), warn: false }]
    : [addedLine(result, outcome.added), removedLine(result, outcome.removed)];
  return [head, ...lines, ...work, ...comment];
}

/** The lines text mode writes for `result`, in order. */
export function renderEpicMove(result: EpicMoveResult): readonly MoveLineOut[] {
  const problems = result.problems.map((problem) => ({ text: `The open work named may be short: ${problem}`, warn: true }));
  if (result.outcome !== null) return Object.freeze([...movedLines(result, result.outcome), ...problems]);
  const head = result.status === 'unasked'
    ? { text: unaskedReasonMessage(result.question ?? ''), warn: false }
    : { text: blankReasonMessage(), warn: true };
  return Object.freeze([head, ...problems]);
}

/** The refusal a moved run ends with when a write past the swap failed; null when none did. */
export function moveFailure(result: EpicMoveResult): CommandExit | null {
  const { outcome } = result;
  if (outcome === null) return null;
  const left: string[] = [];
  if (outcome.added?.status === 'failed') left.push(`add its line to epic ${ref(result.to)}'s checklist`);
  if (outcome.removed?.status === 'failed') left.push(`take its line off epic ${ref(result.from)}'s checklist`);
  if (outcome.commentProblem !== '') left.push(`comment the move on ${ref(result.issue)}`);
  if (left.length === 0) return null;
  const now = result.addedLabel === undefined
    ? `its parent is ${ref(result.to)}; ${NATIVE_MODE}`
    : `its label is ${result.addedLabel}`;
  return new CommandExit(1, `❌ ${ref(result.issue)} moved to epic ${ref(result.to)} (${now}),`
    + ` but the rest did not land; by hand: ${left.join('; ')}.`);
}

/** Runs one `epic move` line with `seams`, writing it in the line's output mode. */
export async function runEpicMove(context: RafaContext, seams: EpicMoveSeams): Promise<void> {
  const result = await moveEpicIssue(context, seams);
  const failure = moveFailure(result);
  if (context.outputMode !== 'json') {
    for (const out of renderEpicMove(result)) {
      if (out.warn) context.output.warn(out.text);
      else context.output.info(out.text);
    }
  }
  await refreshProjectAfterEpic(context, seams, moveTarget(result));
  if (failure !== null) throw failure;
  if (context.outputMode === 'json') context.output.result(result);
}

/** The command, reaching `gh`, `git` and the terminal through `seams`; see the module note. */
export function createEpicMoveCommand(seams: EpicMoveSeams = {}): RafaCommand {
  const command: RafaCommand = {
    name: 'epic move',
    subject: 'epic',
    action: 'move',
    summary: 'move an issue to another epic, its label, its checklist line and a comment with the reason',
    description: 'Swaps the issue\'s epic: label for the target epic\'s in one edit, moves its checklist line from'
      + ' the old epic\'s body to the new one\'s keeping every other byte, and comments "Moved from epic #A to #B:'
      + ' <reason>" on the issue, naming its open branches and pull requests, which stay as they are. The issue is'
      + ' never recreated or closed. The reason is --reason, or asked once where there is a terminal; with neither,'
      + ' nothing changes and the question is printed. An issue with no epic: label, a target that is not an open'
      + ' epic and a move to its own epic are refused with exit code 2 before anything is written. With'
      + ' `--output=json` the move and what each write did are the data of the terminal result event. With'
      + ' board.relationships set to native it sets the issue\'s parent to the target epic in one edit instead,'
      + ' and no label or checklist line is read or written; the comment is the same.',
    args: [
      {
        name: 'issue',
        description: 'The number of the issue that moves.',
        type: 'string',
        required: true,
      },
    ],
    flags: [
      {
        name: TO_FLAG,
        description: 'The number of the open epic it moves to. Required.',
        type: 'string',
        required: true,
      },
      {
        name: REASON_FLAG,
        description: 'Why it moves, commented on the issue. Asked once when left out.',
        type: 'string',
      },
    ],
    examples: [
      {
        cmd: 'rafa epic move 12 --to=40 --reason="belongs with sign-in"',
        note: 'Swaps #12\'s epic: label for #40\'s, moves its line into #40\'s checklist and comments the move on #12.',
      },
    ],
    outputs: ['text', 'json'],
    run: (context) => runEpicMove(context, seams),
  };
  return Object.freeze(command);
}

export default createEpicMoveCommand();
