/**
 * The blocked-issue reading `rafa doctor` ends with: every open issue
 * labelled `spec:blocked` whose `Blocked by:` line is MISSING or
 * UNREADABLE, named with what an author must do about it.
 *
 * `src/board/blocked.ts` is the reading of one body — the label, the
 * ids a line names, and the four faults it refuses to guess at — and
 * this module is the half that asks the board for the bodies and turns
 * the faults into lines. It sits beside `./init-board.ts`, the other
 * module holding a board-shaped piece of a command's output, for the
 * reason the spec gives the reading at all: an issue labelled
 * `spec:blocked` with no `Blocked by:` line, or one naming itself or an
 * id the board has no issue for, is REPORTED and never guessed at
 * (`.rafa/specs/rafa-63-one-command-next-step.md`). It is a module of
 * its own rather than four more functions in `src/commands/doctor.ts`,
 * which is 700-odd lines against a 800-line cap (`context/source.md`).
 *
 * ## The two commands, and why the second is often not sent
 *
 * | Reading | Command |
 * |---|---|
 * | The blocked issues | `gh issue list --state open --label spec:blocked --limit 100 --json number,body` |
 * | The board's issue numbers | `gh issue list --state all --limit 500 --json number` |
 *
 * Only OPEN issues are listed: a closed issue's label costs nobody
 * anything, and an operator reading `rafa doctor` is being told what to
 * fix now.
 *
 * The second command answers the `known` set `readBlockedBy` checks an
 * id against, and is sent only when a line actually named ids, because
 * that is the only reading a `known` set can change: a body with no
 * line, a line with no id and a line naming itself are already faults
 * without it. So the usual board — no blocked issue, or blocked issues
 * whose lines all read — costs ONE `gh` command, and a repository with
 * no blocked issue at all costs one command whose answer is `[]`.
 *
 * It is `--state all` because a blocker is cleared by being CLOSED, so
 * a closed issue is still an issue the board has: reading only the open
 * ones would report every cleared blocker as unknown, which is the
 * exact false report this exists to avoid.
 *
 * ## An id is reported unknown only when the whole board was read
 *
 * The listing asks for {@link KNOWN_LIST_LIMIT} numbers, and a board
 * holding more than that answers a prefix of itself. An id past the end
 * of that prefix is not an unknown issue — it is an issue this run did
 * not read — so when the listing comes back full, or fails, NO id is
 * checked and {@link BlockedIssuesReport.unchecked} carries the
 * sentence saying so. The other three faults are still reported, since
 * none of them depends on the board.
 *
 * That is the same refusal `src/board/blocked.ts` makes by leaving
 * `known` out: a reader that called every id it had not seen unknown
 * would report every blocker on a board it only half read.
 *
 * ## Nothing here writes, and nothing spawns
 *
 * GitHub arrives through the {@link GhRunner} `rafa doctor` opens for
 * the board rows — the same runner, so a run sends its board commands
 * and these through one `gh` seam. No label is moved, no body is
 * edited, and no issue's state is asked for: clearing a blocker is
 * `rafa issue unblock`'s, and this command starts nothing and changes
 * nothing. {@link readBlockedIssues} never throws either: a `gh`
 * command that failed and an answer this does not read are the
 * report's `problem`, printed as a line like any other.
 *
 * Every case in `./doctor-blocked.test.ts` drives a recorded fake
 * runner, so none of them reaches GitHub or spawns `gh`.
 */
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';
import type { BlockedReading } from '../board/blocked.js';

import { blockedFaultMessage, readBlockedBy, SPEC_BLOCKED_LABEL } from '../board/blocked.js';
import { describeValue, isMapping, messageOf } from '../config-sections.js';

import { plural } from './plan/plan-files.js';

/** The heading the blocked lines sit under, as `GitHub board:` heads the rows. */
export const BLOCKED_HEADING = 'Blocked issues:';

/** How many open `spec:blocked` issues one reading lists. */
export const BLOCKED_LIST_LIMIT = 100;

/** How many issue numbers the board listing reads, open and closed alike. */
export const KNOWN_LIST_LIMIT = 500;

/** What every sentence this module makes opens with. */
const PREFIX = 'board blocked';

/** What one reading of the board's blocked issues came to. */
export interface BlockedIssuesReport {
  /** Every open issue labelled `spec:blocked`, read, in the order the board listed them. */
  readonly readings: readonly BlockedReading[];
  /** One sentence per issue whose line is missing or unreadable, in that order. */
  readonly faults: readonly string[];
  /** Why no issue could be read at all; null when the listing answered. */
  readonly problem: string | null;
  /** Why no named id was checked against the board; null when every one was. */
  readonly unchecked: string | null;
}

