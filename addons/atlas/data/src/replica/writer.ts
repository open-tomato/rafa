/**
 * `writeReplica`: builds a whole replica beside the live one and swaps it
 * in with one rename, so a reader sees the old replica or the new one and
 * never half of one.
 *
 * 1. Open `<replica>.build-<build id>` read-write; a build file already
 *    there is refused, as another run's.
 * 2. Create every table of `ddl.ts` and stamp `atlas_meta`: the contract
 *    version, `REPLICA_VERSION`, the build id, the build time and the
 *    project label.
 * 3. Hand the open build to the caller's `fill`, which inserts the bucket
 *    rows and stamps each source it read in `atlas_sources`.
 * 4. Copy the old replica's `board_snapshot` rows into the build file, the
 *    one bucket carried between builds (D20). A row of the same day and
 *    stage that `fill` wrote stays, so a second build on one day keeps its
 *    own count. No old replica, or one of an older version with no such
 *    table, adds no row; an old replica that cannot be read fails the
 *    build and stays as it was, so no snapshot history is lost.
 * 5. Count the rows of each bucket, close the file and rename it over the
 *    replica path.
 *
 * Any failure before the rename closes and removes the build file and
 * rethrows, leaving the live replica as it was. The build file keeps
 * SQLite's default rollback journal, so the closed file is the whole
 * replica and nothing beside it needs to move with it.
 */
import type { ReplicaTable } from './ddl.js';

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';

import { Database } from 'bun:sqlite';

import { ATLAS_CONTRACT_VERSION } from '../contract/version.js';

import { META_KEYS, REPLICA_TABLES, REPLICA_VERSION, replicaDdl } from './ddl.js';

/** A build id is one path segment: letters, digits, dot, dash, underscore. */
const BUILD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** A version stamp is three dot-separated whole numbers. */
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

/** The random part of a default build id, in hex digits. */
const BUILD_ID_SUFFIX_LENGTH = 8;

/** One row of `atlas_sources`: what the build read from one source. */
export interface SourceStamp {
  readonly source: string;
  /** The newest fact the source holds, or null when it holds none. */
  readonly asOf: string | null;
  /** When the build read the source. */
  readonly readAt: string;
  readonly rows: number;
  /** True when the source was read in part, with `reason` saying why. */
  readonly partial: boolean;
  readonly reason: string | null;
}

/** The build in progress, as `fill` sees it. */
export interface ReplicaBuild {
  /** The build file, open read-write, every table created and the meta stamped. */
  readonly database: Database;
  /** The build file's path, beside the replica path. */
  readonly buildPath: string;
  readonly buildId: string;
  readonly builtAt: string;
  /** Write one row of `atlas_sources`; a second stamp of the same source is refused. */
  stampSource(stamp: SourceStamp): void;
}

export interface WriteReplicaOptions {
  /** The live replica file, replaced by the rename; it need not exist yet. */
  readonly replicaPath: string;
  /** Stamped as `project_label`. */
  readonly projectLabel: string;
  /** One path segment; defaults to the build time's digits and a random suffix. */
  readonly buildId?: string;
  /** The build clock; defaults to the system clock. */
  readonly now?: () => Date;
  /**
   * Stamped as `contract_version`; defaults to `ATLAS_CONTRACT_VERSION`. A
   * builder leaves it out; a test sets it to plant a replica of another
   * contract.
   */
  readonly contractVersion?: string;
}

export interface WriteReplicaResult<T> {
  readonly replicaPath: string;
  readonly buildId: string;
  readonly builtAt: string;
  /** The rows each bucket holds in the replica just swapped in. */
  readonly tables: Readonly<Record<ReplicaTable, number>>;
  /** What `fill` returned. */
  readonly value: T;
}

/** The build file of `buildId` beside `replicaPath`. */
export function buildPathOf(replicaPath: string, buildId: string): string {
  return `${replicaPath}.build-${buildId}`;
}

function defaultBuildId(builtAt: string): string {
  const digits = builtAt.replace(/[^0-9]/g, '');
  const suffix = randomUUID()
    .replace(/-/g, '')
    .slice(0, BUILD_ID_SUFFIX_LENGTH);
  return `${digits}-${suffix}`;
}

function checkOptions(options: WriteReplicaOptions, buildId: string, contractVersion: string): void {
  if (!BUILD_ID_PATTERN.test(buildId)) {
    throw new Error(`replica: the build id ${JSON.stringify(buildId)} is not one path segment`);
  }
  if (!VERSION_PATTERN.test(contractVersion)) {
    throw new Error(`replica: the contract version ${JSON.stringify(contractVersion)} is not major.minor.patch`);
  }
  if (options.replicaPath.trim() === '') {
    throw new Error('replica: the replica path is empty');
  }
}

function createSchema(database: Database, stamps: Readonly<Record<string, string>>): void {
  database.transaction(() => {
    for (const statement of replicaDdl()) database.run(statement);
    const insert = database.prepare('INSERT INTO atlas_meta (key, value) VALUES (?, ?)');
    for (const [key, value] of Object.entries(stamps)) insert.run(key, value);
  })();
}

