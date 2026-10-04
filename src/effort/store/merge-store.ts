/**
 * The merge `rafa effort merge` runs: another device's store file
 * unioned into this store, built beside it, checked, and swapped in
 * behind a whole-file backup.
 *
 * ## What it refuses
 *
 * Every refusal comes before anything is built or copied, so both files
 * keep their bytes. In the order they are asked:
 *
 *   - A project whose `store` is `ndjson`: its sessions and commits are
 *     NDJSON, which carries no origin, so a merge needs the SQLite
 *     backend. The text names {@link MOVE_TO_SQLITE}. The backend is the
 *     caller's resolved config, never read here.
 *   - A store file absent on either side, and a journal or write-ahead
 *     log beside either one (`refuseInFlight`, `rebuild-aside.ts`).
 *   - A damaged other file: one SQLite cannot open as a database, or
 *     whose `integrity_check` answers anything but `ok`. A plain file
 *     copy taken during a write holds a half-written page; a copy made
 *     by `rafa effort copy` is consistent.
 *   - A store on either side that `planSchema` (`schema-plan.ts`) will
 *     not let this rafa write, with the plan's own text.
 *   - Another project's store: both stores name a project, and their
 *     root commits differ. The project of each is the one its
 *     `store_meta` row records; this store, when it has not been
 *     minted, takes the one git reads in its directory. A side that
 *     names none, such as a store only an older runtime wrote, cannot
 *     be told apart and is merged, and the `merges` row then names no
 *     other store.
 *
 * Two more are asked only of a swap, since a dry run reads the stores
 * and deletes what it builds, as `effort migrate`'s is:
 *
 *   - From a development build, over a store it does not own, with
 *     `refuseUnownedDevelopmentWrite`'s text (`development-build.ts`).
 *     What it names is what the swap records: the migrations this store
 *     has pending, then `merges`, the table the merge writes its row to.
 *   - While a loop record under the store's project reads `running` or
 *     `paused` with its pid alive (`liveLoop`, `migrate.ts`): renaming
 *     the store under a loop loses what the loop writes. The record
 *     whose session id `sessionId` names is passed: it is the run
 *     pulling at the end of its own task, between task sessions, so
 *     nothing of its own writes into the store under the swap. It is
 *     matched by session id, never by pid, so a second live record
 *     sharing that pid is still refused.
 *
 * ## The other store
 *
 * It is only ever read. It is opened `{ readonly: true }` when it holds
 * every migration this rafa knows. When it lacks some, it is written
 * out with `VACUUM INTO` (`vacuumInto`, `copy.ts`) to a directory of
 * its own under the temporary directory, that copy is brought forward
 * (`bringForward`, `builtAside`), and the copy is what the union reads;
 * the directory is removed once the merge ends, refused or not. A store
 * logging a migration this rafa does not know adds columns the union
 * refuses (`UnionSchemaMismatch`, `merge-union.ts`), and that refusal
 * is passed on.
 *
 * ## The build
 *
 * The parallel file, `<store>.merge-<stamp>`, is this store written out
 * by `vacuumInto` and brought forward there with `builtAside`, each new
 * log row naming this runtime (`appliedByName`). In one transaction on
 * it, the union (`unionStores`) inserts every unmatched row of each
 * merged table, the conflict step (`settleMatches`,
 * `merge-conflicts.ts`) settles each matched pair and records in
 * `merge_conflicts` what no rule settles, the commit gaps of each commit
 * brought in and of the commit after it are recomputed
 * (`recomputeCommitGaps`, `merge-commit-gaps.ts`), and one `merges` row
 * records the merge: its id, the other store's id, when, and the rows
 * added, skipped and in conflict over every merged table.
 *
 * The live store is then attached, and every table both files hold,
 * the log apart, must hold its live row count plus the rows the merge
 * added to it (`checkedCounts`): the rows added to each merged table,
 * one row in `merges`, and one in `merge_conflicts` per conflict. A
 * merged table's fills and gap rewrites change no count. SQLite's
 * `integrity_check` must answer `ok`, and `planSchema` must find the
 * file one this rafa uses as it is (`refuseUnusable`, `fix-schema.ts`).
 *
 * Under `dryRun` the parallel file is then deleted, and the answer says
 * what the merge would have done. Otherwise the parallel file is
 * swapped in (`swapIn`, `rebuild-aside.ts`): this store is written out
 * to `<store>.before-merge-<stamp>.bak` with `VACUUM INTO`, its identity
 * is carried onto the parallel file (`carryStoreIdentity`,
 * `store-meta.ts`), and the parallel file is renamed into its place.
 *
 * ## The store keeps its id
 *
 * `store_meta` is `local` in `MERGE_RULES`, so the parallel file holds
 * this store's own row and never the other store's. The carry gives it
 * the device, inode and generation the rename brings to this store's
 * path, so the merged store keeps this store's origin, and the rows it
 * writes next carry the same store id. A store whose next write would
 * have minted anyway, being a copy already, is carried nothing and
 * mints on its first write after the swap.
 *
 * The backup holds every row the original held, and restoring it is
 * renaming it back. It is a copy with an inode of its own, so once
 * renamed back over the store its first writing open mints a new
 * origin, as any restored copy must (`store-identity.ts`).
 *
 * ## What the counts leave out
 *
 * An unmatched incoming row the union could not insert, because it
 * collides with a row here on another UNIQUE key, is answered per table
 * as `collided` and kept in the other file only: it is neither added,
 * skipped nor recorded, since `merge_conflicts` names a local row and
 * the union does not know which one it collided with.
 *
 * It opens both stores itself rather than through `withSqliteStore`, so
 * it runs the test guard (`guardTestProcess`, `location.ts`) itself,
 * over both paths, before it reads anything.
 */
