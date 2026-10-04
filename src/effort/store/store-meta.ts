/**
 * The store's own identity row: reading what `store_meta` records,
 * minting a new origin into it on a writing open that needs one, and
 * rotating the store's generation on every writing open and on every
 * rebuild that keeps the store's origin.
 *
 * ## What a writing open writes
 *
 * `withSqliteStore` (`sqlite.ts`) calls {@link settleStoreIdentity}
 * after `bringForward`, so the table and its `generation` column exist,
 * and before any caller reads or writes. `decideStoreIdentity`
 * (`store-identity.ts`) makes the decision: a `read` open answers
 * `none` and this module neither reads the row, observes the file nor
 * touches the side record, so a read writes nothing. A `write` open
 * reads the row, observes the host, the real path, the file's device
 * and inode and the side record's generation, and mints when the row is
 * absent, any of the three facts moved, or the row holds a generation
 * the side record does not. A row's generation is read as NULL when its
 * store has no `generation` column yet, and a NULL one is judged by the
 * three facts alone.
 *
 * Every writing open then takes the write lock with `BEGIN IMMEDIATE`,
 * reads the row and decides again under it, since another process may
 * have minted or rotated the same file while this one waited, and
 * writes a new random generation (`newGeneration`, a UUID) in that
 * transaction: on a keep, into `store_meta.generation`; on a mint, into
 * the new row (`id = 1`) with the new origin. Either way it then writes
 * the same generation to the side record (`store-generation.ts`),
 * `<real path of the store file>.generation` beside it, and commits. So
 * a store written without a generation keeps its origin on its first
 * write and holds one after it, two processes that open one unminted
 * store at once record one origin, and a copy of the file, which
 * carries the row and leaves the side record behind, mints on its first
 * write once the original has been written since the copy was taken.
 *
 * The row is written first and the side record second, both before the
 * commit, because a writer that waits for the lock decides only once it
 * holds it and so always sees the two agree. A side record that fails
 * to write throws and rolls the row back. A crash after the side
 * record's rename and before the commit leaves the side record one
 * rotation ahead of the row; the next writing open mints once, which is
 * safe, and keeps on the write after. A side record restored from
 * before the last write is one rotation behind and mints the same way.
 *
 * What the generation does not catch: a restore of the store's whole
 * directory, the store file and its side record together, brings back a
 * row and a side record that agree. When the file comes back at its old
 * inode, as a `cp` over the existing file writes it, all three facts
 * match as well and nothing mints; the merge's collision check is what
 * catches that copy afterwards.
 *
 * ## The project a mint records
 *
 * `store_meta.project_root_commit` is `NOT NULL`. The project is read
 * through git in the store file's directory (`readProjectIdentity`), so
 * `<root>/.rafa/effort/` and a copy under `<root>/.rafa/scratch/` both
 * name the project they sit in. When git finds no root commit there, a
 * mint takes the project the row already records, since a copy moved
 * outside its checkout is still that project's store. When neither
 * names one, as for a store under `tmpdir()` outside any repository
 * with commits, nothing is written and the outcome is `no-project`: the
 * store stays unminted, no generation is written to the row or the side
 * record, and the next writing open asks again. That costs the git
 * reads on each such open and loses no origin, since an unminted store
 * stamps none. Git is only asked on a mint, never on a write that keeps
 * the origin, and before the lock is taken: under it, git is asked only
 * for a store that came due a mint while this open waited.
 *
 * ## Device and inode as SQLite integers
 *
 * Both are unsigned 64-bit values, and SQLite's INTEGER is signed.
 * Measured with Bun 1.4.2: binding `2n ** 63n` raises nothing and
 * stores `-9223372036854775808`, and a plain read would answer a
 * rounded number. So {@link toStoredInteger} writes the two's
 * complement explicitly, the row is read through `CAST(… AS TEXT)`,
 * and {@link fromStoredInteger} turns it back unsigned. Every value
 * below 2^63 is written and read as itself.
 *
 * ## Carrying the identity onto a file that replaces the store
 *
 * A rebuild beside the store (`rebuild-aside.ts`) builds a parallel file
 * that holds the store's own `store_meta` row, since `store_meta` is
 * `local` in `MERGE_RULES`, and then renames it over the store. The
 * renamed file has the store's path and host and the parallel file's
 * inode, so its next writing open would mint although it is the same
 * store. {@link carryStoreIdentity} runs before that rename. It reads
 * the live file's row and asks `decideStoreIdentity` what a write to the
 * live file would do. Only on a keep does it write the parallel file's
 * own device and inode, and a new generation (`newGeneration`), into the
 * parallel file's row, and it answers that generation in `carried`.
 * `swapIn` then writes it to the live store's side record immediately
 * before the rename. After the rename the parallel file sits at the live
 * path beside that side record, so all three facts and the generation
 * agree and the next writing open keeps the origin.
 *
 * The generation rotates on the carry, rather than staying the one the
 * live side record held, so that nothing the rebuild leaves behind
 * matches the side record afterwards. The backup and the replaced live
 * file both hold the old generation in their rows: either renamed back
 * over the store mints on its first write, even when it lands on an
 * inode number the host reused. A rename that fails after the side
 * record was written leaves the live file holding the old generation
 * beside the new one, so it mints once on its next write, the safe
 * side, and keeps on the write after. A parallel file whose
 * `store_meta` has no `generation` column, as for a store written
 * before `store-meta-generation`, is given its device and inode only;
 * `carried` then holds a null generation and nothing is written to the
 * side record, and the renamed file is judged by the three facts alone.
 *
 * Every other answer writes nothing, so the renamed file mints on its
 * next write, which is the safe side. That covers a live file with no
 * `store_meta` table or no row (an unminted store has no origin to
 * carry), a live file that would mint itself (another host, path,
 * device or inode, or a row generation its side record does not hold),
 * and a parallel file whose row is not the live store's. A write to the
 * live store between the side record's write and the rename rotates the
 * side record past the generation carried, so the renamed file mints as
 * well. A write between the carry and the side record's write is
 * overwritten in the side record by the generation carried, so the
 * renamed file keeps the origin; the rows such a write adds were never
 * in the parallel file, as for any write after the rebuild began.
 */
