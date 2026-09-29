/**
 * The anonymised extract of two real stores that the merge's fixtures
 * are made from: both stores read in one run, every value that could
 * carry source text replaced by a keyed-hash placeholder, and each
 * merged table sampled around the point where the two stores diverged.
 * `scripts/extract-merge-fixture.ts` is its command line.
 *
 * ## The mapping
 *
 * One run draws a random 32-byte key, maps every replaced string through
 * HMAC-SHA256 under it, and zeroes the key when the run ends. The key is
 * never written, returned or logged, so nobody holding an extract can
 * map a placeholder back to its value or test a guess against it, and
 * two runs over the same stores give different placeholders. Within one
 * run the map is shared by both stores and by every table and column, so
 * the same value becomes the same placeholder wherever it stands: a
 * session id in `sessions`, in a finding and inside a `row_json`, or an
 * artifact string two findings share. The map is injective by check
 * rather than by trust: a second value reaching a placeholder already
 * taken throws ({@link PlaceholderCollision}), since two values merged
 * into one would forge an overlap the stores do not hold.
 *
 * ## What is replaced and what is kept
 *
 * Replacement is the default, per value:
 *
 *   - NULL stays NULL, the empty string stays empty, and a number is
 *     kept, so which fields are filled, every count and every CHECK on
 *     either survives. `store_meta`'s `file_dev` and `file_ino` describe
 *     the source file and become 0.
 *   - A string shaped as an ISO 8601 timestamp is kept, so the rows'
 *     times and their order survive, inside JSON as well.
 *   - A string in one of the {@link KEPT_COLUMNS} is kept when it passes
 *     that column's shape: the closed vocabularies (a finding's `kind`,
 *     a report's `outcome`, a change's `level`) as a lowercase word, and
 *     the migration log's ids, checksums and `breaks` words, which are
 *     rafa's own code. A value failing the shape is replaced.
 *   - A string in one of the {@link JSON_COLUMNS} is parsed and mapped
 *     leaf by leaf, so an array keeps its length and an object its
 *     shape: an object key is kept when it is a camelCase identifier,
 *     as every key of the row schemas is, and replaced otherwise, as a
 *     branch name holding a slash or a model name holding a dash is.
 *     A one-word key of a count map passes as an identifier and is
 *     kept: over a copy of this project's store on 2026-09-29 those
 *     were `main`, `cli`, `system`, the record types and the effort
 *     levels. A value that does not parse is replaced whole.
 *   - Every other string is replaced: row, session and store ids, shas,
 *     task text, finding prose, causes, resolutions, file paths,
 *     `tracker_ref` values, artifact strings, host ids and remotes.
 *
 * A BLOB throws: no table holds one, and there is no placeholder for it.
 *
 * ## Overlap and sampling
 *
 * A row of a merged table overlaps when the other store holds a row the
 * union (`merge-union.ts`) would match it to: the same origin pair, or
 * failing that the same values in the table's identity columns from
 * `MERGE_RULES`. Overlapping rows come in pairs, one on each side, and
 * the extract keeps the last `overlap` pairs in store B's order, both
 * rows of each: the shared rows nearest the divergence point, 200 unless
 * the caller says otherwise, or every pair under `all`. A pair is kept
 * or dropped whole, since keeping one row of it would turn a shared row
 * into one only that side holds. Then on each side it keeps the first
 * `perSide` rows the other side does not hold, in `seq` order: the rows
 * just past the divergence point, 200 each unless the caller says
 * otherwise. A `local` table, and any table the registry does not name,
 * is kept whole, as small and describing one file. Each kept row keeps
 * its `seq`.
 *
 * The overlap cap exists because a copy shares its whole history with
 * the store it came from: over this project's two stores on 2026-09-29
 * every overlapping row made an 8.2 MB extract, 934 shared sessions and
 * 2,275 shared findings of it, for a test that needs the shared rows'
 * shape and not their number.
 *
 * ## The files
 *
 * {@link writeExtract} writes three files under the directory it is
 * given and nowhere else, refusing to replace one already there: one
 * {@link ExtractSide} per store, holding its `user_version`, its schema
 * as the store's own DDL, and its kept rows, and a summary of counts.
 * They are JSON, for a person to review before any is committed, and
 * {@link restoreExtractSide} builds a store file from a side again.
 *
 * Both stores are opened read-only. Every path is passed through the
 * test guard (`guardTestProcess`, `location.ts`) first, so a test reads
 * and writes under `tmpdir()` only.
 */
