/**
 * The rebuild-beside routine: an index file is never changed in place.
 * {@link rebuildIndex} builds a new one beside it from the store's rows,
 * checks it, and swaps it in with one rename. It mirrors the steps of
 * core's build-aside convention (`rebuild-aside.ts` in the effort store)
 * without importing it, since this package imports nothing from core.
 *
 * ## The steps
 *
 * 1. Refuse while a rollback journal or write-ahead log sits beside the
 *    index file: either means a write to it is in flight or was
 *    interrupted, and nothing but this routine's rename should change it.
 * 2. Refuse when the parallel file, `<index>.rebuild-<stamp>`, is
 *    already there, so two runs never overwrite each other's file. A
 *    refused run leaves that file where it found it.
 * 3. Build the parallel file: open it through the loader, which runs
 *    before the store is opened so macOS's library can still be named,
 *    create the schema, then read the store, opened read-only, and write
 *    one full-text row per row read and, with vector search on, one
 *    vector row per row read. The parallel file is closed once written.
 * 4. Check the parallel file on a connection of its own, so the bytes
 *    checked are the ones the rename swaps in: `PRAGMA integrity_check`
 *    must answer `ok`, and every index table ({@link indexTables}) must
 *    hold the rows the build read, the metadata table one.
 * 5. Run the test hook {@link RebuildIndexHooks.beforeSwap}, then rename
 *    the parallel file over the index file, which replaces it in one
 *    step: a reader that opened the old file keeps reading it, and one
 *    opening the name afterwards reads the new file.
 *
 * Any failure from step 3 on removes the parallel file with its journal
 * and log and leaves the index file untouched. No backup is kept: the
 * index is derived from the store, so it is rebuilt, never restored.
 *
 * ## What is read
 *
 * The caller names the store tables, and each must carry the origin pair
 * (`origin_store`, `origin_seq`). A row is indexed under its table and
 * origin pair, and its body is the row's text columns other than
 * `origin_store`, in column order, the null ones left out, joined by a
 * newline. A text column is one SQLite gives text affinity: its declared
 * type, read with `PRAGMA table_info` at rebuild, holds `CHAR`, `CLOB` or
 * `TEXT` and no `INT`. A row whose origin pair is null names no row a
 * search can answer, so it is not read.
 *
 * ## Vectors
 *
 * Vector search is on when the loader answered `vector: true` and an
 * {@link IndexEmbedder} was given. Without an embedder no vector table
 * is made, the answer's why is `no embedder configured`, and the
 * metadata row records {@link UNEMBEDDED_DIMENSION}, as the schema takes
 * no dimension below 1: a reader reads the dimension only when the
 * vector table is there. Bodies are embedded {@link EMBED_BATCH} at a
 * time, and an embedder that answers another count of vectors, or a
 * vector of another length than its dimension, fails the rebuild.
 *
 * ## The store
 *
 * The store file is only ever opened read-only, and read in one read
 * transaction so every table is read at one point of its history. A
 * read-only open of a store in rollback-journal mode writes no file, so
 * the store's bytes are the same before and after.
 */
import type { LoaderState, PrepareOptions, VectorAnswer } from './loader.js';
import type { Database } from 'bun:sqlite';

import { existsSync, renameSync, rmSync } from 'node:fs';

import { loadVector, openDatabase, openWithVector } from './loader.js';
import { createIndexSchema, FTS_TABLE, indexTables, META_TABLE, VECTOR_TABLE } from './schema.js';

/** A rebuild refused before the index file was changed. */
export class IndexRebuildRefusal extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'IndexRebuildRefusal';
  }
}

/** The embedder a rebuild hands each batch of bodies to. */
export interface IndexEmbedder {
  /** The length of every vector it answers, a whole number from 1 to the schema's cap. */
  readonly dimension: number;
  /** One vector per text, in the order of the texts. */
  readonly embed: (texts: readonly string[]) => Promise<readonly Float32Array[]>;
}

/** The hooks a test runs inside a rebuild, each handed the parallel file's path. */
export interface RebuildIndexHooks {
  /** Runs once the parallel file is written and closed, before it is checked. */
  readonly afterBuild?: (parallelPath: string) => void | Promise<void>;
  /** Runs once the parallel file passed its checks, before it is renamed over the index file. */
  readonly beforeSwap?: (parallelPath: string) => void | Promise<void>;
}