import type { StoreAccess } from './schema-plan.js';
import type {
  MintReason,
  ProjectIdentity,
  RecordedIdentity,
  StoreFileFacts,
  StoreIdentityFacts,
} from './store-identity.js';

import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';

import { Database } from 'bun:sqlite';

import { writeStoreGeneration } from './store-generation.js';
import {
  decideStoreIdentity,
  observeStore,
  readHostId,
  readProjectIdentity,
  readStoreFileFacts,
} from './store-identity.js';

/** The width of the unsigned device and inode values. */
const STORED_INTEGER_BITS = 64;

/**
 * What a store open reads the machine and the clock through. Every
 * field falls back to the real one; tests pass the host id and the
 * project and never read this machine's.
 */
export interface StoreIdentitySeams {
  /** The host id. `readHostId` when absent. */
  readonly readHostId?: () => string;
  /** The project of the repository holding `dir`. `readProjectIdentity` when absent. */
  readonly readProject?: (dir: string) => ProjectIdentity;
  /** A new store id. `crypto.randomUUID` when absent. */
  readonly newStoreId?: () => string;
  /** A new generation. `crypto.randomUUID` when absent. */
  readonly newGeneration?: () => string;
  /** The time a mint records. `new Date()` when absent. */
  readonly now?: () => Date;
}

/** The whole `store_meta` row. */
export interface StoreMeta extends RecordedIdentity {
  /** The project's smallest root commit. */
  readonly projectRootCommit: string;
  /** Its normalised `origin` remote, or null when it had none. */
  readonly projectRemote: string | null;
  /** The device the file was on, unsigned. */
  readonly fileDev: bigint;
  /** The file's inode, unsigned. */
  readonly fileIno: bigint;
  /** When the origin was minted, as an ISO string. */
  readonly mintedAt: string;
}

