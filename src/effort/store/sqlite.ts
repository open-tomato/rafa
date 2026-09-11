/**
 * The effort store's SQLite backend: the port over `bun:sqlite`, with
 * every kind in one file.
 *
 * ## Layout
 *
 * One file, `effort.sqlite`, in the directory the NDJSON backend's
 * files live in: `EFFORT_STORE_DIR`, spelled once in `effort/store.ts`
 * and ignored by the root `.gitignore`. The two backends can therefore
 * hold a store side by side, and neither is ever committed.
 *
 * One table per kind, named for the kind and keyed by the key the
 * NDJSON rows are deduplicated by. Each table has three columns:
 *
 *   - `seq`, the order the row was appended in.
 *   - The kind's key, filled from {@link EFFORT_KEY_PROJECTIONS}:
 *     `session_id` for `sessions` and `sha` for `commits`, the names the
 *     reference schema gives the same two keys. It is `NOT NULL` and
 *     `UNIQUE` and refuses an empty string, so no stored row lacks one.
 *   - `row_json`, the row itself.
 *
 * The row is stored whole, as the JSON text the NDJSON backend writes
 * as a line, and read back through `JSON.parse` as that backend reads
 * its lines. Both backends make the same pair of calls on the same row,
 * so a row read from one is byte-identical to its counterpart in the
 * other by construction, which is what the parity test holds them to.
 * The row is not spread over a column per field. A session row carries
 * open-keyed histograms (records by type, branch, entrypoint, effort
 * and model) that no fixed column set can hold, and a row rebuilt from
 * columns would have to reproduce the collector's field order to come
 * out byte-identical. The key is the one field SQLite has to see,
 * because the uniqueness constraint on it is what deduplicates.
 *
 * `seq` is an `INTEGER PRIMARY KEY`, SQLite's alias for the rowid, so
 * the append order is a column the schema declares rather than an
 * implicit one. That is a declaration, not a repair: measured on SQLite
 * 3.51.0, a `VACUUM` left implicit rowids where they were as well.
 *
 * ## The port's rules, as they come out here
 *
 *   - Append-only. `append` inserts, and nothing here updates or
 *     deletes a row.
 *   - `keys` is read back from the rows. It answers each stored row's
 *     key column, which is the column the uniqueness constraint dedupes
 *     by, so the set a collector skips by and the set an append dedupes
 *     by are one set. The key field inside `row_json` is read by
 *     neither.
 *   - Duplicate suppression covers the batch as well as the disk. The
 *     batch is inserted under `ON CONFLICT (<key>) DO NOTHING`, so a key
 *     repeated within it conflicts with the row its first occurrence
 *     inserted, and the first occurrence stays, as in the NDJSON file.
 *     That form rather than `INSERT OR IGNORE`, because measured,
 *     `OR IGNORE` also swallows a `NOT NULL` violation as a skipped row,
 *     where the upsert form absorbs the key conflict and throws on
 *     anything else.
 *   - The batch is checked before the store is opened. Every key is
 *     projected and every row serialised first, so a refused batch, or
 *     a row `JSON.stringify` throws on, leaves the file byte-identical,
 *     and on a store that does not exist yet leaves no file and no
 *     directory. A batch that passes is inserted in one transaction,
 *     and lands whole or not at all.
 *   - Writing nothing writes NOTHING. An empty batch never opens the
 *     store. An append whose every row is already held opens it and
 *     leaves its bytes identical, measured, where an append that adds a
 *     row changes them.
 *   - Absence is the first-run case. `read` and `keys` answer empty for
 *     a store with no file, without opening one, and only an append
 *     with a row to add opens the store with SQLite's create flag.
 *     Measured, an open without that flag refuses a missing file with
 *     `SQLITE_CANTOPEN` and creates nothing.
 *   - A store that exists and cannot be read throws. Measured, a
 *     directory at the path refuses to open (`SQLITE_CANTOPEN`), and a
 *     file that is not a database refuses its first statement
 *     (`SQLITE_NOTADB`). A zero-byte file is an empty database to
 *     SQLite, and is what a run killed between creating the file and
 *     its first commit leaves, so it reads as an empty store and is
 *     given the schema.
 *
 * ## What does not carry over from the NDJSON backend
 *
 * There is no partial last line to tolerate. SQLite commits a
 * transaction whole or not at all (measured, a throw inside one rolls
 * back its rows and its schema changes alike), so a run killed
 * mid-append leaves no half-row. Nor can any append write a `row_json`
 * that is not a JSON object, so `read` throws on one rather than
 * skipping it. The NDJSON reader tolerates a malformed line because of
 * a failure mode this store does not have; carried over, the tolerance
 * would only hide a row written from outside.
 *
 * A key holding a lone UTF-16 surrogate REFUSES its batch here, where
 * the NDJSON backend would store it. `JSON.stringify` escapes a lone
 * surrogate, so the row would survive in `row_json`, but the key column
 * is bound as UTF-8 text, and bun converts a lone surrogate lossily.
 * Measured: `ab\uD800cd` comes back as `ab\u{10063}d`, the very text a
 * genuine astral character binds to, so two distinct keys would share
 * one row and the second would be dropped as a duplicate. A key the
 * store cannot deduplicate by refuses its batch, which is the port's
 * rule for a keyless row. The collectors' keys are log file basenames
 * and hex shas, so this guards against a key they are not expected to
 * produce.
 *
 * The journal stays SQLite's default rollback journal, measured as
 * `delete` on a fresh store, with nothing left beside the file once a
 * call returns. The reference switches to the write-ahead log. Under
 * WAL a committed row can sit in the `-wal` file rather than in the
 * store, so the store file's bytes would stop being the store, and
 * comparing them, which is how a refused batch is shown to have written
 * nothing, would stop meaning anything. Measured on macOS, where bun
 * uses Apple's SQLite, a WAL store also leaves its `-wal` and `-shm`
 * files behind after a close.
 *
 * Every call opens the store, does its work and closes it before
 * returning, because the port has no `close`. Measured, thirty
 * open-append-close cycles left no descriptor on the file open, where
 * one open connection holds one. No busy timeout is set, so a call
 * that finds another process mid-write throws `SQLITE_BUSY` at once
 * (measured) rather than waiting its turn.
 *
 * ## Schema versioning
 *
 * {@link SQLITE_MIGRATIONS} is the schema's history, a versioned array
 * modelled on the reference's `effort-db.ts`. The entry at index `i`
 * takes a store from version `i` to version `i + 1`. Two things differ
 * from the reference, and each closes a failure the reference leaves
 * open:
 *
 *   - The last version is the array's length rather than a constant
 *     beside it. The reference declares `SCHEMA_VERSION = 1` next to
 *     its array, so an entry appended without the bump would never run.
 *   - The version lives in `PRAGMA user_version`, SQLite's header field
 *     for it, written in the same transaction as the migrations it
 *     records. Measured, a throw inside the transaction rolls the field
 *     back with the tables. The reference keeps its version in a table
 *     and inserts it after the migration, outside any transaction, so a
 *     run killed between the two leaves a migrated schema recorded as
 *     unmigrated.
 *
 * Every call brings an existing store forward before using it, reads
 * included, as the reference's `openDb` does, so no call reads a store
 * under a schema this code does not know. {@link migrateSchema} names
 * the two stores it refuses instead.
 */