/** What one rebuild is handed. */
export interface RebuildIndexOptions {
  /** The live index file, replaced by the rename; it need not exist yet. */
  readonly indexPath: string;
  /** The store file the rows are read from, opened read-only. */
  readonly storePath: string;
  /** The store tables to index, each carrying the origin pair, each named once. */
  readonly tables: readonly string[];
  /** The project whose rows the index holds, recorded in its metadata. */
  readonly project: string;
  /** The build stamp, naming the parallel file; letters, digits, `_` and `-`. A stamp of the clock when left out. */
  readonly stamp?: string;
  /** The embedder; without one vector search is off. */
  readonly embedder?: IndexEmbedder;
  /** The loader's inputs, the process's own when left out. */
  readonly loader?: PrepareOptions;
  /** The test hooks. */
  readonly hooks?: RebuildIndexHooks;
}

/** An index table with the rows it holds. */
export interface IndexTableRows {
  readonly table: string;
  readonly rows: number;
}

/** What a rebuild that swapped its file in answers. */
export interface RebuildIndexResult {
  /** The project recorded in the index's metadata. */
  readonly project: string;
  /** The build stamp recorded in the index's metadata. */
  readonly stamp: string;
  /** The rows read from the store, one full-text row each. */
  readonly rows: number;
  /** The rows embedded, one vector row each: `rows` with vector search on, 0 with it off. */
  readonly vectors: number;
  /** Each index table with the rows the check counted in it. */
  readonly tables: readonly IndexTableRows[];
  /** Whether the index holds the vector table. */
  readonly vector: boolean;
  /** Why it does not, `null` when it does. */
  readonly why: string | null;
}

/** The dimension recorded when no embedder is given: the smallest the schema takes. */
export const UNEMBEDDED_DIMENSION = 1;

/** How many bodies one call of the embedder is handed. */
export const EMBED_BATCH = 64;

/** The why of an index built without an embedder. */
export const NO_EMBEDDER = 'no embedder configured';

/** The suffix between the index file's name and the stamp in the parallel file's name. */
export const PARALLEL_SUFFIX = '.rebuild-';

/** The characters a stamp may hold, so it stays one file name. */
const STAMP_PATTERN = /^[\w-]+$/;

/** One store row as the build read it. */
interface ReadRow {
  readonly table: string;
  readonly originStore: string;
  readonly originSeq: number;
  readonly body: string;
}

/** A column as `PRAGMA table_info` answers it. */
interface ColumnInfo {
  readonly name: string;
  readonly type: string;
}

/** The parallel file of `indexPath` for `stamp`. */
export function parallelIndexPath(indexPath: string, stamp: string): string {
  return `${indexPath}${PARALLEL_SUFFIX}${stamp}`;
}

/** A stamp of the clock, as `20261108T230000123Z`. */
function clockStamp(): string {
  return new Date()
    .toISOString()
    .replace(/[-:.]/g, '');
}

/** A name quoted as an SQL identifier. */
function quoted(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/** Whether SQLite gives a column of this declared type text affinity. */
function isTextColumn(type: string): boolean {
  const declared = type.toUpperCase();
  if (declared.includes('INT')) {
    return false;
  }
  return ['CHAR', 'CLOB', 'TEXT'].some((word) => declared.includes(word));
}

/** Refuse the options before any file is touched. */
function checkOptions(tables: readonly string[], stamp: string): void {
  if (!STAMP_PATTERN.test(stamp)) {
    throw new IndexRebuildRefusal(`the stamp ${JSON.stringify(stamp)} holds a character other than a letter, a digit, _ or -`);
  }
  const twice = tables.find((table, at) => tables.indexOf(table) !== at);
  if (twice !== undefined) {
    throw new IndexRebuildRefusal(`the table ${twice} is named twice, so its rows would be indexed twice`);
  }
}

/** Refuse while a journal or log beside the index file says a write is in flight or was interrupted. */
function refuseInFlight(indexPath: string): void {
  for (const suffix of ['-journal', '-wal']) {
    if (existsSync(`${indexPath}${suffix}`)) {
      throw new IndexRebuildRefusal(
        `${indexPath}${suffix} is there, so a write to the index is in flight or was interrupted;`
          + ' stop whatever writes it, then rebuild',
      );
    }
  }
}

/** Refuse a parallel file that is already there. */
function refuseTaken(parallelPath: string): void {
  if (existsSync(parallelPath)) {
    throw new IndexRebuildRefusal(`${parallelPath} is already there; move it aside or pass another stamp`);
  }
}

/** Delete the parallel file and any journal or log it left. */
function removeParallel(parallelPath: string): void {
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    rmSync(`${parallelPath}${suffix}`, { force: true });
  }
}