/** What {@link settleStoreIdentity} did. */
export type IdentityOutcome =
  /** A read: nothing was read, observed or written. */
  | { readonly action: 'none' }
  /** A write to the store its origin was minted for: only a new generation written. */
  | { readonly action: 'keep'; readonly storeId: string }
  /** A write that recorded the new origin `storeId` and a new generation. */
  | { readonly action: 'mint'; readonly storeId: string; readonly reasons: readonly MintReason[] }
  /** A write that was due a mint and wrote nothing, knowing no project. */
  | { readonly action: 'no-project'; readonly reasons: readonly MintReason[] };

/** A project a mint can record: one whose root commit is known. */
interface KnownProject {
  readonly rootCommit: string;
  readonly remote: string | null;
}

/** The row as SQLite answers it, device and inode as decimal text. */
interface StoreMetaColumns {
  readonly store_id: string;
  readonly project_root_commit: string;
  readonly project_remote: string | null;
  readonly host_id: string;
  readonly store_path: string;
  readonly file_dev: string;
  readonly file_ino: string;
  readonly minted_at: string;
  readonly generation: string | null;
}

/** An unsigned 64-bit value as the signed INTEGER SQLite stores. */
export function toStoredInteger(value: bigint): bigint {
  return BigInt.asIntN(STORED_INTEGER_BITS, value);
}

/** The unsigned value {@link toStoredInteger} stored as `text`. */
export function fromStoredInteger(text: string): bigint {
  return BigInt.asUintN(STORED_INTEGER_BITS, BigInt(text));
}

/**
 * Whether `store_meta` has the `generation` column. A store a read open
 * or a read-only merge reads may predate `store-meta-generation`.
 */
function hasGenerationColumn(db: Database): boolean {
  return db.query<{ n: number }, []>(
    'SELECT count(*) AS n FROM pragma_table_info(\'store_meta\') WHERE name = \'generation\'',
  ).get()?.n === 1;
}

/**
 * The `store_meta` row of the store `db` holds, or null when it holds
 * none. The generation is null for a row whose store has no
 * `generation` column yet, as for one written before it.
 */
export function readStoreMeta(db: Database): StoreMeta | null {
  const generation = hasGenerationColumn(db)
    ? 'generation'
    : 'NULL AS generation';
  const row = db.query<StoreMetaColumns, []>(
    'SELECT store_id, project_root_commit, project_remote, host_id, store_path,'
      + ' CAST(file_dev AS TEXT) AS file_dev, CAST(file_ino AS TEXT) AS file_ino, minted_at,'
      + ` ${generation} FROM store_meta WHERE id = 1`,
  ).get();
  if (row === null) return null;
  return {
    storeId: row.store_id,
    projectRootCommit: row.project_root_commit,
    projectRemote: row.project_remote,
    hostId: row.host_id,
    storePath: row.store_path,
    fileDev: fromStoredInteger(row.file_dev),
    fileIno: fromStoredInteger(row.file_ino),
    mintedAt: row.minted_at,
    generation: row.generation,
  };
}

/**
 * The project a mint of the store at `storePath` records: what git
 * reads in its directory, or what `recorded` names when git finds no
 * root commit, or null when neither names one.
 */
function projectFor(
  storePath: string,
  recorded: StoreMeta | null,
  seams: StoreIdentitySeams,
): KnownProject | null {
  const read = (seams.readProject ?? readProjectIdentity)(dirname(storePath));
  if (read.rootCommit !== null) return { rootCommit: read.rootCommit, remote: read.remote };
  if (recorded === null) return null;
  return { rootCommit: recorded.projectRootCommit, remote: recorded.projectRemote };
}

/**
 * Replaces the store's one `store_meta` row with a new origin minted for
 * `facts`, holding `generation`.
 */
