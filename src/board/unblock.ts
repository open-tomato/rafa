/**
 * The unblock run: the issues whose blockers have all closed, asked
 * about one at a time, and `spec:blocked` taken off each one the answer
 * says yes for.
 *
 * `./blocked.ts` is the reading of one body — the label, the ids a
 * `Blocked by:` line names, and the four faults it refuses to guess at
 * — and this module is the half that ASKS the board: which issues carry
 * the label, whether each named blocker is open or closed, the one
 * question per issue, and the one write. A blocker is CLEARED when its
 * issue is closed, and an issue every one of whose blockers is closed is
 * the only one this ever offers to unlabel
 * (`.rafa/specs/rafa-63-one-command-next-step.md`).
 *
 * This is the library half of `src/commands/issue/unblock.ts`. The
 * command half holds `rafa issue unblock` itself: the line it reads and
 * refuses, the terminal and the prompter it asks through, the lines it
 * writes, and its native-mode answer. It hands {@link runUnblock} the
 * issues, the question and the board. Nothing here reads a command
 * line, and nothing here imports a file under `src/commands/`.
 *
 * ## The four commands
 *
 * | Reading | Command |
 * |---|---|
 * | One issue the caller named | `gh issue view <n> --json number,title,body,state,labels,author` |
 * | The blocked issues, with no issue named | `gh issue list --state open --label spec:blocked --limit 100 --json number,body` |
 * | Every issue's state | `gh issue list --state all --limit 500 --json number,state` |
 * | One blocker the full state listing did not hold | `gh issue view <n> --json number,state` |
 *
 * The first is `./issue.ts`'s reader, whole, so the one `gh` spelling
 * of "read issue `<n>`" is not written twice; its `labels` is what says
 * whether the issue carries `spec:blocked` at all, which the listing
 * answers by asking for that label.
 *
 * The last two are `./blocker-states.ts`'s {@link readBlockerStates},
 * handed every id the `Blocked by:` lines named, and they go in that
 * order. The state listing goes FIRST: it answers both questions a
 * blocker raises at once — whether the board has an issue for the id,
 * and whether that issue is closed — so an issue blocked by three ids
 * costs one command rather than three on a board the listing holds
 * whole. THEN one view per id the listing did not hold, sent only when
 * the listing came back full, and once per id however many issues name
 * it. The listing is sent only when some line actually named ids, for
 * the reason `./blocked-issues.ts` records: a body with no line, a line
 * with no id and a line naming itself are faults without it. {@link
 * BLOCKED_LIST_LIMIT} is that module's constant, imported rather than
 * respelled, and the state listing asks for its `KNOWN_LIST_LIMIT`, so
 * the two readings of the board ask for the same number of issues.
 *
 * `--state all` because a blocker is cleared by being CLOSED, so a
 * closed issue is still an issue the board has.
 *
 * What the board answered for each id comes to one of four words. An
 * id answered `open` or `closed` is what it says. An id answered
 * `dangling` — a listing short of its limit not naming it, or a view
 * `gh` failed as no issue or pull request with that number — is the
 * `readBlockedBy` fault for an id the board has no issue for, reported
 * and never guessed at. An id answered `unread` is named
 * `#<n> (state not read)`.
 *
 * ## Nothing is removed on a half-read board
 *
 * The state listing asks for `KNOWN_LIST_LIMIT` issues, and a board
 * holding more answers a prefix of itself. A blocker that prefix does
 * not name is read by a view of its own, and only a view `gh` answered
 * CLOSED clears it. A view that FAILED for any reason but the issue
 * not existing, or answered a state that is neither word, still never
 * removes a label: that blocker has no state this run read, which
 * counts as NOT cleared, the issue is reported `waiting` naming
 * `#<n> (state not read)`, and {@link UnblockReport.unchecked} carries
 * the sentence naming every id left so. So a board too big for one
 * listing costs a label that stays on, never one taken off over a
 * blocker nobody looked at.
 *
 * A state listing that FAILED settles nothing either: every issue whose
 * line named ids is reported `failed` with what `gh` said, no view is
 * sent, and no question is asked about it.
 *
 * ## The question, and a caller with nobody to ask
 *
 * One question per issue, spelled by {@link unblockQuestion}:
 * `#12 was blocked by #24 #26, all closed. Remove spec:blocked? [y/N] `.
 * The caller answers it through {@link UnblockOptions.ask}. With `ask`
 * null nothing is asked and nothing is written: the issue is reported
 * `unasked`, with the line naming the command to run where an answer
 * can be typed.
 *
 * ## What it changes, and what it only reports
 *
 * The one write is `removeLabel` ({@link IssueBoard}), `spec:blocked`
 * off one issue and nothing put on. No body is edited, no issue is
 * closed or reopened, and no session is spawned anywhere on this path.
 *
 * Everything else is a reading, and a reading that came out badly for
 * ONE issue is that issue's outcome rather than a throw: an issue that
 * could not be read, a `Blocked by:` line that is missing or
 * unreadable, and a removal `gh` refused are each reported and the run
 * goes on to the next issue. Over a whole board, one issue's failure
 * hiding the other issues' answers would be the worse report. A board
 * listing that failed before any issue was read is {@link
 * UnblockReport.problem}, the case where there is nothing to report at
 * all.
 *
 * ## The seam the merge-time run takes
 *
 * {@link runUnblock} is the whole of this that touches the board, and
 * it takes the issues, the question and the board as arguments rather
 * than reading a command line. That is what lets `rafa pr merge` run
 * the same reading over the issues a merged pull request unblocks
 * without going through a second copy of the question or the write.
 *
 * {@link UnblockOptions.naming} is the half of that seam a command line
 * has no spelling for. A merge knows which issues it CLOSED and not
 * which issues wait on them, so it asks for the listing of every
 * blocked issue and keeps the issues whose line names one of the closed
 * ones. Doing it here rather than in the caller costs one
 * `gh issue list` for the whole run: filtering outside would mean
 * reading each candidate back with a `gh issue view` of its own, which
 * is what {@link UnblockOptions.issues} does for a caller that names
 * numbers and nobody has read a body for yet.
 *
 * ## Nothing here spawns
 *
 * GitHub arrives through the {@link GhRunner} seam, so every case in
 * `src/commands/issue/unblock.test.ts` drives a recorded runner and
 * none of them reaches GitHub or spawns `gh`.
 */
