/**
 * The sync wire codec: an effort store's rows carried as JSON between a
 * device and a hub, and turned back into a store file on the other side
 * so that `mergeStore` (`src/effort/store/merge-store.ts`) is still the
 * only thing that merges rows.
 *
 * ## The payload
 *
 * A {@link WirePayload} holds:
 *
 *   - `format` and `version`, so a receiver refuses a payload it does
 *     not read rather than guess at it;
 *   - `migrations`, the ids the sending store's migration log holds, in
 *     the order it applied them;
 *   - `tables`, for each `merged` table of `MERGE_RULES`
 *     (`merge-rules.ts`) the sending store holds, its rows past the
 *     cursor in `seq` order, each row every column the table has by name,
 *     `seq` and the origin pair (`origin_store`, `origin_seq`) included;
 *   - `cursor`, the highest `seq` each table has now sent.
 *
 * A `local` table (the migration log, `store_meta`, the merge trail)
 * never travels, as a merge never reads it. So the payload names no
 * store and no project: a materialised file holds no `store_meta` row,
 * its merge records no other store in `merges`, and the merge's
 * other-project refusal has nothing to compare. Keeping a hub's
 * projects apart is the hub's, not the payload's.
 *
 * ## The cursor
 *
 * A {@link WireCursor} maps a merged table to the highest local `seq`
 * already sent; a table it leaves out is read from the start. Every
 * insert takes `MAX(seq) + 1`, so a row this store writes later, or
 * brings in by a merge, lands past it and goes on the next export. Rows
 * a merge brought in under another origin travel too, so a hub can
 * relay them, and a receiver already holding them skips them by their
 * origin pair. Every table is read in one read transaction, so the
 * cursor answered is one snapshot of the store.
 *
 * ## Values
 *
 * A value is a string, a finite number or null. The store is read with
 * `safeIntegers`, so an integer past `Number.MAX_SAFE_INTEGER` is
 * refused rather than rounded, and so is a BLOB, which JSON has no
 * spelling for. A REAL holding a whole number crosses as a JSON integer
 * and is stored back as one; SQLite compares the two equal.
 *
 * ## Materialising
 *
 * {@link materialiseWirePayload} checks the payload again, since it
 * comes off a network, then builds `effort.sqlite` in a directory of its
 * own under the temporary directory: brought through exactly the
 * migrations the payload names (`bringForward`, `builtAside`), so its
 * schema is the sender's, then each table's rows inserted as sent, `seq`
 * included, in one transaction. `mergeStore` then brings that file to
 * this rafa's migrations as it does any other store's, and reads it. A
 * migration this rafa does not know, a table or column the built schema
 * lacks, a row missing a column, and a row the table's own constraints
 * refuse are each a {@link WireFormatError}, with the directory removed.
 * The caller removes it after the merge with `release`.
 */
import type { RuntimeIdentity } from '../../runtime/identity.js';
import type { SqliteMigration } from '../store/migrations.js';

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database, SQLiteError } from 'bun:sqlite';

import { readRuntimeIdentity } from '../../runtime/identity.js';
import { bringForward, MIGRATION_LOG_TABLE } from '../store/bring-forward.js';
import { appliedByName } from '../store/development-build.js';
import { guardTestProcess } from '../store/location.js';
import { MERGE_RULES } from '../store/merge-rules.js';
import { SQLITE_MIGRATIONS } from '../store/migrations.js';
import { quoted } from '../store/rebuild-aside.js';
import { activeStoreSettings } from '../store/settings.js';
import { SQLITE_STORE_FILE_NAME } from '../store/sqlite.js';

/** What every payload's `format` holds. */
export const WIRE_FORMAT = 'rafa-effort-wire';

/** The payload version this rafa writes and reads. */
export const WIRE_VERSION = 1;

/** One column's value as the wire carries it. */
export type WireValue = string | number | null;

/** One row: every column of its table, `seq` and the origin pair included, by name. */
export type WireRow = Readonly<Record<string, WireValue>>;

/** The highest local `seq` sent, per merged table; a table left out has sent nothing. */
export type WireCursor = Readonly<Record<string, number>>;

/** A store's rows past a cursor; see the module note. */
export interface WirePayload {
  readonly format: typeof WIRE_FORMAT;
  readonly version: typeof WIRE_VERSION;
  /** The sending store's migration log, in apply order. */
  readonly migrations: readonly string[];
  /** Each merged table the sending store holds, with its rows past the cursor in `seq` order. */
  readonly tables: Readonly<Record<string, readonly WireRow[]>>;
  /** The cursor the next export starts from. */
  readonly cursor: WireCursor;
}

