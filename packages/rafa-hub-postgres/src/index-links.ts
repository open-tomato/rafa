/**
 * The connector's link walk: {@link walkProjectLinks} answers the nodes
 * a project's serving build reaches from one node over its copy of
 * `ref_links`, as kinds, ids and hops, never a row's body.
 *
 * ## The links the build holds
 *
 * The walk reads the build's copy of `ref_links` (`index-build.ts`),
 * never the project's own table: a link the rows took since the build
 * was copied, such as one of a backfill run the build does not hold, is
 * never reached until a rebuild copies it, and a link the rows dropped
 * since is reached until then. A build copied from a project holding no
 * `ref_links` answers `graph: false` with no links. Until #1653's fold
 * lands the copy is `ref_links` as the rows hold it; once it does, the
 * build holds the folded table and the walk reads it unchanged.
 *
 * ## The walk
 *
 * As `rafa-index`'s SQLite walk: a node is a kind and an id, and a
 * link's `ref_kind` and `ref_text` name the node a further link leaves
 * from as its `from_kind` and `from_id`. One recursive CTE
 * ({@link walkSql}) follows links from their `from` end to their `ref`
 * end, one hop a step, up to the request's depth, a whole number from 1
 * to `rafa-index`'s `MAX_DEPTH`, its `DEFAULT_DEPTH` when left out. Its
 * `UNION` keeps each (node, depth) once, so two links joining the same
 * ends are one hop and a cycle ends at the depth bound. The answer names
 * each node reached once, at its fewest hops, never the start node,
 * nearest first, the key (kind, id) breaking ties. The walk reads the four
 * columns `REF_LINK_COLUMNS` names, so any column beside them, a run's
 * or a role's, is left alone.
 *
 * ## The placeholders
 *
 * The walk is written with Postgres's `$n` placeholders, `$1` and `$2`
 * the start node's kind and id and `$3` the depth, bound by
 * `index-search.ts`'s `boundSql`, so no value of a request is written
 * into the text; only the build's schema, quoted, is.
 *
 * ## The serving build
 *
 * A walk runs in one transaction in the project's schema, reading the
 * pointer with `servingBuild`, which locks it `FOR SHARE` so no swap
 * drops the build under it, and walks that build. A project with no
 * build yet is refused, naming the rebuild.
 *
 * ## Refusals
 *
 * Refused with `rafa-index`'s `IndexLinksRefusal`, before the transaction
 * opens: a start node with an empty kind or id, and a depth that is no
 * whole number from 1 to `MAX_DEPTH`. Inside it: a project with no build,
 * and a build whose link table lacks a column the walk reads, naming each.
 *
 * Nothing here is exported from the package's entry: it takes the
 * Drizzle database, which the leak rule keeps inside the connector.
 */
import type { ProjectSchema } from './hub-projects.js';
import type { HubDatabase, HubTransaction } from './hub-tables.js';
import type { IndexLinksRequest, IndexLinksResult } from '@open-tomato/rafa-hub-port';

import { DEFAULT_DEPTH, IndexLinksRefusal, MAX_DEPTH, REF_LINK_COLUMNS } from '@open-tomato/rafa-index';
import { sql } from 'drizzle-orm';

import { inProjectSchema } from './hub-tables.js';
import { LINKS_TABLE, quoted, servingBuild } from './index-build.js';
import { boundSql } from './index-search.js';

/** The key columns, in the order every query names them. */
const KEY = 'node_kind, node_id';

/** What one walk of a project's links is handed. */
export interface IndexLinksOptions {
  /** The connector's Drizzle database, the walk's transaction taken on it. */
  readonly db: HubDatabase;
  /** The project's schema, whose pointer names the serving build. */
  readonly place: ProjectSchema;
  /** The request: the start node and the depth. */
  readonly request: IndexLinksRequest;
}

/** One node a walk reached, as the port's result carries it. */
type IndexLink = IndexLinksResult['links'][number];

/** What a request holds once checked. */
interface CheckedRequest {
  readonly kind: string;
  readonly id: string;
  readonly depth: number;
}

/** A reached node, as the walk answers it; Postgres answers an integer as a number. */
interface LinkRow extends Record<string, unknown> {
  readonly node_kind: string;
  readonly node_id: string;
  readonly depth: number | string;
}

/** The answer for a build holding no link table. */
const NO_GRAPH: IndexLinksResult = Object.freeze({ graph: false, links: Object.freeze([]) });