import type { SQLQueryBindings } from 'bun:sqlite';

import { createHmac, getRandomValues } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { Database } from 'bun:sqlite';

import { guardTestProcess } from './location.js';
import { MERGE_RULES } from './merge-rules.js';
import { quoted } from './rebuild-aside.js';

/** The rows kept on each side beyond the overlap, per merged table, unless the caller says otherwise. */
export const DEFAULT_PER_SIDE = 200;

/** The overlapping pairs kept per merged table, unless the caller says otherwise. */
export const DEFAULT_OVERLAP = 200;

/** How many overlapping pairs a merged table keeps: a whole number above zero, or every pair. */
export type OverlapCap = number | 'all';

/** What an extract file's `format` names. */
export const EXTRACT_FORMAT = 'rafa-merge-fixture/1';

/** The file names {@link writeExtract} writes under its directory. */
export const EXTRACT_FILE_NAMES = { a: 'a.json', b: 'b.json', summary: 'summary.json' } as const;

/** Every placeholder starts so; the colon keeps it apart from every kept word and timestamp. */
const PLACEHOLDER_PREFIX = 'anon:';

/** Hex digits of the HMAC a placeholder keeps: 96 bits. */
const PLACEHOLDER_HEX_LENGTH = 24;

/** Bytes of the key one run draws. */
const KEY_BYTES = 32;

/** An ISO 8601 date and time, with seconds, fraction and zone as rafa and git write them. */
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

/** A closed-vocabulary word. */
const WORD = /^[a-z][a-z0-9-]{0,31}$/;

/** A sha256 in lowercase hex. */
const SHA256_HEX = /^[0-9a-f]{64}$/;

/** A JSON object key kept as it is. */
const SCHEMA_KEY = /^[a-z][a-zA-Z0-9]{0,63}$/;

/** A kept column's check on the value it holds. */
type ShapeCheck = (value: string) => boolean;

/** True for a closed-vocabulary word. */
const isWord: ShapeCheck = (value) => WORD.test(value);

/** True for a JSON array of words, as the migration log's `breaks`. */
const isWordArray: ShapeCheck = (value) => {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((word) => typeof word === 'string' && isWord(word));
  } catch {
    return false;
  }
};

/** The columns whose values are kept when they pass the column's shape, as `table.column`. */
export const KEPT_COLUMNS: Readonly<Record<string, ShapeCheck>> = {
  'findings.kind': isWord,
  'findings.signal': isWord,
  'findings.outcome': isWord,
  'blockers.outcome': isWord,
  'out_of_scope_bugs.outcome': isWord,
  'out_of_scope_bugs.scope': isWord,
  'report_absences.reason': isWord,
  'report_absences.outcome': isWord,
  'task_reports.status': isWord,
  'task_reports.outcome': isWord,
  'changes.level': isWord,
  'preflight.tier': isWord,
  'preflight.kind': isWord,
  'preflight.outcome': isWord,
  'plan_ci.verdict': isWord,
  'dispatches.resolver': isWord,
  'schema_migrations.id': isWord,
  'schema_migrations.sha256': (value) => SHA256_HEX.test(value),
  'schema_migrations.breaks': isWordArray,
};

/** The columns holding JSON, mapped leaf by leaf, as `table.column`. */
export const JSON_COLUMNS: ReadonlySet<string> = new Set([
  'sessions.row_json',
  'commits.row_json',
  'dispatches.flags',
  'dispatches.skills_offered',
  'dispatches.lessons_offered',
  'task_reports.skills_used',
  'plan_ci.failing',
  'merge_conflicts.incoming',
]);

/** The integer columns describing the source file, written as 0. */
const ZEROED_COLUMNS: ReadonlySet<string> = new Set(['store_meta.file_dev', 'store_meta.file_ino']);

/** One value as an extract holds it. */
export type ExtractValue = string | number | null;

/** One table of one side: its columns in table order, and its kept rows in `rowid` order. */
export interface ExtractTable {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly ExtractValue[])[];
}