import type {
  AppendResult,
  EffortRow,
  EffortRowKind,
  EffortStore,
} from './types.js';

import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { Database } from 'bun:sqlite';

import { EFFORT_STORE_DIR } from '../store.js';

import { EFFORT_KEY_PROJECTIONS } from './types.js';

/** The store's file, inside `EFFORT_STORE_DIR`. */
const STORE_FILE_NAME = 'effort.sqlite';

/**
 * The schema's history. The entry at index `i` takes a store from
 * version `i` to version `i + 1`; the module note says why the version
 * is this array's length and lives in `user_version`.
 *
 * An entry is frozen once it ships. A store already past it never runs
 * it again, so an edit would give new stores a schema the old ones
 * never received. A change to the schema is a new entry at the end.
 */
export const SQLITE_MIGRATIONS: readonly string[] = [
  // Version 1: one table per kind, keyed as its NDJSON rows are.
  `
  CREATE TABLE sessions (
    seq        INTEGER PRIMARY KEY,
    session_id TEXT NOT NULL UNIQUE CHECK (session_id <> ''),
    row_json   TEXT NOT NULL
  );

  CREATE TABLE commits (
    seq      INTEGER PRIMARY KEY,
    sha      TEXT NOT NULL UNIQUE CHECK (sha <> ''),
    row_json TEXT NOT NULL
  );
  `,
];

/**
 * The version a store is brought to: the history's length, so
 * appending a migration is what raises it.
 */
export const SQLITE_SCHEMA_VERSION = SQLITE_MIGRATIONS.length;

/** Where one kind's rows live in the schema. */
interface KindTable {
  /** The table, named for the kind. */
  readonly name: string;
  /** The column the kind's key is stored in, and deduplicated by. */
  readonly keyColumn: string;
}

/**
 * Each kind's table and key column, as the migrations create them.
 *
 * Closed over the port's row map, as the NDJSON backend's file names
 * are: a kind added there fails to compile here until this record
 * names its table. Both names are interpolated into SQL, which is safe
 * because they come from this record and never from a caller.
 */