/** A payload, or a cursor, this rafa cannot read or cannot build a store from. */
export class WireFormatError extends Error {
  override readonly name = 'WireFormatError';
}

/** A store the exporter will not read rows from. */
export class WireExportRefusal extends Error {
  override readonly name = 'WireExportRefusal';
}

/** What {@link exportWirePayload} reads. */
export interface WireExportOptions {
  /** The store file, only ever read. */
  readonly path: string;
  /** Where the last export stopped; every row is sent when absent. */
  readonly cursor?: WireCursor;
}

/** What {@link materialiseWirePayload} may vary; each field has the running build's default. */
export interface MaterialiseOptions {
  /** The directory the scratch directory is made under; `tmpdir()` when absent. */
  readonly tempDir?: string;
  /** The catalogue the payload's ids are looked up in; this build's unless a test passes another. */
  readonly migrations?: readonly SqliteMigration[];
  /** Which build logs the scratch store's migrations; `readRuntimeIdentity()` when absent. */
  readonly identity?: RuntimeIdentity;
  /** The clock the scratch store's log rows are stamped from. */
  readonly now?: () => Date;
}

/** A payload built into a store file. */
export interface MaterialisedWire {
  /** The scratch directory holding the file. */
  readonly directory: string;
  /** The store file, the `otherPath` a merge reads. */
  readonly path: string;
  /** Removes the directory and everything in it. */
  readonly release: () => void;
}

/** A value SQLite hands back under `safeIntegers`. */
type ReadValue = string | number | bigint | null | Uint8Array;

/** The tables a payload may carry, in `MERGE_RULES` order. */
const MERGED_TABLES: readonly string[] = Object.entries(MERGE_RULES)
  .filter(([, rule]) => rule.scope === 'merged')
  .map(([table]) => table);

/** The columns every carried table must hold. */
const ORIGIN_COLUMNS = ['origin_store', 'origin_seq'] as const;

/** Whether `value` is a plain JSON object. */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Whether `value` is a count `seq` or a cursor can hold. */
function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Whether a merged table of this name exists. */
function isMergedTable(name: string): boolean {
  return MERGED_TABLES.includes(name);
}

/** The cursor, checked: merged tables only, each a non-negative whole number. */
function checkCursor(value: unknown): WireCursor {
  if (!isRecord(value)) throw new WireFormatError('wire: cursor is not an object');
  const entries = Object.entries(value).map(([table, seq]): [string, number] => {
    if (!isMergedTable(table)) throw new WireFormatError(`wire: cursor names ${JSON.stringify(table)}, which is no merged table`);
    if (!isCount(seq)) throw new WireFormatError(`wire: cursor for ${table} is ${JSON.stringify(seq)}, expected a whole number of 0 or more`);
    return [table, seq];
  });
  return Object.freeze(Object.fromEntries(entries));
}

/** One row, checked: every value a string, a finite number or null, and `seq` a positive whole number. */
function checkRow(table: string, value: unknown, index: number): WireRow {
  const where = `wire: ${table} row ${String(index)}`;
  if (!isRecord(value)) throw new WireFormatError(`${where} is not an object`);
  for (const [column, cell] of Object.entries(value)) {
    const carried = cell === null || typeof cell === 'string' || (typeof cell === 'number' && Number.isFinite(cell));
    if (!carried) throw new WireFormatError(`${where} holds ${JSON.stringify(cell) ?? typeof cell} in ${column}, expected a string, a number or null`);
  }
  const seq = value.seq;
  if (!isCount(seq) || seq === 0) throw new WireFormatError(`${where} has seq ${JSON.stringify(seq) ?? 'undefined'}, expected a whole number above 0`);
  return Object.freeze({ ...value }) as WireRow;
}

/** The migration ids, checked: non-empty strings, none twice. */
function checkMigrations(value: unknown): readonly string[] {
  if (!Array.isArray(value)) throw new WireFormatError('wire: migrations is not a list');
  const ids = value.map((id: unknown) => {
    if (typeof id !== 'string' || id === '') throw new WireFormatError(`wire: migration id ${JSON.stringify(id)} is not a name`);
    return id;
  });
  const twice = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (twice.length > 0) throw new WireFormatError(`wire: migrations name ${twice.join(', ')} more than once`);
  return Object.freeze(ids);
}

