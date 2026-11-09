/**
 * The fusion query: reciprocal-rank fusion of a full-text ranking and a
 * vector ranking into one, as SQL text built by {@link fusionSql}.
 *
 * ## The shape
 *
 * Two CTEs rank the hits of each search with `row_number() OVER (ORDER
 * BY ...)`, best first, so each hit gets a rank from 1; each reads its
 * search's hits from a materialized CTE of their own. The two are
 * combined on the key, (table, origin pair), and each hit is scored by
 * the sum of `1.0 / (k + rank)` over the rankings it appears in, with
 * `k` = {@link RRF_K}. The combination is a `UNION ALL` grouped by the
 * key rather than an inner join, so a hit present in one CTE alone is
 * still ranked, scored by that one ranking.
 *
 * ## The hit queries
 *
 * The caller hands the two hit queries in, since how a hit is found is
 * the engine's (FTS5 and `vec0` on SQLite, its own on Postgres). Each
 * answers the columns of {@link HitQueries} and names a key once; its
 * placeholders are its own and bind in text order, the full-text
 * query's first. The fusion text adds no placeholder of its own.
 *
 * ## The dialect
 *
 * The text is written in the subset SQLite and Postgres both parse —
 * `WITH`, `AS MATERIALIZED` (SQLite 3.35, Postgres 12), `row_number()`,
 * `UNION ALL`, `GROUP BY`, `LIMIT` — since the `postgres` connector
 * imports it too.
 */

/** The `k` of reciprocal-rank fusion: a rank `r` adds `1 / (k + r)` to a hit's score. */
export const RRF_K = 60;

/** The name of the CTE ranking the full-text hits. */
export const FTS_RANKED = 'fts_ranked';

/** The name of the CTE ranking the vector hits. */
export const VECTOR_RANKED = 'vector_ranked';

/**
 * The two hit queries the fusion ranks. Each is one `SELECT` answering
 * `row_table`, `origin_store`, `origin_seq` and `hit_order`, a number
 * whose ascending order is best first (FTS5's `rank`, a `vec0`
 * `distance`), with no trailing semicolon.
 */
export interface HitQueries {
  /** The full-text hits. */
  readonly fts: string;
  /** The vector hits. */
  readonly vector: string;
}

/** A row of the fusion query: the key and its fused score, never a body. */
export interface FusedHit {
  /** The store table the row lives in. */
  readonly row_table: string;
  /** The store the row originated in. */
  readonly origin_store: string;
  /** The row's sequence number in its origin store. */
  readonly origin_seq: number;
  /** The fused score: the sum of `1 / (k + rank)` over the rankings holding the row. */
  readonly score: number;
}

/** The key columns, in the order every part of the query names them. */
const KEY = 'row_table, origin_store, origin_seq';

/**
 * The two CTEs of one search: its hits, materialized, then their ranks
 * by `hit_order`, the key breaking ties. The hits are materialized so the
 * planner never folds the window's `ORDER BY` into the hit query: a
 * `vec0` KNN query refuses any order but its own `distance` (`Only a
 * single 'ORDER BY distance' clause is allowed on vec0 KNN queries`).
 */
function rankedCtes(name: string, hits: string): string {
  return `${name}_found AS MATERIALIZED (
  ${hits}
),
${name} AS (
  SELECT ${KEY}, row_number() OVER (ORDER BY hit_order, ${KEY}) AS hit_rank
  FROM ${name}_found
)`;
}

/** Refuse a hit query the fusion cannot wrap. */
function checkHits(label: string, hits: string): void {
  if (hits.trim() === '') {
    throw new Error(`fusion: the ${label} hit query must be a non-empty SELECT`);
  }
  if (hits.trimEnd().endsWith(';')) {
    throw new Error(`fusion: the ${label} hit query must not end in a semicolon`);
  }
}

/**
 * The reciprocal-rank fusion query over the two hit queries, answering
 * at most `limit` rows of {@link FusedHit}, the best score first and the
 * key breaking ties. `limit` is written into the text, so it is refused
 * unless a whole number of 1 or more; a hit query that is empty or ends
 * in a semicolon is refused too.
 */
export function fusionSql(hits: HitQueries, limit: number): string {
  checkHits('full-text', hits.fts);
  checkHits('vector', hits.vector);
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`fusion: limit must be a whole number of 1 or more, got ${String(limit)}`);
  }
  return `WITH ${rankedCtes(FTS_RANKED, hits.fts)},
${rankedCtes(VECTOR_RANKED, hits.vector)},
ranked AS (
  SELECT ${KEY}, hit_rank FROM ${FTS_RANKED}
  UNION ALL
  SELECT ${KEY}, hit_rank FROM ${VECTOR_RANKED}
)
SELECT ${KEY}, sum(1.0 / (${RRF_K} + hit_rank)) AS score
FROM ranked
GROUP BY ${KEY}
ORDER BY score DESC, ${KEY}
LIMIT ${limit}`;
}
