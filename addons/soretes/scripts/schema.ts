/**
 * The effort store's own schema as entities, for the ERM view: one node per
 * table, its columns as rows, and a `references` edge where a column names
 * another table's key. The keys are matched by name, which is how the store
 * joins them; SQLite declares no foreign keys here.
 */
import type { Database } from 'bun:sqlite';

import type { GraphEdge, GraphNode } from '../src/types.ts';

/** Column name → the table whose key it holds. */
const KEY_OWNERS: Readonly<Record<string, string>> = {
  session_id: 'sessions',
  merge_id: 'merges',
  origin_store: 'store_meta',
  store_id: 'store_meta',
};

interface Column {
  readonly name: string;
  readonly type: string;
  readonly pk: number;
}

export function schemaGraph(db: Database): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const tables = (db.query("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name").all() as { name: string }[]).map((t) => t.name);
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  for (const table of tables) {
    const columns = db.query(`select name, type, pk from pragma_table_info('${table.replace(/'/g, "''")}')`).all() as Column[];
    const rowCount = (db.query(`select count(*) as n from "${table.replace(/"/g, '""')}"`).get() as { n: number }).n;
    const refs = columns.flatMap((c) => {
      const owner = KEY_OWNERS[c.name];
      return owner && owner !== table && tables.includes(owner) ? [{ column: c.name, table: owner }] : [];
    });
    nodes.push({
      id: `table:${table}`,
      label: table,
      type: 'table',
      group: 'store:effort',
      legend: `${rowCount} rows · ${columns.length} columns`,
      rowCount,
      columns: columns.map((c) => ({
        name: c.name,
        type: c.type.toLowerCase() || 'any',
        key: c.pk > 0 ? 'pk' : KEY_OWNERS[c.name] ? 'fk' : '',
      })),
      references: refs.map((r) => `table:${r.table}`),
    });
    for (const ref of refs) edges.push({ source: `table:${table}`, target: `table:${ref.table}`, kind: 'references', weight: 1 });
  }
  return { nodes, edges };
}
