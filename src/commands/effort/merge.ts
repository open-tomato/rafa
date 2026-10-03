/**
 * `rafa effort merge <file> [--dry-run]`: another device's effort store
 * file unioned into this project's store by `mergeStore`
 * (`src/effort/store/merge-store.ts`, whose note is the long form).
 * Starts no Claude session and declares no `spends`.
 *
 * This store is the one every other command would open: under
 * `RAFA_EFFORT_DIR` when it is set, and `<root>/.rafa/effort/effort.sqlite`
 * otherwise. `<file>` is read against the directory the command runs
 * from, and is only ever read. The merged store is built beside this one
 * as `effort.sqlite.merge-<stamp>`, checked, and swapped in with the
 * original kept whole as `effort.sqlite.before-merge-<stamp>.bak`.
 * `--dry-run` builds and checks the same file, then deletes it.
 *
 * It prints, for each merged table, the rows added, skipped and in
 * conflict (and, when there are any, the set-once fields filled and the
 * rows another UNIQUE key refused), the totals, the commit gaps
 * rewritten, and the backup's name.
 *
 * Exit code 2 when the other file is another project's store, and when
 * the project keeps its sessions and commits as NDJSON (`store: ndjson`),
 * that refusal naming `rafa effort move --to=sqlite`: in both, the stores
 * cannot be merged as they are. Exit code 1 for every other refusal (an
 * argument, a config `loadConfig` refuses, a missing or damaged file, a
 * write in flight, a schema this rafa will not write, a live loop, a
 * development build over a store it does not own, a check the build
 * failed), each changing no byte of either file. Exit code 0 otherwise.
 * In json mode the `MergeResult` is the data of the terminal result.
 */
import type { RafaCommand, RafaContext } from '../../cli/command.js';
import type { MergeOptions, MergeResult, TableMerge } from '../../effort/store/merge-store.js';
import type { SqliteMigration } from '../../effort/store/migrations.js';
import type { ProjectIdentity } from '../../effort/store/store-identity.js';
import type { PidProbe } from '../../loop/sessions.js';
import type { RuntimeIdentity } from '../../runtime/identity.js';

import { join, resolve } from 'node:path';

import { CommandExit } from '../../cli/command.js';
import { messageOf } from '../../config-sections.js';
import { DevelopmentBuildRefusedError } from '../../effort/store/development-build.js';
import { effortStoreDir } from '../../effort/store/location.js';
import { MergeRefusal, mergeStore } from '../../effort/store/merge-store.js';
import { UnionSchemaMismatch } from '../../effort/store/merge-union.js';
import { RebuildRefusal } from '../../effort/store/rebuild-aside.js';
import { SQLITE_STORE_FILE_NAME } from '../../effort/store/sqlite.js';
import { expectOneArgument, readSwitch, requireProject, resolveProjectConfig } from '../plan/plan-files.js';

import { fileStamp } from './fix-schema.js';

/** The command's spelling, as its refusals name it. */
const COMMAND_NAME = 'rafa effort merge';

/** The line the refusals end with. */
export const MERGE_USAGE = 'rafa effort merge <file> [--dry-run]';

const DRY_RUN_FLAG = 'dry-run';

/** The exit code of a refusal the two stores can be merged past. */
const REFUSED_EXIT = 1;

/** The exit code of two stores that cannot be merged as they are: another project's, or an NDJSON project. */
const UNMERGEABLE_EXIT = 2;

/** The refusals answered with {@link UNMERGEABLE_EXIT}. */
const UNMERGEABLE_REASONS: ReadonlySet<MergeRefusal['reason']> = new Set(['other-project', 'ndjson']);

/** What a test replaces. */
export interface MergeCommandSeams {
  /** The clock the parallel and backup files are stamped from, and `merged_at`. */
  readonly now?: () => Date;
  /** The directory `<file>` is read against; `process.cwd()` by default. */
  readonly cwd?: () => string;
  /** Whether a run record's pid is alive. */
  readonly isAlive?: PidProbe;
  /** Which build runs; `readRuntimeIdentity()` by default. */
  readonly identity?: RuntimeIdentity;
  /** The catalogue both stores are brought to. */
  readonly migrations?: readonly SqliteMigration[];
  /** A new merge id. */
  readonly newMergeId?: () => string;
  /** The project of the repository holding a store, for an unminted one. */
  readonly readProject?: (dir: string) => ProjectIdentity;
}