/** Which of the two stores a side was read from. */
export type SideName = 'a' | 'b';

/** One store's extract. */
export interface ExtractSide {
  readonly format: typeof EXTRACT_FORMAT;
  readonly side: SideName;
  /** The store's `PRAGMA user_version`. */
  readonly userVersion: number;
  /** The store's own DDL, tables and indexes, in the order it was created. */
  readonly schema: readonly string[];
  readonly tables: Readonly<Record<string, ExtractTable>>;
}

/** What the extract found and kept of one table. */
export interface TableSummary {
  readonly table: string;
  readonly rowsA: number;
  readonly rowsB: number;
  /** Rows of each side the other side holds; the same count on both. */
  readonly overlap: number;
  /** Overlapping pairs kept, both rows of each; at most the overlap cap. */
  readonly overlapKept: number;
  readonly keptA: number;
  readonly keptB: number;
}

/** A run's answer: both sides and the summary, in table order. */
export interface Extract {
  readonly a: ExtractSide;
  readonly b: ExtractSide;
  readonly perSide: number;
  readonly overlap: OverlapCap;
  readonly summary: readonly TableSummary[];
}

/** Two different values reached one placeholder. */
export class PlaceholderCollision extends Error {
  constructor(placeholder: string) {
    super(`two values reached the placeholder ${placeholder}; run the extract again for a new key`);
    this.name = 'PlaceholderCollision';
  }
}

/** Maps a replaced value to its placeholder, the same one each time. */
export type PlaceholderMap = (value: string) => string;

/**
 * A placeholder map over `digest`, which answers a value's hex digest:
 * each value's placeholder is remembered, and a second value reaching a
 * taken placeholder throws {@link PlaceholderCollision}.
 */
export function createPlaceholderMap(digest: (value: string) => string): PlaceholderMap {
  const byValue = new Map<string, string>();
  const byPlaceholder = new Map<string, string>();
  return (value) => {
    const known = byValue.get(value);
    if (known !== undefined) return known;
    const placeholder = PLACEHOLDER_PREFIX + digest(value).slice(0, PLACEHOLDER_HEX_LENGTH);
    const holder = byPlaceholder.get(placeholder);
    if (holder !== undefined && holder !== value) throw new PlaceholderCollision(placeholder);
    byValue.set(value, placeholder);
    byPlaceholder.set(placeholder, value);
    return placeholder;
  };
}

/** Maps a parsed JSON value leaf by leaf, as the module note says. */
function mapJson(value: unknown, map: PlaceholderMap): unknown {
  if (typeof value === 'string') return mapFreeString(value, map);
  if (Array.isArray(value)) return value.map((item) => mapJson(item, map));
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      SCHEMA_KEY.test(key)
        ? key
        : map(key),
      mapJson(item, map),
    ]));
  }
  return value;
}

/** A string no column rule keeps: empty and timestamps kept, everything else mapped. */
function mapFreeString(value: string, map: PlaceholderMap): string {
  if (value === '' || ISO_TIMESTAMP.test(value)) return value;
  return map(value);
}

/** A JSON column's value, mapped leaf by leaf, or whole when it does not parse. */
function mapJsonText(value: string, map: PlaceholderMap): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return mapFreeString(value, map);
  }
  return JSON.stringify(mapJson(parsed, map));
}

/** One stored value of `table.column`, as the extract holds it. */
export function anonymiseValue(table: string, column: string, value: SQLQueryBindings, map: PlaceholderMap): ExtractValue {
  const qualified = `${table}.${column}`;
  if (value === null || value === undefined) return null;
  if (ZEROED_COLUMNS.has(qualified)) return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'boolean') return Number(value);
  if (typeof value !== 'string') throw new Error(`${qualified} holds a BLOB, which the extract has no placeholder for`);
  if (KEPT_COLUMNS[qualified]?.(value) === true) return value;
  if (JSON_COLUMNS.has(qualified)) return mapJsonText(value, map);
  return mapFreeString(value, map);
}

/** One row as the store holds it, by column name. */
type StoredRow = Readonly<Record<string, SQLQueryBindings>>;

/** One table of one store, read whole. */
interface ReadTable {
  readonly columns: readonly string[];
  readonly rows: readonly StoredRow[];
}

