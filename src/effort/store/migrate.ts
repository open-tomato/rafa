/**
 * The forward move `rafa effort migrate` runs: a SQLite store's pending
 * migrations, breaking ones included, applied to a copy built beside it,
 * checked, and swapped in behind a whole-file backup.
 *
 * ## What it applies
 *
 * The decision is `planSchema`'s (`schema-plan.ts`), asked for a write
 * by the `migrate` caller, the one caller a pending breaking migration
 * does not refuse. The store's `user_version` and migration log are read
 * on a read-only connection, so a store with nothing to write keeps its
 * bytes.
 *
 *   - A store with nothing to adopt or apply is `current`, and left alone.
 *   - A store `planSchema` refuses is refused with the plan's own text,
 *     which ends with the command to run next. `breaking-pending` never
 *     comes back, since this is the caller it names.
 *   - Otherwise the store is brought forward aside: adopted when it has
 *     no log, then every pending migration applied in catalogue order.
 *
 * ## The build
 *
 * The parallel file, `<store>.migrate-<stamp>`, is the live store written
 * out by `VACUUM INTO` on a read-only connection (`vacuumInto`,
 * `copy.ts`), which keeps `user_version` and the log. It is brought
 * forward there by the log-aware apply (`bringForward`,
 * `bring-forward.ts`) as the `migrate` caller, each row's `applied_by`
 * naming this runtime (`appliedByName`, `development-build.ts`). The live
 * store is then attached, and the row count of every table both files
 * hold, the log apart, must equal the live one (`checkedCounts`): a
 * breaking table rebuild that lost a row is refused there. SQLite's
 * `integrity_check` must answer `ok`, and `planSchema` must find the file
 * one this rafa uses as it is (`refuseUnusable`, `fix-schema.ts`).
 *
 * Under `dryRun` the parallel file is then deleted. Otherwise the live
 * file is renamed to `<store>.before-<id>-<stamp>.bak` and the parallel
 * file renamed into its place. `<id>` is the first migration applied, or
 * `schema_migrations` when the run only adopts the store. The backup is
 * the whole original; restoring it is renaming it back.
 *
 * Those steps, from the in-flight refusal to the swap and the removal of
 * the parallel file on any failure, are `rebuild-aside.ts`'s, the same
 * convention `fix-schema.ts` runs with its own file names.
 *
 * ## When the swap is refused
 *
 * Both refusals come before anything is built, and leave the directory
 * as it was. A dry run is asked neither, since it only reads the store
 * and deletes what it writes.
 *
 *   - From a development build, unless the store is one it owns: under
 *     the temporary directory or `RAFA_EFFORT_DIR`, which is where a copy
 *     `rafa effort copy` made sits. The question and its text are
 *     `refuseUnownedDevelopmentWrite`'s, the one every open asks.
 *   - While a loop record under the store's project root reads `running`
 *     or `paused` with its pid alive (`readSessions`,
 *     `src/loop/sessions.ts`): renaming the store under a loop loses what
 *     it writes. The spec's text names the first breaking migration:
 *     `REFUSED — migration <id> breaks older runtimes, and loop <sessionId>
 *     (pid <pid>, plan <stub>) is running on this store. Nothing was
 *     migrated. Finish or stop that loop, then run it again.` With only
 *     additive migrations pending it names the loop and the lost writes
 *     instead. A store that is not a project's own `.rafa/effort/` file,
 *     a copy, is named by no loop record, since `loop start` refuses to
 *     run with `RAFA_EFFORT_DIR` set.
 *
 * It opens the store itself rather than through `withSqliteStore`, so it
 * runs the test guard (`guardTestProcess`, `location.ts`) itself, before
 * it reads or makes anything.
 */
import type { DevelopmentProbe } from './development-build.js';
import type { SqliteMigration } from './migrations.js';
import type { TableRows } from './rebuild-aside.js';
import type { LoggedMigration } from './schema-plan.js';
import type { SessionRecord } from '../../loop/sessions.js';

import { existsSync } from 'node:fs';

import { Database } from 'bun:sqlite';

import { messageOf } from '../../config-sections.js';
import { isPidAlive, readSessions } from '../../loop/sessions.js';
import { readRuntimeIdentity } from '../../runtime/identity.js';