import type { DevelopmentProbe } from './development-build.js';
import type { SqliteMigration } from './migrations.js';
import type { SchemaUse } from './schema-plan.js';
import type { ProjectIdentity } from './store-identity.js';
import type { StoreBackend } from '../../config.js';

import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Database, SQLiteError } from 'bun:sqlite';

import { readRuntimeIdentity } from '../../runtime/identity.js';

import { bringForward, writeNames } from './bring-forward.js';
import { vacuumInto } from './copy.js';
import { appliedByName, refuseUnownedDevelopmentWrite } from './development-build.js';
import { readOnlySchema, refuseUnusable, tableNames } from './fix-schema.js';
import { guardTestProcess } from './location.js';
import { recomputeCommitGaps } from './merge-commit-gaps.js';
import { settleMatches } from './merge-conflicts.js';
import { unionStores } from './merge-union.js';
import { liveLoop } from './migrate.js';
import { SQLITE_MIGRATIONS } from './migrations.js';
import { checkedCounts, rebuildAside, RebuildRefusal, refuseCorrupt, refuseInFlight } from './rebuild-aside.js';
import { planSchema, sqliteCatalogue } from './schema-plan.js';
import { readProjectIdentity } from './store-identity.js';
import { readStoreMeta } from './store-meta.js';

/** The command that moves an NDJSON project's rows into the SQLite store. */
export const MOVE_TO_SQLITE = 'rafa effort move --to=sqlite';

/** Why a merge was refused before anything was built. */
export type MergeRefusalReason =
  /** The project's `store` is `ndjson`. */
  | 'ndjson'
  /** A store file is absent. */
  | 'missing'
  /** The other file is no SQLite database, or fails `integrity_check`. */
  | 'damaged'
  /** A store's schema is one this rafa will not write. */
  | 'schema'
  /** The two stores name different projects. */
  | 'other-project'
  /** A loop records to this store. */
  | 'live-loop';

/** A merge refused before either store was changed. */
export class MergeRefusal extends RebuildRefusal {
  readonly reason: MergeRefusalReason;

  constructor(reason: MergeRefusalReason, message: string) {
    super(message);
    this.name = 'MergeRefusal';
    this.reason = reason;
  }
}

/** What the run did. */
export type MergeStatus =
  /** Under `dryRun`: the merged store was built, checked and deleted. */
  | 'would-merge'
  /** The merged store was swapped in and the original kept as a backup. */
  | 'merged';

/** What the merge did with one merged table's incoming rows. */
export interface TableMerge {
  readonly table: string;
  /** Rows inserted with a new local `seq`. */
  readonly added: number;
  /** Matched rows left with equal content, fills included. */
  readonly skipped: number;
  /** `merge_conflicts` rows recorded. */
  readonly inConflict: number;
  /** Set-once fields this store took from the other. */
  readonly filled: number;
  /** Unmatched rows another UNIQUE key refused; see the module note. */
  readonly collided: number;
}

