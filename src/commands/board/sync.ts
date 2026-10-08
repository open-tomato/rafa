/**
 * `rafa board sync [--dry-run]`: the repository's GitHub project brought
 * in step with its issues, every item refreshed and every open issue
 * missing from it added
 * (`.rafa/specs/rafa-791-github-project-each-repository.md`, "`rafa board
 * sync`"). It repairs what changed outside rafa: a label edited in the web
 * UI, an issue closed by hand, the Roadmap issue's order edited in its
 * body. The work is `syncProject` (`src/board/project/sync.ts`); this
 * module reads the line, the config and the answer.
 *
 * ## The lines
 *
 * One line per change, in the order the sync answers them:
 * `#<n> <field>: <from> → <to>`, an empty value spelled `(empty)`. Then
 * one line per open issue missing from the project: `#<n> added to the
 * project`, or `#<n> is not on the project: would be added` on a dry run.
 * Then one closing line counting both and the issues refused, saying the
 * project is in step when there was nothing to do and none was refused,
 * or, when the rate limit stopped the writes, how many of the changes were
 * written. Every warning line of the sync follows as a warning, a refused
 * issue's as `#<n> not refreshed: <reason>`. In json mode the terminal
 * result's `data` is a {@link BoardSyncResult}: the same changes, without
 * the write ids, and the issues refused.
 *
 * `--dry-run` reads everything a sync reads, and sends no write and no
 * add.
 *
 * Every call goes through the runner opened retrying
 * (`src/board/project/project-runner.ts`): a call that failed on a
 * network error is sent again, each retry printed before its wait as
 * `retrying #725 (1 of 3): operation timed out`, or written as one
 * `retry` event in json mode.
 *
 * ## Progress
 *
 * The sync's long phases print their progress as they run, ahead of the
 * lines above (`src/board/project/progress.ts`): reading the facts and
 * writing the fields of each refresh, and adding the missing issues. Each
 * prints a start line with its total, `reading facts: 283`, a line at
 * most every `board.project.progressSeconds` with the count and the time
 * so far, and an end line with the refused count; a pause for GitHub's
 * write limit prints `waiting 1 s for GitHub's write limit`. In json mode
 * each line is one `progress` event ahead of the terminal result. The
 * phases are timed by {@link BoardSyncSeams.now}.
 *
 * ## Exit codes
 *
 * 1 for a stray word, a config that cannot be used, and a project with no
 * `board.project.number`, which names `rafa init --board --project`.
 * {@link BOARD_SYNC_REFUSAL_EXIT} (2) when the sync could not finish: a
 * token without the `project` scope, a number naming no project, a write
 * the rate limit refused (the lines of what was written print first), and
 * any read or write `gh` failed outside one issue's facts. A field the
 * project does not hold as the template has it is a warning: the other
 * fields are synced and the exit code is 0. So is an issue whose facts
 * could not be read: its line prints, the other issues are synced and the
 * missing ones added, and the exit code is 0, since the next run reads it
 * again. A run whose only failures are refused issues therefore exits 0.
 *
 * It starts no session, so it declares no `spends`.
 */
import type { GhRunner } from '../../adapters/tracker/github.js';
import type { ProjectFieldKey, ProjectRef } from '../../board/project/port.js';
import type { ProjectChange } from '../../board/project/refresh-values.js';
import type { ProjectSynced } from '../../board/project/sync.js';
import type { RafaCommand, RafaContext } from '../../cli/command.js';

import { createGhRunner } from '../../adapters/tracker/github.js';
import { commandProgressFeed } from '../../board/project/progress.js';
import { commandRetrySeams, openProjectRunner } from '../../board/project/project-runner.js';
import { rateLimitWarning } from '../../board/project/refresh-warnings.js';
import { syncProject } from '../../board/project/sync.js';
import { CommandExit } from '../../cli/command.js';
import { messageOf } from '../../config-sections.js';
import { issueProject, issueSubjectConfig, lineRefusal } from '../issue/issue-tracker.js';

/** The usage line a refusal names. */
const USAGE = 'rafa board sync [--dry-run]';

/** The flag that reads without writing. */
const DRY_RUN_FLAG = 'dry-run';

/** The exit code of a sync that could not finish; see the module note. */
export const BOARD_SYNC_REFUSAL_EXIT = 2;

/** The command that sets `board.project.number`, named when it is unset. */
const PROJECT_INIT_FIX = 'rafa init --board --project';

/** How an empty field value is printed. */
const EMPTY_VALUE = '(empty)';

