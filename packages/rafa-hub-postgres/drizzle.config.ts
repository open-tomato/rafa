/**
 * The `drizzle-kit` config of the connector: Postgres, the schema in
 * `src/schema.ts` and the migrations under `drizzle/`, journal and
 * snapshots checked in. `bun run db:generate` writes a migration from a
 * schema change; a migration file is never written by hand, and an object
 * Drizzle cannot express (a BM25 index) is a `drizzle-kit generate
 * --custom` migration.
 *
 * The connector's driver is `Bun.sql`, through `drizzle-orm/bun-sql`, and
 * its migrator (`drizzle-orm/bun-sql/migrator`) applies the generated
 * folder per project schema. `drizzle-kit` itself drives no `Bun.sql`
 * connection: of its commands only `generate` is used here, and it reads
 * the schema file alone, so the config names no database and no URL.
 * The connector reads its URL from the environment variable
 * `hub.store.postgres.urlVariable` names, never from a file.
 */
import type { Config } from 'drizzle-kit';

import { defineConfig } from 'drizzle-kit';

import { MIGRATIONS_FOLDER, SCHEMA_FILE } from './src/layout.js';

/** The config `drizzle-kit` reads from this package's folder. */
const config: Config = defineConfig({
  dialect: 'postgresql',
  schema: `./${SCHEMA_FILE}`,
  out: `./${MIGRATIONS_FOLDER}`,
});

export default config;