/** One store, read whole. */
interface ReadStore {
  readonly userVersion: number;
  readonly schema: readonly string[];
  readonly tables: ReadonlyMap<string, ReadTable>;
}

/** Reads every table of `db`, its DDL and its `user_version`. */
function readStore(db: Database): ReadStore {
  const userVersion = db.query<{ user_version: number }, []>('PRAGMA user_version').get()?.user_version ?? 0;
  const schema = db
    .query<{ sql: string }, []>(
      'SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND type IN (\'table\', \'index\') ORDER BY rowid',
    )
    .all()
    .map(({ sql }) => sql);
  const names = db
    .query<{ name: string }, []>('SELECT name FROM sqlite_master WHERE type = \'table\' AND name NOT LIKE \'sqlite_%\' ORDER BY rowid')
    .all()
    .map(({ name }) => name);
  const tables = new Map(names.map((name): [string, ReadTable] => [name, readTable(db, name)]));
  return { userVersion, schema, tables };
}

/** Every row of `table`, each column named, in `rowid` order. */
function readTable(db: Database, table: string): ReadTable {
  const columns = db
    .query<{ name: string }, []>(`PRAGMA table_info(${quoted(table)})`)
    .all()
    .map(({ name }) => name);
  const rows = db
    .query<StoredRow, []>(`SELECT ${columns.map(quoted).join(', ')} FROM ${quoted(table)} ORDER BY rowid`)
    .all();
  return { columns, rows };
}

/** A row's origin pair as a key, or null when either half is NULL. */
function originKey(row: StoredRow): string | null {
  const store = row['origin_store'] ?? null;
  const seq = row['origin_seq'] ?? null;
  return store === null || seq === null
    ? null
    : JSON.stringify([store, seq]);
}

/** A row's identity values as a key; two NULLs are equal, as `IS` counts them. */
function identityKey(row: StoredRow, identity: readonly string[]): string {
  return JSON.stringify(identity.map((column) => row[column] ?? null));
}

/** One overlapping row of each side: its position in A and in B. */
type OverlapPair = readonly [a: number, b: number];

/** The overlapping rows of the two sides, paired as the union matches them, in B's order. */
function overlapOf(rowsA: readonly StoredRow[], rowsB: readonly StoredRow[], identity: readonly string[]): readonly OverlapPair[] {
  const byOrigin = new Map<string, number>();
  const byIdentity = new Map<string, number>();
  rowsA.forEach((row, index) => {
    const origin = originKey(row);
    if (origin !== null && !byOrigin.has(origin)) byOrigin.set(origin, index);
    const key = identityKey(row, identity);
    if (!byIdentity.has(key)) byIdentity.set(key, index);
  });
  return rowsB.flatMap((row, index): OverlapPair[] => {
    const origin = originKey(row);
    const match = (origin === null
      ? undefined
      : byOrigin.get(origin)) ?? byIdentity.get(identityKey(row, identity));
    return match === undefined
      ? []
      : [[match, index]];
  });
}

/** The pairs kept under `cap`: the last ones in B's order, nearest the divergence point. */
function cappedPairs(pairs: readonly OverlapPair[], cap: OverlapCap): readonly OverlapPair[] {
  return cap === 'all' || pairs.length <= cap
    ? pairs
    : pairs.slice(pairs.length - cap);
}

/**
 * The positions kept of one side: its rows of the kept pairs, then the
 * first `perSide` of the rows no pair holds. `overlap` is every position
 * of this side a pair holds, kept or not, so a dropped shared row is
 * never taken for one past the divergence.
 */
function sampled(count: number, overlap: ReadonlySet<number>, keptPairs: ReadonlySet<number>, perSide: number): number[] {
  const rest = Array.from({ length: count }, (_, index) => index).filter((index) => !overlap.has(index));
  const kept = new Set([...keptPairs, ...rest.slice(0, perSide)]);
  return Array.from({ length: count }, (_, index) => index).filter((index) => kept.has(index));
}

/** The kept rows of one table of one side, mapped. */
function mappedTable(table: string, read: ReadTable, kept: readonly number[], map: PlaceholderMap): ExtractTable {
  return {
    columns: read.columns,
    rows: kept.map((index) => {
      const row = read.rows[index] ?? {};
      return read.columns.map((column) => anonymiseValue(table, column, row[column] ?? null, map));
    }),
  };
}

