/**
 * `rafa issue unblock [<n>] [--all]`: the issues whose blockers have all
 * closed, asked about one at a time, and `spec:blocked` taken off each
 * one the answer says yes for.
 *
 * This is the command half. The library half, `src/board/unblock.ts`,
 * holds the run itself: `runUnblock`, the three `gh` commands it sends,
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
 * Without a terminal nothing is asked and nothing is written. The issue
 * is reported `unasked`, with the line naming the command to run where
 * an answer can be typed — `rafa init` reads a root the same way, and
 * refusing here would make the command fail inside a script over a
 * label that is no worse for staying on.
 *
 * The prompter is opened LAZILY, on the first question, and closed once
 * the run is over, so a run with nothing to ask opens none.
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
 * that is no whole number from 1, a value given to `--all`, and a
 * blocked listing that failed before any issue was read. A line is read
 * BEFORE the runner is opened, so a refused line sends no command.
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
import type { RafaCommand, RafaContext } from '../../cli/command.js';
import type { Prompter } from '../../cli/prompt/confirm.js';

import { createGhRunner } from '../../adapters/tracker/github.js';
import { SPEC_BLOCKED_LABEL } from '../../board/blocked.js';
import { createRefreshingGhIssueBoard, refreshFailedWarning, refreshIssueItems } from '../../board/project/issue-board-refresh.js';
import { isUnblockFailure, runUnblock } from '../../board/unblock.js';
import { CommandExit } from '../../cli/command.js';
import { createLinePrompter } from '../../cli/prompt/confirm.js';

import { issueProject, issueSubjectConfig, lineRefusal } from './issue-tracker.js';
import { nativeUnblockReport, NATIVE_UNBLOCK_LINE, refreshNativeUnblock, unblockRelationshipsMode } from './unblock-native.js';

/** The usage line a refusal names. */
export const UNBLOCK_USAGE = 'rafa issue unblock [<n>] [--all]';

/** The flag that reads every open issue labelled `spec:blocked`. */
const ALL_FLAG = 'all';

/** An issue number as a line types it: a whole number from 1. */
const ISSUE_NUMBER = /^[1-9]\d*$/u;

/** The answers that mean yes to the question, which is spelled `[y/N]`. */
const YES_ANSWERS: readonly string[] = ['y', 'yes'];

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

/**
 * Runs the unblock a line asks for, asking through the prompter when
 * there is a terminal. Its board refreshes each issue it unlabels on the
 * project (`../../board/project/issue-board-refresh.ts`), each line the
 * refresh answers written at `warn`.
 */
export async function unblockIssues(context: RafaContext, seams: UnblockSeams): Promise<UnblockReport> {
  const line = readUnblockLine(context);
  const root = projectRoot(context);
  const openGh = seams.openGh ?? ((dir: string): GhRunner => createGhRunner({ cwd: dir }));
  const isTerminal = seams.isTerminal ?? ((): boolean => process.stdin.isTTY === true);
  const openPrompter = seams.openPrompter ?? ((): Prompter => createLinePrompter(process.stdin, process.stderr));

  // Its warnings dropped, as `unblockRelationshipsMode` drops them when the run reads the mode.
  const config = issueSubjectConfig(issueProject(context), () => undefined);
  const gh = openGh(root);
  const prompter = lazyPrompter(openPrompter);
  try {
    return await runUnblock({
      gh,
      board: createRefreshingGhIssueBoard({ gh, config, warn: (message) => {
        context.output.warn(message);
      } }),
      issues: line.issues,
      ask: isTerminal()
        ? prompter.ask
        : null,
    });
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
function nativeRefreshOptions(context: RafaContext, seams: UnblockSeams): NativeUnblockRefreshOptions {
  const openGh = seams.openGh ?? ((dir: string): GhRunner => createGhRunner({ cwd: dir }));
  return {
    // Its warnings dropped, as `unblockRelationshipsMode` drops them.
    config: issueSubjectConfig(issueProject(context), () => undefined),
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
      + ' data of the terminal result event. With board.relationships set to native it reads nothing and'
      + ' writes nothing: GitHub clears a blocker by itself when the blocking issue closes.',
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
      const line = readUnblockLine(context);
      if (unblockRelationshipsMode(issueProject(context)) === 'native') {
        if (context.outputMode === 'json') context.output.result(nativeUnblockReport());
        else context.output.info(NATIVE_UNBLOCK_LINE);
        await refreshNativeUnblock(line.issues, nativeRefreshOptions(context, seams));
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

export default createIssueUnblockCommand();