function writeStoreMeta(
  db: Database,
  facts: StoreIdentityFacts,
  project: KnownProject,
  generation: string,
  seams: StoreIdentitySeams,
): string {
  const storeId = (seams.newStoreId ?? randomUUID)();
  const mintedAt = (seams.now?.() ?? new Date()).toISOString();
  db.query(
    'INSERT OR REPLACE INTO store_meta (id, store_id, project_root_commit, project_remote,'
      + ' host_id, store_path, file_dev, file_ino, minted_at, generation) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    storeId,
    project.rootCommit,
    project.remote,
    facts.hostId,
    facts.storePath,
    toStoredInteger(facts.fileDev),
    toStoredInteger(facts.fileIno),
    mintedAt,
    generation,
  );
  return storeId;
}

/**
 * Decides under the write lock and writes what the decision says: a new
 * generation into the row and the side record on a keep, a new origin
 * with a new generation on a mint, nothing when a mint knows no project.
 * The project is the one read before the lock, or, for a store that came
 * due a mint only while this open waited, the one read now. The row is written before the side record and both before the commit,
 * so a side record that fails to write rolls the row back with it.
 */
function settleUnderLock(
  db: Database,
  observe: () => StoreIdentityFacts,
  prefetched: KnownProject | undefined,
  seams: StoreIdentitySeams,
): IdentityOutcome {
  const current = readStoreMeta(db);
  const facts = observe();
  const decision = decideStoreIdentity('write', current, () => facts);
  if (decision.action === 'none') return { action: 'none' };

  const generation = (seams.newGeneration ?? randomUUID)();
  if (decision.action === 'keep') {
    db.query('UPDATE store_meta SET generation = ? WHERE id = 1').run(generation);
    writeStoreGeneration(facts.storePath, generation);
    return { action: 'keep', storeId: decision.storeId };
  }

  const project = prefetched ?? projectFor(facts.storePath, current, seams);
  if (project === null) return { action: 'no-project', reasons: decision.reasons };
  const storeId = writeStoreMeta(db, facts, project, generation, seams);
  writeStoreGeneration(facts.storePath, generation);
  return { action: 'mint', storeId, reasons: decision.reasons };
}

/**
 * Settles the identity of the store at `path`, open as `db`, for an open
 * with `access`: nothing on a read; on a write, under the write lock,
 * the recorded origin kept for the same file or a new one minted for an
 * unminted store or a copy, and a new generation written to the row and
 * the side record either way. See the module note.
 */
export function settleStoreIdentity(
  db: Database,
  path: string,
  access: StoreAccess,
  seams: StoreIdentitySeams = {},
): IdentityOutcome {
  if (access === 'read') return { action: 'none' };

  const observe = (): StoreIdentityFacts => observeStore(path, seams.readHostId ?? readHostId);
  const recorded = readStoreMeta(db);
  const first = decideStoreIdentity(access, recorded, observe);
  const prefetched = first.action === 'mint'
    ? projectFor(first.facts.storePath, recorded, seams)
    : undefined;
  if (first.action === 'mint' && prefetched === null) return { action: 'no-project', reasons: first.reasons };

  const underLock = db.transaction((): IdentityOutcome => settleUnderLock(db, observe, prefetched ?? undefined, seams));
  return underLock.immediate();
}

/**
 * What {@link carryStoreIdentity} did. Every answer but `carried` left
 * the parallel file unwritten.
 */
export type CarryOutcome =
  /** The live file holds no `store_meta` table. */
  | { readonly action: 'no-table' }
  /** The live file's `store_meta` holds no row: an unminted store. */
  | { readonly action: 'no-row' }
  /** A write to the live file would mint, for `reasons`. */
  | { readonly action: 'mint'; readonly reasons: readonly MintReason[] }
  /** The parallel file holds no `store_meta` row of the live store's id. */
  | { readonly action: 'other-row' }
  /**
   * The parallel file's row now records its own device and inode and the
   * new `generation`, which the side record has yet to be given; null when
   * its `store_meta` has no `generation` column, so none was written.
   */
  | { readonly action: 'carried'; readonly storeId: string; readonly generation: string | null };

