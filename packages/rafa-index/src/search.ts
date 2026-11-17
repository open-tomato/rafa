/**
 * Search over an index: {@link search} answers the rows a query finds as
 * row references, a store table and an origin pair with a score, and
 * never a row's body. The reader fetches bodies from the store, so an
 * index can be rebuilt under it without touching what the reader holds.
 *
 * ## The three modes
 *
 * | Mode | Finds by | Score, higher is better |
 * | --- | --- | --- |
 * | `fts` | FTS5 `MATCH` on `index_fts` | `-rank`, FTS5's bm25 negated |
 * | `vector` | a `vec0` KNN query on `index_vectors` | `1 - distance`, the cosine similarity |
 * | `hybrid` | both, fused by {@link fusionSql} | the reciprocal-rank fusion score |
 *
 * Hits come best first, the key (table, origin pair) breaking ties, and
 * at most the request's limit of them, a whole number from 1 to
 * {@link MAX_LIMIT}, {@link DEFAULT_LIMIT} when left out. A `hybrid`
 * search ranks the best `limit` hits of each search and fuses those.
 *
 * ## The query text
 *
 * The query is plain words, not FTS5 syntax: each run of non-space
 * characters is quoted as one FTS5 string, so every word must match and
 * an operator such as `AND` or a stray `"` is just a word. The vector
 * modes hand the query text to the embedder as written.
 *
 * ## Vector search off
 *
 * The caller answers whether vector search is on, as the loader and the
 * connector measured it, and a `vector` or `hybrid` request is refused
 * with a message naming `fts` when it is off, when no embedder was
 * handed, or when the index holds no vector table. A row whose vector
 * has no cosine distance, the zero vector, is never a vector hit.
 *
 * ## Where the index is
 *
 * The index tables are read from the database's schema `schema`,
 * `main` when left out: a connector that attaches the index file to a
 * connection on the store names the schema it attached it as.
 */
import type { IndexEmbedder } from './rebuild.js';
import type { Database } from 'bun:sqlite';

import { fusionSql } from './fusion.js';
import { NO_EMBEDDER } from './rebuild.js';
import { FTS_TABLE, META_TABLE, VECTOR_TABLE } from './schema.js';

/** The modes a search runs in. */
export type SearchMode = 'fts' | 'vector' | 'hybrid';

/** Every {@link SearchMode}, in the order a refusal names them. */
export const SEARCH_MODES: readonly SearchMode[] = Object.freeze(['fts', 'vector', 'hybrid']);

/** The most hits one search answers. */
export const MAX_LIMIT = 100;

/** The hits a search answers when the request names no limit. */
export const DEFAULT_LIMIT = 10;

/** The largest cosine distance, two opposite vectors'; a row past it has no distance. */
const MAX_COSINE_DISTANCE = 2.0;

/** The pattern a schema name must match, so it stays one SQL identifier. */
const SCHEMA_PATTERN = /^[A-Za-z_]\w*$/;

/** The key columns, in the order every query names them. */
const KEY = 'row_table, origin_store, origin_seq';

/** A row's origin: the store it originated in and its sequence number there. */
export interface OriginPair {
  readonly originStore: string;
  readonly originSeq: number;
}

/** What one search asks. */
export interface IndexSearchRequest {
  /** How the hits are found. */
  readonly mode: SearchMode;
  /** The words searched for, plain text. */
  readonly query: string;
  /** The most hits answered, a whole number from 1 to {@link MAX_LIMIT}; {@link DEFAULT_LIMIT} when left out. */
  readonly limit?: number;
}

/** One hit: the row's table and origin pair, and its score. Never a body. */
export interface IndexSearchHit {
  /** The store table the row lives in. */
  readonly table: string;
  /** The row's origin pair. */
  readonly origin: OriginPair;
  /** The hit's score in its mode, higher is better. */
  readonly score: number;
}

/** What one search answers: its hits, best first. */
export interface IndexSearchResult {
  readonly hits: readonly IndexSearchHit[];
}

