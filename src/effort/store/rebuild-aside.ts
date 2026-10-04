/**
 * The build-aside convention: a SQLite store is never changed in place.
 * A new file is built beside it, checked, and swapped in behind a
 * backup of the whole store, or deleted under a dry run.
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
 *    into it, and the forward move (`migrate.ts`) writes the store out
 *    with `VACUUM INTO` and applies its pending migrations there, and
 *    the merge (`merge-store.ts`) writes the store out the same way and
 *    unions another store's rows into it. The caller checks it with
 *    {@link checkedCounts}, every table's row count against the
 *    store's plus the rows the caller says it added, and
 *    {@link refuseCorrupt}, SQLite's `integrity_check`.
 * 4. Any failure while building removes the parallel file and its
 *    journal, and leaves the store untouched.
 * 5. Under a dry run the parallel file is then deleted, so the run can
 *    be repeated and leaves the directory as it found it. Otherwise the
 *    parallel file is swapped in ({@link swapIn}) in three steps:
 *    a. The store is written out to the backup with `VACUUM INTO` on a
 *       read-only connection (`vacuumInto`, `copy.ts`), and the backup
 *       is flushed with `fsync`, since SQLite's documentation says
 *       `VACUUM INTO` does not sync the file it writes.
 *    b. The store's identity is carried onto the parallel file
 *       (`carryStoreIdentity`, `store-meta.ts`): when a write to the
 *       live store would keep its origin, the parallel file's row is
 *       given the parallel file's own device and inode and the
 *       generation the live side record holds. Otherwise nothing is
 *       written, and the swapped-in store mints on its next write.
 *    c. The parallel file is renamed over the store, which replaces it
 *       in one step.
 *
 * ## A failed swap
 *
 * The store is only read until the rename, and a rename that fails
 * replaces nothing, so a failure at any of the three steps leaves the
 * store as it was. The swap then deletes nothing: it throws a
 * {@link SwapFailure} naming the step, the rebuilt file and the backup,
 * and leaves both beside the store. After a failed backup the backup
 * may be partial or absent; after a failed carry or rename it holds the
 * whole store. A run with another stamp names other files, so it never
 * overwrites either.
 *
 * ## The backup is a copy, and takes a new origin
 *
 * The backup holds every row the store held, with its schema and
 * `user_version`, but it is a new file: its bytes need not equal the
 * original's, and it has an inode of its own, since it was written while
 * the original still existed. Its `store_meta` row still names the
 * original's inode, so a backup renamed back over the store mints a new
 * origin on its next writing open, as any restored copy must
 * (`store-identity.ts`). The swapped-in file keeps the store's origin,
 * since the carry recorded the inode the rename brings to the store's
 * path and the generation its side record holds.
 *
 * The caller names both files, so each command keeps its own spelling
 * of them beside the store. The checks work over a handle the caller
 * opened; the swap opens the store read-only for the backup and the
 * parallel file for the carry.
 */
import type { Database } from 'bun:sqlite';

import { closeSync, existsSync, fsyncSync, openSync, renameSync, rmSync } from 'node:fs';

import { vacuumInto } from './copy.js';
import { carryStoreIdentity } from './store-meta.js';

/** A build-aside step refused before the live store was changed. */
export class RebuildRefusal extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
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
 * count differs from the same table in the attached `original` schema
 * plus the rows `added` names for it, none for a table it does not name.
 * A repair or a migration adds none; a merge names what it inserted.
 */
