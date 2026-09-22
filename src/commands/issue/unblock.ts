/**
 * `rafa issue unblock [<n>] [--all]`: the issues whose blockers have all
 * closed, asked about one at a time, and `spec:blocked` taken off each
 * one the answer says yes for.
 *
 * `src/board/blocked.ts` is the reading of one body — the label, the ids
 * a `Blocked by:` line names, and the four faults it refuses to guess at
 * — and this module is the half that ASKS the board: which issues carry
 * the label, whether each named blocker is open or closed, the one
 * question per issue, and the one write. A blocker is CLEARED when its
 * issue is closed, and an issue every one of whose blockers is closed is
 * the only one this ever offers to unlabel
 * (`.rafa/specs/rafa-63-one-command-next-step.md`).
 *
 * ## The three commands
 *
 * | Reading | Command |
 * |---|---|
 * | One issue a line named | `gh issue view <n> --json number,title,body,state,labels,author` |
 * | The blocked issues, under `--all` | `gh issue list --state open --label spec:blocked --limit 100 --json number,body` |
 * | Every issue's state | `gh issue list --state all --limit 500 --json number,state` |
 *
 * The first is `src/board/issue.ts`'s reader, whole, so the one `gh`
 * spelling of "read issue `<n>`" is not written twice; its `labels` is
 * what says whether the issue carries `spec:blocked` at all, which the
 * `--all` listing answers by asking for that label.
 *
 * The third is ONE listing rather than a `gh issue view` per blocker: it
 * answers both questions a blocker raises at once — whether the board
 * has an issue for the id, and whether that issue is closed — and an
 * issue blocked by three ids costs one command rather than three. It is
 * sent only when some line actually named ids, for the reason
 * `../doctor-blocked.ts` records: a body with no line, a line with no
 * id and a line naming itself are faults without it. {@link
 * BLOCKED_LIST_LIMIT} and {@link KNOWN_LIST_LIMIT} are that module's
 * constants, imported rather than respelled, so the two readings of the
 * board ask for the same number of issues.
 *
 * `--state all` because a blocker is cleared by being CLOSED, so a
 * closed issue is still an issue the board has.
 *
 * ## Nothing is removed on a half-read board
 *
 * The state listing asks for {@link KNOWN_LIST_LIMIT} issues, and a
 * board holding more answers a prefix of itself. When it comes back
 * full, no id is called unknown — {@link UnblockReport.unchecked}
 * carries the sentence saying so — and a blocker the prefix does not
 * name has no state this run read, which counts as NOT cleared. So a
 * board too big for one listing costs a label that stays on, never one
 * taken off over a blocker nobody looked at.
 *
 * A state listing that FAILED settles nothing either: every issue whose
 * line named ids is reported `failed` with what `gh` said, and no
 * question is asked about it.
 *
 * ## The question, and what a run without a terminal does
 *
 * One question per issue, spelled by {@link unblockQuestion}:
 * `#12 was blocked by #24 #26, all closed. Remove spec:blocked? [y/N] `.
 * It goes to stderr through the same {@link Prompter} `rafa init` and
 * `pr merge` read an answer with, so a json-mode stdout stays NDJSON,
 * and it is asked only where standard input is a TTY. An answer that is
 * not `y` or `yes` declines, the empty answer and an input that ended
 * included: the question is spelled `[y/N]`.
 *
 * Without a terminal nothing is asked and nothing is written. The issue
 * is reported `unasked`, with the line naming the command to run where
 * an answer can be typed — `rafa init` reads a root the same way, and
 * refusing here would make the command fail inside a script over a
 * label that is no worse for staying on.
 *
 * The prompter is opened LAZILY, on the first question, and closed once
 * the run is over, so a run with nothing to ask opens none.
 *
 * ## What it changes, and what it only reports
 *
 * The one write is `removeLabel` ({@link IssueBoard}), `spec:blocked`
 * off one issue and nothing put on. No body is edited, no issue is
 * closed or reopened, and no session is spawned anywhere on this path.
 *
 * Everything else is a reading, and a reading that came out badly for
 * ONE issue is that issue's line rather than the command's exit code:
 * an issue that could not be read, a `Blocked by:` line that is missing
 * or unreadable, and a removal `gh` refused are each reported and the
 * run goes on to the next issue. With `--all` over a board, one issue's
 * failure hiding the other issues' answers would be the worse report.
 * The exit code is 1 for a line this refuses and for a board listing
 * that failed before any issue was read, which is the case where there
 * is nothing to report at all.
 *
 * ## Refusals
 *
 * Exit code 1, as `./issue-tracker.ts` words them: a line naming
 * neither an issue nor `--all`, one naming both, a second word, a word
 * that is no whole number from 1, a value given to `--all`, and a
 * blocked listing that failed before any issue was read. A line is read
 * BEFORE the runner is opened, so a refused line sends no command.
 *
 * ## The seam the merge-time run takes
 *
 * {@link runUnblock} is the whole of this that touches the board, and
 * it takes the issues, the question and the board as arguments rather
 * than reading a command line. That is what lets `rafa pr merge` run
 * the same reading over the issues a merged pull request unblocks
 * without going through a second copy of the question or the write.
 *
 * {@link UnblockOptions.naming} is the half of that seam the line has
 * no spelling for. A merge knows which issues it CLOSED and not which
 * issues wait on them, so it asks for the listing `--all` asks for and
 * keeps the issues whose line names one of the closed ones. Doing it
 * here rather than in the caller costs one `gh issue list` for the
 * whole run: filtering outside would mean reading each candidate back
 * with a `gh issue view` of its own, which is what {@link
 * UnblockOptions.issues} does for a line that names numbers and nobody
 * has read a body for yet.
 *
 * ## Nothing here spawns
 *
 * GitHub arrives through the {@link GhRunner} seam, the terminal and
 * the prompter through {@link UnblockSeams}, so every case in
 * `./unblock.test.ts` drives a recorded runner and a scripted prompter
 * and none of them reaches GitHub, spawns `gh` or waits on an answer.
 */