/** One change, as json mode gives it. */
export interface BoardSyncChange {
  readonly issue: number;
  readonly field: ProjectFieldKey;
  /** The field's name on the project. */
  readonly name: string;
  /** What the item held, or null for no value. */
  readonly from: string | null;
  /** What the sync writes, or null for a clear. */
  readonly to: string | null;
}

/** One issue whose facts could not be read, as json mode gives it. */
export interface BoardSyncRefusal {
  readonly issue: number;
  /** What failed, as its warning line names it. */
  readonly reason: string;
}

/** What json mode gives as the terminal result's `data`. */
export interface BoardSyncResult {
  readonly project: ProjectRef;
  readonly dryRun: boolean;
  readonly changes: readonly BoardSyncChange[];
  /** The open issues that had no item on the project. */
  readonly missing: readonly number[];
  /** Those of them added; none on a dry run. */
  readonly added: readonly number[];
  /** The issues whose facts could not be read, none written; each has its warning line. */
  readonly refused: readonly BoardSyncRefusal[];
  /** How many values were written; none on a dry run. */
  readonly written: number;
  /** True when the rate limit stopped the writes. */
  readonly rateLimited: boolean;
  /** How many issues the rate limit left not updated. */
  readonly notUpdated: number;
  readonly warnings: readonly string[];
}

/**
 * How the command reaches `gh`, and the pause between write requests and
 * the wait before a retried call; the system's own when left out.
 */
export interface BoardSyncSeams {
  readonly gh?: GhRunner;
  readonly sleep?: (ms: number) => Promise<void>;
  /** The clock the progress phases are timed by, in milliseconds; the system's own when left out. */
  readonly now?: () => number;
}

/** `count` and `noun`, the noun in the plural unless the count is one. */
function counted(count: number, noun: string): string {
  return count === 1
    ? `1 ${noun}`
    : `${String(count)} ${noun}s`;
}

/** The line text mode prints for `change`. */
export function changeLine(change: BoardSyncChange): string {
  return `#${String(change.issue)} ${change.name}: ${change.from ?? EMPTY_VALUE} → ${change.to ?? EMPTY_VALUE}`;
}

/** The closing line's count of the issues refused, or nothing when none was. */
function refusedPart(result: BoardSyncResult): string {
  return result.refused.length === 0
    ? ''
    : `; ${counted(result.refused.length, 'issue')} not refreshed`;
}

/** The line closing a run over `result`. */
export function closingLine(result: BoardSyncResult): string {
  const project = `project #${String(result.project.number)}`;
  const adds = result.dryRun
    ? result.missing
    : result.added;
  const changes = counted(result.changes.length, 'change');
  const issues = counted(adds.length, 'issue');
  const inStep = result.changes.length === 0 && adds.length === 0 && result.refused.length === 0;
  if (result.dryRun) {
    return inStep
      ? `Dry run on ${project}: in step, nothing to change.`
      : `Dry run on ${project}: ${changes} and ${issues} to add${refusedPart(result)}; nothing written.`;
  }
  if (result.rateLimited) return `Stopped on ${project}: ${String(result.written)} of ${changes} written; the rate limit refused the rest.`;
  return inStep
    ? `Synced ${project}: in step, nothing to change.`
    : `Synced ${project}: ${changes} written and ${issues} added${refusedPart(result)}.`;
}

/** Every line text mode prints for `result`, the warnings left out. */
export function syncLines(result: BoardSyncResult): readonly string[] {
  const adds = result.dryRun
    ? result.missing.map((issue) => `#${String(issue)} is not on the project: would be added`)
    : result.added.map((issue) => `#${String(issue)} added to the project`);
  return [...result.changes.map(changeLine), ...adds, closingLine(result)];
}

/** `change` without its write. */
function plainChange(change: ProjectChange): BoardSyncChange {
  return { issue: change.issue, field: change.field, name: change.name, from: change.from, to: change.to };
}

/** The result json mode gives for `synced`. */
export function syncResultOf(synced: ProjectSynced): BoardSyncResult {
  return {
    project: synced.project,
    dryRun: synced.dryRun,
    changes: synced.changes.map(plainChange),
    missing: synced.missing,
    added: synced.added,
    refused: synced.refused.map(({ number, reason }) => ({ issue: number, reason })),
    written: synced.writes.written,
    rateLimited: synced.writes.rateLimited,
    notUpdated: synced.writes.notUpdated,
    warnings: synced.warnings,
  };
}