/** The text columns of a store table indexed into its body, refusing a table the build cannot key. */
function bodyColumns(store: Database, table: string): readonly string[] {
  const columns = store.query<ColumnInfo, []>(`PRAGMA main.table_info(${quoted(table)})`).all();
  if (columns.length === 0) {
    throw new IndexRebuildRefusal(`the store holds no table ${table}`);
  }
  const names = columns.map((column) => column.name);
  if (!names.includes('origin_store') || !names.includes('origin_seq')) {
    throw new IndexRebuildRefusal(`the store table ${table} carries no origin pair (origin_store, origin_seq)`);
  }
  return columns
    .filter((column) => column.name !== 'origin_store' && isTextColumn(column.type))
    .map((column) => column.name);
}

/** The rows of one store table with an origin pair, each with its body. */
function readTable(store: Database, table: string): readonly ReadRow[] {
  const columns = bodyColumns(store, table);
  const selected = ['origin_store', 'origin_seq', ...columns].map(quoted).join(', ');
  const rows = store
    .query<Record<string, string | number | null>, []>(
      `SELECT ${selected} FROM main.${quoted(table)}`
        + ' WHERE origin_store IS NOT NULL AND origin_seq IS NOT NULL ORDER BY origin_store, origin_seq',
    )
    .all();
  return rows.map((row) => ({
    body: columns
      .map((column) => row[column])
      .filter((value) => value !== null && value !== undefined)
      .map(String)
      .join('\n'),
    originSeq: Number(row.origin_seq),
    originStore: String(row.origin_store),
    table,
  }));
}

/** Every row of the named tables, read from the store opened read-only in one read transaction. */
function readStore(storePath: string, tables: readonly string[], state: LoaderState | undefined): readonly ReadRow[] {
  const store = openDatabase(storePath, { readonly: true }, state);
  try {
    return store.transaction(() => tables.flatMap((table) => readTable(store, table)))();
  } finally {
    store.close();
  }
}

/** Write one full-text row per row read, in one transaction. */
function writeFullText(database: Database, rows: readonly ReadRow[]): void {
  const insert = database.prepare<unknown, [string, string, number, string]>(
    `INSERT INTO ${FTS_TABLE} (row_table, origin_store, origin_seq, body) VALUES (?, ?, ?, ?)`,
  );
  database.transaction(() => {
    for (const row of rows) {
      insert.run(row.table, row.originStore, row.originSeq, row.body);
    }
  })();
}

/** Refuse an embedder's answer for a batch that is not one vector of its dimension per text. */
function checkVectors(vectors: readonly Float32Array[], texts: number, dimension: number): void {
  if (vectors.length !== texts) {
    throw new IndexRebuildRefusal(`the embedder answered ${String(vectors.length)} vectors for ${String(texts)} texts`);
  }
  const wrong = vectors.find((vector) => vector.length !== dimension);
  if (wrong !== undefined) {
    throw new IndexRebuildRefusal(`the embedder answered a vector of ${String(wrong.length)} numbers, its dimension being ${String(dimension)}`);
  }
}

/** Embed every body, {@link EMBED_BATCH} at a time, and write one vector row per row read. */
async function writeVectors(database: Database, rows: readonly ReadRow[], embedder: IndexEmbedder): Promise<void> {
  const insert = database.prepare<unknown, [Float32Array, string, string, number]>(
    `INSERT INTO ${VECTOR_TABLE} (embedding, row_table, origin_store, origin_seq) VALUES (?, ?, ?, ?)`,
  );
  for (let start = 0; start < rows.length; start += EMBED_BATCH) {
    const batch = rows.slice(start, start + EMBED_BATCH);
    const vectors = await embedder.embed(batch.map((row) => row.body));
    checkVectors(vectors, batch.length, embedder.dimension);
    database.transaction(() => {
      batch.forEach((row, at) => {
        insert.run(vectors[at] as Float32Array, row.table, row.originStore, row.originSeq);
      });
    })();
  }
}