const KIND_TABLES: Readonly<Record<EffortRowKind, KindTable>> = {
  sessions: { name: 'sessions', keyColumn: 'session_id' },
  commits: { name: 'commits', keyColumn: 'sha' },
};

/**
 * A lone UTF-16 surrogate: a high half with no low half after it, or a
 * low half with no high half before it. There is no `u` flag, so the
 * pattern reads code units, which is the level a lone half exists at.
 */
const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** One row of a batch, keyed and serialised, ready to insert. */
interface BatchEntry {
  key: string;
  body: string;
}

/** A row paired with its key projection, which may have answered null. */
interface ProjectedRow<R> {
  key: string | null;
  row: R;
}

/** A projected row whose projection answered a key. */
interface KeyedRow<R> {
  key: string;
  row: R;
}

/** Narrows a projected row to one that carries a key. */
function hasKey<R>(entry: ProjectedRow<R>): entry is KeyedRow<R> {
  return entry.key !== null;
}

/** A batch refusal, worded as the NDJSON backend words its own. */
function refused(index: number, length: number, reason: string): Error {
  return new Error(
    `effort store: row ${index} of ${length} ${reason}; batch refused`,
  );
}

/**
 * Keys and serialises a whole batch, or refuses it, before anything is
 * opened.
 *
 * A keyless row is looked for across the whole batch first, so a batch
 * the NDJSON backend refuses is refused here with the same message,
 * naming the same row. Serialising here rather than inside the
 * transaction is what keeps a row `JSON.stringify` throws on from
 * creating a store that then holds nothing.
 */
function batchEntries<K extends EffortRowKind>(
  kind: K,
  rows: readonly EffortRow<K>[],
): BatchEntry[] {
  const keyOf: (row: EffortRow<K>) => string | null =
    EFFORT_KEY_PROJECTIONS[kind];
  const projected = rows.map((row) => ({ key: keyOf(row), row }));
  const keyed = projected.filter(hasKey);
  if (keyed.length < projected.length) {
    const keylessAt = projected.findIndex((entry) => !hasKey(entry));
    throw refused(keylessAt, rows.length, 'carries no key');
  }

  const unholdableAt = keyed.findIndex(({ key }) => LONE_SURROGATE.test(key));
  if (unholdableAt !== -1) {
    const reason = 'carries a key with a lone UTF-16 surrogate,'
      + ' which SQLite text cannot hold';
    throw refused(unholdableAt, rows.length, reason);
  }
  return keyed.map(({ key, row }) => ({ key, body: JSON.stringify(row) }));
}

/** A database's `user_version`, which a fresh database holds as 0. */
function userVersion(db: Database): number {
  const row = db
    .query<{ user_version: number }, []>('PRAGMA user_version')
    .get();
  return row?.user_version ?? 0;
}

/** The version a database is at, refusing one past `latest`. */
function checkedVersion(db: Database, path: string, latest: number): number {
  const version = userVersion(db);
  if (version > latest) {
    throw new Error(
      `effort store: ${path} is at schema version ${version}, past the`
        + ` ${latest} this rafa knows; refusing to read or write it`,
    );
  }
  return version;
}

/**
 * Brings a database's schema up to the last version a migrations array
 * holds: the store's own history unless another is passed, which is
 * what lets the version arithmetic be driven with a history of any
 * length. `path` is what a refusal names the database as.
 *
 * Every pending migration runs in one `BEGIN IMMEDIATE` transaction,
 * and the version is read again once the write lock is held, since
 * another process may have migrated the store in the meantime. A
 * failure anywhere leaves the database at the version it was found at,
 * with nothing half-applied. A database already at the last version
 * takes no lock and is not written to.
 *
 * Two databases are refused, and neither is written to:
 *
 *   - One already past the array's last version. A newer rafa wrote
 *     it, and this one can neither vouch for its schema nor write rows
 *     the newer one expects.
 *   - One a migration fails on, such as a version-0 file that already
 *     holds a table named for a kind. The migrations create their
 *     tables without the `IF NOT EXISTS` the reference uses, so a table
 *     nobody migrated is refused rather than adopted with a layout
 *     nobody chose. Measured, the refusal leaves the file
 *     byte-identical.
 */
export function migrateSchema(
  db: Database,
  path: string,
  migrations: readonly string[] = SQLITE_MIGRATIONS,
): void {
  const latest = migrations.length;
  if (checkedVersion(db, path, latest) === latest) return;

  const applyPending = db.transaction(() => {
    const from = checkedVersion(db, path, latest);
    for (const sql of migrations.slice(from)) db.run(sql);
    db.run(`PRAGMA user_version = ${latest}`);
  });
  applyPending.immediate();
}

