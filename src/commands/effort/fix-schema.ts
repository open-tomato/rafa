/**
 * `rafa effort fix-schema [--dry-run]`: the project's SQLite effort
 * store, when this rafa refuses it for a reason a rebuild repairs,
 * rebuilt at the migrations this rafa knows by `fixStoreSchema`
 * (`src/effort/store/fix-schema.ts`, whose note is the long form).
 * Starts no Claude session and declares no `spends`.
 *
 * The decision is `planSchema`'s. A store this rafa uses is left alone,
 * `current` or `behind`, even when it logs migrations this rafa does
 * not know that are additive. A store refused as `pre-log-unreleased`,
 * `gate-mismatch`, `edited` or either `unknown-breaks-*` is rebuilt with
 * a migration log whose rows name this runtime as applying them, and
 * what only the newer schema holds, unknown migrations included, is
 * kept in the backup alone. The rebuild keeps the store's id; the
 * backup is a copy, so renamed back it takes a new id on its next
 * write. The other two refusals are passed on with
 * the plan's own next step. Where a newer rafa that knows the store's
 * migrations can be installed, that comes first.
 *
 * The swap is refused while any loop session under the project reads
 * `running` or `paused` (`readSessions`, `src/loop/sessions.ts`), since a
 * loop writing the store while it is renamed would lose those writes,
 * and from a development build, whose migrations may be a branch's. A
 * dry run reads the store and writes only its own parallel file, which it
 * deletes, so it runs beside a live loop and from a development build.
 * Every refusal is exit code 1 with the live store untouched; every other
 * outcome is exit code 0. In json mode the `FixSchemaResult` is the data
 * of the terminal result.
 */
import type { RafaCommand, RafaContext } from '../../cli/command.js';
import type { FixSchemaResult } from '../../effort/store/fix-schema.js';
import type { PidProbe, SessionRecord } from '../../loop/sessions.js';
import type { RuntimeIdentity } from '../../runtime/identity.js';

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
  /** Which build runs; `readRuntimeIdentity()` by default. */
  readonly identity?: RuntimeIdentity;
}

/** A clock reading as a file-name stamp: `20260926T101500Z`. */
export function fileStamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

/**
 * The done line's sentence on identity, shared by `effort fix-schema`,
 * `effort migrate` and `effort merge`: the file `swapped` names keeps the
 * store's id, and the backup, a copy, takes a new one once renamed back
 * (`carryStoreIdentity`, `src/effort/store/store-meta.ts`).
 */
