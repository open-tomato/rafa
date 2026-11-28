/**
 * The connector's index search: {@link searchProjectIndex} answers the
 * rows a query finds in a project's serving build, as row references (a
 * table, an origin pair and a score), never a row's body.
 *
 * ## The three modes
 *
 * | Mode | Finds by | Score, higher is better |
 * | --- | --- | --- |
 * | `fts` | `pg_search`'s `&&&` on each copy's body, its BM25 index | `paradedb.score`, the BM25 score |
 * | `vector` | `pgvector`'s cosine distance `<=>` on each copy's vector, its HNSW index | `1 - distance`, the cosine similarity |
 * | `hybrid` | both, fused by `rafa-index`'s `fusionSql` | the reciprocal-rank fusion score |
 *
 * Each copied table of the build (`index-build.ts`) is searched on its
 * own, at most the limit of hits each, and the hits of every table are
 * ranked together, best first, the key (table, origin pair) breaking
 * ties, and cut at the limit: a whole number from 1 to `rafa-index`'s
 * `MAX_LIMIT`, its `DEFAULT_LIMIT` when left out. A BM25 score is read
 * from its own table's index, so a word's weight in it is that table's.
 * A `hybrid` search ranks the best `limit` hits of each search and fuses
 * those, as the SQLite connector does.
 *
 * ## The query text
 *
 * The query is plain words: `&&&` takes it as text and requires every
 * word the body's tokenizer reads from it, so an operator such as `OR`
 * or a stray `"` is just a word, and a query with no word in it finds
 * nothing. The vector modes hand the query text to the embedder as
 * written, once per search and before the transaction opens. A row whose
 * vector has no cosine distance, the zero vector, is never a vector hit.
 *
 * ## The placeholders
 *
 * The hit queries are written with Postgres's `$n` placeholders, the
 * full-text query's first, as `fusionSql` binds them. {@link boundSql}
 * hands the finished text to Drizzle with each `$n` its parameter, so no
 * value of a request is ever written into the text. Only the build's
 * table and column names, quoted, and the vector type, read from the
 * build, are.
 *
 * ## The serving build
 *
 * A search runs in one transaction in the project's schema: it reads
 * the pointer with `servingBuild`, which locks it `FOR SHARE` so no swap
 * drops the build under it, and queries that build. A project with no
 * build yet is refused, naming the rebuild.
 *
 * ## Refusals
 *
 * Refused with `rafa-index`'s `IndexSearchRefusal` before the
 * transaction opens: a mode none of the three, a query holding no word,
 * a limit out of range, and a `vector` or `hybrid` search while the
 * caller's vector answer is `false` or no embedder was given, the message
 * naming the why and `fts`. Refused inside the transaction: a vector mode
 * over a build holding no vectors, naming `fts`, and an embedder of
 * another dimension than the build's, naming the rebuild.
 *
 * Nothing here is exported from the package's entry: it takes the
 * Drizzle database, which the leak rule keeps inside the connector.
 */
import type { ProjectSchema } from './hub-projects.js';
import type { HubDatabase, HubTransaction } from './hub-tables.js';
import type { EmbeddingPrecision } from './index-build.js';
import type { IndexSearchHit, IndexSearchRequest, IndexSearchResult } from '@open-tomato/rafa-hub-port';
import type { IndexEmbedder, SearchMode } from '@open-tomato/rafa-index';
import type { SQL } from 'drizzle-orm';

import {
  DEFAULT_LIMIT,
  fusionSql,
  IndexSearchRefusal,
  MAX_LIMIT,
  NO_EMBEDDER,
  SEARCH_MODES,
} from '@open-tomato/rafa-index';
import { sql } from 'drizzle-orm';

import { inProjectSchema } from './hub-tables.js';
import { BODY_COLUMN, BUILD_META_TABLE, EMBEDDING_COLUMN, quoted, servingBuild } from './index-build.js';
import { WIRE_TABLES } from './schema.js';

/** The largest cosine distance, two opposite vectors'; a row past it, the zero vector's NaN, has none. */
const MAX_COSINE_DISTANCE = '2.0';

/** pgvector's name in `pg_extension`. */
const VECTOR_EXTENSION = 'vector';

/** The column type of each precision's vectors. */
const VECTOR_TYPE: Readonly<Record<EmbeddingPrecision, string>> = Object.freeze({ half: 'halfvec', full: 'vector' });

/** The key columns, in the order every query names them. */
const KEY = 'row_table, origin_store, origin_seq';

/** A `$n` placeholder in a query's text. */
const PLACEHOLDER = /\$(\d+)/g;