/** The index a search reads, with whether vector search is on for it. */
export interface SearchTarget {
  /** The connection the index tables are reached from. */
  readonly database: Database;
  /** The schema the index tables live in, `main` when left out. */
  readonly schema?: string;
  /** Whether vector search is on, as the loader and the connector measured it. */
  readonly vector: boolean;
  /** Why it is off, `null` when it is on. */
  readonly why: string | null;
  /** The embedder the query text is embedded by; without one vector search is off. */
  readonly embedder?: IndexEmbedder;
}

/** A search refused before or while it ran, for a request or an index it cannot answer. */
export class IndexSearchRefusal extends Error {
  constructor(message: string) {
    super(`index search: ${message}`);
    this.name = 'IndexSearchRefusal';
  }
}

/** A key row and its score, as the queries answer it. */
interface ScoredRow {
  readonly row_table: string;
  readonly origin_store: string;
  readonly origin_seq: number;
  readonly score: number;
}

/** What a request holds once checked. */
interface CheckedRequest {
  readonly mode: SearchMode;
  readonly query: string;
  readonly limit: number;
}

/** A name quoted as an SQL identifier. */
function quoted(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/** Refuse a request the search cannot run, answering it with its limit filled in. */
function checkRequest(request: IndexSearchRequest): CheckedRequest {
  const { limit = DEFAULT_LIMIT, mode, query } = request;
  if (!SEARCH_MODES.includes(mode)) {
    throw new IndexSearchRefusal(`mode must be one of ${SEARCH_MODES.join(', ')}, got ${JSON.stringify(mode)}`);
  }
  if (typeof query !== 'string' || query.trim() === '') {
    throw new IndexSearchRefusal('query must hold a word');
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new IndexSearchRefusal(`limit must be a whole number from 1 to ${MAX_LIMIT}, got ${String(limit)}`);
  }
  return { limit, mode, query };
}

/** The query as FTS5 strings, one per word, so no word is read as syntax. */
export function ftsQuery(query: string): string {
  return query
    .split(/\s+/u)
    .filter((word) => word !== '')
    .map((word) => `"${word.replaceAll('"', '""')}"`)
    .join(' ');
}

/** The target's schema, quoted, refusing a name that is no identifier or no attached database. */
function schemaOf(target: SearchTarget): string {
  const schema = target.schema ?? 'main';
  if (!SCHEMA_PATTERN.test(schema)) {
    throw new IndexSearchRefusal(`schema ${JSON.stringify(schema)} is not an SQL identifier`);
  }
  const attached = target.database
    .query<{ readonly name: string }, []>('PRAGMA database_list')
    .all()
    .some((row) => row.name === schema);
  if (!attached) {
    throw new IndexSearchRefusal(`no database is attached as ${schema}`);
  }
  return quoted(schema);
}

/** Whether the schema holds the named table. */
function holdsTable(database: Database, schema: string, table: string): boolean {
  return database
    .query<{ readonly name: string }, [string]>(`SELECT name FROM ${schema}.sqlite_master WHERE type = 'table' AND name = ?`)
    .get(table) !== null;
}

/** The index's dimension, refusing a schema that holds no index. */
function indexDimension(database: Database, schema: string): number | null {
  if (!holdsTable(database, schema, META_TABLE)) {
    throw new IndexSearchRefusal(`the database holds no index: there is no ${META_TABLE} table`);
  }
  return database
    .query<{ readonly dimension: number | null }, []>(`SELECT dimension FROM ${schema}.${META_TABLE} WHERE id = 1`)
    .get()?.dimension ?? null;
}

/** The refusal of a vector-backed mode with vector search off, naming `fts`. */
function vectorOff(mode: SearchMode, why: string): IndexSearchRefusal {
  return new IndexSearchRefusal(`a ${mode} search needs vector search, which is off (${why}); search with mode 'fts'`);
}

/** The embedder a vector-backed mode runs with, refusing when vector search is off by any measure. */
function requireVector(target: SearchTarget, schema: string, mode: SearchMode): IndexEmbedder {
  if (!target.vector) {
    throw vectorOff(mode, target.why ?? 'no reason was given');
  }
  if (target.embedder === undefined) {
    throw vectorOff(mode, NO_EMBEDDER);
  }
  const dimension = indexDimension(target.database, schema);
  if (dimension === null || !holdsTable(target.database, schema, VECTOR_TABLE)) {
    throw vectorOff(mode, `the index holds no ${VECTOR_TABLE} table`);
  }
  if (target.embedder.dimension !== dimension) {
    throw new IndexSearchRefusal(
      `the embedder's dimension is ${String(target.embedder.dimension)}, the index's ${String(dimension)}; rebuild the index`,
    );
  }
  return target.embedder;
}

/** The query text's vector, refusing an embedder answer that is not one vector of its dimension. */
async function queryVector(embedder: IndexEmbedder, query: string): Promise<Float32Array> {
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
  return vector;
}

/** The full-text hit query: its two placeholders are the FTS5 query and the hit count. */
function ftsHits(schema: string): string {
  return `SELECT ${KEY}, rank AS hit_order FROM ${schema}.${FTS_TABLE}`
    + ` WHERE ${FTS_TABLE} MATCH ? ORDER BY rank, ${KEY} LIMIT ?`;
}

/**
 * The vector hit query: its two placeholders are the query vector and
 * the hit count. The distance bound drops a row with no distance, which
 * would otherwise rank first.
 */
function vectorHits(schema: string): string {
  return `SELECT ${KEY}, distance AS hit_order FROM ${schema}.${VECTOR_TABLE}`
    + ` WHERE embedding MATCH ? AND k = ? AND distance <= ${MAX_COSINE_DISTANCE.toFixed(1)}`;
}

/** One search's hits scored, best first; the hits materialized so no order reaches a `vec0` query. */
function scoredSql(hits: string, score: string): string {
  return `WITH found AS MATERIALIZED (
  ${hits}
)
SELECT ${KEY}, ${score} AS score FROM found ORDER BY hit_order, ${KEY}`;
}

/** A query row as a frozen hit. */
function toHit(row: ScoredRow): IndexSearchHit {
  return Object.freeze({
    origin: Object.freeze({ originSeq: Number(row.origin_seq), originStore: String(row.origin_store) }),
    score: Number(row.score),
    table: String(row.row_table),
  });
}

/** Run a scored query and answer its rows as a frozen result. */
function answer(database: Database, sql: string, bindings: readonly (string | number | Float32Array)[]): IndexSearchResult {
  const rows = database.query<ScoredRow, (string | number | Float32Array)[]>(sql).all(...bindings);
  return Object.freeze({ hits: Object.freeze(rows.map(toHit)) });
}

/**
 * Search the index for the request's words, answering at most its limit
 * of hits, each a table, an origin pair and a score, best first. Rejects
 * with an {@link IndexSearchRefusal} for an unknown mode, an empty
 * query, a limit that is not a whole number from 1 to {@link MAX_LIMIT},
 * a database holding no index, and a `vector` or `hybrid` request while
 * vector search is off, the message naming `fts`.
 */
export async function search(target: SearchTarget, request: IndexSearchRequest): Promise<IndexSearchResult> {
  const { limit, mode, query } = checkRequest(request);
  const schema = schemaOf(target);
  const { database } = target;
  if (mode === 'fts') {
    indexDimension(database, schema);
    return answer(database, scoredSql(ftsHits(schema), '-hit_order'), [ftsQuery(query), limit]);
  }
  const embedder = requireVector(target, schema, mode);
  const vector = await queryVector(embedder, query);
  if (mode === 'vector') {
    return answer(database, scoredSql(vectorHits(schema), '1.0 - hit_order'), [vector, limit]);
  }
  const fused = fusionSql({ fts: ftsHits(schema), vector: vectorHits(schema) }, limit);
  return answer(database, fused, [ftsQuery(query), limit, vector, limit]);
}