import { bringForward, writeNames } from './bring-forward.js';
import { vacuumInto } from './copy.js';
import {
  ADOPTION_NAME,
  appliedByName,
  refuseUnownedDevelopmentWrite,
  storeProjectRoot,
} from './development-build.js';
import { readOnlySchema, refuseUnusable, tableNames } from './fix-schema.js';
import { guardTestProcess } from './location.js';
import { SQLITE_MIGRATIONS } from './migrations.js';
import { checkedCounts, rebuildAside, RebuildRefusal, refuseCorrupt, refuseInFlight } from './rebuild-aside.js';
import { planSchema, sqliteCatalogue } from './schema-plan.js';

/** What the run found, and what it did about it. */
export type MigrateStatus =
  /** No store file: nothing to migrate, and none is created. */
  | 'missing'
  /** Nothing to adopt or apply: nothing to migrate. */
  | 'current'
  /** Under `dryRun`: the migrated store was built, checked and deleted. */
  | 'would-migrate'
  /** The migrated store was swapped in and the original kept as a backup. */
  | 'migrated';

/** The outcome of one run. */
export interface MigrateResult {
  /** The live store's file. */
  readonly path: string;
  readonly status: MigrateStatus;
  /** The live store's `user_version`, or null when there is no file. */
  readonly storeVersion: number | null;
  /** Whether the live store held a migration log. */
  readonly logged: boolean;
  /** What the run records: `schema_migrations` first when it adopts, then each pending id. */
  readonly applying: readonly string[];
  /** The pending ids that break older runtimes, in catalogue order. */
  readonly breaking: readonly string[];
  /** Logged migrations this rafa does not know; each is one this rafa uses the store through. */
  readonly unknown: readonly LoggedMigration[];
  /** Who the new log rows name as applying them. */
  readonly appliedBy: string;
  /** The `user_version` the migrated store holds, or null when nothing was built. */
  readonly userVersion: number | null;
  /** Every table both files hold, with the rows each holds; empty when nothing was built. */
  readonly counted: readonly TableRows[];
  /** Where the original went, for `migrated` only. */
  readonly backupPath: string | null;
}

/** What one run is handed; the {@link DevelopmentProbe} fields say which build runs and which stores it owns. */
export interface MigrateOptions extends DevelopmentProbe {
  /** The live store's file. */
  readonly path: string;
  /** Build and check the migrated store, then delete it instead of swapping it in. */
  readonly dryRun: boolean;
  /** Names the parallel and backup files, so two runs never collide. */
  readonly stamp: string;
  /** The catalogue to migrate to: this build's unless a test passes a synthetic tail. */
  readonly migrations?: readonly SqliteMigration[];
  /** The clock the new log rows' `applied_at` is read from. */
  readonly now?: () => Date;
}

/** A run refused before the live store was changed: the build-aside steps' refusal. */
export { RebuildRefusal as MigrateRefusal } from './rebuild-aside.js';

/** The name the attached live store is reached by. */
const LIVE = 'live';

/** The parallel file a migration is built in, and the backup the original goes to. */
function asidePaths(path: string, first: string, stamp: string): { parallelPath: string; backupPath: string } {
  return { parallelPath: `${path}.migrate-${stamp}`, backupPath: `${path}.before-${first}-${stamp}.bak` };
}

/**
 * The first loop record under the store's project root that reads
 * `running` or `paused`, if any, passing the record whose session id is
 * `ownSessionId`: the run asking, which a pull at the end of its own task
 * names (`merge-store.ts`). A record is passed by its session id alone,
 * never by its pid, so another live record sharing the caller's pid is
 * still answered. Records that cannot be read refuse, the text ending
 * with `nothingDone`, the caller's sentence for what it left undone; the
 * merge asks this too, and only the merge names a session id.
 */
