/**
 * `rafa pr wait [<n>] [--timeout=<minutes>]`: polls one pull request's
 * checks until they settle or the deadline passes, and answers what they
 * came to.
 *
 * ## It composes, and it writes nothing
 *
 * The poll is `src/pr/checks.ts`'s `waitForChecks` over
 * `PullRequests.checks`, the same pair the loop's own CI gate
 * (`src/start/pr-lifecycle.ts`) and `pr triage --resolve` poll with, and
 * the deadline and the interval are that gate's own constants, so one
 * wait and the other agree about what green means and about how often a
 * pull request is asked.
 *
 * What it does NOT do is the rest of that gate: no repair session, no
 * comment, no label, no merge. `verifyPullRequest` keeps those, and this
 * command is READ-ONLY — the only provider members it reaches are
 * `findOpen`, for the branch that names no number, and `checks`. A test
 * reads that off the double's own call log rather than trusting the
 * sentence (`wait.test.ts`).
 *
 * ## The reads, in the order `pr-context.ts` sets
 *
 * The line first — `--timeout` ahead of `<n>`, so a `--timeout` whose
 * value is no minute count is refused for the flag rather than for a
 * number that was never read — then the config, then the provider, then
 * the pull request through `pickPullRequest`. So a line with a stray
 * word spawns no `gh`, and a repository whose `pr.provider` is not `gh`
 * is refused with exit 2 and the constant sentence, as the other six
 * are.
 *
 * `--timeout` TAKES a value, so `parseArgs` hands it the word after it
 * whatever that word is, and `rafa pr wait --timeout 41` is a wait of
 * forty-one minutes on the branch's own pull request rather than a wait
 * on #41. Nothing can tell those two apart, which is why the usage line
 * puts the flag after the number and why the refusal for a value that
 * is no minute count names that order. `--max-attempts` reads the same
 * way.
 *
 * ## What it answers, and the exit code each answer carries
 *
 * {@link WAIT_EXIT_CODES} maps the verdict onto the code:
 *
 *   - `green`, exit 0: every check passed.
 *   - `red`, exit 1: one failed and none is still running.
 *   - `none`, exit 1: the pull request has no checks AT ALL, which is
 *     what a conflicting pull request produces — GitHub builds no merge
 *     ref for it and so schedules no run. `waitForChecks` answers it at
 *     once rather than waiting out the deadline, because no amount of
 *     waiting turns it into a run, and the report says what to look at.
 *     It is not green, so it is not exit 0.
 *   - `timeout`, exit 3: the deadline passed with checks still running.
 *     Nothing failed, so it is not exit 1; 3 is the code this tree
 *     already gives a run that gave up rather than one that was refused
 *     (`pr triage --resolve`'s attempt guard).
 *   - `pending`, exit 3: unreachable from {@link waitForChecks}, which
 *     turns a pending poll at the deadline into `timeout` and otherwise
 *     polls again. It is in the map because the verdict type carries it,
 *     and it is mapped with `timeout` because that is what it means:
 *     checks that have not settled.
 *
 * The report goes where a reader of that ending looks for it. A green
 * run writes it through the output — stdout in text mode, the terminal
 * result's `data` in json mode. Every other ending carries it as the
 * message of its `CommandExit`, because the dispatcher DROPS a
 * command's payload when it ends non-zero (`src/cli/dispatch.ts`
 * answers `payload: null` there): a report written through `result`
 * would be thrown away, and the ending would read `exit code 1` with
 * nothing under it. So text mode writes it to stderr and json mode
 * carries it as the terminal error's message, and it is written once
 * either way.
 *
 * A pull request that is not there at all is `pickPullRequest`'s own
 * refusal, exit 1: a branch with no open pull request names the branch
 * and points at `pr list`. A `<n>` the repository has no pull request
 * under is the provider's refusal, also exit 1, carrying `gh`'s words —
 * this command spends no `gh pr view` to find that out ahead of the
 * checks read, since the checks read answers it.
 *
 * ## The clock and the wait are injected
 *
 * {@link PrWaitSeams} carries `clock` and `sleep` beside the provider
 * seams, and hands them to `waitForChecks`, so every case in
 * `wait.test.ts` — a pending poll that turns green, a deadline that
 * passes — runs with no timer and no real second spent. The seams are
 * spelled as `pr triage --resolve`'s are, for the same reason.
 *
 * The progress line one poll writes is `pr-lifecycle.ts`'s own spelling,
 * `[<seconds>s] <verdict> — <n> check(s)`, so a wait reads the same
 * whether the loop ran it or a person typed it.
 */
import type { PrSeams } from './pr-context.js';
import type { RafaCommand, RafaContext } from '../../cli/command.js';
import type { CheckRow, ChecksVerdict } from '../../pr/index.js';

import { CommandExit } from '../../cli/command.js';
import { failingRows, formatRows, waitForChecks } from '../../pr/index.js';
import { CI_POLL_INTERVAL_MS, DEFAULT_CI_TIMEOUT_MIN } from '../../start/pr-lifecycle.js';

