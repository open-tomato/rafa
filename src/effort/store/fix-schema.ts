/**
 * The repair `rafa effort fix-schema` runs: a SQLite store past the
 * version this rafa knows, rebuilt at that version beside the live file,
 * checked, and swapped in with the original kept as a backup.
 *
 * ## Why a store gets ahead of the rafa reading it
 *
 * A pre-log release refuses a store past the last version its history
 * holds, and every read and write it makes goes through that check. A
 * store gets there when newer code opens it: a branch's own code run
 * from its working tree against the project's store, while the loop
 * driving that branch is an installed runtime that predates it. From
 * then on the runtime refuses the store, and a task report the loop
 * collects is not stored. This rafa's own opens go through
 * `bringForward` (`bring-forward.ts`) instead, which refuses such a
 * store with no migration log and names this repair as the way out.
 *
 * ## The rebuild
 *
 * A parallel file, `<store>.fix-<stamp>`, is migrated with this rafa's
 * own history, so its layout is exactly the one this rafa writes. The
 * live store is attached, and every table the parallel file holds is
 * filled from the live table of the same name, over the columns the
 * parallel table has. Nothing needs to know what the newer migrations
 * did: a table or column this rafa does not know is simply not copied,
 * and it is reported as left behind with how many rows or values it
 * held. The rebuild is refused when the live store lacks a table or a
 * column this rafa knows, since a newer history that removed one is not
 * additive, and copying around it would lose what this rafa writes.
 *
 * The parallel file is checked before anything else happens: the row
 * count of every table copied must equal the live one, and SQLite's
 * `integrity_check` must answer `ok`. Under `dryRun` it is then deleted,
 * so a dry run can be repeated and leaves the directory as it found it.
 * Otherwise the live file is renamed to `<store>.v<version>-<stamp>.bak`
 * and the parallel file renamed into its place. The backup is the whole
 * original, left-behind data included, and restoring it is renaming it
 * back.
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
 * It opens the store itself rather than through `withSqliteStore`, so it
 * runs the test guard (`guardTestProcess`, `location.ts`) itself too,
 * before it reads or makes anything.
 */
import type { SqliteMigration } from './migrations.js';
import type { TableRows } from './rebuild-aside.js';

import { existsSync } from 'node:fs';

import { Database } from 'bun:sqlite';

import { guardTestProcess } from './location.js';
import {
  checkedCounts,
  count,
  quoted,
  rebuildAside,
  RebuildRefusal,
  refuseCorrupt,
  refuseInFlight,
} from './rebuild-aside.js';
import { migrateSchema, SQLITE_MIGRATIONS } from './sqlite.js';

/** What the repair found, and what it did about it. */
export type FixSchemaStatus =
  /** No store file: nothing to repair, and none is created. */
  | 'missing'
  /** At this rafa's version: nothing to repair. */
  | 'current'
  /** Behind it: the next ordinary open migrates it, so nothing to repair. */
  | 'behind'
  /** Past it, under `dryRun`: the rebuild was made, checked and deleted. */
  | 'would-rebuild'
  /** Past it: the rebuild was swapped in and the original kept as a backup. */
  | 'rebuilt';

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
  /** The live store's version, or null when there is no file. */
  readonly storeVersion: number | null;
  /** The version this rafa knows, and the one a rebuild is made at. */
  readonly knownVersion: number;
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
  /** The history to rebuild with: the store's own unless another is passed. */
  readonly migrations?: readonly SqliteMigration[];
}

/** A repair refused before the live store was changed: the build-aside steps' refusal. */
export { RebuildRefusal as SchemaFixRefusal } from './rebuild-aside.js';

/** The name the attached live store is reached by. */
const LIVE = 'live';

/** The user tables one attached schema holds, by name. */
function tableNames(db: Database, schema: string): string[] {
  return db
    .query<{ name: string }, []>(
      `SELECT name FROM ${schema}.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
    )
    .all()
    .map((row) => row.name);
}

/** A table's columns in one attached schema, in their declared order. */
function columnNames(db: Database, schema: string, table: string): string[] {
  return db
    .query<{ name: string }, [string, string]>('SELECT name FROM pragma_table_info(?, ?)')
    .all(table, schema)
    .map((row) => row.name);
}

/** The file's `user_version`, read without migrating it. */
function versionOf(path: string): number {
  const db = new Database(path, { readonly: true });
  try {
    return db.query<{ user_version: number }, []>('PRAGMA user_version').get()?.user_version ?? 0;
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

/** Builds and checks the parallel file, answering what it copied and left behind. */
function buildParallel(path: string, parallelPath: string, migrations: readonly SqliteMigration[]): Pick<FixSchemaResult, 'kept' | 'leftTables' | 'leftColumns'> {
  const db = new Database(parallelPath, { create: true, readwrite: true });
  try {
    migrateSchema(db, parallelPath, migrations);
    db.run(`ATTACH DATABASE ? AS ${LIVE}`, [path]);
    const known = tableNames(db, 'main');
    const live = tableNames(db, LIVE);
    refuseRemoved(db, known, new Set(live));
    copyKnown(db, known);
    const kept = checkedCounts(db, known, LIVE);
    const left = leftBehind(db, new Set(known), live);
    db.run(`DETACH DATABASE ${LIVE}`);
    refuseCorrupt(db);
    return { kept, ...left };
  } finally {
    db.close();
  }
}

/** The parallel file a rebuild is made in, and the backup the original goes to. */
function asidePaths(path: string, version: number, stamp: string): { parallelPath: string; backupPath: string } {
  return { parallelPath: `${path}.fix-${stamp}`, backupPath: `${path}.v${String(version)}-${stamp}.bak` };
}

/** Repairs the store at `options.path`. See the module note. */
export function fixStoreSchema(options: FixSchemaOptions): FixSchemaResult {
  const { path, dryRun, stamp } = options;
  guardTestProcess(path);
  const migrations = options.migrations ?? SQLITE_MIGRATIONS;
  const knownVersion = migrations.length;
  const nothing = { kept: [], leftTables: [], leftColumns: [], backupPath: null };
  if (!existsSync(path)) return { path, status: 'missing', storeVersion: null, knownVersion, ...nothing };

  refuseInFlight(path);
  const storeVersion = versionOf(path);
  if (storeVersion === knownVersion) return { path, status: 'current', storeVersion, knownVersion, ...nothing };
  if (storeVersion < knownVersion) return { path, status: 'behind', storeVersion, knownVersion, ...nothing };

  const { built, backupPath } = rebuildAside({
    path,
    ...asidePaths(path, storeVersion, stamp),
    dryRun,
    build: (parallelPath) => buildParallel(path, parallelPath, migrations),
  });
  const status = dryRun
    ? 'would-rebuild'
    : 'rebuilt';
  return { path, status, storeVersion, knownVersion, ...built, backupPath };
}