/** One side of the extract. The DDL is rafa's code, not the store's data, and is kept whole. */
function sideOf(side: SideName, store: ReadStore, tables: Record<string, ExtractTable>): ExtractSide {
  return { format: EXTRACT_FORMAT, side, userVersion: store.userVersion, schema: store.schema, tables };
}

/** An empty table for a side that lacks it. */
const NO_TABLE: ReadTable = { columns: [], rows: [] };

/** Throws unless `perSide` is a whole number of rows. */
function checkPerSide(perSide: number): void {
  if (!Number.isSafeInteger(perSide) || perSide < 0) {
    throw new Error(`per-side sample ${String(perSide)} is not a whole number of rows`);
  }
}

/**
 * Throws unless `cap` is `all` or a whole number above zero. Zero is
 * refused rather than read as "none": an extract keeping no shared row
 * is no longer a copy then divergence, and `all` spells "no cap".
 */
function checkOverlapCap(cap: OverlapCap): void {
  if (cap === 'all') return;
  if (!Number.isSafeInteger(cap) || cap < 1) {
    throw new Error(`overlap cap ${String(cap)} is not a whole number of rows above zero; use all to keep every overlapping row`);
  }
}

/** Opens a store read-only, naming it when it is absent. */
function openReadOnly(path: string): Database {
  guardTestProcess(path);
  if (!existsSync(path)) throw new Error(`no store at ${path}`);
  return new Database(path, { readonly: true });
}

/** The extract of two read stores under `map`. */
function extractRead(storeA: ReadStore, storeB: ReadStore, perSide: number, cap: OverlapCap, map: PlaceholderMap): Extract {
  const names = [...new Set([...storeA.tables.keys(), ...storeB.tables.keys()])];
  const tablesA: Record<string, ExtractTable> = {};
  const tablesB: Record<string, ExtractTable> = {};
  const summary = names.map((table): TableSummary => {
    const readA = storeA.tables.get(table) ?? NO_TABLE;
    const readB = storeB.tables.get(table) ?? NO_TABLE;
    const rule = MERGE_RULES[table];
    const merged = rule?.scope === 'merged';
    const pairs = merged
      ? overlapOf(readA.rows, readB.rows, rule.identity)
      : [];
    const kept = cappedPairs(pairs, cap);
    const positions = (list: readonly OverlapPair[], side: 0 | 1): Set<number> => new Set(list.map((pair) => pair[side]));
    const whole = (count: number): number[] => Array.from({ length: count }, (_, index) => index);
    const keptA = merged
      ? sampled(readA.rows.length, positions(pairs, 0), positions(kept, 0), perSide)
      : whole(readA.rows.length);
    const keptB = merged
      ? sampled(readB.rows.length, positions(pairs, 1), positions(kept, 1), perSide)
      : whole(readB.rows.length);
    if (storeA.tables.has(table)) tablesA[table] = mappedTable(table, readA, keptA, map);
    if (storeB.tables.has(table)) tablesB[table] = mappedTable(table, readB, keptB, map);
    return {
      table, rowsA: readA.rows.length, rowsB: readB.rows.length, overlap: pairs.length,
      overlapKept: kept.length, keptA: keptA.length, keptB: keptB.length,
    };
  });
  return { a: sideOf('a', storeA, tablesA), b: sideOf('b', storeB, tablesB), perSide, overlap: cap, summary };
}

/**
 * Reads the stores at `pathA` and `pathB` read-only and answers their
 * extract under a key drawn for this call and zeroed before it returns,
 * as the module note says.
 */
export function extractStores(
  pathA: string,
  pathB: string,
  perSide: number = DEFAULT_PER_SIDE,
  overlap: OverlapCap = DEFAULT_OVERLAP,
): Extract {
  checkPerSide(perSide);
  checkOverlapCap(overlap);
  const dbA = openReadOnly(pathA);
  try {
    const dbB = openReadOnly(pathB);
    try {
      const key = getRandomValues(new Uint8Array(KEY_BYTES));
      try {
        const map = createPlaceholderMap((value) => createHmac('sha256', key)
          .update(value, 'utf8')
          .digest('hex'));
        return extractRead(readStore(dbA), readStore(dbB), perSide, overlap, map);
      } finally {
        key.fill(0);
      }
    } finally {
      dbB.close();
    }
  } finally {
    dbA.close();
  }
}