import type { BlockedReading } from './blocked.js';
import type { BlockerAnswer, BlockerStatesReading } from './blocker-states.js';
import type { IssueBoard } from './issue-board.js';
import type { SpecIssueReader } from './issue.js';
import type { GhRunner } from '../adapters/tracker/github.js';

import { describeValue, isMapping, messageOf } from '@open-tomato/rafa/core/config/sections';

import { BLOCKED_LIST_LIMIT } from './blocked-issues.js';
import { blockedFaultMessage, hasSpecBlockedLabel, readBlockedBy, SPEC_BLOCKED_LABEL } from './blocked.js';
import { readBlockerStates, rowNumber, rowsOf } from './blocker-states.js';
import { createGhIssueBoard } from './issue-board.js';
import { createGhSpecIssueReader } from './issue.js';

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
  /** The sentence naming the blocker ids whose state this run could not read; null when none was left unread. */
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

/** One issue whose body is still to be read, settled against what the board answered. */
async function settleIssue(
  row: Considered,
  reading: BlockerStatesReading,
  options: { readonly ask: UnblockAsk | null; readonly board: IssueBoard },
): Promise<UnblockOutcome> {
  const answer = (id: number): BlockerAnswer | undefined => reading.states.get(id);
  const named = readBlockedBy(row.issue, row.body ?? '');
  const known = new Set(named.blockers.filter((id) => answer(id) !== 'dangling'));
  const read = readBlockedBy(row.issue, row.body ?? '', known);
  if (read.kind !== 'blocked') {
    return outcome(read.issue, 'fault', blockedFaultMessage(read), { blockers: read.blockers });
  }
  if (reading.problem !== null) {
    return outcome(read.issue, 'failed', `#${String(read.issue)} was not unblocked: ${reading.problem},`
      + ' so the state of the issues it names was not read', { blockers: read.blockers });
  }

  const open = read.blockers.filter((id) => answer(id) === 'open');
  const unread = read.blockers.filter((id) => answer(id) !== 'open' && answer(id) !== 'closed');
  if (open.length + unread.length > 0) {
    return outcome(read.issue, 'waiting', waitingMessage(read, open, unread), { blockers: read.blockers, open, unread });
  }
  return settleCleared(read, options.ask, options.board);
}

/** Every id the lines of `pending` name, where the line reads `blocked` with no board to check against. */
function namedIds(pending: readonly Considered[]): readonly number[] {
  return pending.flatMap((row) => {
    const read = readBlockedBy(row.issue, row.body ?? '');
    return read.kind === 'blocked'
      ? read.blockers
      : [];
  });
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
  const reading = await readBlockerStates({ gh, ids: namedIds(pending) });

  const settled: UnblockOutcome[] = [];
  for (const row of considered) {
    settled.push(row.settled ?? await settleIssue(row, reading, { ask, board }));
  }
  return Object.freeze({
    issues: Object.freeze(settled),
    problem: null,
    unchecked: reading.unchecked,
  });
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
