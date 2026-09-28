/**
 * The build-aside convention: a SQLite store is never changed in place.
 * A new file is built beside it, checked, and swapped in behind a
 * whole-file backup, or deleted under a dry run.
 *
 * ## The steps
 *
 * 1. Refuse while a rollback journal or write-ahead log sits beside the
 *    store ({@link refuseInFlight}): either means a write in flight or
 *    interrupted, and a file built from the store then would miss it.
 * 2. Refuse when the parallel file or the backup is already there
 *    ({@link rebuildAside}), so two runs never overwrite each other.
 * 3. Build the parallel file. What goes into it is the caller's: the
 *    repair (`fix-schema.ts`) brings a fresh file to this rafa's
 *    migrations through the log-aware apply and copies the known tables
 *    into it. The caller checks it with {@link checkedCounts},
 *    every table's row count against the store's, and
 *    {@link refuseCorrupt}, SQLite's `integrity_check`.
 * 4. Any failure while building removes the parallel file and its
 *    journal, and leaves the store untouched.
 * 5. Under a dry run the parallel file is then deleted, so the run can
 *    be repeated and leaves the directory as it found it. Otherwise the
 *    store is renamed to the backup and the parallel file renamed into
 *    its place ({@link swapIn}); a failed second rename puts the store
 *    back. The backup is the whole original, and restoring it is
 *    renaming it back.
 *
 * The caller names both files, so each command keeps its own spelling
 * of them beside the store. The steps work over a handle the caller
 * opened, and open no store themselves.
 */
import type { Database } from 'bun:sqlite';

import { existsSync, renameSync, rmSync } from 'node:fs';

/** A build-aside step refused before the live store was changed. */
export class RebuildRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RebuildRefusal';
  }
}

/** A table with the rows it holds. */
export interface TableRows {
  readonly table: string;
  readonly rows: number;
}

/** A name quoted as an SQL identifier. */
export function quoted(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/** One count query's answer. */
export function count(db: Database, sql: string): number {
  return db.query<{ n: number }, []>(sql).get()?.n ?? 0;
}

/** Refuses while a journal or log beside `path` says a write is in flight or was interrupted. */
export function refuseInFlight(path: string): void {
  for (const suffix of ['-journal', '-wal']) {
    if (existsSync(`${path}${suffix}`)) {
      throw new RebuildRefusal(
        `${path}${suffix} is there, so a write is in flight or was interrupted; stop whatever uses the store`
          + ' and open it once with rafa before repairing it',
      );
    }
  }
}

/**
 * Every table in `tables` with its rows in `main`, refusing one whose
 * count differs from the same table in the attached `original` schema.
 */
export function checkedCounts(db: Database, tables: readonly string[], original: string): TableRows[] {
  return tables.map((table) => {
    const rows = count(db, `SELECT count(*) AS n FROM main.${quoted(table)}`);
    const originalRows = count(db, `SELECT count(*) AS n FROM ${original}.${quoted(table)}`);
    if (rows !== originalRows) {
      throw new RebuildRefusal(`the rebuilt ${table} holds ${String(rows)} rows, the store ${String(originalRows)}`);
    }
    return { table, rows };
  });
}

/** Refuses a rebuilt file SQLite does not vouch for. */
export function refuseCorrupt(db: Database): void {
  const answer = db.query<{ integrity_check: string }, []>('PRAGMA main.integrity_check').get()?.integrity_check;
  if (answer !== 'ok') throw new RebuildRefusal(`the rebuilt store failed integrity_check: ${answer ?? 'no answer'}`);
}

/** Deletes the parallel file and any journal it left. */
function removeParallel(parallelPath: string): void {
  rmSync(parallelPath, { force: true });
  rmSync(`${parallelPath}-journal`, { force: true });
}

/** Renames the original to its backup and the rebuild into its place, undoing the first on a failed second. */
function swapIn(path: string, parallelPath: string, backupPath: string): void {
  renameSync(path, backupPath);
  try {
    renameSync(parallelPath, path);
  } catch (error) {
    renameSync(backupPath, path);
    throw error;
  }
}

/** Refuses when any of `paths` is already there. */
function refuseTaken(paths: readonly string[]): void {
  for (const taken of paths) {
    if (existsSync(taken)) throw new RebuildRefusal(`${taken} is already there; move it aside or pass another stamp`);
  }
}

/** What one build-aside run is handed. */
export interface RebuildAsideOptions<Built> {
  /** The live store's file. */
  readonly path: string;
  /** The file built beside it. */
  readonly parallelPath: string;
  /** Where the original goes when the rebuild is swapped in. */
  readonly backupPath: string;
  /** Build and check, then delete the parallel file instead of swapping it in. */
  readonly dryRun: boolean;
  /** Builds and checks the parallel file, throwing to refuse it. */
  readonly build: (parallelPath: string) => Built;
}

/** What the build answered, and where the original went: null under a dry run. */
export interface RebuildAsideResult<Built> {
  readonly built: Built;
  readonly backupPath: string | null;
}

/** Runs the build-aside steps around `options.build`. See the module note. */
export function rebuildAside<Built>(options: RebuildAsideOptions<Built>): RebuildAsideResult<Built> {
  const { path, parallelPath, backupPath, dryRun, build } = options;
  refuseInFlight(path);
  refuseTaken([parallelPath, backupPath]);
  let built: Built;
  try {
    built = build(parallelPath);
  } catch (error) {
    removeParallel(parallelPath);
    throw error;
  }
  if (dryRun) {
    removeParallel(parallelPath);
    return { built, backupPath: null };
  }
  swapIn(path, parallelPath, backupPath);
  return { built, backupPath };
}