/** The tables, checked: merged tables only, each a list of rows. */
function checkTables(value: unknown): WirePayload['tables'] {
  if (!isRecord(value)) throw new WireFormatError('wire: tables is not an object');
  const entries = Object.entries(value).map(([table, rows]): [string, readonly WireRow[]] => {
    if (!isMergedTable(table)) throw new WireFormatError(`wire: tables names ${JSON.stringify(table)}, which is no merged table`);
    if (!Array.isArray(rows)) throw new WireFormatError(`wire: tables.${table} is not a list`);
    return [table, Object.freeze(rows.map((row: unknown, index) => checkRow(table, row, index)))];
  });
  return Object.freeze(Object.fromEntries(entries));
}

/** A payload, checked whole and copied; throws {@link WireFormatError} naming the first fault. */
function checkPayload(value: unknown): WirePayload {
  if (!isRecord(value)) throw new WireFormatError('wire: the payload is not an object');
  if (value.format !== WIRE_FORMAT) throw new WireFormatError(`wire: format is ${JSON.stringify(value.format) ?? 'undefined'}, expected ${JSON.stringify(WIRE_FORMAT)}`);
  if (value.version !== WIRE_VERSION) throw new WireFormatError(`wire: version is ${JSON.stringify(value.version) ?? 'undefined'}; this rafa reads version ${String(WIRE_VERSION)}`);
  return Object.freeze({
    format: WIRE_FORMAT,
    version: WIRE_VERSION,
    migrations: checkMigrations(value.migrations),
    tables: checkTables(value.tables),
    cursor: checkCursor(value.cursor),
  });
}

/** The payload as the JSON text the wire carries. */
export function encodeWirePayload(payload: WirePayload): string {
  return JSON.stringify(payload);
}

/** The payload `text` spells, checked whole; throws {@link WireFormatError} on anything else. */
export function decodeWirePayload(text: string): WirePayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const reason = error instanceof Error
      ? error.message
      : String(error);
    throw new WireFormatError(`wire: the payload is not JSON (${reason})`);
  }
  return checkPayload(parsed);
}

/** The ids of the store's migration log in apply order, or null when it has none. */
function readLoggedIds(db: Database): readonly string[] | null {
  const hasLog = db
    .query<{ name: string }, [string]>('SELECT name FROM sqlite_master WHERE type = \'table\' AND name = ?')
    .get(MIGRATION_LOG_TABLE) !== null;
  if (!hasLog) return null;
  return db
    .query<{ id: string }, []>(`SELECT id FROM ${MIGRATION_LOG_TABLE} ORDER BY seq`)
    .all()
    .map(({ id }) => id);
}

/** A table's columns in declared order, empty when the store has no such table. */
function columnsOf(db: Database, table: string): readonly string[] {
  return db
    .query<{ name: string }, []>(`PRAGMA table_info(${quoted(table)})`)
    .all()
    .map(({ name }) => name);
}

/** One read value as the wire carries it, or a refusal naming where it sits. */
function wireValue(value: ReadValue, where: string): WireValue {
  if (typeof value === 'bigint') {
    const number = Number(value);
    if (Number.isSafeInteger(number)) return number;
    throw new WireExportRefusal(`wire: ${where} holds ${String(value)}, past the whole numbers JSON carries exactly`);
  }
  if (value instanceof Uint8Array) throw new WireExportRefusal(`wire: ${where} holds a BLOB, which the wire does not carry`);
  return value;
}

/** The rows of `table` past `after`, every one of `columns` by name, in `seq` order, as the wire carries them. */
function readRows(db: Database, table: string, columns: readonly string[], after: number, path: string): readonly WireRow[] {
  const named = columns.map(quoted).join(', ');
  return db
    .query<Record<string, ReadValue>, [number]>(`SELECT ${named} FROM ${quoted(table)} WHERE seq > ? ORDER BY seq`)
    .all(after)
    .map((row) => Object.freeze(Object.fromEntries(Object.entries(row).map(([column, value]) => [
      column,
      wireValue(value, `${path} ${table}.${column} at seq ${String(row.seq)}`),
    ]))));
}

/** The payload of one read transaction on `db`. */
function readPayload(db: Database, path: string, cursor: WireCursor): WirePayload {
  const migrations = readLoggedIds(db);
  if (migrations === null) {
    throw new WireExportRefusal(`wire: ${path} has no migration log; any rafa command that writes the store brings it forward`);
  }
  const tables: Record<string, readonly WireRow[]> = {};
  const next: Record<string, number> = { ...cursor };
  for (const table of MERGED_TABLES) {
    const columns = columnsOf(db, table);
    if (columns.length === 0) continue;
    const missing = ORIGIN_COLUMNS.filter((column) => !columns.includes(column));
    if (missing.length > 0) {
      throw new WireExportRefusal(`wire: ${path} holds no ${missing.map((column) => `${table}.${column}`).join(', ')}, so its rows carry no origin pair`);
    }
    const rows = readRows(db, table, columns, cursor[table] ?? 0, path);
    tables[table] = Object.freeze(rows);
    const last = rows[rows.length - 1];
    next[table] = last === undefined
      ? cursor[table] ?? 0
      : Number(last.seq);
  }
  return Object.freeze({
    format: WIRE_FORMAT,
    version: WIRE_VERSION,
    migrations: Object.freeze([...migrations]),
    tables: Object.freeze(tables),
    cursor: Object.freeze(next),
  });
}

