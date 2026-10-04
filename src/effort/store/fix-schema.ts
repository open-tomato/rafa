/**
 * The repair `rafa effort fix-schema` runs: a SQLite store this rafa
 * refuses, rebuilt at the migrations this rafa knows beside the live
 * file, checked, and swapped in with the original kept as a backup.
 *
 * ## Which stores it repairs
 *
 * The decision is `planSchema`'s (`schema-plan.ts`), asked for a write
 * from an ordinary open, as `rafa effort schema` asks it: a runtime that
 * reads and writes the store is refused whatever a read alone would be.
 * The store's `user_version` and migration log are read on a read-only
 * connection, so a store that needs no repair keeps its bytes.
 *
 *   - A store the plan lets this rafa use is left alone: `current` when
 *     nothing is to be adopted or applied, `behind` when the next
 *     ordinary open brings it forward. A store logging migrations this
 *     rafa does not know, each additive, is one of these, since this
 *     rafa already reads and writes through them.
 *   - Five refusals are repaired by a rebuild ({@link REPAIRABLE_REASONS}):
 *     `pre-log-unreleased`, a store a branch build migrated past the
 *     legacy entries with no log; `gate-mismatch`, a logged store a
 *     build older than the log migrated; `edited`, a logged checksum
 *     this rafa holds otherwise; and `unknown-breaks-readers` and
 *     `unknown-breaks-writers`, a logged migration this rafa does not
 *     know which breaks it.
 *   - The other two, `breaking-out-of-order` and `breaking-pending`, are
 *     about migrations this rafa knows and has not applied, which a
 *     rebuild at those same migrations does not answer. They are refused
 *     with the plan's own text, which ends with the command to run next.
 *
 * Installing a rafa that knows the store's migrations comes first
 * wherever it can: a rebuild leaves what only the newer schema holds in
 * the backup.
 *
 * ## The rebuild
 *
 * A parallel file, `<store>.fix-<stamp>`, is brought to this rafa's
 * migrations by the log-aware apply (`bringForward`, `bring-forward.ts`),
 * so it holds exactly the tables this rafa writes and a migration log
 * with a row for every id this rafa knows, each `applied_by` naming this
 * runtime ({@link appliedByName}: its version, with `+dev:<checkout>`
 * for a development build). The live store is attached, and every table
 * the parallel file holds, the log apart, is filled from the live table
 * of the same name over the columns the parallel table has. A table or
 * column this rafa does not know is not copied, and is reported as left
 * behind with how many rows or values it held. So are the unknown
 * migrations the live log names: they stay in the backup only, since an
 * object copied into the rebuild with no log row would make the release
 * that ships its migration fail on `CREATE TABLE`. The rebuild is
 * refused when the live store lacks a table or a column this rafa
 * knows, since copying around it would lose what this rafa writes.
 *
 * The parallel file is checked before anything else happens: the row
 * count of every table copied must equal the live one, SQLite's
 * `integrity_check` must answer `ok`, and `planSchema` must find it a
 * store this rafa uses as it is. Under `dryRun` it is then deleted, so a
 * dry run can be repeated and leaves the directory as it found it.
 * Otherwise the live store is written out to
 * `<store>.v<user_version>-<stamp>.bak` with `VACUUM INTO`, its identity
 * is carried onto the parallel file (`carryStoreIdentity`,
 * `store-meta.ts`), and the parallel file is renamed into its place.
 * The rebuild keeps the live store's origin, so the rows it writes next
 * carry the same store id; a store whose next write would have minted
 * anyway is carried nothing and mints after the swap. The backup holds
 * the whole original, left-behind data included, and restoring it is
 * renaming it back. It is a copy with an inode of its own, so once
 * renamed back over the store its first writing open mints a new
 * origin (`store-identity.ts`).
 *
 * The live file is only ever read. A rollback journal or write-ahead log
 * beside it means a write in flight or interrupted, so the repair is
 * refused while either is there. Any failure while building removes the
 * parallel file and leaves the live one untouched.
 *
 * Those steps, from the in-flight refusal to the swap, are the
 * build-aside convention of `rebuild-aside.ts`, which this module runs
 * with its own file names and its own build. `SchemaFixRefusal` is that
 * module's `RebuildRefusal` under the name the command catches.
 *
 * ## A development build never swaps
 *
 * A development build (`readRuntimeIdentity`, `src/runtime/identity.ts`)
 * builds, checks and deletes a rebuild under `dryRun`, and is refused
 * the swap before anything is built: its migrations may be a branch's,
 * which no installed runtime knows. The parallel file is brought forward
 * with `builtAside`, so the open's own development-build question, which
 * would refuse a file in the project's store directory, is not asked of
 * it; this refusal is that question, asked of the swap.
 *
 * It opens the store itself rather than through `withSqliteStore`, so it
 * runs the test guard (`guardTestProcess`, `location.ts`) itself too,
 * before it reads or makes anything.
 */