/** What {@link readBlockedIssues} reads through. */
export interface BlockedIssuesOptions {
  /** Runs every `gh` command, in the repository the board belongs to. */
  readonly gh: GhRunner;
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

/** One open issue labelled `spec:blocked`, as the listing answered it. */
interface ListedIssue {
  readonly number: number;
  readonly body: string;
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

/** The arguments and the command line of the board's issue-number listing. */
const KNOWN_ARGS: readonly string[] = Object.freeze([
  'issue', 'list',
  '--state', 'all',
  '--limit', String(KNOWN_LIST_LIMIT),
  '--json', 'number',
]);

/** The board listing, as a message names it. */
const KNOWN_COMMAND = `gh ${KNOWN_ARGS.join(' ')}`;

/** Every open issue labelled `spec:blocked`, with its body. */
async function listBlockedIssues(gh: GhRunner): Promise<readonly ListedIssue[]> {
  const rows = await rowsOf(gh, BLOCKED_ARGS, BLOCKED_COMMAND);
  return Object.freeze(rows.map((row, index) => {
    const where = `issue ${String(index)}`;
    return { number: rowNumber(row, BLOCKED_COMMAND, where), body: rowBody(row, BLOCKED_COMMAND, where) };
  }));
}

/** Every issue number the board holds, open and closed, up to {@link KNOWN_LIST_LIMIT}. */
async function listKnownIssues(gh: GhRunner): Promise<readonly number[]> {
  const rows = await rowsOf(gh, KNOWN_ARGS, KNOWN_COMMAND);
  return Object.freeze(rows.map((row, index) => rowNumber(row, KNOWN_COMMAND, `issue ${String(index)}`)));
}

/** The sentence a fault carries, for every reading that is one. */
function faultsOf(readings: readonly BlockedReading[]): readonly string[] {
  return Object.freeze(readings.filter((read) => read.kind !== 'blocked').map((read) => blockedFaultMessage(read)));
}

/** One report, spelled. */
function reportOf(readings: readonly BlockedReading[], unchecked: string | null): BlockedIssuesReport {
  return Object.freeze({
    readings: Object.freeze([...readings]),
    faults: faultsOf(readings),
    problem: null,
    unchecked,
  });
}

/**
 * Every open issue labelled `spec:blocked`, read: which of them names
 * blockers, and which carries a `Blocked by:` line that is missing or
 * unreadable.
 *
 * Writes nothing and never throws: a `gh` command that failed and an
 * answer this does not read come back as {@link
 * BlockedIssuesReport.problem} with no reading, and a board listing
 * that failed or came back full as {@link
 * BlockedIssuesReport.unchecked} with the readings the bodies alone
 * decide. See the module note for what each costs in commands.
 */
export async function readBlockedIssues(options: BlockedIssuesOptions): Promise<BlockedIssuesReport> {
  const { gh } = options;

  let listed: readonly ListedIssue[];
  try {
    listed = await listBlockedIssues(gh);
  } catch (error) {
    return Object.freeze({ readings: [], faults: [], problem: messageOf(error), unchecked: null });
  }

  const bodies = listed.map((issue) => readBlockedBy(issue.number, issue.body));
  if (!bodies.some((read) => read.kind === 'blocked')) return reportOf(bodies, null);

  let known: readonly number[];
  try {
    known = await listKnownIssues(gh);
  } catch (error) {
    return reportOf(bodies, `${messageOf(error)}, so no blocker id was checked against the board`);
  }
  if (known.length >= KNOWN_LIST_LIMIT) {
    return reportOf(
      bodies,
      `the board answered the ${plural(KNOWN_LIST_LIMIT, 'issue')} the listing asked for and may hold more,`
        + ' so no blocker id was checked against it',
    );
  }

  const board = new Set(known);
  return reportOf(listed.map((issue) => readBlockedBy(issue.number, issue.body, board)), null);
}

/** The line a report with no fault ends on: what was read, and that it reads. */
function cleanLine(readings: readonly BlockedReading[]): string {
  const named = new Set(readings.flatMap((read) => read.blockers)).size;
  return `  ${plural(readings.length, 'issue')} labelled ${SPEC_BLOCKED_LABEL},`
    + ` naming ${plural(named, 'blocker')} this run could read`;
}

/**
 * The lines text mode writes for the blocked issues: the heading, one
 * sentence per fault, and the line saying no id was checked when none
 * was. A report with no blocked issue and no problem prints nothing at
 * all, since a board with none has nothing to say about them.
 */
export function renderBlockedIssues(report: BlockedIssuesReport | null): readonly string[] {
  if (report === null) return [];
  if (report.problem !== null) {
    return [BLOCKED_HEADING, `  the issues labelled ${SPEC_BLOCKED_LABEL} could not be read: ${report.problem}`];
  }
  if (report.readings.length === 0) return [];

  const body = report.faults.length === 0
    ? [cleanLine(report.readings)]
    : report.faults.map((fault) => `  ${fault}`);
  const unchecked = report.unchecked === null
    ? []
    : [`  ${report.unchecked}`];
  return [BLOCKED_HEADING, ...body, ...unchecked];
}
