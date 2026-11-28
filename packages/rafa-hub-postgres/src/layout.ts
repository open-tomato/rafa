/**
 * Where the connector's Drizzle files sit, relative to this package's
 * folder: the schema `drizzle-kit generate` reads and the folder it writes
 * the migrations, their journal and their snapshots to, which the
 * connector's migrator applies per project schema.
 *
 * Plain strings on purpose: `drizzle.config.ts` imports this file, and
 * `drizzle-kit` loads that config through its own transpiler, where
 * `import.meta` is not the module's. A caller that needs an absolute path
 * joins one of these under the package's folder itself.
 */

/** The schema file `drizzle-kit` reads, relative to the package folder. */
export const SCHEMA_FILE = 'src/schema.ts';

/** The folder `drizzle-kit generate` writes and the migrator reads, relative to the package folder. */
export const MIGRATIONS_FOLDER = 'drizzle';
