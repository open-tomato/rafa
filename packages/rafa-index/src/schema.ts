/**
 * The index schema: the tables an index file holds, created once on a
 * fresh file by {@link createIndexSchema}. The index is derived from the
 * store and is rebuilt, never migrated, so there is no schema version:
 * a new shape is a new rebuild.
 *
 * | Table | Kind | Holds |
 * | --- | --- | --- |
 * | `index_fts` | FTS5 | one row per indexed store row: `row_table`, `origin_store`, `origin_seq`, unindexed, and its `body`, indexed |
 * | `index_vectors` | `vec0` | one row per embedded store row: its `embedding` and the same three key columns, auxiliary |
 * | `index_meta` | table | one row: the `project`, the embedder's `dimension` and the build `stamp` |
 *
 * ## The key
 *
 * A store row is named by its table and its origin pair, as the wire
 * names it: `row_table`, `origin_store`, `origin_seq`. Both search
 * tables carry the three columns, so the fusion query joins an FTS hit
 * to a vector hit on them, and a search answers them and never a body.
 *
 * ## The vector table
 *
 * `vec0` is `sqlite-vec`'s module, so `index_vectors` is created only
 * when the loader answered `vector: true`; on any other answer the
 * index holds full text alone. Its distance is cosine, the metric text
 * embedders are compared by. Its dimension is the embedder's, a whole
 * number from 1 to {@link MAX_DIMENSION}, the cap `sqlite-vec` 0.1.9
 * refuses past (`Dimension on vector column too large`).
 */
import type { VectorAnswer } from './loader.js';
import type { Database } from 'bun:sqlite';

/** The full-text table, FTS5. */
export const FTS_TABLE = 'index_fts';

/** The vector table, `sqlite-vec`'s `vec0`, present only with vector search on. */
export const VECTOR_TABLE = 'index_vectors';

/** The metadata table, one row. */
export const META_TABLE = 'index_meta';

/** The largest dimension `sqlite-vec` 0.1.9 takes on a `vec0` column. */
export const MAX_DIMENSION = 8192;

/** What the metadata table holds: whose rows, the embedder's dimension, and when the build ran. */
export interface IndexMeta {
  /** The project whose rows the index holds. */
  readonly project: string;
  /** The embedder's dimension, the length of every vector it answers. */
  readonly dimension: number;
  /** The build stamp, written by the build that made the file. */
  readonly stamp: string;
}

/** A metadata row as SQLite answers it. */
interface MetaRow {
  readonly project: string;
  readonly dimension: number;
  readonly stamp: string;
}

/** The statement creating the full-text table. */
const CREATE_FTS = `CREATE VIRTUAL TABLE ${FTS_TABLE} USING fts5(
  row_table UNINDEXED,
  origin_store UNINDEXED,
  origin_seq UNINDEXED,
  body
)`;

/** The statement creating the metadata table, held to one row by its key. */
const CREATE_META = `CREATE TABLE ${META_TABLE} (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  project TEXT NOT NULL,
  dimension INTEGER NOT NULL,
  stamp TEXT NOT NULL
)`;

/** The statement creating the vector table, for a dimension already checked. */
function createVectorSql(dimension: number): string {
  return `CREATE VIRTUAL TABLE ${VECTOR_TABLE} USING vec0(
  embedding float[${dimension}] distance_metric=cosine,
  +row_table TEXT,
  +origin_store TEXT,
  +origin_seq INTEGER
)`;
}

/** Refuse metadata the table cannot hold, the dimension before it reaches SQL text. */
function checkMeta(meta: IndexMeta): void {
  if (meta.project.trim() === '') {
    throw new Error('index schema: project must be a non-empty string');
  }
  if (meta.stamp.trim() === '') {
    throw new Error('index schema: stamp must be a non-empty string');
  }
  if (!Number.isInteger(meta.dimension) || meta.dimension < 1 || meta.dimension > MAX_DIMENSION) {
    throw new Error(`index schema: dimension must be a whole number from 1 to ${MAX_DIMENSION}, got ${String(meta.dimension)}`);
  }
}

/**
 * The search and metadata tables an index holds under the answer given,
 * in creation order: the vector table only when `vector` is `true`. The
 * rebuild checks the count of each search table against the rows it read.
 */
export function indexTables(answer: VectorAnswer): readonly string[] {
  return answer.vector
    ? [FTS_TABLE, VECTOR_TABLE, META_TABLE]
    : [FTS_TABLE, META_TABLE];
}

/**
 * Create the index tables on a fresh database and write its metadata
 * row, in one transaction, answering the tables created. The vector
 * table is created only when `answer.vector` is `true`, which the loader
 * answered for this database. Throws on metadata the table cannot hold
 * and on a database that already holds any of the tables.
 */
export function createIndexSchema(database: Database, meta: IndexMeta, answer: VectorAnswer): readonly string[] {
  checkMeta(meta);
  const tables = indexTables(answer);
  database.transaction(() => {
    database.run(CREATE_FTS);
    if (answer.vector) {
      database.run(createVectorSql(meta.dimension));
    }
    database.run(CREATE_META);
    database.run(
      `INSERT INTO ${META_TABLE} (id, project, dimension, stamp) VALUES (1, ?, ?, ?)`,
      [meta.project, meta.dimension, meta.stamp],
    );
  })();
  return tables;
}

/** The metadata row of an index, or `null` for a database that holds no metadata table. */
export function readIndexMeta(database: Database): IndexMeta | null {
  const table = database
    .query<{ readonly name: string }, [string]>('SELECT name FROM sqlite_master WHERE type = \'table\' AND name = ?')
    .get(META_TABLE);
  if (table === null) {
    return null;
  }
  const row = database
    .query<MetaRow, []>(`SELECT project, dimension, stamp FROM ${META_TABLE} WHERE id = 1`)
    .get();
  return row === null
    ? null
    : { dimension: row.dimension, project: row.project, stamp: row.stamp };
}
