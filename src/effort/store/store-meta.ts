/**
 * The store's own identity row: reading what `store_meta` records, and
 * minting a new origin into it on a writing open that needs one.
 *
 * ## When an open mints
 *
 * `withSqliteStore` (`sqlite.ts`) calls {@link settleStoreIdentity}
 * after `bringForward`, so the table exists, and before any caller
 * reads or writes. `decideStoreIdentity` (`store-identity.ts`) makes the
 * decision: a `read` open answers `none` and this module neither reads
 * the row nor observes the file, so a read writes nothing. A `write`
 * open reads the row, observes the host, the real path and the file's
 * device and inode, and mints when the row is absent or any of the
 * three moved. Otherwise it keeps the recorded origin and writes
 * nothing, taking no lock.
 *
 * A mint takes the write lock with `BEGIN IMMEDIATE`, reads the row and
 * decides again under it, since another process may have minted the
 * same file while this one waited, and writes the one row (`id = 1`)
 * only when the second decision still mints. So two processes that
 * open one unminted store at once record one origin.
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
 * store stays unminted, and the next writing open asks again. That
 * costs the git reads on each such open and loses no origin, since an
 * unminted store stamps none. Git is only asked on a mint, never on a
 * write that keeps the origin.
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
 */
import type { StoreAccess } from './schema-plan.js';
import type {
  IdentityDecision,
  MintReason,
  ProjectIdentity,
  RecordedIdentity,
  StoreIdentityFacts,
} from './store-identity.js';
import type { Database } from 'bun:sqlite';

import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';

import {
  decideStoreIdentity,
  observeStore,
  readHostId,
  readProjectIdentity,
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
  /** A write to the store its origin was minted for: nothing written. */
  | { readonly action: 'keep'; readonly storeId: string }
  /** A write that recorded the new origin `storeId`. */
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
}

/** An unsigned 64-bit value as the signed INTEGER SQLite stores. */
export function toStoredInteger(value: bigint): bigint {
  return BigInt.asIntN(STORED_INTEGER_BITS, value);
}

/** The unsigned value {@link toStoredInteger} stored as `text`. */
export function fromStoredInteger(text: string): bigint {
  return BigInt.asUintN(STORED_INTEGER_BITS, BigInt(text));
}

/** The `store_meta` row of the store `db` holds, or null when it holds none. */
export function readStoreMeta(db: Database): StoreMeta | null {
  const row = db.query<StoreMetaColumns, []>(
    'SELECT store_id, project_root_commit, project_remote, host_id, store_path,'
      + ' CAST(file_dev AS TEXT) AS file_dev, CAST(file_ino AS TEXT) AS file_ino, minted_at'
      + ' FROM store_meta WHERE id = 1',
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

/** Replaces the store's one `store_meta` row with a new origin minted for `facts`. */
function writeStoreMeta(
  db: Database,
  facts: StoreIdentityFacts,
  project: KnownProject,
  seams: StoreIdentitySeams,
): string {
  const storeId = (seams.newStoreId ?? randomUUID)();
  const mintedAt = (seams.now?.() ?? new Date()).toISOString();
  db.query(
    'INSERT OR REPLACE INTO store_meta (id, store_id, project_root_commit, project_remote,'
      + ' host_id, store_path, file_dev, file_ino, minted_at) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    storeId,
    project.rootCommit,
    project.remote,
    facts.hostId,
    facts.storePath,
    toStoredInteger(facts.fileDev),
    toStoredInteger(facts.fileIno),
    mintedAt,
  );
  return storeId;
}

/** The outcome a decision that mints nothing answers. */
function unminted(decision: Exclude<IdentityDecision, { readonly action: 'mint' }>): IdentityOutcome {
  return decision.action === 'keep'
    ? { action: 'keep', storeId: decision.storeId }
    : { action: 'none' };
}

/**
 * Settles the identity of the store at `path`, open as `db`, for an open
 * with `access`: nothing on a read, the recorded origin kept on a write
 * that finds the same file, and a new origin minted, under the write
 * lock, on a write to an unminted store or a copy. See the module note.
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
  if (first.action !== 'mint') return unminted(first);

  const project = projectFor(first.facts.storePath, recorded, seams);
  if (project === null) return { action: 'no-project', reasons: first.reasons };

  const mintUnderLock = db.transaction((): IdentityOutcome => {
    const second = decideStoreIdentity(access, readStoreMeta(db), observe);
    if (second.action !== 'mint') return unminted(second);
    const storeId = writeStoreMeta(db, second.facts, project, seams);
    return { action: 'mint', storeId, reasons: second.reasons };
  });
  return mintUnderLock.immediate();
}
