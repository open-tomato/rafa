/**
 * The hub's `postgres` connector as a package of its own: the hub's store
 * and index over Postgres, on Drizzle over the `Bun.sql` driver
 * (`drizzle-orm/bun-sql`). Every device keeps `bun:sqlite`; the hub
 * promises the wire contract, not an engine.
 *
 * The leak rule holds every export here: no Drizzle type, query builder,
 * SQL fragment, transaction handle or `Bun.sql` type is exported, so what
 * the hub reads of this package is the port's `HubStore` and `HubIndex`
 * and plain values. Today the entry exports the layout of the package's
 * Drizzle files alone.
 */
export { MIGRATIONS_FOLDER, SCHEMA_FILE } from './src/layout.js';