import type { GhResult, GhRunner } from '../../adapters/tracker/github.js';
import type { BlockedReading } from '../../board/blocked.js';
import type { IssueBoard } from '../../board/issue-board.js';
import type { SpecIssueReader } from '../../board/issue.js';
import type { RafaCommand, RafaContext } from '../../cli/command.js';
import type { Prompter } from '../../project/root-choice.js';

import { createGhRunner } from '../../adapters/tracker/github.js';
import { blockedFaultMessage, hasSpecBlockedLabel, readBlockedBy, SPEC_BLOCKED_LABEL } from '../../board/blocked.js';
import { createGhIssueBoard } from '../../board/issue-board.js';
import { createGhSpecIssueReader } from '../../board/issue.js';
import { CommandExit } from '../../cli/command.js';
import { describeValue, isMapping, messageOf } from '../../config-sections.js';
import { createLinePrompter } from '../../project/root-choice.js';
import { BLOCKED_LIST_LIMIT, KNOWN_LIST_LIMIT } from '../doctor-blocked.js';
import { plural } from '../plan/plan-files.js';

import { lineRefusal } from './issue-tracker.js';

/** The usage line a refusal names. */
export const UNBLOCK_USAGE = 'rafa issue unblock [<n>] [--all]';

/** The flag that reads every open issue labelled `spec:blocked`. */
const ALL_FLAG = 'all';

/** An issue number as a line types it: a whole number from 1. */
const ISSUE_NUMBER = /^[1-9]\d*$/u;

/** The answers that mean yes to the question, which is spelled `[y/N]`. */
const YES_ANSWERS: readonly string[] = ['y', 'yes'];

/** What every sentence this module makes about the board opens with. */
const PREFIX = 'board unblock';

/** What one issue's run came to. */
export type UnblockStatus =
  /** Every blocker is closed, the question was answered yes, and the label came off. */
  | 'removed'
  /** Every blocker is closed and the question was answered no. */
  | 'declined'
  /** Every blocker is closed and there was no terminal to ask on, so the label stays. */
  | 'unasked'
  /** A blocker is still open, or its state was not read; nothing changed. */
  | 'waiting'
  /** The `Blocked by:` line is missing or unreadable, so it is reported and never guessed at. */
  | 'fault'
  /** The issue a line named carries no `spec:blocked` label, so there is nothing to unblock. */
  | 'not-blocked'
  /** The issue could not be read, its blockers could not be checked, or the removal failed. */
  | 'failed';