/** Reads the line and the config and syncs; refuses as the module note says. */
export async function runBoardSync(context: RafaContext, seams: BoardSyncSeams): Promise<BoardSyncResult> {
  if (context.args.length > 0) {
    throw lineRefusal(`Expected no arguments, got ${String(context.args.length)}: ${context.args.join(' ')}`, USAGE);
  }
  const project = issueProject(context);
  const config = issueSubjectConfig(project, (message) => {
    context.output.warn(message);
  });
  if (config.boardProjectNumber === null) {
    throw new CommandExit(1, `❌ board.project.number is not set, so there is no project to sync. Run \`${PROJECT_INIT_FIX}\` to create one.`);
  }
  const gh = openProjectRunner(seams.gh ?? createGhRunner({ cwd: project.root }), config, commandRetrySeams(context.output, context.outputMode, seams.sleep));
  const dryRun = context.flags[DRY_RUN_FLAG] === true;
  const progress = commandProgressFeed(context.output, context.outputMode, config.boardProjectProgressSeconds, seams.now === undefined
    ? {}
    : { now: seams.now });
  const synced = await syncProject(seams.sleep === undefined
    ? { config, gh, dryRun, progress }
    : { config, gh, dryRun, progress, sleep: seams.sleep }).catch((error: unknown) => {
    throw new CommandExit(BOARD_SYNC_REFUSAL_EXIT, `❌ Could not sync the project: ${messageOf(error)}`);
  });
  if (synced.kind !== 'synced') {
    throw new CommandExit(BOARD_SYNC_REFUSAL_EXIT, `❌ ${synced.warnings.join('\n')}`);
  }
  return syncResultOf(synced);
}

/**
 * Writes `result` in the line's output mode; refuses with the rate-limit
 * line, after the other lines, when the rate limit stopped the writes.
 */
function writeResult(context: RafaContext, result: BoardSyncResult): void {
  const refusal = rateLimitWarning(result.notUpdated);
  if (context.outputMode !== 'json') {
    for (const line of syncLines(result)) context.output.info(line);
  }
  for (const line of result.warnings) {
    if (!result.rateLimited || line !== refusal) context.output.warn(line);
  }
  if (result.rateLimited) throw new CommandExit(BOARD_SYNC_REFUSAL_EXIT, `❌ ${refusal}`);
  if (context.outputMode === 'json') context.output.result(result);
}

/** The command, reaching `gh` with `seams`; see the module note. */
export function createBoardSyncCommand(seams: BoardSyncSeams = {}): RafaCommand {
  const command: RafaCommand = {
    name: 'sync',
    subject: 'board',
    action: 'sync',
    summary: 'bring the repository\'s GitHub project in step with its issues',
    description: 'Refreshes every item of this repository on the GitHub project board.project.number names, writing'
      + ' only the Stage, Horizon, Rank, Blocked by and Progress values that differ from what rafa reads of the'
      + ' issues, then adds every open issue missing from the project and fills its fields. It repairs what changed'
      + ' outside rafa: a label edited in the web UI, an issue closed by hand, the Roadmap issue\'s order edited in'
      + ' its body. Prints one line per change and per issue added, then a closing count. With `--dry-run` it'
      + ' prints the same lines and writes nothing. With `--output=json` the changes are the data of the terminal'
      + ' result event. An issue whose facts could not be read is named in a warning, `#<n> not refreshed:'
      + ' <reason>`, while the others are synced; the exit code stays 0 and the next run reads it again. Adding'
      + ' the issues, reading their facts and writing their fields each print a start line with the total, a'
      + ' progress line at most every board.project.progressSeconds, as `reading facts: 146/283, 6m 40s`, and an'
      + ' end line; with `--output=json` each is a `progress` event. Refused'
      + ' with exit code 1 when board.project.number is unset, and with exit code 2 when the token lacks the'
      + ' project scope, the number names no project, or the rate limit stopped the writes.',
    args: [],
    flags: [
      {
        name: DRY_RUN_FLAG,
        description: 'Print each change the sync would make and each issue it would add, and write nothing.',
        type: 'boolean',
      },
    ],
    examples: [
      {
        cmd: 'rafa board sync --dry-run',
        note: 'Shows what drifted on the project since rafa last wrote it, writing nothing.',
      },
      {
        cmd: 'rafa board sync',
        note: 'Writes those changes and adds the open issues the project lacks.',
      },
      {
        cmd: 'rafa board sync --output=json',
        note: 'Gives the changes, the issues added and the counts as the terminal result.',
      },
    ],
    outputs: ['text', 'json'],
    run: async (context) => {
      writeResult(context, await runBoardSync(context, seams));
    },
  };
  return Object.freeze(command);
}

export default createBoardSyncCommand();