function sourceStamper(database: Database): (stamp: SourceStamp) => void {
  const insert = database.prepare(
    'INSERT INTO atlas_sources (source, as_of, read_at, rows, partial, reason) VALUES (?, ?, ?, ?, ?, ?)',
  );
  return (stamp) => {
    if (!Number.isInteger(stamp.rows) || stamp.rows < 0) {
      throw new Error(`replica: the source ${stamp.source} has a row count that is not a whole number`);
    }
    const partial = stamp.partial
      ? 1
      : 0;
    insert.run(stamp.source, stamp.asOf, stamp.readAt, stamp.rows, partial, stamp.reason);
  };
}

/** One `board_snapshot` row, as the old replica holds it. */
interface SnapshotRow {
  readonly taken_at: string;
  readonly day: string;
  readonly stage: string;
  readonly count: number;
}

/** The old replica's `board_snapshot` rows, or none when it has no such table. */
function readSnapshotRows(replicaPath: string): readonly SnapshotRow[] {
  const old = new Database(replicaPath, { readonly: true, strict: true });
  try {
    const table = old
      .query<{ readonly name: string }, [string, string]>('SELECT name FROM sqlite_master WHERE type = ? AND name = ?')
      .get('table', 'board_snapshot');
    if (table === null) return [];
    return old.query<SnapshotRow, []>('SELECT taken_at, day, stage, count FROM board_snapshot').all();
  } finally {
    old.close();
  }
}

/** As `readSnapshotRows`, with no row for a missing replica and a failure naming the file. */
function oldSnapshotRows(replicaPath: string): readonly SnapshotRow[] {
  if (!existsSync(replicaPath)) return [];
  try {
    return readSnapshotRows(replicaPath);
  } catch (error: unknown) {
    const reason = error instanceof Error
      ? error.message
      : String(error);
    throw new Error(`replica: the board snapshot of ${replicaPath} cannot be read (${reason}); the build keeps it`);
  }
}

/** Copy the old replica's snapshot rows into the build; a row `fill` wrote for the same day and stage wins. */
function carryBoardSnapshot(database: Database, replicaPath: string): void {
  const rows = oldSnapshotRows(replicaPath);
  const insert = database.prepare(
    'INSERT OR IGNORE INTO board_snapshot (taken_at, day, stage, count) VALUES (?, ?, ?, ?)',
  );
  database.transaction(() => {
    for (const row of rows) insert.run(row.taken_at, row.day, row.stage, row.count);
  })();
}

function countTables(database: Database): Readonly<Record<ReplicaTable, number>> {
  const entries = Object.keys(REPLICA_TABLES).map((table) => {
    const row = database.query<{ readonly n: number }, []>(`SELECT count(*) AS n FROM ${table}`).get();
    return [table, row?.n ?? 0] as const;
  });
  return Object.fromEntries(entries) as Record<ReplicaTable, number>;
}

function removeBuildFile(buildPath: string): void {
  rmSync(buildPath, { force: true });
  rmSync(`${buildPath}-journal`, { force: true });
}

/**
 * Build a replica with `fill` and rename it over `options.replicaPath`.
 * See the module note for the steps; a failure leaves the live replica
 * untouched and no build file of this run behind.
 */
export async function writeReplica<T>(
  options: WriteReplicaOptions,
  fill: (build: ReplicaBuild) => T | Promise<T>,
): Promise<WriteReplicaResult<T>> {
  const builtAt = (options.now ?? (() => new Date()))().toISOString();
  const buildId = options.buildId ?? defaultBuildId(builtAt);
  const contractVersion = options.contractVersion ?? ATLAS_CONTRACT_VERSION;
  checkOptions(options, buildId, contractVersion);
  const { replicaPath } = options;
  const buildPath = buildPathOf(replicaPath, buildId);
  if (existsSync(buildPath)) {
    throw new Error(`replica: the build file ${buildPath} is already there, from another build`);
  }
  mkdirSync(dirname(replicaPath), { recursive: true });
  const database = new Database(buildPath, { create: true, readwrite: true, strict: true });
  let open = true;
  try {
    createSchema(database, {
      [META_KEYS.contractVersion]: contractVersion,
      [META_KEYS.replicaVersion]: REPLICA_VERSION,
      [META_KEYS.buildId]: buildId,
      [META_KEYS.builtAt]: builtAt,
      [META_KEYS.projectLabel]: options.projectLabel,
    });
    const value = await fill({ database, buildPath, buildId, builtAt, stampSource: sourceStamper(database) });
    carryBoardSnapshot(database, replicaPath);
    const tables = countTables(database);
    database.close();
    open = false;
    renameSync(buildPath, replicaPath);
    return { replicaPath, buildId, builtAt, tables, value };
  } catch (error: unknown) {
    if (open) database.close();
    removeBuildFile(buildPath);
    throw error;
  }
}