import type { SqliteMigration } from './migrations.js';
import type { TableRows } from './rebuild-aside.js';
import type { LoggedMigration, RefusalReason, StoreSchema } from './schema-plan.js';
import type { RuntimeIdentity } from '../../runtime/identity.js';

import { existsSync } from 'node:fs';

import { Database } from 'bun:sqlite';

import { readRuntimeIdentity } from '../../runtime/identity.js';

import { bringForward, MIGRATION_LOG_TABLE, readStoreSchema, writeNames } from './bring-forward.js';
import { appliedByName } from './development-build.js';
import { guardTestProcess } from './location.js';
import { SQLITE_MIGRATIONS } from './migrations.js';
import {
  checkedCounts,
  count,
  quoted,
  rebuildAside,
  RebuildRefusal,
  refuseCorrupt,
  refuseInFlight,
} from './rebuild-aside.js';
import { planSchema, sqliteCatalogue } from './schema-plan.js';

/** What the repair found, and what it did about it. */
export type FixSchemaStatus =
  /** No store file: nothing to repair, and none is created. */
  | 'missing'
  /** This rafa uses it as it is: nothing to repair. */
  | 'current'
  /** This rafa uses it once the next ordinary open brings it forward: nothing to repair. */
  | 'behind'
  /** Refused for a reason a rebuild repairs, under `dryRun`: the rebuild was made, checked and deleted. */
  | 'would-rebuild'
  /** Refused for a reason a rebuild repairs: the rebuild was swapped in and the original kept as a backup. */
  | 'rebuilt';

/** The `planSchema` refusals a rebuild at this rafa's migrations repairs, in the order they are tried. */
export const REPAIRABLE_REASONS = [
  'pre-log-unreleased',
  'gate-mismatch',
  'edited',
  'unknown-breaks-readers',
  'unknown-breaks-writers',
] as const satisfies readonly RefusalReason[];

/** A refusal a rebuild repairs. */
export type RepairReason = typeof REPAIRABLE_REASONS[number];

/** A table the rebuild copies, with the rows it holds. */
export type KeptTable = TableRows;

/** A table only the newer schema knows, with the rows the backup keeps. */
export interface LeftTable {
  readonly table: string;
  readonly rows: number;
}

/** A column only the newer schema knows, with its non-null values the backup keeps. */
export interface LeftColumn {
  readonly table: string;
  readonly column: string;
  readonly values: number;
}

/** The outcome of one repair. */
export interface FixSchemaResult {
  /** The live store's file. */
  readonly path: string;
  readonly status: FixSchemaStatus;
  /** The live store's `user_version`, or null when there is no file. */
  readonly storeVersion: number | null;
  /** Whether the live store holds a migration log. */
  readonly logged: boolean;
  /** The refusal a rebuild repairs, or null when the store needs none. */
  readonly reason: RepairReason | null;
  /** That refusal's text without its way out, since the repair is that way out, or null. */
  readonly refusal: string | null;
  /** The ids this rafa knows, in catalogue order: the ones a rebuild logs. */
  readonly known: readonly string[];
  /** Who a rebuild's log rows name as applying them. */
  readonly appliedBy: string;
  /** What the next ordinary open records, for `behind`: the log first when it adopts, then each pending id. */
  readonly pending: readonly string[];
  /**
   * Logged migrations this rafa does not know. For `current` and
   * `behind` each is one this rafa uses the store through; for a
   * rebuild they stay in the backup only.
   */
  readonly unknown: readonly LoggedMigration[];
  /** Every table copied; empty unless a rebuild was made. */
  readonly kept: readonly KeptTable[];
  readonly leftTables: readonly LeftTable[];
  readonly leftColumns: readonly LeftColumn[];
  /** Where the original went, for `rebuilt` only. */
  readonly backupPath: string | null;
}

