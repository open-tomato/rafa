/**
 * `rafa issue unblock [<n>] [--all] [--yes]`: the issues whose blockers
 * have all closed, asked about one at a time, and `spec:blocked` taken
 * off each one the answer says yes for, or that `--yes` answered.
 *
 * This is the command half. The library half, `src/board/unblock.ts`,
 * holds the run itself: `runUnblock`, the four `gh` commands it sends,
 * the question's spelling, the one write, the report and its statuses,
 * and what a half-read board costs. This file reads the line, opens the
 * runner and the prompter, hands them to `runUnblock`, and writes what
 * the report came to. `rafa pr merge` reaches the same run through the
 * library half, without this file.
 *
 * ## The question, and what a run without a terminal does
 *
 * One question per issue, spelled by the library half's
 * `unblockQuestion`:
 * `#12 was blocked by #24 #26, all closed. Remove spec:blocked? [y/N] `.
 * It goes to stderr through the same {@link Prompter} `rafa init` and
 * `pr merge` read an answer with, so a json-mode stdout stays NDJSON,
 * and it is asked only where standard input is a TTY. An answer that is
 * not `y` or `yes` declines, the empty answer and an input that ended
 * included: the question is spelled `[y/N]`.
 *
 * Without a terminal and without `--yes` nothing is asked and nothing
 * is written. The issue is reported `unasked`, with the line naming the
 * command to run where an answer can be typed — `rafa init` reads a
 * root the same way, and refusing here would make the command fail
 * inside a script over a label that is no worse for staying on.
 *
 * The prompter is opened LAZILY, on the first question, and closed once
 * the run is over, so a run with nothing to ask opens none.
 *
 * ## `--yes`, the answer typed on the line
 *
 * `--yes` answers the QUESTION, and nothing else: an issue every one of
 * whose blockers is closed has `spec:blocked` taken off with no
 * question put, terminal or not, and the prompter is never opened. Its
 * line names the issue and the blockers the run read closed:
 * `Removed spec:blocked from #12 under --yes; every blocker is closed: #24 #26`.
 * Every other reading is kept as it is without the flag: a blocker
 * still open is named and the label stays, and a `Blocked by:` line
 * that is missing, names itself or names an id the board has no issue
 * for is reported and nothing is written. `--yes` beside an issue
 * number and beside `--all` are both lines this reads. It is a boolean
 * switch, read as `--all` is, and a value given to it (`--yes=maybe`)
 * is a line refusal.
 *
 * ## What it reports, and its exit code
 *
 * A reading that came out badly for ONE issue is that issue's line
 * rather than the command's exit code: an issue that could not be read,
 * a `Blocked by:` line that is missing or unreadable, and a removal
 * `gh` refused are each reported and the run goes on to the next issue.
 * The exit code is 1 for a line this refuses and for a board listing
 * that failed before any issue was read, which is the case where there
 * is nothing to report at all.
 *
 * ## Refusals
 *
 * Exit code 1, as `./issue-tracker.ts` words them: a line naming
 * neither an issue nor `--all`, one naming both, a second word, a word
 * that is no whole number from 1, a value given to `--all` or `--yes`,
 * and a blocked listing that failed before any issue was read. A line
 * is read BEFORE the runner is opened, so a refused line sends no
 * command.
 *
 * ## Native mode
 *
 * Under `board.relationships: native` a blocker is GitHub's blocked-by
 * link, which the tracker clears when the blocking issue closes. The
 * command reads the line, so a refused line is refused in both modes,
 * then prints `./unblock-native.ts`'s one line, sends no board call,
 * refreshes the named issue on the project when `board.project.number`
 * is set, and exits 0. Everything above is the labels mode, the default.
 *
 * ## Nothing here spawns
 *
 * GitHub arrives through the {@link GhRunner} seam, the terminal and
 * the prompter through {@link UnblockSeams}, so every case in
 * `./unblock.test.ts` drives a recorded runner and a scripted prompter
 * and none of them reaches GitHub, spawns `gh` or waits on an answer.
 */