/** The outcome of one run. */
export interface MergeResult {
  /** This store's file. */
  readonly path: string;
  /** The other store's file. */
  readonly otherPath: string;
  readonly status: MergeStatus;
  /** The `merges.id` the merge recorded. */
  readonly mergeId: string;
  /** The other store's id, or null when it was never minted. */
  readonly otherStore: string | null;
  /** What the other store's copy was brought forward through; empty when it was read as it is. */
  readonly otherBroughtForward: readonly string[];
  /** One entry per merged table, in `MERGE_RULES` order. */
  readonly tables: readonly TableMerge[];
  readonly rowsAdded: number;
  readonly rowsSkipped: number;
  readonly rowsInConflict: number;
  /** Commit rows whose gap was rewritten. */
  readonly gapsRewritten: number;
  /** Where the original went, for `merged` only. */
  readonly backupPath: string | null;
}

/** What one run is handed; the {@link DevelopmentProbe} fields say which build runs and which stores it owns. */
export interface MergeOptions extends DevelopmentProbe {
  /** This store's file. */
  readonly path: string;
  /** The other store's file, only ever read. */
  readonly otherPath: string;
  /** The project's resolved `store` backend. */
  readonly backend: StoreBackend;
  /** Build and check the merged store, then delete it instead of swapping it in. */
  readonly dryRun: boolean;
  /** Names the parallel and backup files, so two runs never collide. */
  readonly stamp: string;
  /** The catalogue both stores are brought to: this build's unless a test passes another. */
  readonly migrations?: readonly SqliteMigration[];
  /** The clock `merged_at` and new log rows read. */
  readonly now?: () => Date;
  /** A new merge id; `crypto.randomUUID` when absent. */
  readonly newMergeId?: () => string;
  /** The project of the repository holding `dir`, for an unminted store; `readProjectIdentity` when absent. */
  readonly readProject?: (dir: string) => ProjectIdentity;
  /**
   * The session id of the loop run merging, whose own live record the
   * live-loop guard passes; absent or null for a caller that is no run.
   */
  readonly sessionId?: string | null;
}

/** The name the attached live store is reached by. */
const LIVE = 'live';

/** The table the merge records itself in, which a development build's refusal names. */
const MERGES_TABLE = 'merges';

const INSERT_MERGE = `INSERT INTO merges (id, other_store, merged_at, rows_added, rows_skipped, rows_in_conflict)
  VALUES (?, ?, ?, ?, ?, ?)`;

/** The sentence every refusal ends with. */
const NOTHING_MERGED = 'Nothing was merged.';

/** How new log rows and the merge row are stamped. */
interface MergeStamp {
  readonly migrations: readonly SqliteMigration[];
  readonly appliedBy: string;
  readonly now: () => Date;
}

/** What the build answered. */
type Merged = Pick<MergeResult, 'tables' | 'rowsAdded' | 'rowsSkipped' | 'rowsInConflict' | 'gapsRewritten'>;

/** The other store as the union reads it. */
interface OtherStore {
  readonly db: Database;
  readonly broughtForward: readonly string[];
  /** Closes the handle and removes any copy. */
  readonly release: () => void;
}

/** Refuses a project whose effort rows are NDJSON. */
function refuseNdjson(backend: StoreBackend): void {
  if (backend !== 'ndjson') return;
  throw new MergeRefusal(
    'ndjson',
    `REFUSED — this project keeps its sessions and commits as NDJSON (store: ndjson), and a merge needs the SQLite store. ${NOTHING_MERGED}`
      + ` Next safe step: ${MOVE_TO_SQLITE}`,
  );
}

/** Refuses a store file that is not there. */
function refuseMissing(path: string, which: string): void {
  if (existsSync(path)) return;
  throw new MergeRefusal('missing', `REFUSED — ${which} ${path} is not there. ${NOTHING_MERGED}`);
}

/** Refuses a file SQLite cannot read as a database, or whose `integrity_check` is not `ok`. */
function refuseDamaged(path: string): void {
  let answers: readonly string[];
  try {
    const db = new Database(path, { readonly: true });
    try {
      answers = db.query<{ integrity_check: string }, []>('PRAGMA integrity_check').all()
        .map((row) => row.integrity_check);
    } finally {
      db.close();
    }
  } catch (error) {
    if (!(error instanceof SQLiteError)) throw error;
    throw new MergeRefusal('damaged', `REFUSED — ${path} cannot be read as a SQLite store (${error.message}). ${NOTHING_MERGED}`
      + ' Take a consistent copy on its device with rafa effort copy, and merge that.');
  }
  if (answers.length === 1 && answers[0] === 'ok') return;
  throw new MergeRefusal('damaged', `REFUSED — ${path} failed integrity_check: ${answers.join('; ')}. ${NOTHING_MERGED}`
    + ' Take a consistent copy on its device with rafa effort copy, and merge that.');
}