/** What one issue came to, and the line said about it. */
export interface UnblockOutcome {
  readonly issue: number;
  readonly status: UnblockStatus;
  /** Every id its `Blocked by:` line named, in line order; empty when it named none. */
  readonly blockers: readonly number[];
  /** The named ids the board still holds open, in line order. */
  readonly open: readonly number[];
  /** The named ids this run read no state for, in line order. */
  readonly unread: readonly number[];
  /** The sentence text mode writes for it. */
  readonly message: string;
}

/** What one run came to. */
export interface UnblockReport {
  /** One outcome per issue considered, in the order the board or the line named them. */
  readonly issues: readonly UnblockOutcome[];
  /** Why no issue could be read at all; null when the board answered. */
  readonly problem: string | null;
  /** Why no blocker id was checked against the board; null when every one was. */
  readonly unchecked: string | null;
}

/** Puts one question and answers whether it was said yes to. */
export type UnblockAsk = (question: string) => Promise<boolean>;

/** What {@link runUnblock} reads and writes through. */
export interface UnblockOptions {
  /** Runs every `gh` command, in the repository the board belongs to. */
  readonly gh: GhRunner;
  /** The issues to consider, or null for every open issue labelled `spec:blocked`. */
  readonly issues: readonly number[] | null;
  /**
   * With `issues` null, only the listed issues whose `Blocked by:` line
   * names one of these; every listed one when left out. Ignored where
   * `issues` names the issues itself. See the module note.
   */
  readonly naming?: readonly number[];
  /** Asks the one question per issue, or null when there is nobody to ask. */
  readonly ask: UnblockAsk | null;
  /** Takes the label off. Made over `gh` when left out. */
  readonly board?: IssueBoard;
  /** Reads one issue by number. Made over `gh` when left out. */
  readonly readIssue?: SpecIssueReader;
}

/** `#24 #26`, the way the question and a report name a list of ids. */
function nameIds(ids: readonly number[]): string {
  return ids.map((id) => `#${String(id)}`).join(' ');
}

/** The question one issue whose blockers have all closed is asked about. */
export function unblockQuestion(issue: number, blockers: readonly number[]): string {
  return `#${String(issue)} was blocked by ${nameIds(blockers)}, all closed.`
    + ` Remove ${SPEC_BLOCKED_LABEL}? [y/N] `;
}

/** What a failed command wrote, for a message. Never empty. */
function detailOf(result: GhResult, command: string): string {
  const written = result.stderr.trim() || result.stdout.trim();
  return written === ''
    ? `${command} failed and wrote nothing`
    : `${command} failed: ${written}`;
}

/** The rows `args` wrote. Throws, naming `command`, when it failed or answered something else. */
async function rowsOf(gh: GhRunner, args: readonly string[], command: string): Promise<readonly unknown[]> {
  const result = await gh(args);
  if (!result.ok) throw new Error(`${PREFIX}: ${detailOf(result, command)}`);

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout) as unknown;
  } catch (error) {
    throw new Error(`${PREFIX}: ${command} wrote output that is not JSON: ${messageOf(error)}`, { cause: error });
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`${PREFIX}: ${command} answered ${describeValue(parsed)}, expected a list of issues`);
  }
  return parsed as readonly unknown[];
}

/** One row's `number`, checked. */
function rowNumber(row: unknown, command: string, where: string): number {
  if (!isMapping(row)) {
    throw new Error(`${PREFIX}: ${command} answered ${where} as ${describeValue(row)}, expected a mapping`);
  }
  const number = row['number'];
  if (typeof number !== 'number' || !Number.isSafeInteger(number) || number < 1) {
    throw new Error(
      `${PREFIX}: ${command} answered ${where}.number as ${describeValue(number)}, expected a positive whole number`,
    );
  }
  return number;
}

/** One row's `body`, checked. An issue written with no body answers the empty string. */
function rowBody(row: unknown, command: string, where: string): string {
  const body = isMapping(row)
    ? row['body']
    : null;
  if (typeof body !== 'string') {
    throw new Error(`${PREFIX}: ${command} answered ${where}.body as ${describeValue(body)}, expected a string`);
  }
  return body;
}

/** The arguments and the command line of the blocked-issue listing. */
const BLOCKED_ARGS: readonly string[] = Object.freeze([
  'issue', 'list',
  '--state', 'open',
  '--label', SPEC_BLOCKED_LABEL,
  '--limit', String(BLOCKED_LIST_LIMIT),
  '--json', 'number,body',
]);

