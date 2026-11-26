/**
 * The connector's probe for the hub index contract suite: how the suite
 * reads, from outside the connector, the identity of a project's rows and
 * of the index serving it. Each answer is an opaque string the suite only
 * compares with an earlier one.
 *
 *   - {@link rowTablesChecksum}, the store's identity: a sha256 over every
 *     table of the project's schema but the pointer `hub_index_serving`,
 *     in name order, each as its name, the md5 of its rows' text in sorted
 *     order, and the definition of every index on it. A rebuild must leave
 *     it as it was: a row it wrote, or an index it put on a row table,
 *     changes it. The pointer is left out because a rebuild's swap is the
 *     one write to the project's schema it is meant to make.
 *   - {@link servingBuildIdentity}, the index's identity: the serving
 *     build's schema, then each of its tables with its relfilenode and its
 *     indexes' names and relfilenodes, in name order; `none` before the
 *     first rebuild. A rebuild swaps in a new schema of new tables, so it
 *     changes; a search leaves it.
 *
 * {@link postgresIndexProbe} wraps the two over a URL, opening a client of
 * its own for each reading and closing it after, and is what the package's
 * entry exports: it takes and answers plain values alone, the leak rule's
 * shape, with `schemaOf` naming the project schema a case's context opened.
 */
import type { HubStoreContext } from '@open-tomato/rafa-hub-port';

import { SQL } from 'bun';

import { quoted } from './index-build.js';
import { SCHEMA_NAME } from './migrator.js';

/** The pointer table, the one table of the project's schema the store identity leaves out. */
const POINTER_TABLE = 'hub_index_serving';

/** The index identity before the project's first rebuild. */
export const NO_SERVING_BUILD = 'none';

/** What {@link postgresIndexProbe} reads over. */
export interface PostgresIndexProbeOptions {
  /** The Postgres URL the probe opens its own client on. */
  readonly url: string;
  /** The project schema the connector opened over `context` keeps its rows in. */
  readonly schemaOf: (context: HubStoreContext) => string;
}

/** The two readings, in the shape the index contract suite's probe takes. */
export interface PostgresIndexProbe {
  /** The project's row tables' checksum: {@link rowTablesChecksum}. */
  readonly storeIdentity: (context: HubStoreContext) => Promise<string>;
  /** The serving build's tables and their indexes' relfilenodes: {@link servingBuildIdentity}. */
  readonly indexIdentity: (context: HubStoreContext) => Promise<string>;
}

/** `schema`, refused when it is no name the connector quotes safely. */
function checkedSchema(schema: string): string {
  if (!SCHEMA_NAME.test(schema)) throw new TypeError(`hub postgres: "${schema}" is no schema name`);
  return schema;
}

/** The sha256 of `text`, hex. */
function sha256Of(text: string): string {
  return new Bun.CryptoHasher('sha256')
    .update(text)
    .digest('hex');
}

/** The checksum of the project's row tables; see the module note. */
export async function rowTablesChecksum(client: SQL, schema: string): Promise<string> {
  const tables = await client.unsafe<{ table_name: string }[]>(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = $1 AND table_type = 'BASE TABLE' AND table_name <> $2 ORDER BY table_name`,
    [checkedSchema(schema), POINTER_TABLE],
  );
  const lines: string[] = [];
  for (const { table_name: table } of tables) {
    const [rows] = await client.unsafe<{ digest: string }[]>(
      `SELECT md5(coalesce(string_agg(r::text, E'\\n' ORDER BY r::text), '')) AS digest FROM ${quoted(schema)}.${quoted(table)} AS r`,
    );
    const indexes = await client.unsafe<{ indexdef: string }[]>(
      'SELECT indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename = $2 ORDER BY indexname',
      [schema, table],
    );
    lines.push(`${table}\t${rows?.digest ?? ''}\t${indexes.map((index) => index.indexdef).join(';')}`);
  }
  return sha256Of(lines.join('\n'));
}

/** The serving build's tables and their indexes' relfilenodes; see the module note. */
export async function servingBuildIdentity(client: SQL, schema: string): Promise<string> {
  const [pointer] = await client.unsafe<{ build_schema: string }[]>(
    `SELECT build_schema FROM ${quoted(checkedSchema(schema))}.${quoted(POINTER_TABLE)} WHERE id = 1`,
  );
  if (pointer === undefined) return NO_SERVING_BUILD;
  const build = pointer.build_schema;
  const tables = await client.unsafe<{ name: string; node: string; indexes: string }[]>(
    `SELECT c.relname AS name, c.relfilenode::text AS node,
        coalesce(string_agg(i.relname || '=' || i.relfilenode::text, ',' ORDER BY i.relname), '') AS indexes
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_index x ON x.indrelid = c.oid
      LEFT JOIN pg_class i ON i.oid = x.indexrelid
      WHERE n.nspname = $1 AND c.relkind = 'r'
      GROUP BY c.relname, c.relfilenode ORDER BY c.relname`,
    [build],
  );
  return [build, ...tables.map((table) => `${table.name}@${table.node}[${table.indexes}]`)].join('\n');
}

/** Runs `read` on a client of its own opened on `url`, closing it after. */
async function withClient<T>(url: string, read: (client: SQL) => Promise<T>): Promise<T> {
  const client = new SQL(url);
  try {
    return await read(client);
  } finally {
    await client.close();
  }
}

/** The probe over `options.url`; see the module note. */
export function postgresIndexProbe(options: PostgresIndexProbeOptions): PostgresIndexProbe {
  const { schemaOf, url } = options;
  return Object.freeze({
    storeIdentity: (context: HubStoreContext) => withClient(url, (client) => rowTablesChecksum(client, schemaOf(context))),
    indexIdentity: (context: HubStoreContext) => withClient(url, (client) => servingBuildIdentity(client, schemaOf(context))),
  });
}
