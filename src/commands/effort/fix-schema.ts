/**
 * `rafa effort fix-schema [--dry-run]`: the project's SQLite effort store,
 * when it is past the schema version this rafa knows, rebuilt at that
 * version by `fixStoreSchema` (`src/effort/store/fix-schema.ts`, whose
 * note is the long form). Starts no Claude session and declares no
 * `spends`.
 *
 * A store gets past this rafa when newer code opens it, most often a
 * plan's own branch code run from its working tree while the loop driving
 * the plan is an older installed runtime. That runtime then refuses the
 * store, and the task reports it collects are not stored.
 *
 * The swap is refused while any loop session under the project reads
 * `running` or `paused` (`readSessions`, `src/loop/sessions.ts`), since a
 * loop writing the store while it is renamed would lose those writes. A
 * dry run reads the store and writes only its own parallel file, which it
 * deletes, so it runs beside a live loop. Every refusal is exit code 1
 * with the live store untouched; every other outcome is exit code 0. In
 * json mode the `FixSchemaResult` is the data of the terminal result.
 */
import type { RafaCommand, RafaContext } from '../../cli/command.js';
import type { FixSchemaResult } from '../../effort/store/fix-schema.js';
import type { PidProbe, SessionRecord } from '../../loop/sessions.js';

import { CommandExit } from '../../cli/command.js';
import { fixStoreSchema, SchemaFixRefusal } from '../../effort/store/fix-schema.js';
import { sqliteStorePath } from '../../effort/store/sqlite.js';
import { readSessions } from '../../loop/sessions.js';
import { expectNoArgument, readSwitch } from '../plan/plan-files.js';

/** The command's spelling, as its refusals name it. */
const COMMAND_NAME = 'rafa effort fix-schema';

/** The line the refusals end with. */
export const FIX_SCHEMA_USAGE = 'rafa effort fix-schema [--dry-run]';

const DRY_RUN_FLAG = 'dry-run';

/** What a test replaces. */
export interface FixSchemaCommandSeams {
  /** The clock the parallel and backup files are stamped from. */
  readonly now?: () => Date;
  /** Whether a run record's pid is alive. */
  readonly isAlive?: PidProbe;
}

/** A clock reading as a file-name stamp: `20260926T101500Z`. */
export function fileStamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

/** Refuses while a loop session under `root` reads `running` or `paused`. */
function refuseLiveLoop(root: string, isAlive: PidProbe | undefined): void {
  let records: readonly SessionRecord[];
  try {
    records = readSessions(root, isAlive === undefined
      ? {}
      : { isAlive });
  } catch (error) {
    throw new CommandExit(1, `❌ ${COMMAND_NAME}: the loop's run records cannot be read, so a live loop cannot be ruled out: ${String(error)}`);
  }
  const live = records.find((record) => record.state === 'running' || record.state === 'paused');
  if (live === undefined) return;
  throw new CommandExit(
    1,
    `❌ ${COMMAND_NAME}: loop session ${live.sessionId} on ${live.branch} is ${live.state} and writes the store;`
      + ` stop it with \`rafa loop stop -s ${live.sessionId}\` first. \`--dry-run\` runs beside it.`,
  );
}

/** The lines a rebuild's tables and left-behind data read as. */
function rebuildLines(result: FixSchemaResult): string[] {
  const rows = result.kept.reduce((sum, table) => sum + table.rows, 0);
  const kept = result.kept.map((table) => `${table.table} ${String(table.rows)}`).join(', ');
  const left = [
    ...result.leftTables.map((table) => `table ${table.table} (${String(table.rows)} rows)`),
    ...result.leftColumns.map((column) => `column ${column.table}.${column.column} (${String(column.values)} values)`),
  ];
  return [
    `${result.path} is at schema version ${String(result.storeVersion)}, past the ${String(result.knownVersion)} this rafa knows.`,
    `Keeps ${String(result.kept.length)} tables, ${String(rows)} rows: ${kept}.`,
    left.length === 0
      ? 'Leaves nothing behind.'
      : `Leaves behind, kept only in the backup: ${left.join('; ')}.`,
  ];
}