/** The blocked-issue listing, as a message names it. */
const BLOCKED_COMMAND = `gh ${BLOCKED_ARGS.join(' ')}`;

/** The arguments and the command line of the board's state listing. */
const STATE_ARGS: readonly string[] = Object.freeze([
  'issue', 'list',
  '--state', 'all',
  '--limit', String(KNOWN_LIST_LIMIT),
  '--json', 'number,state',
]);

/** The state listing, as a message names it. */
const STATE_COMMAND = `gh ${STATE_ARGS.join(' ')}`;

/** What the board holds an issue as; a state this reads as neither is no reading at all. */
type BoardState = 'open' | 'closed';

/** What the board answered about its issues. */
interface BoardStates {
  /** Every issue number the listing named, whatever it said of its state. */
  readonly numbers: ReadonlySet<number>;
  /** The issues whose state the listing answered as one the board holds. */
  readonly states: ReadonlyMap<number, BoardState>;
  /** True when the listing answered its own limit, so the board may hold more. */
  readonly full: boolean;
}

/** One row's `state`, folded, or null when it is neither state the board holds. */
function rowState(row: unknown): BoardState | null {
  const state = isMapping(row)
    ? row['state']
    : null;
  if (typeof state !== 'string') return null;
  const folded = state.trim().toUpperCase();
  if (folded === 'OPEN') return 'open';
  return folded === 'CLOSED'
    ? 'closed'
    : null;
}

/** Every issue the board holds with its state; throws, naming the command, when the listing failed. */
async function readBoardStates(gh: GhRunner): Promise<BoardStates> {
  const rows = await rowsOf(gh, STATE_ARGS, STATE_COMMAND);
  const numbers = new Set<number>();
  const states = new Map<number, BoardState>();
  for (const [index, row] of rows.entries()) {
    const number = rowNumber(row, STATE_COMMAND, `issue ${String(index)}`);
    numbers.add(number);
    const state = rowState(row);
    if (state !== null) states.set(number, state);
  }
  return { numbers, states, full: rows.length >= KNOWN_LIST_LIMIT };
}

/** One issue this run considered: its body to read, or the outcome that already settled it. */
interface Considered {
  readonly issue: number;
  /** The body its `Blocked by:` line is read out of, or null when `settled` holds the answer. */
  readonly body: string | null;
  /** What settled it before any line was read, or null when the body is still to be read. */
  readonly settled: UnblockOutcome | null;
}

/** One outcome, spelled. */
function outcome(
  issue: number,
  status: UnblockStatus,
  message: string,
  named: { blockers?: readonly number[]; open?: readonly number[]; unread?: readonly number[] } = {},
): UnblockOutcome {
  return Object.freeze({
    issue,
    status,
    blockers: Object.freeze([...named.blockers ?? []]),
    open: Object.freeze([...named.open ?? []]),
    unread: Object.freeze([...named.unread ?? []]),
    message,
  });
}

/**
 * Every open issue labelled `spec:blocked`, with its body, in the order
 * the board listed them, kept to those whose line names one of
 * `naming` when there is one. See the module note for why the filter
 * sits here.
 */
async function considerListed(gh: GhRunner, naming: readonly number[] | undefined): Promise<readonly Considered[]> {
  const rows = await rowsOf(gh, BLOCKED_ARGS, BLOCKED_COMMAND);
  const listed = rows.map((row, index) => {
    const where = `issue ${String(index)}`;
    return { issue: rowNumber(row, BLOCKED_COMMAND, where), body: rowBody(row, BLOCKED_COMMAND, where), settled: null };
  });
  if (naming === undefined) return listed;

  const wanted = new Set(naming);
  return listed.filter((row) => readBlockedBy(row.issue, row.body).blockers.some((id) => wanted.has(id)));
}

/** The issues a line named, read one at a time; a read that failed settles its own issue. */
async function considerNamed(read: SpecIssueReader, issues: readonly number[]): Promise<readonly Considered[]> {
  const rows: Considered[] = [];
  for (const issue of issues) {
    try {
      const found = await read(issue);
      rows.push(hasSpecBlockedLabel(found.labels)
        ? { issue, body: found.body, settled: null }
        : {
          issue,
          body: null,
          settled: outcome(issue, 'not-blocked', `#${String(issue)} is not labelled ${SPEC_BLOCKED_LABEL},`
            + ' so there is nothing to unblock'),
        });
    } catch (error) {
      const failed = outcome(issue, 'failed', `#${String(issue)} could not be read: ${messageOf(error)}`);
      rows.push({ issue, body: null, settled: failed });
    }
  }
  return rows;
}