/**
 * Opens the store, brings its schema forward, hands it to `use`, and
 * closes it whatever `use` did. Only a caller with a row to add passes
 * `create`, and only then is the directory made.
 */
function withStore<T>(
  path: string,
  create: boolean,
  use: (db: Database) => T,
): T {
  if (create) mkdirSync(dirname(path), { recursive: true });

  const db = new Database(path, { readwrite: true, create });
  try {
    migrateSchema(db, path);
    return use(db);
  } finally {
    db.close();
  }
}

/**
 * Inserts a checked batch in one transaction and answers how many rows
 * it added. A row whose key is already held, on disk or earlier in the
 * batch, conflicts, adds nothing and is counted by the caller as
 * skipped.
 */
function insertBatch(
  db: Database,
  table: KindTable,
  entries: readonly BatchEntry[],
): number {
  const insert = db.query<unknown, [string, string]>(
    `INSERT INTO ${table.name} (${table.keyColumn}, row_json) VALUES (?, ?)`
      + ` ON CONFLICT (${table.keyColumn}) DO NOTHING`,
  );
  const insertAll = db.transaction(() => entries.reduce(
    (appended, { key, body }) => appended + insert.run(key, body).changes,
    0,
  ));
  return insertAll.immediate();
}

/** Appends one kind's batch, deduplicated by that kind's key column. */
function appendKind<K extends EffortRowKind>(
  path: string,
  kind: K,
  rows: readonly EffortRow<K>[],
): AppendResult {
  const entries = batchEntries(kind, rows);
  if (entries.length === 0) return { path, appended: 0, skipped: 0 };

  const table = KIND_TABLES[kind];
  const appended = withStore(
    path,
    !existsSync(path),
    (db) => insertBatch(db, table, entries),
  );
  return { path, appended, skipped: entries.length - appended };
}

/** The keys one kind holds: its key column, in append order. */
function keysOfKind(path: string, kind: EffortRowKind): Set<string> {
  if (!existsSync(path)) return new Set();

  const { name, keyColumn } = KIND_TABLES[kind];
  const keys = withStore(path, false, (db) => db
    .query<{ key: string }, []>(
      `SELECT ${keyColumn} AS key FROM ${name} ORDER BY seq`,
    )
    .all());
  return new Set(keys.map(({ key }) => key));
}

/** A stored body parsed to a plain object, or null when it is not one. */
function parsedObject(body: string): object | null {
  try {
    const value: unknown = JSON.parse(body);
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? value
      : null;
  } catch {
    return null;
  }
}

/**
 * One stored body as a row. The row type is the port's assertion, as
 * it is in the NDJSON backend: a body is checked only for being a plain
 * JSON object, and one that is not throws, naming where it sits.
 */
function rowOf<K extends EffortRowKind>(
  body: string,
  where: string,
): EffortRow<K> {
  const value = parsedObject(body);
  if (value === null) {
    throw new Error(
      `effort store: ${where} does not hold a JSON object;`
        + ' no append writes one',
    );
  }
  return value as EffortRow<K>;
}

/** Every row one kind holds, in append order. */
function readKind<K extends EffortRowKind>(
  path: string,
  kind: K,
): EffortRow<K>[] {
  if (!existsSync(path)) return [];

  const { name } = KIND_TABLES[kind];
  const stored = withStore(path, false, (db) => db
    .query<{ seq: number; body: string }, []>(
      `SELECT seq, row_json AS body FROM ${name} ORDER BY seq`,
    )
    .all());
  return stored.map(({ seq, body }) => rowOf<K>(
    body,
    `${path}: ${name} row ${seq}`,
  ));
}

/**
 * The SQLite backend's surface: the port, plus the one reading the
 * NDJSON backend also makes, so a caller holding either can find the
 * file a kind lives in.
 */
export interface SqliteEffortStore extends EffortStore {
  /**
   * The file one kind lives in, whether or not it exists yet. For this
   * backend it is the same file for every kind.
   */
  path: (kind: EffortRowKind) => string;
}

/**
 * Opens the SQLite store under one repo root.
 *
 * Opening touches nothing on disk. Each call opens the file afresh,
 * brings its schema forward and closes it before returning, which is
 * why the port has no `close` for this backend to need.
 */
export function openSqliteStore(repoRoot: string): SqliteEffortStore {
  const path = join(repoRoot, EFFORT_STORE_DIR, STORE_FILE_NAME);
  return {
    append: (kind, rows) => appendKind(path, kind, rows),
    keys: (kind) => keysOfKind(path, kind),
    read: (kind) => readKind(path, kind),
    path: () => path,
  };
}