import type { NativeUnblockRefreshOptions } from './unblock-native.js';
import type { GhRunner } from '../../adapters/tracker/github.js';
import type { UnblockAsk, UnblockReport } from '../../board/unblock.js';
import type { RafaCommand, RafaContext , Prompter } from '@open-tomato/rafa/core/command';

import { CommandExit , createLinePrompter, lazyPrompter } from '@open-tomato/rafa/core/command';

import { createGhRunner } from '../../adapters/tracker/github.js';
import { SPEC_BLOCKED_LABEL } from '../../board/blocked.js';
import { createRefreshingGhIssueBoard, refreshFailedWarning, refreshIssueItems } from '../../board/project/issue-board-refresh.js';
import { isUnblockFailure, runUnblock } from '../../board/unblock.js';

import { ISSUE_UNBLOCK_DECLARATION, UNBLOCK_ALL_FLAG, UNBLOCK_YES_FLAG } from './declarations.js';
import { issueProject, issueSubjectConfig, lineRefusal } from './issue-tracker.js';
import { nativeUnblockReport, NATIVE_UNBLOCK_LINE, refreshNativeUnblock, unblockRelationshipsMode } from './unblock-native.js';

/** The usage line a refusal names. */
export const UNBLOCK_USAGE = 'rafa issue unblock [<n>] [--all] [--yes]';

/** An issue number as a line types it: a whole number from 1. */
const ISSUE_NUMBER = /^[1-9]\d*$/u;

/** What a line asked for: the issues named, or every blocked one. */
export interface UnblockLine {
  /** The issues to consider, or null for `--all`. */
  readonly issues: readonly number[] | null;
  /** True when `--yes` answered the question; see the module note. */
  readonly yes: boolean;
}

/**
 * Whether the line typed the switch `name`, or a refusal with exit code
 * 1 naming the usage for a value given to it.
 */
function readUnblockSwitch(flags: RafaContext['flags'], name: string): boolean {
  const value = flags[name];
  if (value === undefined) return false;
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 'false') return value === 'true';
  throw lineRefusal(`--${name} takes no value, and read "${value}" as one`, UNBLOCK_USAGE);
}