/** The vector answer a search works under: whether vector search is on, and why not. */
export interface SearchVectorState {
  /** Whether vector search is on, as the connector measured it. */
  readonly vector: boolean;
  /** Why it is off, `null` when it is on. */
  readonly why: string | null;
}

/** What one search of a project's index is handed. */
export interface IndexSearchOptions {
  /** The connector's Drizzle database, the search's transaction taken on it. */
  readonly db: HubDatabase;
  /** The project's schema, whose pointer names the serving build. */
  readonly place: ProjectSchema;
  /** The request: the mode, the words and the limit. */
  readonly request: IndexSearchRequest;
  /** Whether vector search is on; a `vector` or `hybrid` request is refused while it is not. */
  readonly vector: SearchVectorState;
  /** The embedder the query text is embedded by; without one vector search is off. */
  readonly embedder?: IndexEmbedder;
}

/** What a request holds once checked. */
interface CheckedRequest {
  readonly mode: SearchMode;
  readonly query: string;
  readonly limit: number;
}

/** The copied tables of a build: those holding a body, and those of them holding a vector. */
interface BuildTables {
  readonly fts: readonly string[];
  readonly vector: readonly string[];
}

/** The vector half of a build, as its metadata records it. */
interface BuildVectors {
  readonly dimension: number;
  readonly precision: EmbeddingPrecision;
}

/** How a vector hit query names the build's vectors: their type and pgvector's distance operator, both schema-qualified. */
export interface VectorSpec {
  /** The vector type with the build's dimension, such as `"public".halfvec(3)`. */
  readonly type: string;
  /** The cosine distance operator, such as `OPERATOR("public".<=>)`. */
  readonly distance: string;
}

/** The query text embedded, with the embedder that embedded it. */
interface EmbeddedQuery {
  readonly embedder: IndexEmbedder;
  readonly vector: string;
}

/** A key row and its score, as the queries answer it; Postgres answers a bigint and a numeric as text. */
interface ScoredRow extends Record<string, unknown> {
  readonly row_table: string;
  readonly origin_store: string;
  readonly origin_seq: number | string;
  readonly score: number | string;
}

/** A value a placeholder binds. */
type Binding = string | number;

/** Refuses a request the search cannot run, answering it with its limit filled in. */
function checkRequest(request: IndexSearchRequest): CheckedRequest {
  const { limit = DEFAULT_LIMIT, mode, query } = request;
  if (!SEARCH_MODES.includes(mode)) {
    throw new IndexSearchRefusal(`mode must be one of ${SEARCH_MODES.join(', ')}, got ${JSON.stringify(mode)}`);
  }
  if (typeof query !== 'string' || query.trim() === '') {
    throw new IndexSearchRefusal('query must hold a word');
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new IndexSearchRefusal(`limit must be a whole number from 1 to ${String(MAX_LIMIT)}, got ${String(limit)}`);
  }
  return { limit, mode, query };
}

/** The refusal of a vector-backed mode with vector search off, naming `fts`. */
function vectorOff(mode: SearchMode, why: string): IndexSearchRefusal {
  return new IndexSearchRefusal(`a ${mode} search needs vector search, which is off (${why}); search with mode 'fts'`);
}

/** The embedder a vector-backed mode runs with, refusing when the caller's answer or a missing embedder turns it off. */
function requireEmbedder(options: IndexSearchOptions, mode: SearchMode): IndexEmbedder {
  const { embedder, vector } = options;
  if (!vector.vector) {
    throw vectorOff(mode, vector.why ?? 'no reason was given');
  }
  if (embedder === undefined) {
    throw vectorOff(mode, NO_EMBEDDER);
  }
  return embedder;
}

/** The query text's vector as pgvector's text form, refusing an answer that is not one vector of the embedder's dimension. */
async function queryVector(embedder: IndexEmbedder, query: string): Promise<string> {
  const vectors = await embedder.embed([query]);
  const [vector] = vectors;
  if (vectors.length !== 1 || vector === undefined) {
    throw new IndexSearchRefusal(`the embedder answered ${String(vectors.length)} vectors for one query`);
  }
  if (vector.length !== embedder.dimension) {
    throw new IndexSearchRefusal(
      `the embedder answered a vector of ${String(vector.length)} numbers, its dimension being ${String(embedder.dimension)}`,
    );
  }
  return `[${Array.from(vector).join(',')}]`;
}

/**
 * The query text as Drizzle's SQL: each `$n` placeholder becomes a
 * parameter holding `bindings[n - 1]`, which Drizzle numbers again in
 * text order. A placeholder past the bindings is refused.
 */