/** The sentence an issue still waiting on a blocker is reported with. */
function waitingMessage(read: BlockedReading, open: readonly number[], unread: readonly number[]): string {
  const named = [
    ...open.map((id) => `#${String(id)} (open)`),
    ...unread.map((id) => `#${String(id)} (state not read)`),
  ].join(', ');
  return `#${String(read.issue)} is blocked by ${named}, so ${SPEC_BLOCKED_LABEL} stays`;
}

/** What an issue whose blockers have all closed comes to: the question, the write, or neither. */
async function settleCleared(
  read: BlockedReading,
  ask: UnblockAsk | null,
  board: IssueBoard,
): Promise<UnblockOutcome> {
  const named = { blockers: read.blockers };
  if (ask === null) {
    return outcome(read.issue, 'unasked', `#${String(read.issue)} was blocked by ${nameIds(read.blockers)},`
      + ` all closed; there is no terminal to ask on, so ${SPEC_BLOCKED_LABEL} stays.`
      + ` Run rafa issue unblock ${String(read.issue)} where an answer can be typed`, named);
  }
  if (!await ask(unblockQuestion(read.issue, read.blockers))) {
    return outcome(read.issue, 'declined', `#${String(read.issue)} keeps ${SPEC_BLOCKED_LABEL}`, named);
  }
  try {
    await board.removeLabel(read.issue, SPEC_BLOCKED_LABEL);
  } catch (error) {
    return outcome(read.issue, 'failed', `${SPEC_BLOCKED_LABEL} could not be removed from`
      + ` #${String(read.issue)}: ${messageOf(error)}`, named);
  }
  return outcome(read.issue, 'removed', `Removed ${SPEC_BLOCKED_LABEL} from #${String(read.issue)}`, named);
}

/** What the state listing came to, for the issues whose lines named ids. */
interface StateReading {
  /** The states read, empty when the listing was not sent or failed. */
  readonly board: BoardStates | null;
  /** What `gh` said when the listing failed, or null. */
  readonly problem: string | null;
}

/** The state listing, sent only when some line named ids; its failure is carried, never thrown. */
async function readStates(gh: GhRunner, wanted: boolean): Promise<StateReading> {
  if (!wanted) return { board: null, problem: null };
  try {
    return { board: await readBoardStates(gh), problem: null };
  } catch (error) {
    return { board: null, problem: messageOf(error) };
  }
}

/** One issue whose body is still to be read, settled against what the board answered. */
async function settleIssue(
  row: Considered,
  states: StateReading,
  known: ReadonlySet<number> | undefined,
  options: { readonly ask: UnblockAsk | null; readonly board: IssueBoard },
): Promise<UnblockOutcome> {
  const read = readBlockedBy(row.issue, row.body ?? '', known);
  if (read.kind !== 'blocked') {
    return outcome(read.issue, 'fault', blockedFaultMessage(read), { blockers: read.blockers });
  }
  if (states.problem !== null) {
    return outcome(read.issue, 'failed', `#${String(read.issue)} was not unblocked: ${states.problem},`
      + ' so the state of the issues it names was not read', { blockers: read.blockers });
  }

  const held = states.board?.states ?? new Map<number, BoardState>();
  const open = read.blockers.filter((id) => held.get(id) === 'open');
  const unread = read.blockers.filter((id) => held.get(id) === undefined);
  if (open.length + unread.length > 0) {
    return outcome(read.issue, 'waiting', waitingMessage(read, open, unread), { blockers: read.blockers, open, unread });
  }
  return settleCleared(read, options.ask, options.board);
}

/** What a board answering its own limit is reported as; no id is checked against it. */
function uncheckedSentence(): string {
  return `the board answered the ${plural(KNOWN_LIST_LIMIT, 'issue')} the listing asked for and may hold more,`
    + ' so no blocker id was checked against it';
}

/**
 * The issues `options` names, read off the board, asked about and
 * unlabelled where every blocker has closed. See the module note for
 * the commands it sends, what a half-read board costs, and why one
 * issue's failure is that issue's line rather than the run's.
 *
 * Throws nothing for the board: a listing that failed before any issue
 * was read is {@link UnblockReport.problem} with no outcome.
 */
