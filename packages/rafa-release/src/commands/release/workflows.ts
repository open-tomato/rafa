/**
 * `rafa release workflows [--write]`: the release ladder's workflow
 * files, one row per entry of `LADDER_WORKFLOWS` (`packages/rafa-release/src/release/ladder.ts`),
 * and, with `--write`, the needed ones that are missing written from the
 * shipped templates.
 *
 * ```text
 * Release ladder: level 2, CI publishes.
 * .github/workflows/release-publish.yml       level 2, 3, 4  needed      missing
 * .github/workflows/release-tag.yml           level 3        not needed  missing
 * ```
 *
 * ## What a row holds
 *
 * Each row names the workflow's path under the project root, the levels
 * it serves (`LadderWorkflow.levels`), whether the level the config's
 * `release.settle`, `release.tag` and `release.publish` read as needs it
 * (`ladderWorkflowNeeded`, with `.github/dependabot.yml` read for the bot
 * fragment workflow), and its state:
 *
 *   - `present`: a regular file holding the shipped template's bytes;
 *   - `differs`: a regular file holding other bytes, which is how a
 *     project's own edit reads, and is not wrong by itself;
 *   - `missing`: nothing at the path, or something that is not a regular
 *     file (`found: not-a-file`), as the doctor's ladder row reads it.
 *
 * A template the build does not ship (the ladder names workflows whose
 * templates later work adds) leaves a present file unread against
 * nothing: it reads `present`, with the row's `problem` saying its bytes
 * were not compared, so the row never claims a match it did not make.
 *
 * ## `--write`
 *
 * Each needed workflow that is `missing` is written through
 * `writeReleaseWorkflow` (`packages/rafa-release/src/release/templates.ts`), which leaves an
 * existing file byte for byte and refuses a directory at the path. A
 * present or differing file is left as it is and named on a line, and a
 * workflow the level does not need is never written. A refused write is
 * named with its reason. The command exits 0 in every case: it reports
 * and writes, and `rafa doctor`'s ladder row is what warns.
 *
 * ## json
 *
 * With `--output=json` the terminal result's data is
 * {@link ReleaseWorkflowsResult}: the level, the rows, and with `--write`
 * the part each write answered.
 */
import type { LadderLevelReading, LadderWorkflow, LadderWorkflowReading } from '../../release/ladder.js';
import type { RafaCommand, RafaContext } from '@open-tomato/rafa/core/command';
import type { BoardPart } from '@open-tomato/rafa-board';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expectNoArgument, readSwitch, requireProject, resolveProjectConfig } from '@open-tomato/rafa/commands/plan/plan-files';

import { LADDER_WORKFLOWS, ladderLevel, ladderWorkflowNeeded } from '../../release/ladder.js';
import { readReleaseTemplate, writeReleaseWorkflow } from '../../release/templates.js';
import { readLadderFiles } from '../doctor-ladder.js';

import { RELEASE_WORKFLOWS_DECLARATION, RELEASE_WORKFLOWS_WRITE_FLAG } from './declarations.js';

/** The command's name, as its refusals spell it. */
const COMMAND_NAME = 'rafa release workflows';

/** The usage line this action's refusals name. */
export const RELEASE_WORKFLOWS_USAGE = 'rafa release workflows [--write]';

/** The flag that writes each needed missing workflow. */
export const WRITE_FLAG: string = RELEASE_WORKFLOWS_WRITE_FLAG;

/** What a workflow file reads as against its template. */
export type WorkflowState = 'present' | 'missing' | 'differs';

/** One row: a ladder workflow and what the project holds at its path. */
export interface WorkflowRow {
  /** The file name under `.github/workflows/`. */
  readonly file: string;
  /** The path relative to the project root. */
  readonly path: string;
  /** The levels the workflow serves. */
  readonly levels: readonly number[];
  /** True when the configured level needs it. */
  readonly needed: boolean;
  /** What the path holds against the shipped template; see the module note. */
  readonly state: WorkflowState;
  /** What a stat found at the path. */
  readonly found: LadderWorkflowReading['kind'];
  /** Why the state could not be read in full, or null. */
  readonly problem: string | null;
}

/** One write `--write` made, refused or left alone. */
export interface WorkflowWrite {
  /** The path relative to the project root. */
  readonly path: string;
  /** `created`, `present` or `refused`, as `writeReleaseWorkflow` answers; `kept` for a file left as it is. */
  readonly outcome: BoardPart['outcome'] | 'kept';
  /** One sentence: what was written, or why not. */
  readonly detail: string;
}

/** What json mode gives as the terminal result's `data`. */
export interface ReleaseWorkflowsResult {
  /** The level the config reads as. */
  readonly level: LadderLevelReading;
  /** One row per ladder workflow, in roster order, read before any write. */
  readonly rows: readonly WorkflowRow[];
  /** True when `--write` was given. */
  readonly write: boolean;
  /** What each write came to, empty without `--write`. */
  readonly writes: readonly WorkflowWrite[];
  /** The lines text mode writes. */
  readonly text: string;
}

/** The template text of `file`, or the reason it could not be read. */
function templateOf(file: string, moduleDir: string | undefined): { text: string } | { problem: string } {
  try {
    return {
      text: moduleDir === undefined
        ? readReleaseTemplate(file)
        : readReleaseTemplate(file, moduleDir),
    };
  } catch (error) {
    return { problem: error instanceof Error
      ? error.message
      : String(error) };
  }
}

