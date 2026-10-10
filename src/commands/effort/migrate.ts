/**
 * `rafa effort migrate [--dry-run]`: the project's SQLite effort store
 * brought to this rafa's migrations, a migration that breaks older
 * runtimes included, by `migrateStore` (`src/effort/store/migrate.ts`,
 * whose note is the long form). Starts no Claude session and declares no
 * `spends`.
 *
 * The store is the one every other command would open: under
 * `RAFA_EFFORT_DIR` when it is set, and `<root>/.rafa/effort/effort.sqlite`
 * otherwise. The pending migrations are applied to
 * `effort.sqlite.migrate-<stamp>` beside it, checked (the row count of
 * every table, `integrity_check`, this rafa's schema plan), and swapped in
 * once every row the original holds is copied to
 * `effort.sqlite.before-<id>-<stamp>.bak`. The migrated store keeps the
 * store's id; the backup is a copy, so renamed back to undo the migration
 * it takes a new id on its next write. `--dry-run` builds and checks the
 * same file, then deletes it.
 *
 * The swap is refused, before anything is built, from a development build
 * over a store it does not own, which is any store but a copy under
 * `RAFA_EFFORT_DIR` or the temporary directory, and while a loop record
 * under the project reads `running` or `paused`. A dry run is refused
 * neither. A store this rafa refuses for another reason is refused with
 * the schema plan's text, ending with its next safe step.
 *
 * Every refusal is exit code 1 with the live store untouched; every other
 * outcome is exit code 0. In json mode the `MigrateResult` is the data of
 * the terminal result.
 */
import type { RafaCommand, RafaContext } from '../../cli/command.js';
import type { MigrateResult } from '../../effort/store/migrate.js';
import type { SqliteMigration } from '../../effort/store/migrations.js';
import type { PidProbe } from '../../loop/sessions.js';
import type { RuntimeIdentity } from '../../runtime/identity.js';

import { join } from 'node:path';

import { CommandExit } from '../../cli/command.js';
import { messageOf } from '../../config-sections.js';
import { fileStamp } from '../../effort/file-stamp.js';
import { DevelopmentBuildRefusedError } from '../../effort/store/development-build.js';
import { effortStoreDir } from '../../effort/store/location.js';
import { migrateStore, MigrateRefusal } from '../../effort/store/migrate.js';
import { SQLITE_STORE_FILE_NAME } from '../../effort/store/sqlite.js';
import { expectNoArgument, readSwitch, requireProject } from '../plan/plan-files.js';

import { keepsIdLine } from './fix-schema.js';

/** The command's spelling, as its refusals name it. */
const COMMAND_NAME = 'rafa effort migrate';

/** The line the refusals end with. */
export const MIGRATE_USAGE = 'rafa effort migrate [--dry-run]';

const DRY_RUN_FLAG = 'dry-run';

/** The exit code of every refusal. */
const REFUSED_EXIT = 1;

/** What a test replaces. */
export interface MigrateCommandSeams {
  /** The clock the parallel and backup files are stamped from, and the log rows' `applied_at`. */
  readonly now?: () => Date;
  /** Whether a run record's pid is alive. */
  readonly isAlive?: PidProbe;
  /** Which build runs; `readRuntimeIdentity()` by default. */
  readonly identity?: RuntimeIdentity;
  /** The catalogue to migrate to; a test passes a synthetic tail here. */
  readonly migrations?: readonly SqliteMigration[];
}

/** The lines naming what a built migration applied and how it checked. */
function builtLines(result: MigrateResult): string[] {
  const rows = result.counted.reduce((sum, table) => sum + table.rows, 0);
  const breaking = result.breaking.length === 0
    ? 'Every one is additive.'
    : `${result.breaking.join(', ')} breaks older runtimes: a rafa that does not know it refuses the store once it runs.`;
  return [
    `Applies ${result.applying.join(', ')} to ${result.path}, logged as applied by ${result.appliedBy}. ${breaking}`,
    `Row counts match in ${String(result.counted.length)} tables, ${String(rows)} rows; integrity_check ok;`
      + ` schema version ${String(result.userVersion)} after.`,
  ];
}

