/**
 * The hub's `postgres` connector as a package of its own: the hub's store
 * and index over Postgres, on Drizzle over the `Bun.sql` driver
 * (`drizzle-orm/bun-sql`). Every device keeps `bun:sqlite`; the hub
 * promises the wire contract, not an engine.
 *
 * The leak rule holds every export here: no Drizzle type, query builder,
 * SQL fragment, transaction handle or `Bun.sql` type is exported, so what
 * the hub reads of this package is the port's `HubStore` and `HubIndex`
 * and plain values. The entry exports the connector,
 * `connectPostgresHub` with its options and the type of the embedding
 * record they take, the index contract suite's probe,
 * `postgresIndexProbe`, which reads over a URL and answers plain
 * strings, and the layout of the package's Drizzle files.
 */
export type { EmbeddingPrecision, EmbeddingRecord } from './src/embedding-record.js';
export type { PostgresHubOptions } from './src/hub-connector.js';
export type { PostgresIndexProbe, PostgresIndexProbeOptions } from './src/index-probe.js';

export { connectPostgresHub } from './src/hub-connector.js';
export { postgresIndexProbe } from './src/index-probe.js';
export { MIGRATIONS_FOLDER, SCHEMA_FILE } from './src/layout.js';