/** One file's content: pretty JSON with a closing newline. */
function jsonText(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * Writes `extract` under `outDir` as {@link EXTRACT_FILE_NAMES}, making
 * the directory when absent, and answers the paths written. Refuses,
 * writing nothing, when any of the three files is already there.
 */
export function writeExtract(extract: Extract, outDir: string): readonly string[] {
  guardTestProcess(outDir);
  const files: readonly [string, unknown][] = [
    [join(outDir, EXTRACT_FILE_NAMES.a), extract.a],
    [join(outDir, EXTRACT_FILE_NAMES.b), extract.b],
    [
      join(outDir, EXTRACT_FILE_NAMES.summary),
      { format: EXTRACT_FORMAT, perSide: extract.perSide, overlap: extract.overlap, tables: extract.summary },
    ],
  ];
  const present = files.map(([path]) => path).filter((path) => existsSync(path));
  if (present.length > 0) throw new Error(`the extract would replace ${present.join(', ')}; remove it first`);
  mkdirSync(outDir, { recursive: true });
  for (const [path, content] of files) writeFileSync(path, jsonText(content), { flag: 'wx' });
  return files.map(([path]) => path);
}

/** True for a value an extract row may hold. */
function isExtractValue(value: unknown): value is ExtractValue {
  return value === null || typeof value === 'string' || typeof value === 'number';
}

/** Throws unless `value` is one table of an extract. */
function checkTable(name: string, value: unknown): void {
  const table = value as Partial<ExtractTable> | null;
  const columns = table?.columns;
  const rows = table?.rows;
  if (!Array.isArray(columns) || !columns.every((column) => typeof column === 'string') || !Array.isArray(rows)) {
    throw new Error(`table ${name} holds no columns and rows`);
  }
  const bad = rows.findIndex((row) => !Array.isArray(row) || row.length !== columns.length || !row.every(isExtractValue));
  if (bad >= 0) throw new Error(`table ${name} row ${String(bad)} does not match its ${String(columns.length)} columns`);
}

/** Reads and checks one side written by {@link writeExtract}. */
export function readExtractSide(path: string): ExtractSide {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<ExtractSide> | null;
  const fault = (what: string): Error => new Error(`${path} is not a merge fixture extract: ${what}`);
  if (parsed?.format !== EXTRACT_FORMAT) throw fault(`its format is not ${EXTRACT_FORMAT}`);
  if (parsed.side !== 'a' && parsed.side !== 'b') throw fault('it names no side');
  if (!Number.isSafeInteger(parsed.userVersion)) throw fault('it holds no user_version');
  if (!Array.isArray(parsed.schema) || !parsed.schema.every((sql) => typeof sql === 'string')) throw fault('it holds no schema');
  if (typeof parsed.tables !== 'object' || parsed.tables === null) throw fault('it holds no tables');
  try {
    for (const [name, table] of Object.entries(parsed.tables)) checkTable(name, table);
  } catch (error) {
    throw fault(error instanceof Error
      ? error.message
      : String(error));
  }
  return parsed as ExtractSide;
}

/**
 * Builds a store file at `path` from one side: its DDL, its rows, then
 * its `user_version`, in one transaction. Refuses a path already there.
 */
export function restoreExtractSide(side: ExtractSide, path: string): void {
  guardTestProcess(path);
  if (existsSync(path)) throw new Error(`a file is already at ${path}`);
  const db = new Database(path, { create: true });
  try {
    db.transaction(() => {
      for (const sql of side.schema) db.run(sql);
      for (const [table, { columns, rows }] of Object.entries(side.tables)) {
        if (columns.length === 0) continue;
        const insert = db.query<unknown, SQLQueryBindings[]>(
          `INSERT INTO ${quoted(table)} (${columns.map(quoted).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
        );
        for (const row of rows) insert.run(...row);
      }
      db.run(`PRAGMA user_version = ${String(side.userVersion)}`);
    })();
  } finally {
    db.close();
  }
}
