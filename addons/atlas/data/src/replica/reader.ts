/**
 * `openReplica`: a read-only view of the replica file that follows the
 * writer's renames. Each `current()` call compares the file at the path
 * with the one it holds open (device, inode, size and modification time)
 * and, when they differ, opens the new file, checks its stamps and closes
 * the old one. A reader opened before a build therefore answers from the
 * new replica on its next call.
 *
 * A file renamed over is not one a caller can go on reading. On macOS,
 * SQLite refuses every read of a database whose file was replaced, a
 * statement already stepping included, with `SQLITE_IOERR_VNODE`
 * (measured under bun 1.3.14). So a caller keeps a database from
 * `current()` no longer than one synchronous query, and reads through
 * `read()`, which runs its query once more over the new file when the
 * first run met that refusal. Either way the rows come from one whole
 * build.
 *
 * The stamps checked are those of `atlas_meta`: a replica whose
 * `contract_version` has another major than `ATLAS_CONTRACT_VERSION`, or
 * whose `replica_version` is not `REPLICA_VERSION`, is refused as
 * `ReplicaUnavailable`, and so is a missing file or one with no stamps.
 * The fix for each is a rebuild. A refused file is not kept: the next call
 * looks at the path again.
 */
import type { SourceStamp } from './writer.js';

import { statSync } from 'node:fs';

import { Database } from 'bun:sqlite';

import { ReplicaUnavailable } from '../contract/errors.js';
import { ATLAS_CONTRACT_VERSION } from '../contract/version.js';

import { META_KEYS, REPLICA_VERSION } from './ddl.js';

/** The stamps of `atlas_meta`, as the writer put them. */
export interface ReplicaMeta {
  readonly contractVersion: string;
  readonly replicaVersion: string;
  readonly buildId: string;
  readonly builtAt: string;
  readonly projectLabel: string;
}

/** One replica file, open read-only, with the stamps read when it was opened. */
export interface OpenReplica {
  readonly database: Database;
  readonly meta: ReplicaMeta;
  /** The rows of `atlas_sources`, by source. */
  readonly sources: ReadonlyMap<string, SourceStamp>;
}

export interface ReplicaReader {
  readonly path: string;
  /** The replica now at the path; reopens it when the file changed since the last call. */
  current(): OpenReplica;
  /**
   * Run `use` over `current()`, and once more over the file now at the
   * path when SQLite refused the first run because its file was renamed
   * over. `use` is synchronous and reads only: it may run twice.
   */
  read<T>(use: (replica: OpenReplica) => T): T;
  /** Closes the file held open; a later `current()` throws. */
  close(): void;
}

/** What tells one file at the path from another. */
interface FileIdentity {
  readonly dev: number;
  readonly ino: number;
  readonly size: number;
  readonly mtimeMs: number;
}

interface Held {
  readonly identity: FileIdentity;
  readonly replica: OpenReplica;
}

interface SourceRow {
  readonly source: string;
  readonly as_of: string | null;
  readonly read_at: string;
  readonly rows: number;
  readonly partial: number;
  readonly reason: string | null;
}

/** SQLite's extended code for a file replaced under an open connection (macOS). */
const FILE_MOVED_CODE = 'SQLITE_IOERR_VNODE';

function isFileMoved(error: unknown): boolean {
  return error instanceof Error && (error as Error & { readonly code?: unknown }).code === FILE_MOVED_CODE;
}

function majorOf(version: string): string {
  return version.split('.')[0] ?? '';
}

function identityOf(path: string): FileIdentity | null {
  const stats = statSync(path, { throwIfNoEntry: false });
  return stats === undefined
    ? null
    : { dev: stats.dev, ino: stats.ino, size: stats.size, mtimeMs: stats.mtimeMs };
}

function sameFile(left: FileIdentity, right: FileIdentity): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs;
}

function stampOf(stamps: ReadonlyMap<string, string>, key: string, path: string): string {
  const value = stamps.get(key);
  if (value === undefined) {
    throw new ReplicaUnavailable(`the replica at ${path} has no ${key} stamp; rebuild it`);
  }
  return value;
}

function readMeta(database: Database, path: string): ReplicaMeta {
  let rows: readonly { readonly key: string; readonly value: string }[];
  try {
    rows = database.query<{ readonly key: string; readonly value: string }, []>(
      'SELECT key, value FROM atlas_meta',
    ).all();
  } catch {
    throw new ReplicaUnavailable(`the replica at ${path} holds no atlas_meta table; rebuild it`);
  }
  const stamps = new Map(rows.map((row) => [row.key, row.value]));
  const meta: ReplicaMeta = {
    contractVersion: stampOf(stamps, META_KEYS.contractVersion, path),
    replicaVersion: stampOf(stamps, META_KEYS.replicaVersion, path),
    buildId: stampOf(stamps, META_KEYS.buildId, path),
    builtAt: stampOf(stamps, META_KEYS.builtAt, path),
    projectLabel: stampOf(stamps, META_KEYS.projectLabel, path),
  };
  if (majorOf(meta.contractVersion) !== majorOf(ATLAS_CONTRACT_VERSION)) {
    throw new ReplicaUnavailable(
      `the replica at ${path} speaks contract ${meta.contractVersion}, this reader ${ATLAS_CONTRACT_VERSION}; rebuild it`,
    );
  }
  if (meta.replicaVersion !== REPLICA_VERSION) {
    throw new ReplicaUnavailable(
      `the replica at ${path} has tables of version ${meta.replicaVersion}, this reader ${REPLICA_VERSION}; rebuild it`,
    );
  }
  return meta;
}

function readSources(database: Database): ReadonlyMap<string, SourceStamp> {
  const rows = database.query<SourceRow, []>(
    'SELECT source, as_of, read_at, rows, partial, reason FROM atlas_sources ORDER BY source',
  ).all();
  return new Map(rows.map((row) => [row.source, {
    source: row.source,
    asOf: row.as_of,
    readAt: row.read_at,
    rows: row.rows,
    partial: row.partial !== 0,
    reason: row.reason,
  }]));
}

/** Open the file at `path` and read its stamps; a refused file is closed before the throw. */
function openFile(path: string, identity: FileIdentity): Held {
  let database: Database;
  try {
    database = new Database(path, { readonly: true, strict: true });
  } catch {
    throw new ReplicaUnavailable(`the replica at ${path} cannot be opened; rebuild it`);
  }
  try {
    const meta = readMeta(database, path);
    return { identity, replica: { database, meta, sources: readSources(database) } };
  } catch (error: unknown) {
    database.close();
    throw error;
  }
}

/**
 * Open the replica at `path` read-only. Throws `ReplicaUnavailable` now,
 * rather than at the first query, when there is no replica to answer from.
 */
export function openReplica(path: string): ReplicaReader {
  let held: Held | null = null;
  let closed = false;

  const drop = (): void => {
    held?.replica.database.close();
    held = null;
  };

  const current = (): OpenReplica => {
    if (closed) throw new Error(`replica: the reader of ${path} is closed`);
    const identity = identityOf(path);
    if (identity === null) {
      drop();
      throw new ReplicaUnavailable(`no replica at ${path}; run the build`);
    }
    if (held !== null && sameFile(held.identity, identity)) return held.replica;
    drop();
    held = openFile(path, identity);
    return held.replica;
  };

  const read = <T>(use: (replica: OpenReplica) => T): T => {
    try {
      return use(current());
    } catch (error: unknown) {
      if (!isFileMoved(error)) throw error;
      drop();
      return use(current());
    }
  };

  current();
  return {
    path,
    current,
    read,
    close: () => {
      drop();
      closed = true;
    },
  };
}