/** The plan for writing the store at `path`, or a refusal carrying the plan's text. */
function writablePlan(path: string, migrations: readonly SqliteMigration[]): SchemaUse {
  const plan = planSchema(readOnlySchema(path), sqliteCatalogue(migrations), 'write', 'open');
  if (plan.verdict === 'refuse') throw new MergeRefusal('schema', `REFUSED — ${path}: ${plan.message}`);
  return plan;
}

/** The `store_meta` row of the store at `path`, read-only, or null when it has none or no such table. */
function recordedMeta(path: string): ReturnType<typeof readStoreMeta> {
  const db = new Database(path, { readonly: true });
  try {
    const hasTable = db
      .query<{ n: number }, []>('SELECT count(*) AS n FROM sqlite_master WHERE type = \'table\' AND name = \'store_meta\'')
      .get()?.n === 1;
    return hasTable
      ? readStoreMeta(db)
      : null;
  } finally {
    db.close();
  }
}

/** Refuses two stores whose projects are both known and differ; answers the other store's id. */
function refuseOtherProject(options: MergeOptions): string | null {
  const other = recordedMeta(options.otherPath);
  const here = recordedMeta(options.path)?.projectRootCommit
    ?? (options.readProject ?? readProjectIdentity)(dirname(options.path)).rootCommit;
  const there = other?.projectRootCommit ?? null;
  if (here !== null && there !== null && here !== there) {
    throw new MergeRefusal(
      'other-project',
      `REFUSED — ${options.otherPath} is the effort store of another project (root commit ${there});`
        + ` this store's project has root commit ${here}. ${NOTHING_MERGED}`,
    );
  }
  return other?.storeId ?? null;
}

/** Refuses the swap while a live loop other than the caller's own run records to the store. */
function refuseLiveLoop(path: string, options: DevelopmentProbe, sessionId: string | null): void {
  const loop = liveLoop(path, options, NOTHING_MERGED, sessionId);
  if (loop === undefined) return;
  throw new MergeRefusal(
    'live-loop',
    `REFUSED — loop ${loop.sessionId} (pid ${String(loop.pid)}, plan ${loop.planStub ?? loop.plan}) is running on this store,`
      + ` and swapping the merged store in under it would lose what it writes. ${NOTHING_MERGED}`
      + ' Finish or stop that loop, then run it again.',
  );
}

/** The other store opened read-only, or a copy of it brought forward when it lacks migrations. */
function openOther(otherPath: string, plan: SchemaUse, stamp: MergeStamp): OtherStore {
  const needs = writeNames(plan);
  if (needs.length === 0) {
    const db = new Database(otherPath, { readonly: true });
    return { db, broughtForward: [], release: () => db.close() };
  }
  const dir = mkdtempSync(join(tmpdir(), 'rafa-merge-other-'));
  const release = (db?: Database): void => {
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  };
  try {
    const copyPath = join(dir, 'other.sqlite');
    vacuumInto(otherPath, copyPath);
    const db = new Database(copyPath, { readwrite: true });
    try {
      bringForward(db, copyPath, 'write', 'open', { ...stamp, builtAside: true });
    } catch (error) {
      release(db);
      throw error;
    }
    return { db, broughtForward: needs, release: () => release(db) };
  } catch (error) {
    release();
    throw error;
  }
}