/** Every line one outcome prints. */
export function renderMigrate(result: MigrateResult): string[] {
  switch (result.status) {
    case 'missing':
      return [`No effort store at ${result.path}: nothing to migrate.`];
    case 'current':
      return [`✅ ${result.path} is current: no migration is pending. Nothing to migrate.`];
    case 'would-migrate':
      return [
        ...builtLines(result),
        '🔍 Dry run: the migrated store was built beside it, checked (row counts, integrity_check, this rafa\'s'
          + ' schema plan) and deleted. Run `rafa effort migrate` to swap it in.',
      ];
    case 'migrated':
      return [
        ...builtLines(result),
        `✅ Migrated. Every row the original held is copied to ${String(result.backupPath)}.`
          + ` ${keepsIdLine('migrated store')}`,
      ];
  }
}

/** The store file every other command would open under `root`, or a refusal of `RAFA_EFFORT_DIR`. */
function storePath(context: RafaContext, root: string): string {
  try {
    return join(effortStoreDir(root, context.env), SQLITE_STORE_FILE_NAME);
  } catch (error) {
    throw new CommandExit(REFUSED_EXIT, `❌ ${COMMAND_NAME}: ${messageOf(error)}`);
  }
}

/** Runs one invocation. See the module note. */
export function runMigrate(context: RafaContext, seams: MigrateCommandSeams): void {
  expectNoArgument(context.args, MIGRATE_USAGE);
  const dryRun = readSwitch(DRY_RUN_FLAG, context.flags[DRY_RUN_FLAG], `Usage: ${MIGRATE_USAGE}`);
  const path = storePath(context, requireProject(context, COMMAND_NAME).root);
  const now = seams.now ?? ((): Date => new Date());

  let result: MigrateResult;
  try {
    result = migrateStore({
      path,
      dryRun,
      stamp: fileStamp(now()),
      now,
      env: context.env,
      ...(seams.identity === undefined
        ? {}
        : { identity: seams.identity }),
      ...(seams.isAlive === undefined
        ? {}
        : { isAlive: seams.isAlive }),
      ...(seams.migrations === undefined
        ? {}
        : { migrations: seams.migrations }),
    });
  } catch (error) {
    if (error instanceof MigrateRefusal || error instanceof DevelopmentBuildRefusedError) {
      throw new CommandExit(REFUSED_EXIT, `❌ ${COMMAND_NAME}: ${error.message}`);
    }
    throw error;
  }

  if (context.outputMode === 'json') {
    context.output.result(result);
    return;
  }
  for (const line of renderMigrate(result)) context.output.info(line);
}

/** The command, reading `seams`; see the module note. */
export function createMigrateCommand(seams: MigrateCommandSeams = {}): RafaCommand {
  const command: RafaCommand = {
    name: 'effort migrate',
    subject: 'effort',
    action: 'migrate',
    summary: 'apply the effort store\'s pending migrations, one that breaks older runtimes included, keeping the original',
    description: 'Brings `.rafa/effort/effort.sqlite`, or the store under `RAFA_EFFORT_DIR`, to the migrations this'
      + ' rafa knows, including one that breaks older runtimes, which no ordinary open applies. It writes the'
      + ' store to `effort.sqlite.migrate-<stamp>` beside it with `VACUUM INTO`, applies the pending migrations'
      + ' there with log rows naming this rafa, checks the row count of every table against the store,'
      + ' SQLite\'s integrity_check and the schema plan, then writes the original to'
      + ' `effort.sqlite.before-<id>-<stamp>.bak`, whole, and moves the migrated file into its place. The'
      + ' migrated store keeps the store\'s id; the backup is a copy, so renamed back it takes a new id on its'
      + ' next write. A store'
      + ' with nothing pending, or no store, is left alone. It refuses, changing nothing, while a loop session'
      + ' under the project is running or paused, from a development build over any store but a copy under'
      + ' `RAFA_EFFORT_DIR`, while a journal beside the store shows a write in flight, when a row count'
      + ' changes, and on any refusal of the schema plan, whose text ends with the next safe step. With'
      + ' `--output=json` the outcome is the data of the terminal result event. Starts no session.',
    args: [],
    flags: [
      {
        name: DRY_RUN_FLAG,
        description: 'Build and check the migrated store, print what it applies, then delete it. The live store'
          + ' is only read, so this runs beside a live loop and from a development build, and can be repeated.',
        type: 'boolean',
      },
    ],
    examples: [
      {
        cmd: 'rafa effort migrate --dry-run',
        note: 'Prints what the migration applies and how it checked, changing nothing.',
      },
      {
        cmd: 'rafa effort migrate',
        note: 'Swaps the migrated store in and prints where the original was kept.',
      },
    ],
    outputs: ['text', 'json'],
    run: async (context) => {
      runMigrate(context, seams);
      await Promise.resolve();
    },
  };
  return Object.freeze(command);
}

export default createMigrateCommand();