/** What the line asked for, or a refusal with exit code 1 naming the usage; see the module note. */
export function readUnblockLine(context: RafaContext): UnblockLine {
  const all = readUnblockSwitch(context.flags, UNBLOCK_ALL_FLAG);
  const yes = readUnblockSwitch(context.flags, UNBLOCK_YES_FLAG);
  const { args } = context;
  if (args.length > 1) {
    throw lineRefusal(`Expected at most one issue number, got ${String(args.length)}: ${args.join(' ')}`, UNBLOCK_USAGE);
  }

  const word = args[0];
  if (word === undefined) {
    if (all) return { issues: null, yes };
    throw lineRefusal(
      `Name an issue number, or pass --${UNBLOCK_ALL_FLAG} to read every open issue labelled ${SPEC_BLOCKED_LABEL}`,
      UNBLOCK_USAGE,
    );
  }
  if (all) {
    throw lineRefusal(`Name an issue number or pass --${UNBLOCK_ALL_FLAG}, not both`, UNBLOCK_USAGE);
  }
  if (!ISSUE_NUMBER.test(word)) {
    throw lineRefusal(`"${word}" is no issue number, which is a whole number from 1`, UNBLOCK_USAGE);
  }
  return { issues: [Number(word)], yes };
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

/** How a run's question is answered: by `--yes`, through the prompter on a terminal, or not at all. */
function askFor(line: UnblockLine, isTerminal: () => boolean, prompt: UnblockAsk): UnblockAsk | null {
  if (line.yes) return answeredByYesFlag;
  return isTerminal()
    ? prompt
    : null;
}

/** The question as `--yes` answers it: yes, with nothing put and no prompter opened. */
const answeredByYesFlag: UnblockAsk = () => Promise.resolve(true);

/** The line a removal `--yes` answered for is written as, naming the issue and its blockers. */
export function yesRemovalLine(issue: number, blockers: readonly number[]): string {
  const named = blockers.map((id) => `#${String(id)}`).join(' ');
  return `Removed ${SPEC_BLOCKED_LABEL} from #${String(issue)} under --${UNBLOCK_YES_FLAG}; every blocker is closed: ${named}`;
}

/** `report` with each removal's message spelled by {@link yesRemovalLine}; every other outcome as it was. */
function withYesRemovalLines(report: UnblockReport): UnblockReport {
  const issues = report.issues.map((outcome) => outcome.status === 'removed'
    ? Object.freeze({ ...outcome, message: yesRemovalLine(outcome.issue, outcome.blockers) })
    : outcome);
  return Object.freeze({ ...report, issues: Object.freeze(issues) });
}

/**
 * Runs the unblock a line asks for, asking through the prompter when
 * there is a terminal, or answering yes with no prompter under `--yes`,
 * whose removals are reported by {@link yesRemovalLine}. Its board
 * refreshes each issue it unlabels on the project
 * (`../../board/project/issue-board-refresh.ts`), each line the refresh
 * answers written at `warn`.
 */
export async function unblockIssues(context: RafaContext, seams: UnblockSeams): Promise<UnblockReport> {
  const line = readUnblockLine(context);
  const root = projectRoot(context);
  const openGh = seams.openGh ?? ((dir: string): GhRunner => createGhRunner({ cwd: dir }));
  const isTerminal = seams.isTerminal ?? ((): boolean => process.stdin.isTTY === true);
  const openPrompter = seams.openPrompter ?? ((): Prompter => createLinePrompter(process.stdin, process.stderr));

  // Its warnings dropped, as `unblockRelationshipsMode` drops them when the run reads the mode.
  const config = await issueSubjectConfig(issueProject(context), () => undefined);
  const gh = openGh(root);
  const prompter = lazyPrompter(openPrompter);
  try {
    const report = await runUnblock({
      gh,
      board: createRefreshingGhIssueBoard({ gh, config, warn: (message) => {
        context.output.warn(message);
      } }),
      issues: line.issues,
      ask: askFor(line, isTerminal, prompter.ask),
    });
    return line.yes
      ? withYesRemovalLines(report)
      : report;
  } finally {
    prompter.close();
  }
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

/** The native-mode refresh's config, runner and warn, from `context` and `seams`. */
async function nativeRefreshOptions(context: RafaContext, seams: UnblockSeams): Promise<NativeUnblockRefreshOptions> {
  const openGh = seams.openGh ?? ((dir: string): GhRunner => createGhRunner({ cwd: dir }));
  return {
    // Its warnings dropped, as `unblockRelationshipsMode` drops them.
    config: await issueSubjectConfig(issueProject(context), () => undefined),
    openGh: () => openGh(projectRoot(context)),
    warn: (message) => {
      context.output.warn(message);
    },
    refresh: refreshIssueItems,
    failedLine: refreshFailedWarning,
  };
}

/** The command, reading the board with `seams`; see the module note. */
export function createIssueUnblockCommand(seams: UnblockSeams = DEFAULT_UNBLOCK_SEAMS): RafaCommand {
  const command: RafaCommand = {
    ...ISSUE_UNBLOCK_DECLARATION,
    run: async (context) => {
      const line = readUnblockLine(context);
      if (await unblockRelationshipsMode(issueProject(context)) === 'native') {
        if (context.outputMode === 'json') context.output.result(nativeUnblockReport());
        else context.output.info(NATIVE_UNBLOCK_LINE);
        await refreshNativeUnblock(line.issues, await nativeRefreshOptions(context, seams));
        return;
      }
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

const command: RafaCommand = createIssueUnblockCommand();
export default command;