/** Unions `other` into `db`, settles, recomputes gaps and records the merge, in one transaction. */
function mergeInto(db: Database, other: Database, mergeId: string, otherStore: string | null, mergedAt: string): Merged {
  return db.transaction((): Merged => {
    const unions = unionStores(db, other);
    const settlements = settleMatches(db, other, unions, { mergeId, recordedAt: mergedAt });
    const gaps = recomputeCommitGaps(db, unions.find(({ table }) => table === 'commits')?.added ?? []);
    const tables = unions.map((union, index): TableMerge => {
      const settled = settlements[index];
      return {
        table: union.table,
        added: union.added.length,
        skipped: settled?.skipped.length ?? 0,
        inConflict: settled?.conflicts.length ?? 0,
        filled: settled?.filled.length ?? 0,
        collided: union.collided.length,
      };
    });
    const sum = (field: 'added' | 'skipped' | 'inConflict'): number => tables.reduce((total, entry) => total + entry[field], 0);
    const totals = { rowsAdded: sum('added'), rowsSkipped: sum('skipped'), rowsInConflict: sum('inConflict') };
    db.query(INSERT_MERGE).run(mergeId, otherStore, mergedAt, totals.rowsAdded, totals.rowsSkipped, totals.rowsInConflict);
    return { tables, ...totals, gapsRewritten: gaps.length };
  })();
}

/** The rows the merge added to each table, by name. */
function addedRows(merged: Merged): Readonly<Record<string, number>> {
  return {
    ...Object.fromEntries(merged.tables.map(({ table, added }) => [table, added])),
    [MERGES_TABLE]: 1,
    merge_conflicts: merged.rowsInConflict,
  };
}

/** Builds and checks the merged store at `parallelPath`. */
function buildMerged(
  path: string,
  parallelPath: string,
  other: Database,
  merge: { readonly id: string; readonly otherStore: string | null; readonly stamp: MergeStamp },
): Merged {
  vacuumInto(path, parallelPath);
  const db = new Database(parallelPath, { readwrite: true });
  try {
    bringForward(db, parallelPath, 'write', 'open', { ...merge.stamp, builtAside: true });
    const merged = mergeInto(db, other, merge.id, merge.otherStore, merge.stamp.now().toISOString());
    db.run(`ATTACH DATABASE ? AS ${LIVE}`, [path]);
    const live = new Set(tableNames(db, LIVE));
    checkedCounts(db, tableNames(db, 'main').filter((table) => live.has(table)), LIVE, addedRows(merged));
    db.run(`DETACH DATABASE ${LIVE}`);
    refuseCorrupt(db);
    refuseUnusable(db, parallelPath, merge.stamp.migrations);
    return merged;
  } finally {
    db.close();
  }
}

/** Every refusal asked before anything is built; answers the two plans and the other store's id. */
function refuseUnmergeable(options: MergeOptions, migrations: readonly SqliteMigration[]): {
  readonly otherPlan: SchemaUse;
  readonly otherStore: string | null;
} {
  const { path, otherPath } = options;
  refuseNdjson(options.backend);
  refuseMissing(path, 'this store');
  refuseMissing(otherPath, 'the other store');
  refuseInFlight(path);
  refuseInFlight(otherPath);
  refuseDamaged(otherPath);
  const otherPlan = writablePlan(otherPath, migrations);
  const localPlan = writablePlan(path, migrations);
  const otherStore = refuseOtherProject(options);
  if (!options.dryRun) {
    refuseUnownedDevelopmentWrite(path, [...writeNames(localPlan), MERGES_TABLE], options);
    refuseLiveLoop(path, options, options.sessionId ?? null);
  }
  return { otherPlan, otherStore };
}

/** Merges the store at `options.otherPath` into the one at `options.path`. See the module note. */
export function mergeStore(options: MergeOptions): MergeResult {
  const { path, otherPath, dryRun, stamp } = options;
  guardTestProcess(path);
  guardTestProcess(otherPath);
  const migrations = options.migrations ?? SQLITE_MIGRATIONS;
  const { otherPlan, otherStore } = refuseUnmergeable(options, migrations);

  const mergeStamp: MergeStamp = {
    migrations,
    appliedBy: appliedByName(options.identity ?? readRuntimeIdentity()),
    now: options.now ?? ((): Date => new Date()),
  };
  const mergeId = (options.newMergeId ?? randomUUID)();
  const other = openOther(otherPath, otherPlan, mergeStamp);
  try {
    const { built, backupPath } = rebuildAside({
      path,
      parallelPath: `${path}.merge-${stamp}`,
      backupPath: `${path}.before-merge-${stamp}.bak`,
      dryRun,
      build: (parallelPath) => buildMerged(path, parallelPath, other.db, { id: mergeId, otherStore, stamp: mergeStamp }),
    });
    const status = dryRun
      ? 'would-merge'
      : 'merged';
    return { path, otherPath, status, mergeId, otherStore, otherBroughtForward: other.broughtForward, ...built, backupPath };
  } finally {
    other.release();
  }
}
