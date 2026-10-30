/**
 * `rafa board sync [--dry-run]`: the repository's GitHub project brought
 * in step with its issues, every item refreshed and every open issue
 * missing from it added
 * (`.rafa/specs/rafa-791-github-project-each-repository.md`, "`rafa board
 * sync`"). It repairs what changed outside rafa: a label edited in the web
 * UI, an issue closed by hand, the Roadmap issue's order edited in its
 * body. The work is `syncProject` (`packages/rafa-board/src/board/project/sync.ts`); this
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
 * the write ids, the issues added, those of them filled, and the issues
 * refused.
 *
 * ## Added, and filled
 *
 * An issue added is filled when the sync's second pass wrote its fields
 * (`packages/rafa-board/src/board/project/sync.ts`, "Added, and filled"). The closing line
 * counts the two apart. Where every issue added was filled it reads
 * `2 issues added and filled`, as does a sync that added none,
 * `0 issues added and filled`; where some were not,
 * `2 issues added, 1 filled`. Each issue added and not filled has its own
 * warning line, `#<n> added but not filled: <reason>`, and the next sync
 * fills it. A sync the rate limit stopped counts them too when it had
 * added any, between the changes written and the refusal:
 * `12 of 14 changes written, 2 issues added, 0 filled`. A dry run adds
 * nothing, so it counts only the issues to add.
 *
 * `--dry-run` reads everything a sync reads, and sends no write and no
 * add.
 *
 * Every call goes through the runner opened retrying
 * (`packages/rafa-board/src/board/project/project-runner.ts`): a call that failed on a
 * network error is sent again, each retry printed before its wait as
 * `retrying #725 (1 of 3): operation timed out`, or written as one
 * `retry` event in json mode.
 *
 * ## Progress
 *
 * The sync's long phases print their progress as they run, ahead of the
 * lines above (`packages/rafa-board/src/board/project/progress.ts`): reading the facts and
 * writing the fields of each refresh, and adding the missing issues. Each
 * prints a start line with its total, `reading facts: 283`, a line at
 * most every `board.project.progressSeconds` with the count and the time
 * so far, and an end line with the refused count. A pause between two
 * write requests prints nothing unless it is at least
 * `board.project.progressSeconds` long, and then
 * `pausing 15 s between writes (board.project.writePauseMs)`. In json
 * mode each line is one `progress` event ahead of the terminal result.
 * The phases are timed by {@link BoardSyncSeams.now}.
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
import type { RafaCommand, RafaContext } from '@open-tomato/rafa/core/command';

import { CommandExit } from '@open-tomato/rafa/core/command';
import { messageOf } from '@open-tomato/rafa/core/config/sections';

import { createGhRunner } from '../../adapters/tracker/github.js';
import { commandProgressFeed } from '../../board/project/progress.js';
import { commandRetrySeams, openProjectRunner } from '../../board/project/project-runner.js';
import { rateLimitWarning } from '../../board/project/refresh-warnings.js';
import { syncProject } from '../../board/project/sync.js';
import { issueProject, issueSubjectConfig, lineRefusal } from '../issue/issue-tracker.js';

import { BOARD_SYNC_DECLARATION, BOARD_SYNC_DRY_RUN_FLAG } from './declarations.js';

/** The usage line a refusal names. */
const USAGE = 'rafa board sync [--dry-run]';

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
  /** Those of the added ones whose fields were filled; each other one has its `added but not filled` warning line. */
  readonly filled: readonly number[];
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

/**
 * The closing line's count of the issues added and of those filled: one
 * count when every issue added was filled, two when some were not.
 */
function addedPart(result: BoardSyncResult): string {
  const issues = counted(result.added.length, 'issue');
  return result.filled.length === result.added.length
    ? `${issues} added and filled`
    : `${issues} added, ${String(result.filled.length)} filled`;
}

/** The closing line of a sync the rate limit stopped, counting the issues added when it had added any. */
function stoppedLine(result: BoardSyncResult, project: string, changes: string): string {
  const adds = result.added.length === 0
    ? ''
    : `, ${addedPart(result)}`;
  return `Stopped on ${project}: ${String(result.written)} of ${changes} written${adds}; the rate limit refused the rest.`;
}

/** The line closing a run over `result`. */
export function closingLine(result: BoardSyncResult): string {
  const project = `project #${String(result.project.number)}`;
  const adds = result.dryRun
    ? result.missing
    : result.added;
  const changes = counted(result.changes.length, 'change');
  const inStep = result.changes.length === 0 && adds.length === 0 && result.refused.length === 0;
  if (result.dryRun) {
    return inStep
      ? `Dry run on ${project}: in step, nothing to change.`
      : `Dry run on ${project}: ${changes} and ${counted(adds.length, 'issue')} to add${refusedPart(result)}; nothing written.`;
  }
  if (result.rateLimited) return stoppedLine(result, project, changes);
  return inStep
    ? `Synced ${project}: in step, nothing to change.`
    : `Synced ${project}: ${changes} written, ${addedPart(result)}${refusedPart(result)}.`;
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
    filled: synced.filled,
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
  const config = await issueSubjectConfig(project, (message) => {
    context.output.warn(message);
  });
  if (config.boardProjectNumber === null) {
    throw new CommandExit(1, `❌ board.project.number is not set, so there is no project to sync. Run \`${PROJECT_INIT_FIX}\` to create one.`);
  }
  const gh = openProjectRunner(seams.gh ?? createGhRunner({ cwd: project.root }), config, commandRetrySeams(context.output, context.outputMode, seams.sleep));
  const dryRun = context.flags[BOARD_SYNC_DRY_RUN_FLAG] === true;
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
    ...BOARD_SYNC_DECLARATION,
    run: async (context) => {
      writeResult(context, await runBoardSync(context, seams));
    },
  };
  return Object.freeze(command);
}

const command: RafaCommand = createBoardSyncCommand();
export default command;