export function liveLoop(
  path: string,
  options: DevelopmentProbe,
  nothingDone = 'Nothing was migrated.',
  ownSessionId: string | null = null,
): SessionRecord | undefined {
  const root = storeProjectRoot(path);
  if (root === null) return undefined;
  let records: readonly SessionRecord[];
  try {
    records = readSessions(root, { isAlive: options.isAlive ?? isPidAlive });
  } catch (error) {
    throw new RebuildRefusal(`the loop's run records cannot be read, so a live loop on ${path} cannot be ruled out`
      + ` (${messageOf(error)}). ${nothingDone}`);
  }
  return records.find((record) => (record.state === 'running' || record.state === 'paused')
    && record.sessionId !== ownSessionId);
}

/** Refuses the swap while a live loop records to the store; see the module note. */
function refuseLiveLoop(path: string, breaking: readonly string[], options: DevelopmentProbe): void {
  const loop = liveLoop(path, options);
  if (loop === undefined) return;
  const named = `loop ${loop.sessionId} (pid ${String(loop.pid)}, plan ${loop.planStub ?? loop.plan}) is running on this store`;
  const [first] = breaking;
  const opening = first === undefined
    ? `REFUSED — ${named}, and swapping the migrated store in under it would lose what it writes.`
    : `REFUSED — migration ${first} breaks older runtimes, and ${named}.`;
  throw new RebuildRefusal(`${opening} Nothing was migrated. Finish or stop that loop, then run it again.`);
}

/** What the build answered. */
type Built = Pick<MigrateResult, 'userVersion' | 'counted'>;

/** Builds and checks the migrated store at `parallelPath`. */
function buildMigrated(
  path: string,
  parallelPath: string,
  migrations: readonly SqliteMigration[],
  stamp: { readonly appliedBy: string; readonly now: () => Date },
): Built {
  vacuumInto(path, parallelPath);
  const db = new Database(parallelPath, { readwrite: true });
  try {
    const brought = bringForward(db, parallelPath, 'write', 'migrate', { migrations, ...stamp, builtAside: true });
    db.run(`ATTACH DATABASE ? AS ${LIVE}`, [path]);
    const live = new Set(tableNames(db, LIVE));
    const counted = checkedCounts(db, tableNames(db, 'main').filter((table) => live.has(table)), LIVE);
    db.run(`DETACH DATABASE ${LIVE}`);
    refuseCorrupt(db);
    refuseUnusable(db, parallelPath, migrations);
    return { userVersion: brought.userVersion, counted };
  } finally {
    db.close();
  }
}

/** Migrates the store at `options.path`. See the module note. */
export function migrateStore(options: MigrateOptions): MigrateResult {
  const { path, dryRun, stamp } = options;
  guardTestProcess(path);
  const migrations = options.migrations ?? SQLITE_MIGRATIONS;
  const appliedBy = appliedByName(options.identity ?? readRuntimeIdentity());
  const nothing = { applying: [], breaking: [], unknown: [], userVersion: null, counted: [], backupPath: null };
  if (!existsSync(path)) {
    return { path, status: 'missing', storeVersion: null, logged: false, appliedBy, ...nothing };
  }

  refuseInFlight(path);
  const store = readOnlySchema(path);
  const found = { path, storeVersion: store.userVersion, logged: store.log !== null, appliedBy };
  const plan = planSchema(store, sqliteCatalogue(migrations), 'write', 'migrate');
  if (plan.verdict === 'refuse') throw new RebuildRefusal(plan.message);
  const applying = writeNames(plan);
  const planned = {
    applying,
    breaking: plan.pending.filter(({ breaks }) => breaks.length > 0).map(({ id }) => id),
    unknown: plan.unknown,
  };
  if (applying.length === 0) return { ...found, ...nothing, ...planned, status: 'current' };

  if (!dryRun) {
    refuseUnownedDevelopmentWrite(path, applying, options);
    refuseLiveLoop(path, planned.breaking, options);
  }
  const first = plan.pending[0]?.id ?? ADOPTION_NAME;
  const { built, backupPath } = rebuildAside({
    path,
    ...asidePaths(path, first, stamp),
    dryRun,
    build: (parallelPath) => buildMigrated(path, parallelPath, migrations, {
      appliedBy,
      now: options.now ?? ((): Date => new Date()),
    }),
  });
  const status = dryRun
    ? 'would-migrate'
    : 'migrated';
  return { ...found, ...planned, ...built, status, backupPath };
}