export function keepsIdLine(swapped: string): string {
  return `The ${swapped} keeps the store's id; the backup is a copy, so renamed back it takes a new id on its`
    + ' next write.';
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

/** A list of logged migrations as a line names them. */
function migrationNames(result: FixSchemaResult): string {
  return result.unknown.map(({ id, appliedBy }) => `${id} (applied by ${appliedBy})`).join(', ');
}

/** The lines a rebuild's reason, tables and left-behind data read as. */
function rebuildLines(result: FixSchemaResult): string[] {
  const rows = result.kept.reduce((sum, table) => sum + table.rows, 0);
  const kept = result.kept.map((table) => `${table.table} ${String(table.rows)}`).join(', ');
  const left = [
    ...result.unknown.map(({ id, appliedBy }) => `migration ${id} (applied by ${appliedBy})`),
    ...result.leftTables.map((table) => `table ${table.table} (${String(table.rows)} rows)`),
    ...result.leftColumns.map((column) => `column ${column.table}.${column.column} (${String(column.values)} values)`),
  ];
  const newer = result.unknown.length === 0
    ? []
    : [`A rafa that knows ${result.unknown.map(({ id }) => id).join(', ')} uses the store as it is and keeps that data`
      + ' in it; install one instead where you can.'];
  return [
    `Refused as ${String(result.reason)}: ${String(result.refusal)}`,
    `Rebuilds it at the ${String(result.known.length)} migrations this rafa knows, logged as applied by ${result.appliedBy}.`,
    `Keeps ${String(result.kept.length)} tables, ${String(rows)} rows: ${kept}.`,
    left.length === 0
      ? 'Leaves nothing behind.'
      : `Leaves behind, kept only in the backup: ${left.join('; ')}.`,
    ...newer,
  ];
}

/** The line naming the additive migrations a usable store logs that this rafa does not know, if any. */
function unknownAdditiveLines(result: FixSchemaResult): string[] {
  return result.unknown.length === 0
    ? []
    : [`It logs ${migrationNames(result)}, which this rafa does not know; each is additive, so this rafa uses the store`
      + ' through them.'];
}

/** Every line one outcome prints. */
export function renderFixSchema(result: FixSchemaResult): string[] {
  switch (result.status) {
    case 'missing':
      return [`No effort store at ${result.path}: nothing to repair.`];
    case 'current':
      return [
        `✅ ${result.path} is current: this rafa reads and writes it as it is. Nothing to repair.`,
        ...unknownAdditiveLines(result),
      ];
    case 'behind':
      return [
        `${result.path} is behind this rafa's migrations; the next command that opens it records`
          + ` ${result.pending.join(', ')}. Nothing to repair.`,
        ...unknownAdditiveLines(result),
      ];
    case 'would-rebuild':
      return [
        ...rebuildLines(result),
        '🔍 Dry run: the rebuild was built, checked (row counts, integrity_check, this rafa\'s schema plan) and'
          + ' deleted. Run without `--dry-run` to swap it in.',
      ];
    case 'rebuilt':
      return [
        ...rebuildLines(result),
        `✅ Rebuilt at this rafa's migrations. The original is kept whole at ${String(result.backupPath)};`
          + ` rename it back to undo. ${keepsIdLine('rebuild')}`,
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
  const now = seams.now ?? ((): Date => new Date());

  let result: FixSchemaResult;
  try {
    result = fixStoreSchema({
      path: sqliteStorePath(root),
      dryRun,
      stamp: fileStamp(now()),
      now,
      ...(seams.identity === undefined
        ? {}
        : { identity: seams.identity }),
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
    summary: 'rebuild an effort store this rafa refuses at the migrations it knows, keeping the original',
    description: 'Repairs `.rafa/effort/effort.sqlite`, or the store under `RAFA_EFFORT_DIR`, when this rafa refuses'
      + ' it for a reason a rebuild repairs: no migration log past the legacy entries (pre-log-unreleased), a log'
      + ' with a schema version it does not match (gate-mismatch), a logged checksum this rafa holds otherwise'
      + ' (edited), or a logged migration this rafa does not know that breaks older readers or writers'
      + ' (unknown-breaks-readers, unknown-breaks-writers). Installing a rafa that knows the store\'s migrations'
      + ' comes first where one exists. It builds a parallel store beside it at this rafa\'s migrations, with a'
      + ' migration log naming this rafa, copies every table and column this rafa knows, checks the row counts,'
      + ' SQLite\'s integrity_check and the schema plan, and lists what only the newer schema holds, unknown'
      + ' migrations included. Then it writes the original to `effort.sqlite.v<user_version>-<stamp>.bak`,'
      + ' whole, and moves the rebuild into its place. The rebuild keeps the store\'s id; the backup is a copy,'
      + ' so renamed back it takes a new id on its next write. A store this rafa uses, current or behind, or no store, is'
      + ' left alone. It refuses, changing nothing, while a loop session under the project is running or paused,'
      + ' from a development build, while a journal beside the store shows a write in flight, when the newer'
      + ' schema lacks a table or column this rafa writes, and on a refusal a rebuild does not repair. With'
      + ' `--output=json` the outcome is the data of the terminal result event. Starts no session.',
    args: [],
    flags: [
      {
        name: DRY_RUN_FLAG,
        description: 'Build and check the rebuild, print what it keeps and leaves behind, then delete it. The'
          + ' live store is only read, so this runs beside a live loop and from a development build, and can be'
          + ' repeated.',
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
