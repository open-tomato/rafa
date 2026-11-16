/**
 * The graph half of the index: {@link links} walks the store's
 * `ref_links` table from one reference, a kind and an id, and answers
 * the references it reaches, never a row's body.
 *
 * ## The link table
 *
 * `ref_links` is the store's, not the index's, and is the backfill
 * spec's `ref-links` migration (#1436): a link runs from a record,
 * `(from_kind, from_id)`, such as `commit` and its sha, to a reference
 * it names, `(ref_kind, ref_text)`, such as `issue` and `#1436`. The
 * walk reads the four columns {@link REF_LINK_COLUMNS} names and no
 * other, so the migration's `role`, extractor, provenance and origin
 * columns may sit beside them. A store holding no `ref_links` table
 * answers `graph: false` with no links; one whose table lacks a column
 * is refused, naming the columns it lacks.
 *
 * ## The walk
 *
 * A reference is one node, its kind and its id: a link's `ref_kind` and
 * `ref_text` name the node a further link leaves from as its
 * `from_kind` and `from_id`. One recursive CTE follows links from their
 * `from` end to their `ref` end, one hop per step, up to the request's
 * depth, a whole number from 1 to {@link MAX_DEPTH},
 * {@link DEFAULT_DEPTH} when left out. Two links joining the same ends
 * under two roles are one hop. The CTE's `UNION` keeps each
 * (node, depth) once, so a cycle is walked at most once per depth and
 * the depth bound ends it. The answer names each node reached once, at
 * the fewest hops it took, never the start node, nearest first with the
 * key (kind, id) breaking ties.
 *
 * ## Where the store is
 *
 * The link table is read from the database's schema `schema`, `main`
 * when left out: the connector holds one connection on the store file
 * with the index attached, so the store is its `main`.
 */
import type { Database } from 'bun:sqlite';

/** The store table the walk reads. */
export const REF_LINKS_TABLE = 'ref_links';

/** The columns the walk reads from {@link REF_LINKS_TABLE}: the two ends of a link, as #1436's `ref-links` names them. */
export const REF_LINK_COLUMNS: readonly string[] = Object.freeze([
  'from_kind',
  'from_id',
  'ref_kind',
  'ref_text',
]);

/** The most hops one walk takes. */
export const MAX_DEPTH = 10;

/** The hops a walk takes when the request names no depth. */
export const DEFAULT_DEPTH = 1;

/** The pattern a schema name must match, so it stays one SQL identifier. */
const SCHEMA_PATTERN = /^[A-Za-z_]\w*$/;

/** The key columns, in the order every query names them. */
const KEY = 'node_kind, node_id';

/** What one walk asks. */
export interface IndexLinksRequest {
  /** The start node's kind: a link's `from_kind` or `ref_kind`, such as `commit` or `issue`. */
  readonly kind: string;
  /** The start node's id: a link's `from_id` or `ref_text`, such as a sha or `#1436`. */
  readonly id: string;
  /** The most hops taken, a whole number from 1 to {@link MAX_DEPTH}; {@link DEFAULT_DEPTH} when left out. */
  readonly depth?: number;
}

/** One node a walk reached: its kind and id, and the fewest hops to it. Never a body. */
export interface IndexLink {
  /** The node's kind. */
  readonly kind: string;
  /** The node's id. */
  readonly id: string;
  /** The fewest hops from the start node, from 1 to the request's depth. */
  readonly depth: number;
}

/** What one walk answers: whether the store holds a link table, and the nodes reached, nearest first. */
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

/** A reached node, as the walk query answers it. */
interface LinkRow {
  readonly node_kind: string;
  readonly node_id: string;
  readonly depth: number;
}

/** What a request holds once checked. */
interface CheckedRequest {
  readonly kind: string;
  readonly id: string;
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
  const { depth = DEFAULT_DEPTH, id, kind } = request;
  if (typeof kind !== 'string' || kind === '') {
    throw new IndexLinksRefusal(`kind must be a reference kind, got ${JSON.stringify(kind)}`);
  }
  if (typeof id !== 'string' || id === '') {
    throw new IndexLinksRefusal(`id must be a reference id, got ${JSON.stringify(id)}`);
  }
  if (!Number.isInteger(depth) || depth < 1 || depth > MAX_DEPTH) {
    throw new IndexLinksRefusal(`depth must be a whole number from 1 to ${MAX_DEPTH}, got ${String(depth)}`);
  }
  return { depth, id, kind };
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
 * The recursive walk: every (node, depth) reached from the start node
 * within the depth bound, the start node at depth 0. Its placeholders
 * are `?1` and `?2` the start node's kind and id and `?3` the depth.
 */
export function walkSql(schema: string): string {
  return `WITH RECURSIVE walk(${KEY}, depth) AS (
  SELECT ?1, ?2, 0
  UNION
  SELECT link.ref_kind, link.ref_text, walk.depth + 1
  FROM walk JOIN ${schema}.${REF_LINKS_TABLE} AS link
    ON link.from_kind = walk.node_kind
    AND link.from_id = walk.node_id
  WHERE walk.depth < ?3
)`;
}

/** The answer query: each node reached once, at its fewest hops, never the start node. */
function reachedSql(schema: string): string {
  return `${walkSql(schema)}
SELECT ${KEY}, MIN(depth) AS depth FROM walk
WHERE NOT (node_kind = ?1 AND node_id = ?2)
GROUP BY ${KEY}
ORDER BY depth, ${KEY}`;
}

/** A query row as a frozen link. */
function toLink(row: LinkRow): IndexLink {
  return Object.freeze({
    depth: Number(row.depth),
    id: String(row.node_id),
    kind: String(row.node_kind),
  });
}

/**
 * Walk the store's `ref_links` from the request's node up to its depth,
 * answering each node reached once with the fewest hops to it, nearest
 * first, and `graph: false` with no links for a store holding no
 * `ref_links` table. Rejects with an {@link IndexLinksRefusal} for a
 * start node with an empty kind or id, a depth that is not a
 * whole number from 1 to {@link MAX_DEPTH}, a schema that is no attached
 * database, and a link table lacking a column the walk reads.
 */
export async function links(target: LinksTarget, request: IndexLinksRequest): Promise<IndexLinksResult> {
  const { depth, id, kind } = checkRequest(request);
  if (!holdsRefLinks(target)) {
    return NO_GRAPH;
  }
  const schema = schemaOf(target);
  checkColumns(target.database, schema);
  const rows = target.database
    .query<LinkRow, [string, string, number]>(reachedSql(schema))
    .all(kind, id, depth);
  return Object.freeze({ graph: true, links: Object.freeze(rows.map(toLink)) });
}