/** Whether `db` holds a `store_meta` table. */
function hasStoreMetaTable(db: Database): boolean {
  return db.query<{ n: number }, []>(
    'SELECT count(*) AS n FROM sqlite_master WHERE type = \'table\' AND name = \'store_meta\'',
  ).get()?.n === 1;
}

/** A write to the live file that would keep `storeId`. */
interface LiveKeep {
  readonly action: 'keep';
  readonly storeId: string;
}

/**
 * What a write to the live file at `livePath` would decide about its
 * row, or the outcome that says it holds none. A decision other than
 * keep or mint cannot come from a write; it is answered as a mint with
 * no reasons, the safe side.
 */
function decideLiveWrite(livePath: string, readHost: () => string): CarryOutcome | LiveKeep {
  const live = new Database(livePath, { readonly: true });
  let recorded: StoreMeta | null;
  try {
    if (!hasStoreMetaTable(live)) return { action: 'no-table' };
    recorded = readStoreMeta(live);
  } finally {
    live.close();
  }
  if (recorded === null) return { action: 'no-row' };

  const facts = observeStore(livePath, readHost);
  const decision = decideStoreIdentity('write', recorded, () => facts);
  if (decision.action === 'keep') return { action: 'keep', storeId: decision.storeId };
  const reasons = decision.action === 'mint'
    ? decision.reasons
    : [];
  return { action: 'mint', reasons };
}

/**
 * Writes `parallel`'s device and inode and a generation from
 * `newGeneration` into the row of the parallel file `db` holds when that
 * row is the store `storeId`'s, answering `carried` with that generation,
 * or `other-row` when it is not. The generation is left out, and
 * answered null, for a file whose `store_meta` has no `generation`
 * column; `newGeneration` is then not called.
 */
function writeCarried(
  db: Database,
  storeId: string,
  parallel: StoreFileFacts,
  newGeneration: () => string,
): CarryOutcome {
  if (!hasStoreMetaTable(db) || readStoreMeta(db)?.storeId !== storeId) return { action: 'other-row' };
  const dev = toStoredInteger(parallel.fileDev);
  const ino = toStoredInteger(parallel.fileIno);
  if (hasGenerationColumn(db)) {
    const generation = newGeneration();
    db.query('UPDATE store_meta SET file_dev = ?, file_ino = ?, generation = ? WHERE id = 1').run(dev, ino, generation);
    return { action: 'carried', storeId, generation };
  }
  db.query('UPDATE store_meta SET file_dev = ?, file_ino = ? WHERE id = 1').run(dev, ino);
  return { action: 'carried', storeId, generation: null };
}

/**
 * Carries the identity of the live store at `livePath` onto the file at
 * `parallelPath` that is about to be renamed over it. When
 * `decideStoreIdentity('write', …)` answers keep for the live file, the
 * parallel file's own device and inode and a new generation from
 * `seams.newGeneration` (`crypto.randomUUID` when absent) are written
 * into the parallel file's `store_meta` row, and its store id, path, host
 * and every other column are kept. The answer `carried` holds that
 * generation, which the caller writes to the live store's side record
 * immediately before the rename (`swapIn`, `rebuild-aside.ts`); this
 * function writes no side record. Nothing is written otherwise. The host
 * id is read through `seams.readHostId` (`readHostId` when absent).
 * Throws the filesystem's own error, which names the path, when either
 * file does not exist. See the module note.
 */
export function carryStoreIdentity(
  livePath: string,
  parallelPath: string,
  seams: StoreIdentitySeams = {},
): CarryOutcome {
  const parallel = readStoreFileFacts(parallelPath);
  const live = decideLiveWrite(livePath, seams.readHostId ?? readHostId);
  if (live.action !== 'keep') return live;

  const db = new Database(parallelPath, { readwrite: true });
  try {
    return writeCarried(db, live.storeId, parallel, seams.newGeneration ?? randomUUID);
  } finally {
    db.close();
  }
}