import { SEPARATOR } from './current.js';
import {
  lineRefusal,
  onProvider,
  openPrContext,
  pickPullRequest,
  PR_USAGE,
  readPullArgument,
} from './pr-context.js';

/** The usage line this action's refusals name. */
const USAGE = PR_USAGE.wait;

/** The flag the deadline is typed with. */
const TIMEOUT_FLAG = 'timeout';

/** Minutes a line that types no `--timeout` waits: the loop's own CI deadline. */
export const DEFAULT_WAIT_TIMEOUT_MIN = DEFAULT_CI_TIMEOUT_MIN;

/** Milliseconds in a minute, as `--timeout` is turned into a deadline. */
const MS_PER_MIN = 60_000;

/** Milliseconds in a second, as the report names an elapsed time. */
const MS_PER_SECOND = 1000;

/** The exit code each verdict ends with; see the module note. */
export const WAIT_EXIT_CODES: Readonly<Record<ChecksVerdict | 'timeout', number>> = Object.freeze({
  green: 0,
  red: 1,
  none: 1,
  pending: 3,
  timeout: 3,
});

/** How this action reaches the provider, the branch, the clock and the wait. */
export interface PrWaitSeams extends PrSeams {
  /** The clock the poll measures with, in milliseconds. The system's when left out. */
  readonly clock?: () => number;
  /** The wait between polls. A real timer when left out. */
  readonly sleep?: (ms: number) => Promise<void>;
}

/** The seams the registered action runs with: the system's own, every one. */
export const DEFAULT_WAIT_SEAMS: PrWaitSeams = Object.freeze({});

/** What the poll came to, which the report is rendered from. */
export interface PrWaitReading {
  /** The pull request that was waited on. */
  readonly number: number;
  /** `timeout` means the deadline passed with checks still running. */
  readonly verdict: ChecksVerdict | 'timeout';
  /** The rows of the last poll. */
  readonly rows: readonly CheckRow[];
  /** How long the poll took, in milliseconds, by the injected clock. */
  readonly elapsedMs: number;
  /** How many times the provider was asked. */
  readonly polls: number;
  /** The deadline the line asked for, in milliseconds. */
  readonly timeoutMs: number;
}

/** What json mode gives as the terminal result's `data`. */
export interface PrWaitResult extends PrWaitReading {
  /** The exit code the verdict carries; see {@link WAIT_EXIT_CODES}. */
  readonly exitCode: number;
  /** The report text mode writes. */
  readonly text: string;
}

/**
 * The deadline `--timeout` sets, in minutes. A value that is not a whole
 * number from 1 is refused naming the order that works, as
 * `--max-attempts` is, because `parseArgs` hands a flag the word after
 * it whatever the flag declares.
 */
export function readTimeoutMinutes(flags: RafaContext['flags'], usage: string): number {
  const value = flags[TIMEOUT_FLAG];
  if (value === undefined) return DEFAULT_WAIT_TIMEOUT_MIN;
  const spelled = typeof value === 'boolean'
    ? `--${TIMEOUT_FLAG} with no value`
    : `"${value}"`;
  const minutes = typeof value === 'string'
    ? Number(value)
    : Number.NaN;
  if (!Number.isSafeInteger(minutes) || minutes < 1) {
    throw lineRefusal(
      `${spelled} is no timeout, which is a whole number of minutes from 1;`
        + ' type the pull request number before the flags',
      usage,
    );
  }
  return minutes;
}

/** `1 check` or `<n> checks`, and what a pull request with none reads as. */
function countWord(rows: readonly CheckRow[]): string {
  if (rows.length === 0) return 'nothing reported';
  return rows.length === 1
    ? '1 check'
    : `${rows.length} checks`;
}

/** `1 poll` or `<n> polls`, so a wait says how often it asked. */
function pollWord(polls: number): string {
  return polls === 1
    ? '1 poll'
    : `${polls} polls`;
}

/** The elapsed time in whole seconds, as the progress lines spell it. */
function secondsWord(elapsedMs: number): string {
  return `${Math.round(elapsedMs / MS_PER_SECOND)}s`;
}

/** What the headline calls the verdict: a timeout is checks that are still running. */
function verdictWord(verdict: ChecksVerdict | 'timeout'): string {
  return verdict === 'timeout' || verdict === 'pending'
    ? 'still running'
    : verdict;
}

/** The line under the rows, naming what to do next; green needs none. */
function followUp(reading: PrWaitReading): string | null {
  const minutes = Math.round(reading.timeoutMs / MS_PER_MIN);
  if (reading.verdict === 'green') return null;
  if (reading.verdict === 'red') {
    const failing = failingRows(reading.rows)
      .map((failed) => failed.name)
      .join(', ');
    return `Failing: ${failing}${SEPARATOR}run rafa pr triage ${reading.number} to assess it.`;
  }
  if (reading.verdict === 'none') {
    return 'A pull request that does not merge cleanly schedules no run at all;'
      + ` run rafa pr show ${reading.number} to see whether it merges.`;
  }
  return `Waited the ${minutes} min this run was given;`
    + ` run rafa pr wait ${reading.number} again to keep waiting.`;
}

