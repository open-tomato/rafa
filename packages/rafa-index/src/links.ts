/**
 * The graph half of the index: {@link links} walks the store's
 * `ref_links` table from one row, a store table and an origin pair, and
 * answers the rows it reaches as row references, never a row's body.
 *
 * ## The link table
 *
 * `ref_links` is the store's, not the index's, and no store migration
 * creates it yet (the backfill spec's `ref-links` migration will), so
 * the walk reads the six columns {@link REF_LINK_COLUMNS} names: a
 * link runs from the row `(from_table, from_origin_store,
 * from_origin_seq)` to the row `(to_table, to_origin_store,
 * to_origin_seq)`. A store holding no `ref_links` table answers
 * `graph: false` with no links; one whose table lacks a column is
 * refused, naming the columns it lacks.
 *
 * ## The walk
 *
 * One recursive CTE follows links from their `from` row to their `to`
 * row, one hop per step, up to the request's depth, a whole number from
 * 1 to {@link MAX_DEPTH}, {@link DEFAULT_DEPTH} when left out. The CTE's
 * `UNION` keeps each (row, depth) once, so a cycle is walked at most
 * once per depth and the depth bound ends it. The answer names each row
 * reached once, at the fewest hops it took, never the start row, nearest
 * first with the key (table, origin pair) breaking ties.
 *
 * ## Where the store is
 *
 * The link table is read from the database's schema `schema`, `main`
 * when left out: the connector holds one connection on the store file
 * with the index attached, so the store is its `main`.
 */
import type { OriginPair } from './search.js';
import type { Database } from 'bun:sqlite';

/** The store table the walk reads. */
export const REF_LINKS_TABLE = 'ref_links';

/** The columns the walk reads from {@link REF_LINKS_TABLE}: the two ends of a link. */
export const REF_LINK_COLUMNS: readonly string[] = Object.freeze([
  'from_table',
  'from_origin_store',
  'from_origin_seq',
  'to_table',
  'to_origin_store',
  'to_origin_seq',
]);

/** The most hops one walk takes. */
export const MAX_DEPTH = 10;

/** The hops a walk takes when the request names no depth. */
export const DEFAULT_DEPTH = 1;

/** The pattern a schema name must match, so it stays one SQL identifier. */
const SCHEMA_PATTERN = /^[A-Za-z_]\w*$/;

/** The key columns, in the order every query names them. */
const KEY = 'row_table, origin_store, origin_seq';

/** What one walk asks. */
export interface IndexLinksRequest {
  /** The store table the start row lives in. */
  readonly table: string;
  /** The start row's origin pair. */
  readonly origin: OriginPair;
  /** The most hops taken, a whole number from 1 to {@link MAX_DEPTH}; {@link DEFAULT_DEPTH} when left out. */
  readonly depth?: number;
}

/** One row a walk reached: its table and origin pair, and the fewest hops to it. Never a body. */
export interface IndexLink {
  /** The store table the row lives in. */
  readonly table: string;
  /** The row's origin pair. */
  readonly origin: OriginPair;
  /** The fewest hops from the start row, from 1 to the request's depth. */
  readonly depth: number;
}

/** What one walk answers: whether the store holds a link table, and the rows reached, nearest first. */
export interface IndexLinksResult {
  /** Whether the store holds a `ref_links` table; `false` answers no links. */
  readonly graph: boolean;
  readonly links: readonly IndexLink[];
}

/** The store a walk reads. */
export interface LinksTarget {
  /** The connection the store's tables are reached from. */
  readonly database: Database;
  /** The schema the store's tables live in, `main` when left out. */
  readonly schema?: string;
}

/** A walk refused before it ran, for a request or a store it cannot answer. */
export class IndexLinksRefusal extends Error {
  constructor(message: string) {
    super(`index links: ${message}`);
    this.name = 'IndexLinksRefusal';
  }
}

/** A reached row, as the walk query answers it. */
interface LinkRow {
  readonly row_table: string;
  readonly origin_store: string;
  readonly origin_seq: number;
  readonly depth: number;
}

/** What a request holds once checked. */
interface CheckedRequest {
  readonly table: string;
  readonly originStore: string;
  readonly originSeq: number;
  readonly depth: number;
}

/** The answer for a store holding no link table. */
const NO_GRAPH: IndexLinksResult = Object.freeze({ graph: false, links: Object.freeze([]) });