export function boundSql(text: string, bindings: readonly Binding[]): SQL {
  const chunks: SQL[] = [];
  let from = 0;
  for (const match of text.matchAll(PLACEHOLDER)) {
    const at = Number(match[1]) - 1;
    if (at < 0 || at >= bindings.length) {
      throw new RangeError(`hub postgres: the placeholder $${String(at + 1)} has no binding`);
    }
    chunks.push(sql.raw(text.slice(from, match.index)), sql`${bindings[at]}`);
    from = match.index + match[0].length;
  }
  chunks.push(sql.raw(text.slice(from)));
  return sql.join(chunks);
}

/** A text as an SQL string literal. */
function literal(text: string): string {
  return `'${text.replaceAll('\'', '\'\'')}'`;
}

/** The copied tables of `build`, in `WIRE_TABLES` order. */
async function tablesOf(tx: HubTransaction, build: string): Promise<BuildTables> {
  // Drizzle's bun-sql result types its rows loosely; they are the two text columns selected.
  const rows = await tx.execute<{ table_name: string; column_name: string }>(sql`SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = ${build} AND column_name IN (${BODY_COLUMN}, ${EMBEDDING_COLUMN})`) as unknown as readonly { table_name: string; column_name: string }[];
  const holding = (column: string): readonly string[] => Object.keys(WIRE_TABLES)
    .filter((table) => rows.some((row) => row.table_name === table && row.column_name === column));
  return { fts: holding(BODY_COLUMN), vector: holding(EMBEDDING_COLUMN) };
}

/** The build's vector half from its metadata, `null` when it was built with no embedder. */
async function vectorsOf(tx: HubTransaction, build: string): Promise<BuildVectors | null> {
  const [meta] = await tx.execute<{ dimension: number | null; precision: string | null }>(
    sql.raw(`SELECT dimension, precision FROM ${quoted(build)}.${quoted(BUILD_META_TABLE)} WHERE id = 1`),
  );
  if (meta === undefined || meta.dimension === null || meta.precision === null) return null;
  if (meta.precision !== 'half' && meta.precision !== 'full') {
    throw new Error(`hub postgres: the build ${build} records the precision ${meta.precision}, neither half nor full`);
  }
  return { dimension: Number(meta.dimension), precision: meta.precision };
}

/** The schema pgvector's types and operators live in, read from `pg_extension`, since the search's path is the project's schema alone. */
async function vectorSchemaOf(tx: HubTransaction, mode: SearchMode): Promise<string> {
  const [found] = await tx.execute<{ schema: string }>(sql`SELECT n.nspname AS schema FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = ${VECTOR_EXTENSION}`);
  if (found === undefined) {
    throw vectorOff(mode, `the database holds no ${VECTOR_EXTENSION} extension`);
  }
  return String(found.schema);
}

/**
 * The full-text hit query over `tables`: each table's best hits by its
 * BM25 score, then all of them best first. `$<query>` is the query text
 * and `$<limit>` the hit count.
 */
export function ftsHits(build: string, tables: readonly string[], query: number, limit: number): string {
  const branches = tables.map((table) => `(SELECT CAST(${literal(table)} AS text) AS row_table, origin_store,`
    + ' CAST(origin_seq AS bigint) AS origin_seq, -paradedb.score(seq) AS hit_order'
    + ` FROM ${quoted(build)}.${quoted(table)}`
    + ` WHERE ${quoted(BODY_COLUMN)} &&& CAST($${String(query)} AS text)`
    + ` ORDER BY hit_order LIMIT CAST($${String(limit)} AS integer))`);
  return `SELECT ${KEY}, hit_order FROM (${branches.join(' UNION ALL ')}) AS fts_hits`
    + ` ORDER BY hit_order, ${KEY} LIMIT CAST($${String(limit)} AS integer)`;
}

/**
 * The vector hit query over `tables`: each table's nearest rows by
 * cosine distance, in the HNSW index's own order, the rows with no
 * distance dropped, then all of them nearest first. `$<vector>` is the
 * query vector's text form and `$<limit>` the hit count; `spec` names
 * the build's vector type and pgvector's distance operator.
 */
export function vectorHits(build: string, tables: readonly string[], spec: VectorSpec, vector: number, limit: number): string {
  const branches = tables.map((table) => `(SELECT CAST(${literal(table)} AS text) AS row_table, origin_store,`
    + ' CAST(origin_seq AS bigint) AS origin_seq, distance AS hit_order FROM ('
    + `SELECT origin_store, origin_seq, ${quoted(EMBEDDING_COLUMN)} ${spec.distance} CAST($${String(vector)} AS text)::${spec.type} AS distance`
    + ` FROM ${quoted(build)}.${quoted(table)} ORDER BY distance LIMIT CAST($${String(limit)} AS integer)) AS near`
    + ` WHERE distance <= ${MAX_COSINE_DISTANCE})`);
  return `SELECT ${KEY}, hit_order FROM (${branches.join(' UNION ALL ')}) AS vector_hits`
    + ` ORDER BY hit_order, ${KEY} LIMIT CAST($${String(limit)} AS integer)`;
}