/** What one repair is handed. */
export interface FixSchemaOptions {
  /** The live store's file. */
  readonly path: string;
  /** Build and check the rebuild, then delete it instead of swapping it in. */
  readonly dryRun: boolean;
  /** Names the parallel and backup files, so two runs never collide. */
  readonly stamp: string;
  /** The migrations to rebuild at: this build's unless another list is passed. */
  readonly migrations?: readonly SqliteMigration[];
  /** Which build runs; `readRuntimeIdentity()` by default. */
  readonly identity?: RuntimeIdentity;
  /** The clock a rebuild's `applied_at` is read from. */
  readonly now?: () => Date;
}

/** A repair refused before the live store was changed: the build-aside steps' refusal. */
export { RebuildRefusal as SchemaFixRefusal } from './rebuild-aside.js';

/** The name the attached live store is reached by. */
const LIVE = 'live';

/** The user tables one attached schema holds, by name, the migration log apart. */
export function tableNames(db: Database, schema: string): string[] {
  return db
    .query<{ name: string }, [string]>(
      `SELECT name FROM ${schema}.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> ? ORDER BY name`,
    )
    .all(MIGRATION_LOG_TABLE)
    .map((row) => row.name);
}

/** A table's columns in one attached schema, in their declared order. */
function columnNames(db: Database, schema: string, table: string): string[] {
  return db
    .query<{ name: string }, [string, string]>('SELECT name FROM pragma_table_info(?, ?)')
    .all(table, schema)
    .map((row) => row.name);
}

/** The file's `user_version` and migration log, read on a read-only connection. */
export function readOnlySchema(path: string): StoreSchema {
  const db = new Database(path, { readonly: true });
  try {
    return readStoreSchema(db, path);
  } finally {
    db.close();
  }
}

/** Refuses when the live store lacks a table or a column the rebuild holds. */
function refuseRemoved(db: Database, known: readonly string[], live: ReadonlySet<string>): void {
  for (const table of known) {
    if (!live.has(table)) {
      throw new RebuildRefusal(`the store holds no table ${table}, which this rafa writes; its newer schema is not additive`);
    }
    const liveColumns = new Set(columnNames(db, LIVE, table));
    const missing = columnNames(db, 'main', table).filter((column) => !liveColumns.has(column));
    if (missing.length > 0) {
      throw new RebuildRefusal(
        `the store holds no column ${missing.map((column) => `${table}.${column}`).join(', ')}, which this rafa`
          + ' writes; its newer schema is not additive',
      );
    }
  }
}

/** Copies every known table's rows over its known columns, in one transaction. */
function copyKnown(db: Database, known: readonly string[]): void {
  db.transaction(() => {
    for (const table of known) {
      const columns = columnNames(db, 'main', table).map(quoted)
        .join(', ');
      db.run(`INSERT INTO main.${quoted(table)} (${columns}) SELECT ${columns} FROM ${LIVE}.${quoted(table)}`);
    }
  })();
}

/** What the live store holds that the rebuild does not. */
function leftBehind(db: Database, known: ReadonlySet<string>, live: readonly string[]): Pick<FixSchemaResult, 'leftTables' | 'leftColumns'> {
  const leftTables = live
    .filter((table) => !known.has(table))
    .map((table) => ({ table, rows: count(db, `SELECT count(*) AS n FROM ${LIVE}.${quoted(table)}`) }));
  const leftColumns = live
    .filter((table) => known.has(table))
    .flatMap((table) => {
      const kept = new Set(columnNames(db, 'main', table));
      return columnNames(db, LIVE, table)
        .filter((column) => !kept.has(column))
        .map((column) => ({
          table,
          column,
          values: count(db, `SELECT count(*) AS n FROM ${LIVE}.${quoted(table)} WHERE ${quoted(column)} IS NOT NULL`),
        }));
    });
  return { leftTables, leftColumns };
}

/** Refuses a rebuild `planSchema` would not let this rafa use as it is. */
export function refuseUnusable(db: Database, parallelPath: string, migrations: readonly SqliteMigration[]): void {
  const plan = planSchema(readStoreSchema(db, parallelPath), sqliteCatalogue(migrations), 'write', 'open');
  if (plan.verdict === 'refuse') throw new RebuildRefusal(`the rebuilt store is refused as ${plan.reason}: ${plan.message}`);
  const needs = writeNames(plan);
  if (needs.length > 0) throw new RebuildRefusal(`the rebuilt store still needs ${needs.join(', ')}`);
}

/** How the rebuild's log rows are stamped. */
interface RebuildStamp {
  readonly appliedBy: string;
  readonly now: () => Date;
}