export async function runUnblock(options: UnblockOptions): Promise<UnblockReport> {
  const { gh, issues, ask } = options;
  const board = options.board ?? createGhIssueBoard({ gh });
  const readIssue = options.readIssue ?? createGhSpecIssueReader({ gh });

  let considered: readonly Considered[];
  try {
    considered = issues === null
      ? await considerListed(gh, options.naming)
      : await considerNamed(readIssue, issues);
  } catch (error) {
    return Object.freeze({ issues: [], problem: messageOf(error), unchecked: null });
  }

  const pending = considered.filter((row) => row.body !== null);
  const named = pending.some((row) => readBlockedBy(row.issue, row.body ?? '').kind === 'blocked');
  const states = await readStates(gh, named);
  const full = states.board?.full === true;
  const known = states.board === null || full
    ? undefined
    : states.board.numbers;

  const settled: UnblockOutcome[] = [];
  for (const row of considered) {
    settled.push(row.settled ?? await settleIssue(row, states, known, { ask, board }));
  }
  return Object.freeze({
    issues: Object.freeze(settled),
    problem: null,
    unchecked: full
      ? uncheckedSentence()
      : null,
  });
}

/** What a line asked for: the issues named, or every blocked one. */
export interface UnblockLine {
  /** The issues to consider, or null for `--all`. */
  readonly issues: readonly number[] | null;
}

/** A boolean flag as the line spelled it; any value but a boolean one is refused. */
function readAllFlag(flags: RafaContext['flags']): boolean {
  const value = flags[ALL_FLAG];
  if (value === undefined) return false;
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 'false') return value === 'true';
  throw lineRefusal(`--${ALL_FLAG} takes no value, and read "${value}" as one`, UNBLOCK_USAGE);
}

/** What the line asked for, or a refusal with exit code 1 naming the usage; see the module note. */
export function readUnblockLine(context: RafaContext): UnblockLine {
  const all = readAllFlag(context.flags);
  const { args } = context;
  if (args.length > 1) {
    throw lineRefusal(`Expected at most one issue number, got ${String(args.length)}: ${args.join(' ')}`, UNBLOCK_USAGE);
  }

  const word = args[0];
  if (word === undefined) {
    if (all) return { issues: null };
    throw lineRefusal(
      `Name an issue number, or pass --${ALL_FLAG} to read every open issue labelled ${SPEC_BLOCKED_LABEL}`,
      UNBLOCK_USAGE,
    );
  }
  if (all) {
    throw lineRefusal(`Name an issue number or pass --${ALL_FLAG}, not both`, UNBLOCK_USAGE);
  }
  if (!ISSUE_NUMBER.test(word)) {
    throw lineRefusal(`"${word}" is no issue number, which is a whole number from 1`, UNBLOCK_USAGE);
  }
  return { issues: [Number(word)] };
}

/** How the board, the terminal and the question are reached; each left out is the system's own. */
export interface UnblockSeams {
  /** Opens the runner every `gh` command goes through. `gh` spawned in the project root when left out. */
  readonly openGh?: (root: string) => GhRunner;
  /** True when a question can be answered. `process.stdin.isTTY` when left out. */
  readonly isTerminal?: () => boolean;
  /** Opens the prompter the questions are asked through. Called only to ask. */
  readonly openPrompter?: () => Prompter;
}

/** The seams the registered command runs with: the system's own, every one. */
export const DEFAULT_UNBLOCK_SEAMS: UnblockSeams = Object.freeze({});

/** The project root the board belongs to. */
function projectRoot(context: RafaContext): string {
  if (context.project === null) throw new Error('rafa issue unblock runs inside a project, and was handed none');
  return context.project.root;
}

/** An answer to one question: yes for `y` or `yes`, however it is cased and padded. */
function isYes(answer: string | null): boolean {
  return answer !== null && YES_ANSWERS.includes(answer.trim().toLowerCase());
}

/** The prompter every question of one run goes through, opened on the first and closed by `close`. */
function lazyPrompter(open: () => Prompter): { ask: UnblockAsk; close: () => void } {
  let prompter: Prompter | null = null;
  return {
    ask: async (question: string): Promise<boolean> => {
      prompter ??= open();
      return isYes(await prompter.ask(question));
    },
    close: (): void => {
      prompter?.close();
      prompter = null;
    },
  };
}