/** One search's hits scored, best first. */
function scoredSql(hits: string, score: string): string {
  return `WITH found AS MATERIALIZED (
  ${hits}
)
SELECT ${KEY}, ${score} AS score FROM found ORDER BY hit_order, ${KEY}`;
}

/** A query row as a frozen hit. */
function toHit(row: ScoredRow): IndexSearchHit {
  return Object.freeze({
    table: String(row.row_table),
    origin: Object.freeze({ originStore: String(row.origin_store), originSeq: Number(row.origin_seq) }),
    score: Number(row.score),
  });
}

/** Runs a scored query in `tx` and answers its rows as a frozen result. */
async function answer(tx: HubTransaction, text: string, bindings: readonly Binding[]): Promise<IndexSearchResult> {
  // Drizzle's bun-sql result types its rows loosely; they are the key and score selected.
  const rows = await tx.execute<ScoredRow>(boundSql(text, bindings)) as unknown as readonly ScoredRow[];
  return Object.freeze({ hits: Object.freeze(rows.map(toHit)) });
}

/** The answer of a search that found nothing. */
const NO_HITS: IndexSearchResult = Object.freeze({ hits: Object.freeze([]) });

/** The vector type and distance operator of the build, refusing a build with no vectors or another dimension than the embedder's. */
async function vectorSpec(tx: HubTransaction, build: string, mode: SearchMode, embedder: IndexEmbedder): Promise<VectorSpec> {
  const vectors = await vectorsOf(tx, build);
  if (vectors === null) {
    throw vectorOff(mode, 'the serving build holds no vectors');
  }
  if (vectors.dimension !== embedder.dimension) {
    throw new IndexSearchRefusal(
      `the embedder's dimension is ${String(embedder.dimension)}, the serving build's ${String(vectors.dimension)}; rebuild the index`,
    );
  }
  const schema = quoted(await vectorSchemaOf(tx, mode));
  return { type: `${schema}.${VECTOR_TYPE[vectors.precision]}(${String(vectors.dimension)})`, distance: `OPERATOR(${schema}.<=>)` };
}

/** The search inside its transaction: the serving build read under its lock, then the mode's query. */
async function searchBuild(tx: HubTransaction, options: IndexSearchOptions, checked: CheckedRequest, embedded: EmbeddedQuery | null): Promise<IndexSearchResult> {
  const { limit, mode, query } = checked;
  const serving = await servingBuild(tx);
  if (serving === null) {
    throw new IndexSearchRefusal(`project ${options.place.id} has no index built yet; rebuild the index (rafa-hub index rebuild)`);
  }
  const build = serving.schema;
  const tables = await tablesOf(tx, build);
  if (mode === 'fts') {
    return tables.fts.length === 0
      ? NO_HITS
      : answer(tx, scoredSql(ftsHits(build, tables.fts, 1, 2), '-hit_order'), [query, limit]);
  }
  if (embedded === null) throw vectorOff(mode, NO_EMBEDDER);
  const spec = await vectorSpec(tx, build, mode, embedded.embedder);
  if (tables.vector.length === 0) return NO_HITS;
  if (mode === 'vector') {
    return answer(tx, scoredSql(vectorHits(build, tables.vector, spec, 1, 2), '1.0 - hit_order'), [embedded.vector, limit]);
  }
  const fused = fusionSql({ fts: ftsHits(build, tables.fts, 1, 2), vector: vectorHits(build, tables.vector, spec, 3, 4) }, limit);
  return answer(tx, fused, [query, limit, embedded.vector, limit]);
}

/**
 * Searches the project's serving build for the request's words,
 * answering at most its limit of hits, each a table, an origin pair and
 * a score, best first. Rejects with an `IndexSearchRefusal` for a request
 * the search cannot run, a project with no build, and a `vector` or
 * `hybrid` search its vector answer does not hold, the message naming
 * `fts`; see the module note.
 */
export async function searchProjectIndex(options: IndexSearchOptions): Promise<IndexSearchResult> {
  const { db, place, request } = options;
  const checked = checkRequest(request);
  let embedded: EmbeddedQuery | null = null;
  if (checked.mode !== 'fts') {
    const embedder = requireEmbedder(options, checked.mode);
    embedded = { embedder, vector: await queryVector(embedder, checked.query) };
  }
  return inProjectSchema(db, place.schema, (tx) => searchBuild(tx, options, checked, embedded));
}