/** Every line one outcome prints. */
export function renderFixSchema(result: FixSchemaResult): string[] {
  switch (result.status) {
    case 'missing':
      return [`No effort store at ${result.path}: nothing to repair.`];
    case 'current':
      return [`✅ ${result.path} is at schema version ${String(result.knownVersion)}, the one this rafa knows: nothing to repair.`];
    case 'behind':
      return [
        `${result.path} is at schema version ${String(result.storeVersion)}, behind the ${String(result.knownVersion)} this rafa`
          + ' knows; the next command that opens it migrates it. Nothing to repair.',
      ];
    case 'would-rebuild':
      return [
        ...rebuildLines(result),
        `🔍 Dry run: the rebuild at version ${String(result.knownVersion)} was built, checked (row counts, integrity_check)`
          + ' and deleted. Run without `--dry-run` to swap it in.',
      ];
    case 'rebuilt':
      return [
        ...rebuildLines(result),
        `✅ Rebuilt at version ${String(result.knownVersion)}. The original is kept whole at ${String(result.backupPath)};`
          + ' rename it back to undo.',
      ];
  }
}

/** Runs one invocation. See the module note. */
export function runFixSchema(context: RafaContext, seams: FixSchemaCommandSeams): void {
  expectNoArgument(context.args, FIX_SCHEMA_USAGE);
  const dryRun = readSwitch(DRY_RUN_FLAG, context.flags[DRY_RUN_FLAG], `Usage: ${FIX_SCHEMA_USAGE}`);
  if (context.project === null) throw new Error(`${COMMAND_NAME} runs inside a project, and was handed none`);
  const root = context.project.root;
  if (!dryRun) refuseLiveLoop(root, seams.isAlive);

  let result: FixSchemaResult;
  try {
    result = fixStoreSchema({
      path: sqliteStorePath(root),
      dryRun,
      stamp: fileStamp((seams.now ?? ((): Date => new Date()))()),
    });
  } catch (error) {
    if (error instanceof SchemaFixRefusal) throw new CommandExit(1, `❌ ${COMMAND_NAME}: ${error.message}`);
    throw error;
  }

  if (context.outputMode === 'json') {
    context.output.result(result);
    return;
  }
  for (const line of renderFixSchema(result)) context.output.info(line);
}

/** The command, reading `seams`; see the module note. */
export function createFixSchemaCommand(seams: FixSchemaCommandSeams = {}): RafaCommand {
  const command: RafaCommand = {
    name: 'effort fix-schema',
    subject: 'effort',
    action: 'fix-schema',
    summary: 'rebuild an effort store a newer rafa migrated at the version this rafa knows, keeping the original',
    description: 'Repairs `.rafa/effort/effort.sqlite` when it is past the schema version this rafa knows, which'
      + ' happens when newer code opens it, such as a plan\'s own branch code run while an older installed rafa'
      + ' drives the loop. It builds a parallel store beside it at this rafa\'s version, copies every table and'
      + ' column this rafa knows, checks the row counts and SQLite\'s integrity_check, and lists what only the'
      + ' newer schema holds. Then it renames the original to `effort.sqlite.v<version>-<stamp>.bak`, whole, and'
      + ' moves the rebuild into its place. A store at or behind this version, or no store, is left alone. It'
      + ' refuses, changing nothing, while a loop session under the project is running or paused, while a'
      + ' journal beside the store shows a write in flight, and when the newer schema lacks a table or column'
      + ' this rafa writes. With `--output=json` the outcome is the data of the terminal result event. Starts no'
      + ' session.',
    args: [],
    flags: [
      {
        name: DRY_RUN_FLAG,
        description: 'Build and check the rebuild, print what it keeps and leaves behind, then delete it. The'
          + ' live store is only read, so this runs beside a live loop and can be repeated.',
        type: 'boolean',
      },
    ],
    examples: [
      {
        cmd: 'rafa effort fix-schema --dry-run',
        note: 'Prints what a rebuild would keep and leave behind, changing nothing.',
      },
      {
        cmd: 'rafa effort fix-schema',
        note: 'Swaps the rebuild in and prints where the original was kept.',
      },
    ],
    outputs: ['text', 'json'],
    run: async (context) => {
      runFixSchema(context, seams);
      await Promise.resolve();
    },
  };
  return Object.freeze(command);
}

export default createFixSchemaCommand();