/** A name quoted as an SQL identifier. */
function quoted(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/** Refuse a request the walk cannot run, answering it with its depth filled in. */
function checkRequest(request: IndexLinksRequest): CheckedRequest {
  const { depth = DEFAULT_DEPTH, origin, table } = request;
  if (typeof table !== 'string' || table === '') {
    throw new IndexLinksRefusal(`table must be a table name, got ${JSON.stringify(table)}`);
  }
  if (typeof origin?.originStore !== 'string' || origin.originStore === '') {
    throw new IndexLinksRefusal(`origin store must be a store id, got ${JSON.stringify(origin?.originStore)}`);
  }
  if (!Number.isInteger(origin.originSeq)) {
    throw new IndexLinksRefusal(`origin seq must be a whole number, got ${String(origin.originSeq)}`);
  }
  if (!Number.isInteger(depth) || depth < 1 || depth > MAX_DEPTH) {
    throw new IndexLinksRefusal(`depth must be a whole number from 1 to ${MAX_DEPTH}, got ${String(depth)}`);
  }
  return { depth, originSeq: origin.originSeq, originStore: origin.originStore, table };
}

/** The target's schema, quoted, refusing a name that is no identifier or no attached database. */
function schemaOf(target: LinksTarget): string {
  const schema = target.schema ?? 'main';
  if (!SCHEMA_PATTERN.test(schema)) {
    throw new IndexLinksRefusal(`schema ${JSON.stringify(schema)} is not an SQL identifier`);
  }
  const attached = target.database
    .query<{ readonly name: string }, []>('PRAGMA database_list')
    .all()
    .some((row) => row.name === schema);
  if (!attached) {
    throw new IndexLinksRefusal(`no database is attached as ${schema}`);
  }
  return quoted(schema);
}

/**
 * Whether the target's store holds a `ref_links` table, the measure a
 * connector answers `graph` from. Refuses a schema that is no
 * identifier or no attached database, as {@link links} does.
 */
export function holdsRefLinks(target: LinksTarget): boolean {
  const schema = schemaOf(target);
  return target.database
    .query<{ readonly name: string }, [string]>(`SELECT name FROM ${schema}.sqlite_master WHERE type = 'table' AND name = ?`)
    .get(REF_LINKS_TABLE) !== null;
}

/** Refuse a link table lacking a column the walk reads, naming each. */
function checkColumns(database: Database, schema: string): void {
  const held = new Set(database
    .query<{ readonly name: string }, []>(`PRAGMA ${schema}.table_info(${REF_LINKS_TABLE})`)
    .all()
    .map((column) => column.name));
  const missing = REF_LINK_COLUMNS.filter((column) => !held.has(column));
  if (missing.length > 0) {
    throw new IndexLinksRefusal(`the ${REF_LINKS_TABLE} table has no ${missing.join(', ')} column`);
  }
}

/**
 * The recursive walk: every (row, depth) reached from the start row
 * within the depth bound, the start row at depth 0. Its placeholders are
 * `?1` to `?3` the start row's key and `?4` the depth.
 */
export function walkSql(schema: string): string {
  return `WITH RECURSIVE walk(${KEY}, depth) AS (
  SELECT ?1, ?2, ?3, 0
  UNION
  SELECT link.to_table, link.to_origin_store, link.to_origin_seq, walk.depth + 1
  FROM walk JOIN ${schema}.${REF_LINKS_TABLE} AS link
    ON link.from_table = walk.row_table
    AND link.from_origin_store = walk.origin_store
    AND link.from_origin_seq = walk.origin_seq
  WHERE walk.depth < ?4
)`;
}

/** The answer query: each row reached once, at its fewest hops, never the start row. */
function reachedSql(schema: string): string {
  return `${walkSql(schema)}
SELECT ${KEY}, MIN(depth) AS depth FROM walk
WHERE NOT (row_table = ?1 AND origin_store = ?2 AND origin_seq = ?3)
GROUP BY ${KEY}
ORDER BY depth, ${KEY}`;
}

/** A query row as a frozen link. */
function toLink(row: LinkRow): IndexLink {
  return Object.freeze({
    depth: Number(row.depth),
    origin: Object.freeze({ originSeq: Number(row.origin_seq), originStore: String(row.origin_store) }),
    table: String(row.row_table),
  });
}

/**
 * Walk the store's `ref_links` from the request's row up to its depth,
 * answering each row reached once with the fewest hops to it, nearest
 * first, and `graph: false` with no links for a store holding no
 * `ref_links` table. Rejects with an {@link IndexLinksRefusal} for a
 * start row that is no table and origin pair, a depth that is not a
 * whole number from 1 to {@link MAX_DEPTH}, a schema that is no attached
 * database, and a link table lacking a column the walk reads.
 */
export async function links(target: LinksTarget, request: IndexLinksRequest): Promise<IndexLinksResult> {
  const { depth, originSeq, originStore, table } = checkRequest(request);
  if (!holdsRefLinks(target)) {
    return NO_GRAPH;
  }
  const schema = schemaOf(target);
  checkColumns(target.database, schema);
  const rows = target.database
    .query<LinkRow, [string, string, number, number]>(reachedSql(schema))
    .all(table, originStore, originSeq, depth);
  return Object.freeze({ graph: true, links: Object.freeze(rows.map(toLink)) });
}