/** One merged table's line. */
function tableLine(entry: TableMerge): string {
  const extra = [
    ...(entry.filled === 0
      ? []
      : [`${String(entry.filled)} filled`]),
    ...(entry.collided === 0
      ? []
      : [`${String(entry.collided)} refused by another unique key, kept in the other file only`]),
  ];
  const counts = [
    `${String(entry.added)} added`,
    `${String(entry.skipped)} skipped`,
    `${String(entry.inConflict)} in conflict`,
    ...extra,
  ];
  return `  ${entry.table}: ${counts.join(', ')}`;
}

/** The line closing one outcome: the backup's name, or what a dry run did, naming `command` to run it again. */
function closingLine(result: MergeResult, command: string): string {
  if (result.status === 'would-merge') {
    return '🔍 Dry run: the merged store was built beside it, checked (row counts, integrity_check, this rafa\'s'
      + ` schema plan) and deleted. Run \`${command} ${result.otherPath}\` to swap it in; the original would be`
      + ` kept whole at ${result.path}.before-merge-<stamp>.bak.`;
  }
  return `✅ Merged. The original is kept whole at ${String(result.backupPath)}; rename it back to undo.`;
}

/**
 * Every line one outcome prints. `command` is the spelling a dry run's
 * closing line names to swap the merge in: this command's by default,
 * and `rafa effort import`'s when that command renders its pull.
 */
export function renderMerge(result: MergeResult, command: string = COMMAND_NAME): string[] {
  const other = result.otherStore === null
    ? 'a store that names no origin'
    : `store ${result.otherStore}`;
  const forward = result.otherBroughtForward.length === 0
    ? []
    : [`A copy of the other store was brought forward through ${result.otherBroughtForward.join(', ')}; the file itself was only read.`];
  return [
    `Merges ${result.otherPath} (${other}) into ${result.path}, as merge ${result.mergeId}.`,
    ...forward,
    ...result.tables.map(tableLine),
    `Total: ${String(result.rowsAdded)} added, ${String(result.rowsSkipped)} skipped,`
      + ` ${String(result.rowsInConflict)} in conflict; ${String(result.gapsRewritten)} commit gaps recomputed.`,
    closingLine(result, command),
  ];
}

/**
 * The store file every other command would open under `root`, or a
 * refusal of `RAFA_EFFORT_DIR` with exit code 1 naming `command`. Shared
 * with `rafa effort import`, which merges into the same store.
 */
export function mergeTargetPath(context: RafaContext, root: string, command: string = COMMAND_NAME): string {
  try {
    return join(effortStoreDir(root, context.env), SQLITE_STORE_FILE_NAME);
  } catch (error) {
    throw new CommandExit(REFUSED_EXIT, `❌ ${command}: ${messageOf(error)}`);
  }
}

/**
 * The exit a merge's error is answered with, naming `command`, or null
 * for one the merge does not throw as a refusal: exit code 2 for another
 * project's store and an NDJSON project, 1 for every other refusal.
 * Shared with `rafa effort import`, whose pull rejects with the merge's
 * own refusals, so the two commands cannot answer one refusal apart.
 */
export function mergeRefusalExit(error: unknown, command: string = COMMAND_NAME): CommandExit | null {
  if (error instanceof MergeRefusal) {
    const code = UNMERGEABLE_REASONS.has(error.reason)
      ? UNMERGEABLE_EXIT
      : REFUSED_EXIT;
    return new CommandExit(code, `❌ ${command}: ${error.message}`);
  }
  const known = error instanceof RebuildRefusal
    || error instanceof DevelopmentBuildRefusedError
    || error instanceof UnionSchemaMismatch;
  return known
    ? new CommandExit(REFUSED_EXIT, `❌ ${command}: ${error.message}`)
    : null;
}