/** Builds and checks the parallel file, answering what it copied and left behind. */
function buildParallel(
  path: string,
  parallelPath: string,
  migrations: readonly SqliteMigration[],
  stamp: RebuildStamp,
): Pick<FixSchemaResult, 'kept' | 'leftTables' | 'leftColumns'> {
  const db = new Database(parallelPath, { create: true, readwrite: true });
  try {
    bringForward(db, parallelPath, 'write', 'open', { migrations, ...stamp, builtAside: true });
    db.run(`ATTACH DATABASE ? AS ${LIVE}`, [path]);
    const known = tableNames(db, 'main');
    const live = tableNames(db, LIVE);
    refuseRemoved(db, known, new Set(live));
    copyKnown(db, known);
    const kept = checkedCounts(db, known, LIVE);
    const left = leftBehind(db, new Set(known), live);
    db.run(`DETACH DATABASE ${LIVE}`);
    refuseCorrupt(db);
    refuseUnusable(db, parallelPath, migrations);
    return { kept, ...left };
  } finally {
    db.close();
  }
}

/** The parallel file a rebuild is made in, and the backup the original goes to. */
function asidePaths(path: string, version: number, stamp: string): { parallelPath: string; backupPath: string } {
  return { parallelPath: `${path}.fix-${stamp}`, backupPath: `${path}.v${String(version)}-${stamp}.bak` };
}

/** Whether a rebuild repairs `reason`. */
function isRepairable(reason: RefusalReason): reason is RepairReason {
  return (REPAIRABLE_REASONS as readonly RefusalReason[]).includes(reason);
}

/** Refuses the swap from a development build; see the module note. */
function refuseDevelopmentSwap(path: string, reason: RepairReason, identity: RuntimeIdentity): void {
  if (identity.kind !== 'development') return;
  throw new RebuildRefusal(
    `${path} needs a rebuild (${reason}), and this rafa is a development build (${identity.checkout}), whose`
      + ' migrations may be a branch\'s; a development build never swaps a rebuild in. Nothing was changed, and'
      + ' --dry-run runs from here. Run the swap from an installed rafa. Next safe step: rafa effort fix-schema',
  );
}

/** Repairs the store at `options.path`. See the module note. */
export function fixStoreSchema(options: FixSchemaOptions): FixSchemaResult {
  const { path, dryRun, stamp } = options;
  guardTestProcess(path);
  const migrations = options.migrations ?? SQLITE_MIGRATIONS;
  const identity = options.identity ?? readRuntimeIdentity();
  const appliedBy = appliedByName(identity);
  const known = migrations.map(({ id }) => id);
  const nothing = { known, appliedBy, pending: [], kept: [], leftTables: [], leftColumns: [], backupPath: null };
  if (!existsSync(path)) {
    return { path, status: 'missing', storeVersion: null, logged: false, reason: null, refusal: null, unknown: [], ...nothing };
  }

  refuseInFlight(path);
  const store = readOnlySchema(path);
  const knownIds = new Set(known);
  const found = {
    path,
    storeVersion: store.userVersion,
    logged: store.log !== null,
    unknown: (store.log ?? []).filter(({ id }) => !knownIds.has(id)),
  };
  const plan = planSchema(store, sqliteCatalogue(migrations), 'write', 'open');
  if (plan.verdict === 'use') {
    const pending = writeNames(plan);
    const status = pending.length === 0
      ? 'current'
      : 'behind';
    return { ...found, ...nothing, status, reason: null, refusal: null, pending };
  }
  if (!isRepairable(plan.reason)) {
    throw new RebuildRefusal(`a rebuild at this rafa's migrations does not repair ${plan.reason}. ${plan.message}`);
  }
  if (!dryRun) refuseDevelopmentSwap(path, plan.reason, identity);

  const { built, backupPath } = rebuildAside({
    path,
    ...asidePaths(path, store.userVersion, stamp),
    dryRun,
    build: (parallelPath) => buildParallel(path, parallelPath, migrations, {
      appliedBy,
      now: options.now ?? ((): Date => new Date()),
    }),
  });
  const status = dryRun
    ? 'would-rebuild'
    : 'rebuilt';
  const refusal = withoutWayOut(plan.message, plan.nextStep);
  return { ...found, ...nothing, status, reason: plan.reason, refusal, ...built, backupPath };
}

/** A plan's refusal text with its `Next safe step:` ending taken off. */
function withoutWayOut(message: string, nextStep: string): string {
  const ending = ` Next safe step: ${nextStep}`;
  return message.endsWith(ending)
    ? message.slice(0, -ending.length)
    : message;
}