/** The answer the rebuild works under: the loader's, then whether an embedder was given. */
function rebuildAnswer(loaded: VectorAnswer, embedder: IndexEmbedder | undefined): VectorAnswer {
  if (!loaded.vector) {
    return { vector: false, why: loaded.why };
  }
  return embedder === undefined
    ? { vector: false, why: NO_EMBEDDER }
    : { vector: true, why: null };
}

/** What the build step answers: the rows it read and the answer it built under. */
interface Built {
  readonly rows: number;
  readonly answer: VectorAnswer;
}

/** Build the parallel file and close it. See the module note's step 3. */
async function build(options: RebuildIndexOptions, parallelPath: string, stamp: string): Promise<Built> {
  const { embedder, loader = {}, project, storePath, tables } = options;
  const opened = openWithVector(parallelPath, loader);
  const { database } = opened;
  try {
    const answer = rebuildAnswer(opened, embedder);
    const dimension = embedder?.dimension ?? UNEMBEDDED_DIMENSION;
    createIndexSchema(database, { dimension, project, stamp }, answer);
    const rows = readStore(storePath, tables, loader.state);
    writeFullText(database, rows);
    if (answer.vector && embedder !== undefined) {
      await writeVectors(database, rows, embedder);
    }
    return { answer, rows: rows.length };
  } finally {
    database.close();
  }
}

/** The rows each index table should hold after a build that read `rows`. */
function expectedRows(table: string, rows: number): number {
  return table === META_TABLE
    ? 1
    : rows;
}

/** The SQLite answer to `PRAGMA integrity_check`, its lines joined into one. */
function integrityAnswer(database: Database): string {
  return database
    .query<{ readonly integrity_check: string }, []>('PRAGMA main.integrity_check')
    .all()
    .map((row) => row.integrity_check.replaceAll('\n', '; '))
    .join('; ');
}

/** Check the closed parallel file on a connection of its own. See the module note's step 4. */
function check(parallelPath: string, built: Built, state: LoaderState | undefined): readonly IndexTableRows[] {
  const database = openDatabase(parallelPath, undefined, state);
  try {
    if (built.answer.vector) {
      const loaded = loadVector(database);
      if (!loaded.vector) {
        throw new IndexRebuildRefusal(`the rebuilt index cannot be checked: ${loaded.why ?? 'sqlite-vec did not load'}`);
      }
    }
    const integrity = integrityAnswer(database);
    if (integrity !== 'ok') {
      throw new IndexRebuildRefusal(`the rebuilt index failed integrity_check: ${integrity}`);
    }
    return indexTables(built.answer).map((table) => {
      const rows = database.query<{ readonly n: number }, []>(`SELECT count(*) AS n FROM main.${quoted(table)}`).get()?.n ?? 0;
      const expected = expectedRows(table, built.rows);
      if (rows !== expected) {
        throw new IndexRebuildRefusal(`the rebuilt ${table} holds ${String(rows)} rows, the build read ${String(expected)}`);
      }
      return { rows, table };
    });
  } finally {
    database.close();
  }
}

/**
 * Rebuild the index file beside itself from the store's rows and swap
 * it in with one rename. Throws an {@link IndexRebuildRefusal} for a
 * refusal or a failed check, and rethrows any other failure, in every
 * case leaving the index file untouched and no parallel file of this
 * run behind. See the module note for the steps.
 */
export async function rebuildIndex(options: RebuildIndexOptions): Promise<RebuildIndexResult> {
  const { hooks = {}, indexPath, loader = {}, project, tables } = options;
  const stamp = options.stamp ?? clockStamp();
  checkOptions(tables, stamp);
  const parallelPath = parallelIndexPath(indexPath, stamp);
  refuseInFlight(indexPath);
  refuseTaken(parallelPath);
  try {
    const built = await build(options, parallelPath, stamp);
    await hooks.afterBuild?.(parallelPath);
    const counted = check(parallelPath, built, loader.state);
    await hooks.beforeSwap?.(parallelPath);
    renameSync(parallelPath, indexPath);
    return {
      project,
      rows: built.rows,
      stamp,
      tables: counted,
      vector: built.answer.vector,
      vectors: built.answer.vector
        ? built.rows
        : 0,
      why: built.answer.why,
    };
  } catch (error) {
    removeParallel(parallelPath);
    throw error;
  }
}