/**
 * The rows of the store at `options.path` past `options.cursor`, with
 * its migration ids and the cursor to send next. Only reads. Throws
 * {@link WireExportRefusal} for a store it will not read and
 * {@link WireFormatError} for a cursor it cannot; see the module note.
 */
export function exportWirePayload(options: WireExportOptions): WirePayload {
  const { path } = options;
  const cursor = checkCursor(options.cursor ?? {});
  guardTestProcess(path);
  if (!existsSync(path)) throw new WireExportRefusal(`wire: ${path} is not there`);
  const db = new Database(path, { readonly: true, safeIntegers: true });
  try {
    db.run(`PRAGMA busy_timeout = ${String(activeStoreSettings().busyTimeoutMs)}`);
    return db.transaction(() => readPayload(db, path, cursor))();
  } finally {
    db.close();
  }
}

/** The catalogue entries the payload names, in catalogue order; refuses an id this rafa does not know. */
function namedMigrations(ids: readonly string[], catalogue: readonly SqliteMigration[]): readonly SqliteMigration[] {
  const known = new Set(catalogue.map(({ id }) => id));
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new WireFormatError(`wire: the payload's store holds migration ${unknown.join(', ')}, which this rafa does not know; update rafa to take its rows`);
  }
  return catalogue.filter(({ id }) => ids.includes(id));
}

/** Inserts one table's rows as sent, refusing a row whose columns are not exactly the table's. */
function insertRows(db: Database, table: string, rows: readonly WireRow[]): void {
  const columns = columnsOf(db, table);
  if (columns.length === 0) throw new WireFormatError(`wire: the payload carries ${table}, which its migrations do not make`);
  const statement = db.query<unknown, WireValue[]>(
    `INSERT INTO ${quoted(table)} (${columns.map(quoted).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
  );
  const expected = [...columns].sort().join(',');
  rows.forEach((row, index) => {
    const where = `wire: ${table} row ${String(index)}`;
    const held = Object.keys(row);
    if ([...held].sort().join(',') !== expected) {
      throw new WireFormatError(`${where} holds columns ${held.join(', ')}; its migrations make ${columns.join(', ')}`);
    }
    try {
      statement.run(...columns.map((column) => row[column] ?? null));
    } catch (error) {
      if (!(error instanceof SQLiteError)) throw error;
      throw new WireFormatError(`${where} (seq ${String(row.seq)}) is refused by the table: ${error.message}`);
    }
  });
}

/** Builds the payload's store at `path`. */
function buildStore(path: string, payload: WirePayload, options: MaterialiseOptions): void {
  const migrations = namedMigrations(payload.migrations, options.migrations ?? SQLITE_MIGRATIONS);
  const db = new Database(path, { create: true, readwrite: true });
  try {
    bringForward(db, path, 'write', 'open', {
      migrations,
      appliedBy: appliedByName(options.identity ?? readRuntimeIdentity()),
      now: options.now,
      builtAside: true,
    });
    db.transaction(() => {
      for (const [table, rows] of Object.entries(payload.tables)) insertRows(db, table, rows);
    })();
  } finally {
    db.close();
  }
}

/**
 * Builds `payload` into `effort.sqlite` in a new directory under the
 * temporary directory, the file `mergeStore` reads as `otherPath`. The
 * caller calls `release` once the merge is done. Throws
 * {@link WireFormatError}, having left nothing behind, for a payload it
 * cannot build; see the module note.
 */
export function materialiseWirePayload(payload: WirePayload, options: MaterialiseOptions = {}): MaterialisedWire {
  const checked = checkPayload(payload);
  const directory = mkdtempSync(join(options.tempDir ?? tmpdir(), 'rafa-wire-'));
  const release = (): void => rmSync(directory, { recursive: true, force: true });
  const path = join(directory, SQLITE_STORE_FILE_NAME);
  try {
    guardTestProcess(path);
    buildStore(path, checked, options);
  } catch (error) {
    release();
    throw error;
  }
  return Object.freeze({ directory, path, release });
}