/** The state of a regular file at `path` against the template of `entry`. */
function fileState(
  root: string,
  entry: LadderWorkflow,
  moduleDir: string | undefined,
): Pick<WorkflowRow, 'state' | 'problem'> {
  const template = templateOf(entry.file, moduleDir);
  if ('problem' in template) {
    return { state: 'present', problem: `its bytes were not compared: ${template.problem}` };
  }
  try {
    const text = readFileSync(join(root, entry.path), 'utf8');
    return {
      state: text === template.text
        ? 'present'
        : 'differs',
      problem: null,
    };
  } catch (error) {
    return { state: 'present', problem: `its bytes were not compared: ${String(error)}` };
  }
}

/**
 * One row per ladder workflow under `root`, at `level`. Reads only.
 *
 * @param root - The project root.
 * @param level - The level the config reads as.
 * @param versionFile - `release.versionFile`, handed to the shared reader.
 * @param moduleDir - Where the templates are looked for; the module's own by default.
 */
export function readWorkflowRows(
  root: string,
  level: LadderLevelReading['level'],
  versionFile: string,
  moduleDir?: string,
): readonly WorkflowRow[] {
  const readings = readLadderFiles(root, versionFile);
  return LADDER_WORKFLOWS.map((entry): WorkflowRow => {
    const found = readings.workflows.get(entry.path)?.kind ?? 'absent';
    const base = {
      file: entry.file,
      path: entry.path,
      levels: entry.levels,
      needed: ladderWorkflowNeeded(entry, level, readings.dependabot),
      found,
    };
    return found === 'file'
      ? { ...base, ...fileState(root, entry, moduleDir) }
      : { ...base, state: 'missing', problem: null };
  });
}

/**
 * Writes each needed missing row's workflow, and names each needed row
 * left as it is. A row not needed is passed over.
 */
export function writeWorkflows(
  root: string,
  rows: readonly WorkflowRow[],
  moduleDir?: string,
): readonly WorkflowWrite[] {
  return rows.filter((row) => row.needed).map((row): WorkflowWrite => {
    if (row.state !== 'missing') {
      return { path: row.path, outcome: 'kept', detail: `left as it is (${row.state})` };
    }
    const part = moduleDir === undefined
      ? writeReleaseWorkflow(root, row.file)
      : writeReleaseWorkflow(root, row.file, moduleDir);
    return { path: row.path, outcome: part.outcome, detail: part.detail };
  });
}

/** The row's state as text prints it: a path that is not a file says so. */
function stateText(row: WorkflowRow): string {
  return row.found === 'not-a-file'
    ? 'missing (not a file)'
    : row.state;
}

/** The lines one run renders to: the level, the rows in columns, problems, then the writes. Pure. */
export function renderWorkflows(
  level: LadderLevelReading,
  rows: readonly WorkflowRow[],
  writes: readonly WorkflowWrite[],
): string {
  const cells = rows.map((row) => [
    row.path,
    `level ${row.levels.join(', ')}`,
    row.needed
      ? 'needed'
      : 'not needed',
    stateText(row),
  ]);
  const widths = [0, 1, 2].map((column) => Math.max(...cells.map((cell) => cell[column]!.length)));
  const lines = cells.map((cell) => cell
    .map((value, column) => value.padEnd(widths[column] ?? 0))
    .join('  ')
    .trimEnd());
  const problems = rows.filter((row) => row.problem !== null).map((row) => `${row.path}: ${row.problem ?? ''}`);
  const written = writes.map((each) => `${each.path}: ${each.outcome}, ${each.detail}.`);
  return [
    `Release ladder: level ${String(level.level)}, ${level.name}.`,
    ...lines,
    ...problems,
    ...written,
  ].join('\n');
}

/** Where the templates are read from, for tests; the module's own directory when left out. */
export interface WorkflowsSeams {
  readonly moduleDir?: string;
}

/** One whole run: the line, the config, the rows, and with `--write` the writes. */
export async function runWorkflows(context: RafaContext, seams: WorkflowsSeams = {}): Promise<ReleaseWorkflowsResult> {
  expectNoArgument(context.args, RELEASE_WORKFLOWS_USAGE);
  const write = readSwitch(WRITE_FLAG, context.flags[WRITE_FLAG], `Usage: ${RELEASE_WORKFLOWS_USAGE}`);
  const project = requireProject(context, COMMAND_NAME);
  const config = await resolveProjectConfig(project, COMMAND_NAME, (message) => {
    context.output.warn(message);
  });
  const level = ladderLevel({
    releaseSettle: config.releaseSettle,
    releaseTag: config.releaseTag,
    releasePublish: config.releasePublish,
  });
  const rows = readWorkflowRows(project.root, level.level, config.releaseVersionFile, seams.moduleDir);
  const writes = write
    ? writeWorkflows(project.root, rows, seams.moduleDir)
    : [];
  return { level, rows, write, writes, text: renderWorkflows(level, rows, writes) };
}

/** The command, reading the templates through `seams`; see the module note. */
export function createReleaseWorkflowsCommand(seams: WorkflowsSeams = {}): RafaCommand {
  const command: RafaCommand = {
    ...RELEASE_WORKFLOWS_DECLARATION,
    run: async (context) => {
      const result = await runWorkflows(context, seams);
      if (context.outputMode === 'json') {
        context.output.result(result);
        return;
      }
      context.output.info(result.text);
    },
  };
  return Object.freeze(command);
}

const command: RafaCommand = createReleaseWorkflowsCommand();
export default command;