/**
 * The whole report for a poll: the verdict with what it cost, every
 * check, and what to do next. Pure and total, so every shape is driven
 * by calling it.
 */
export function renderWait(reading: PrWaitReading): string {
  const head = [
    `checks ${verdictWord(reading.verdict)} on #${reading.number}`,
    countWord(reading.rows),
    `${pollWord(reading.polls)} in ${secondsWord(reading.elapsedMs)}`,
  ].join(SEPARATOR);
  const next = followUp(reading);
  return [
    head,
    formatRows(reading.rows),
    ...next === null
      ? []
      : [next],
  ].join('\n');
}

/**
 * Waits on the pull request the line names, or the one the branch does,
 * and answers what the poll came to. See the module note for the order
 * of the reads and for what each verdict exits with.
 */
export async function runWait(context: RafaContext, seams: PrWaitSeams): Promise<PrWaitResult> {
  const minutes = readTimeoutMinutes(context.flags, USAGE);
  const asked = readPullArgument(context.args, USAGE);
  const pr = openPrContext(context, seams);
  const pick = await pickPullRequest(pr, asked, USAGE);
  const timeoutMs = minutes * MS_PER_MIN;

  context.output.info(`Waiting for the checks of #${pick.number}, up to ${minutes} min.`);
  const waited = await waitForChecks({
    probe: async () => {
      const read = await onProvider(
        `read the checks of pull request #${pick.number}`,
        () => pr.pulls.checks(pick.number),
      );
      return read.rows;
    },
    timeoutMs,
    intervalMs: CI_POLL_INTERVAL_MS,
    ...seams.clock === undefined
      ? {}
      : { now: seams.clock },
    ...seams.sleep === undefined
      ? {}
      : { sleep: seams.sleep },
    onPoll: (rows, verdict, elapsedMs) => {
      context.output.info(`   [${secondsWord(elapsedMs)}] ${verdict} — ${rows.length} check(s)`);
    },
  });

  const reading: PrWaitReading = {
    number: pick.number,
    verdict: waited.verdict,
    rows: waited.rows,
    elapsedMs: waited.elapsedMs,
    polls: waited.polls,
    timeoutMs,
  };
  return { ...reading, exitCode: WAIT_EXIT_CODES[waited.verdict], text: renderWait(reading) };
}

/** The command, reaching the provider, the branch, the clock and the wait through `seams`. */
export function createPrWaitCommand(seams: PrWaitSeams = DEFAULT_WAIT_SEAMS): RafaCommand {
  const command: RafaCommand = {
    name: 'pr wait',
    subject: 'pr',
    action: 'wait',
    summary: 'wait for one pull request\'s checks to settle, and answer what they came to',
    description: 'Polls the checks of one pull request until they settle or the deadline passes, printing a line'
      + ' per poll, and then prints the verdict with every check under it. Without a number it waits on the open'
      + ' pull request whose head is the branch checked out at the project root. It writes nothing: no comment,'
      + ' no label, no merge and no repair session. Green exits 0; a red pull request and one with no checks at'
      + ' all — which is what a pull request that does not merge cleanly produces — exit 1; a deadline that'
      + ' passes with checks still running exits 3. The report is printed once: with `--output=json` a green'
      + ' wait gives the verdict, the checks, the polls and the rendered text as the data of the terminal'
      + ' result event, and every other ending carries the report as the message of that event instead.'
      + ' Refuses with exit code 2 where `pr.provider` is not `gh`.',
    args: [
      {
        name: 'n',
        description: 'The pull request number. The open pull request of the current branch when it is left out.',
        type: 'number',
      },
    ],
    flags: [
      {
        name: TIMEOUT_FLAG,
        description: `How many minutes to wait before giving up. ${DEFAULT_WAIT_TIMEOUT_MIN} when it is left out.`,
        type: 'string',
      },
    ],
    examples: [
      {
        cmd: 'rafa pr wait',
        note: 'Waits on the open pull request of the branch checked out at the project root.',
      },
      {
        cmd: 'rafa pr wait 41 --timeout=5',
        note: 'Waits up to five minutes on pull request 41, then exits 3 if its checks are still running.',
      },
      {
        cmd: 'rafa pr wait 41 --output=json',
        note: 'Writes a start event, a line per poll, then a result event holding the verdict and the checks'
          + ' when they are green, and the report as its error message when they are not.',
      },
    ],
    outputs: ['text', 'json'],
    run: async (context) => {
      const waited = await runWait(context, seams);
      // A non-zero ending carries the report itself; see the module note.
      if (waited.exitCode !== 0) throw new CommandExit(waited.exitCode, waited.text);
      if (context.outputMode === 'json') {
        context.output.result(waited);
        return;
      }
      context.output.info(waited.text);
    },
  };
  return Object.freeze(command);
}

export default createPrWaitCommand();