/** Runs the unblock a line asks for, asking through the prompter when there is a terminal. */
export async function unblockIssues(context: RafaContext, seams: UnblockSeams): Promise<UnblockReport> {
  const line = readUnblockLine(context);
  const root = projectRoot(context);
  const openGh = seams.openGh ?? ((dir: string): GhRunner => createGhRunner({ cwd: dir }));
  const isTerminal = seams.isTerminal ?? ((): boolean => process.stdin.isTTY === true);
  const openPrompter = seams.openPrompter ?? ((): Prompter => createLinePrompter(process.stdin, process.stderr));

  const prompter = lazyPrompter(openPrompter);
  try {
    return await runUnblock({
      gh: openGh(root),
      issues: line.issues,
      ask: isTerminal()
        ? prompter.ask
        : null,
    });
  } finally {
    prompter.close();
  }
}

/** The statuses text mode writes at `warn`, being what an operator has something to fix about. */
const WARNED: ReadonlySet<UnblockStatus> = new Set<UnblockStatus>(['fault', 'failed']);

/**
 * True when one issue's outcome is something an operator has to fix:
 * a `Blocked by:` line this refuses to guess at, or a reading or a
 * write that failed. The merge-time run warns on exactly these, so a
 * line is never at `warn` here and at `info` there.
 */
export function isUnblockFailure(status: UnblockStatus): boolean {
  return WARNED.has(status);
}

/**
 * Writes what a report came to as lines a person reads. A report with
 * no outcome is a `--all` run over a board with no open blocked issue:
 * a line naming an issue answers for it however that issue read.
 */
function writeReport(context: RafaContext, report: UnblockReport): void {
  if (report.issues.length === 0) {
    context.output.info(`No open issue is labelled ${SPEC_BLOCKED_LABEL}.`);
    return;
  }
  for (const issue of report.issues) {
    if (isUnblockFailure(issue.status)) {
      context.output.warn(issue.message);
      continue;
    }
    context.output.info(issue.message);
  }
  if (report.unchecked !== null) context.output.warn(report.unchecked);
}

/** The command, reading the board with `seams`; see the module note. */
export function createIssueUnblockCommand(seams: UnblockSeams = DEFAULT_UNBLOCK_SEAMS): RafaCommand {
  const command: RafaCommand = {
    name: 'issue unblock',
    subject: 'issue',
    action: 'unblock',
    summary: `take ${SPEC_BLOCKED_LABEL} off an issue whose blockers have all closed`,
    description: `Reads the "Blocked by: #24 #26" line of an issue labelled ${SPEC_BLOCKED_LABEL} on the GitHub`
      + ' board, asks the board for each blocker\'s state, and when every blocker is closed asks whether to'
      + ` remove ${SPEC_BLOCKED_LABEL} and removes it on a yes. With a blocker still open it names it and`
      + ` changes nothing. An issue labelled ${SPEC_BLOCKED_LABEL} whose "Blocked by:" line is missing, names`
      + ' itself or names an id the board has no issue for is reported and never guessed at. Without a'
      + ' terminal it asks nothing and writes nothing. With `--output=json` the outcome of each issue is the'
      + ' data of the terminal result event.',
    args: [
      {
        name: 'n',
        description: 'The issue number on the GitHub board. Left out, `--all` reads every blocked issue.',
        type: 'string',
        required: false,
      },
    ],
    flags: [
      {
        name: ALL_FLAG,
        description: `Read every open issue labelled ${SPEC_BLOCKED_LABEL}, asking about each one in turn.`,
        type: 'boolean',
      },
    ],
    examples: [
      {
        cmd: 'rafa issue unblock 57',
        note: `Asks whether to remove ${SPEC_BLOCKED_LABEL} from #57 when every issue its "Blocked by:" line names is closed.`,
      },
      {
        cmd: 'rafa issue unblock --all',
        note: 'Walks every open blocked issue on the board, asking about each one whose blockers have all closed.',
      },
    ],
    outputs: ['text', 'json'],
    run: async (context) => {
      const report = await unblockIssues(context, seams);
      if (report.problem !== null) throw new CommandExit(1, `❌ ${report.problem}`);
      if (context.outputMode === 'json') {
        context.output.result(report);
        return;
      }
      writeReport(context, report);
    },
  };
  return Object.freeze(command);
}

export default createIssueUnblockCommand();