/** Refuses a request the walk cannot run, answering it with its depth filled in. */
function checkRequest(request: IndexLinksRequest): CheckedRequest {
  const { depth = DEFAULT_DEPTH, id, kind } = request;
  if (typeof kind !== 'string' || kind === '') {
    throw new IndexLinksRefusal(`kind must be a reference kind, got ${JSON.stringify(kind)}`);
  }
  if (typeof id !== 'string' || id === '') {
    throw new IndexLinksRefusal(`id must be a reference id, got ${JSON.stringify(id)}`);
  }
  if (!Number.isInteger(depth) || depth < 1 || depth > MAX_DEPTH) {
    throw new IndexLinksRefusal(`depth must be a whole number from 1 to ${String(MAX_DEPTH)}, got ${String(depth)}`);
  }
  return { depth, id, kind };
}

/**
 * The walk over `build`'s link table: every node reached from the start
 * node within the depth bound, once, at its fewest hops, never the start
 * node, nearest first. `$1` and `$2` are the start node's kind and id
 * and `$3` the depth.
 */
export function walkSql(build: string): string {
  return `WITH RECURSIVE walk(${KEY}, depth) AS (
  SELECT CAST($1 AS text), CAST($2 AS text), 0
  UNION
  SELECT CAST(link.ref_kind AS text), CAST(link.ref_text AS text), walk.depth + 1
  FROM walk JOIN ${quoted(build)}.${quoted(LINKS_TABLE)} AS link
    ON CAST(link.from_kind AS text) = walk.node_kind
    AND CAST(link.from_id AS text) = walk.node_id
  WHERE walk.depth < CAST($3 AS integer)
)
SELECT ${KEY}, MIN(depth) AS depth FROM walk
WHERE NOT (node_kind = CAST($1 AS text) AND node_id = CAST($2 AS text))
GROUP BY ${KEY}
ORDER BY depth, ${KEY}`;
}

/** The columns `build`'s link table holds, none when the build copied no link table. */
async function linkColumnsOf(tx: HubTransaction, build: string): Promise<readonly string[]> {
  // Drizzle's bun-sql result types its rows loosely; they are the one text column selected.
  const rows = await tx.execute<{ column_name: string }>(sql`SELECT column_name FROM information_schema.columns
    WHERE table_schema = ${build} AND table_name = ${LINKS_TABLE}`) as unknown as readonly { column_name: string }[];
  return rows.map((row) => row.column_name);
}

/** A query row as a frozen link. */
function toLink(row: LinkRow): IndexLink {
  return Object.freeze({
    depth: Number(row.depth),
    id: String(row.node_id),
    kind: String(row.node_kind),
  });
}

/** The walk inside its transaction: the serving build read under its lock, its link table checked, then walked. */
async function walkBuild(tx: HubTransaction, place: ProjectSchema, checked: CheckedRequest): Promise<IndexLinksResult> {
  const serving = await servingBuild(tx);
  if (serving === null) {
    throw new IndexLinksRefusal(`project ${place.id} has no index built yet; rebuild the index (rafa-hub index rebuild)`);
  }
  const held = await linkColumnsOf(tx, serving.schema);
  if (held.length === 0) return NO_GRAPH;
  const missing = REF_LINK_COLUMNS.filter((column) => !held.includes(column));
  if (missing.length > 0) {
    throw new IndexLinksRefusal(`the serving build's ${LINKS_TABLE} table has no ${missing.join(', ')} column`);
  }
  // Drizzle's bun-sql result types its rows loosely; they are the key and depth selected.
  const rows = await tx.execute<LinkRow>(boundSql(walkSql(serving.schema), [checked.kind, checked.id, checked.depth])) as unknown as readonly LinkRow[];
  return Object.freeze({ graph: true, links: Object.freeze(rows.map(toLink)) });
}

/**
 * Walks the project's serving build's links from the request's node up
 * to its depth, answering each node reached once with its fewest hops,
 * nearest first, and `graph: false` with no links over a build holding
 * no link table. Rejects with an `IndexLinksRefusal` for a request the
 * walk cannot run, a project with no build, and a link table lacking a
 * column the walk reads; see the module note.
 */
export async function walkProjectLinks(options: IndexLinksOptions): Promise<IndexLinksResult> {
  const { db, place, request } = options;
  const checked = checkRequest(request);
  return inProjectSchema(db, place.schema, (tx) => walkBuild(tx, place, checked));
}