/** The optional seams `mergeStore` reads, those a test set. */
function probeSeams(seams: MergeCommandSeams): Partial<MergeOptions> {
  return {
    ...(seams.isAlive === undefined
      ? {}
      : { isAlive: seams.isAlive }),
    ...(seams.identity === undefined
      ? {}
      : { identity: seams.identity }),
    ...(seams.migrations === undefined
      ? {}
      : { migrations: seams.migrations }),
    ...(seams.newMergeId === undefined
      ? {}
      : { newMergeId: seams.newMergeId }),
    ...(seams.readProject === undefined
      ? {}
      : { readProject: seams.readProject }),
  };
}

/** Runs one invocation. See the module note. */
export function runMerge(context: RafaContext, seams: MergeCommandSeams): void {
  const file = expectOneArgument(context.args, MERGE_USAGE);
  const dryRun = readSwitch(DRY_RUN_FLAG, context.flags[DRY_RUN_FLAG], `Usage: ${MERGE_USAGE}`);
  const project = requireProject(context, COMMAND_NAME);
  const path = mergeTargetPath(context, project.root);
  const backend = resolveProjectConfig(project, COMMAND_NAME, (message) => context.output.warn(message)).store;
  const now = seams.now ?? ((): Date => new Date());
  const otherPath = resolve((seams.cwd ?? ((): string => process.cwd()))(), file);

  let result: MergeResult;
  try {
    result = mergeStore({ path, otherPath, backend, dryRun, stamp: fileStamp(now()), now, env: context.env, ...probeSeams(seams) });
  } catch (error) {
    throw mergeRefusalExit(error) ?? error;
  }

  if (context.outputMode === 'json') {
    context.output.result(result);
    return;
  }
  for (const line of renderMerge(result)) context.output.info(line);
}

/** The command, reading `seams`; see the module note. */
export function createMergeCommand(seams: MergeCommandSeams = {}): RafaCommand {
  const command: RafaCommand = {
    name: 'effort merge',
    subject: 'effort',
    action: 'merge',
    summary: 'merge another device\'s effort store file into this one, keeping every row and the original',
    description: 'Adds to `.rafa/effort/effort.sqlite`, or the store under `RAFA_EFFORT_DIR`, every row another'
      + ' device\'s store file holds that this one lacks. A row matches on its origin pair, or on its table\'s'
      + ' identity columns when either side has no origin; an equal pair is skipped, a set-once field NULL here'
      + ' is filled, and any other difference is kept on both sides and recorded in `merge_conflicts`. The gap'
      + ' of each commit brought in, and of the commit after it, is recomputed. The other file is only read.'
      + ' The merged store is built beside this one, checked (each table\'s count plus the rows added,'
      + ' integrity_check, the schema plan), and swapped in with the original kept whole as'
      + ' `effort.sqlite.before-merge-<stamp>.bak`. It prints the rows added, skipped and in conflict per table'
      + ' and the backup\'s name. Exit code 2 for another project\'s store, and for a `store: ndjson` project,'
      + ' naming `rafa effort move --to=sqlite`; exit code 1, changing nothing, for a missing or damaged file,'
      + ' a write in flight, a loop session running or paused, and a development build over a store it does not'
      + ' own. With `--output=json` the outcome is the data of the terminal result event. Starts no session.',
    args: [
      {
        name: 'file',
        description: 'The other device\'s `effort.sqlite`, a consistent copy such as `rafa effort copy` makes;'
          + ' a relative path is read from the directory the command runs in.',
        type: 'string',
        required: true,
      },
    ],
    flags: [
      {
        name: DRY_RUN_FLAG,
        description: 'Build and check the merged store, print what it would add, then delete it. This store is'
          + ' only read, so this runs beside a live loop and from a development build, and can be repeated.',
        type: 'boolean',
      },
    ],
    examples: [
      {
        cmd: 'rafa effort merge ../laptop-effort/effort.sqlite --dry-run',
        note: 'Prints what the merge would add, skip and record as conflicts, changing nothing.',
      },
      {
        cmd: 'rafa effort merge ../laptop-effort/effort.sqlite',
        note: 'Swaps the merged store in and prints where the original was kept.',
      },
    ],
    outputs: ['text', 'json'],
    run: async (context) => {
      runMerge(context, seams);
      await Promise.resolve();
    },
  };
  return Object.freeze(command);
}

export default createMergeCommand();