export function checkedCounts(
  db: Database,
  tables: readonly string[],
  original: string,
  added: Readonly<Record<string, number>> = {},
): TableRows[] {
  return tables.map((table) => {
    const rows = count(db, `SELECT count(*) AS n FROM main.${quoted(table)}`);
    const originalRows = count(db, `SELECT count(*) AS n FROM ${original}.${quoted(table)}`);
    const addedRows = added[table] ?? 0;
    if (rows !== originalRows + addedRows) {
      const plus = addedRows === 0
        ? ''
        : ` plus ${String(addedRows)} added`;
      throw new RebuildRefusal(`the rebuilt ${table} holds ${String(rows)} rows, the store ${String(originalRows)}${plus}`);
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

/** A step of {@link swapIn}, in the order it runs them. */
export type SwapStep = 'backup' | 'carry' | 'rename';

/** The files one swap works with. */
interface SwapFiles {
  readonly path: string;
  readonly parallelPath: string;
  readonly backupPath: string;
}

/** What each failed step says it was doing, and what it left of the backup. */
const STEP_TEXT: Readonly<Record<SwapStep, (files: SwapFiles) => { doing: string; backup: string }>> = {
  backup: ({ path, backupPath }) => ({
    doing: `writing ${path} out to the backup ${backupPath}`,
    backup: `any part of the backup written at ${backupPath}`,
  }),
  carry: ({ path, parallelPath, backupPath }) => ({
    doing: `carrying the store id of ${path} onto ${parallelPath}`,
    backup: `the whole backup at ${backupPath}`,
  }),
  rename: ({ path, parallelPath, backupPath }) => ({
    doing: `renaming ${parallelPath} over ${path}`,
    backup: `the whole backup at ${backupPath}`,
  }),
};

/**
 * A swap that failed before the rename replaced the store: the store is
 * unchanged, and the rebuilt file and whatever the backup step wrote
 * are left beside it. The failure the step threw is the `cause`.
 */
export class SwapFailure extends RebuildRefusal {
  readonly step: SwapStep;
  readonly parallelPath: string;
  readonly backupPath: string;

  constructor(step: SwapStep, files: SwapFiles, cause: unknown) {
    const { doing, backup } = STEP_TEXT[step](files);
    const reason = cause instanceof Error
      ? cause.message
      : String(cause);
    super(
      `${doing} failed (${reason}), so ${files.path} was not replaced and is unchanged.`
        + ` The rebuilt store is left at ${files.parallelPath}, and ${backup}.`,
      { cause },
    );
    this.name = 'SwapFailure';
    this.step = step;
    this.parallelPath = files.parallelPath;
    this.backupPath = files.backupPath;
  }
}

/** Writes the store at `path` out to `backupPath` as one snapshot, and flushes it to disk. */
function writeBackup(path: string, backupPath: string): void {
  vacuumInto(path, backupPath);
  const backup = openSync(backupPath, 'r');
  try {
    fsyncSync(backup);
  } finally {
    closeSync(backup);
  }
}

/** The three steps of a swap, which {@link swapIn} runs in this order. */
export interface SwapSteps {
  /** Writes the store at `path` out to `backupPath`. */
  readonly backup: (path: string, backupPath: string) => void;
  /** Carries the identity of the store at `path` onto the file at `parallelPath`. */
  readonly carry: (path: string, parallelPath: string) => unknown;
  /** Renames `parallelPath` over `path`. */
  readonly rename: (parallelPath: string, path: string) => void;
}

/** The steps a swap runs when the caller replaces none. */
const SWAP_STEPS: SwapSteps = {
  backup: writeBackup,
  carry: (path, parallelPath) => carryStoreIdentity(path, parallelPath),
  rename: renameSync,
};

/** Runs one step of a swap, throwing its failure as a {@link SwapFailure}. */
function runStep(step: SwapStep, files: SwapFiles, act: () => unknown): void {
  try {
    act();
  } catch (error) {
    throw new SwapFailure(step, files, error);
  }
}

/**
 * Swaps the parallel file in over the store at `path`: writes the
 * backup, carries the store's identity, and renames the parallel file
 * over the store. A failed step throws a {@link SwapFailure} and leaves
 * the store unchanged, and the backup and the parallel file where they
 * are. `steps` replaces any of the three, so a test can fail one. See
 * the module note.
 */
export function swapIn(path: string, parallelPath: string, backupPath: string, steps: Partial<SwapSteps> = {}): void {
  const { backup, carry, rename } = { ...SWAP_STEPS, ...steps };
  const files: SwapFiles = { path, parallelPath, backupPath };
  runStep('backup', files, () => backup(path, backupPath));
  runStep('carry', files, () => carry(path, parallelPath));
  runStep('rename', files, () => rename(parallelPath, path));
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
  /** Where the backup of the store is written when the rebuild is swapped in. */
  readonly backupPath: string;
  /** Build and check, then delete the parallel file instead of swapping it in. */
  readonly dryRun: boolean;
  /** Builds and checks the parallel file, throwing to refuse it. */
  readonly build: (parallelPath: string) => Built;
}

/** What the build answered, and where the backup was written: null under a dry run. */
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
