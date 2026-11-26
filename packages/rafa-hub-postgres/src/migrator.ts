/**
 * The connector's migrator: it applies the migrations `drizzle-kit
 * generate` wrote under `drizzle/` (`MIGRATIONS_FOLDER`) to one project's
 * Postgres schema, through Drizzle's own migrator for the `Bun.sql`
 * driver (`drizzle-orm/bun-sql/migrator`).
 *
 * ## One schema per project
 *
 * The generated SQL names no schema (see `schema.ts`), so the migrator
 * reserves one connection of the pool, creates the project's schema when
 * it is missing, sets `search_path` to it and runs the migrations there;
 * the same files build every project's tables apart. Drizzle's own log,
 * `__drizzle_migrations`, sits in the project's schema too, so each
 * project records the migrations it has applied. `search_path` is reset
 * before the connection goes back to the pool.
 *
 * ## A shipped migration never changes
 *
 * Drizzle's migrator decides what to apply by each journal entry's `when`
 * alone and never reads the hash it logs, so a migration file edited
 * after a schema applied it would go unnoticed. Two checks close that:
 *
 *   - {@link SHIPPED_MIGRATION_HASHES} pins the sha256 of each shipped
 *     migration file, the hash Drizzle logs, and `migrator.test.ts` fails
 *     when a file's hash differs from its pin. A schema change is a new
 *     generated migration with a new pin, never an edit of a shipped one;
 *   - before it migrates, the migrator reads the schema's log and refuses
 *     when a logged migration's hash is not the shipped file's, naming
 *     the tag and both hashes.
 *
 * Nothing here is exported from the package's entry: the `Bun.sql`
 * client it takes stays inside the connector under the leak rule.
 */
import type { SQL } from 'bun';
import type { MigrationMeta } from 'drizzle-orm/migrator';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/bun-sql';
import { migrate } from 'drizzle-orm/bun-sql/migrator';
import { readMigrationFiles } from 'drizzle-orm/migrator';

import { MIGRATIONS_FOLDER } from './layout.js';

/** The table Drizzle logs a schema's applied migrations in, inside that schema. */
export const MIGRATIONS_TABLE = '__drizzle_migrations';

/** The shipped migrations folder, by its absolute path. */
export const SHIPPED_MIGRATIONS_FOLDER: string = join(fileURLToPath(new URL('..', import.meta.url)), MIGRATIONS_FOLDER);

/** A Postgres schema name the migrator takes: lower case, unquoted-safe, within the 63-byte limit. */
const SCHEMA_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

/** One shipped migration and the sha256 of its file, as Drizzle logs it. */
export interface ShippedMigrationHash {
  /** The Drizzle journal's tag for the migration. */
  readonly tag: string;
  /** The sha256 of the migration's `.sql` file, hex. */
  readonly hash: string;
}

/**
 * The shipped migrations in journal order, each pinned to its file's hash.
 * A new generated migration adds its entry here; a shipped entry is never
 * edited.
 */
export const SHIPPED_MIGRATION_HASHES: readonly ShippedMigrationHash[] = [
  { tag: '0000_wire_contract_1', hash: '05825fa6a7974728683e1f51e402be2c82f6f7e2caf1eaac0797d452c1388f19' },
];

/** A migration of a folder: its journal tag, its journal `when` and its file's hash. */
export interface FolderMigration {
  /** The Drizzle journal's tag for the migration. */
  readonly tag: string;
  /** The journal's `when`, the value Drizzle logs as `created_at`. */
  readonly when: number;
  /** The sha256 of the migration's `.sql` file, hex. */
  readonly hash: string;
}

/** A row of a schema's Drizzle log. */
export interface AppliedMigration {
  /** The hash Drizzle logged for the migration. */
  readonly hash: string;
  /** The journal `when` Drizzle logged as `created_at`. */
  readonly createdAt: number;
}

/** The journal's entries, as `drizzle-kit` writes them. */
interface JournalFile {
  readonly entries: readonly { readonly tag: string; readonly when: number }[];
}

/**
 * Reads a migrations folder's journal and files: each migration's tag and
 * `when` from the journal, its hash as Drizzle's own reader computes it.
 */
export function readFolderMigrations(folder: string): FolderMigration[] {
  const journal = JSON.parse(readFileSync(join(folder, 'meta', '_journal.json'), 'utf8')) as JournalFile;
  const metas: MigrationMeta[] = readMigrationFiles({ migrationsFolder: folder });
  return journal.entries.map((entry, index) => {
    const meta = metas[index];
    if (meta === undefined) throw new Error(`hub migrator: ${entry.tag} has no migration file in ${folder}`);
    return { tag: entry.tag, when: entry.when, hash: meta.hash };
  });
}

/**
 * The faults between the pinned hashes and a folder's migrations: a pin
 * whose file hashes otherwise, a pin with no migration and a migration
 * with no pin, each named by its tag. Empty when they agree, in order.
 */
export function pinnedHashFaults(
  pinned: readonly ShippedMigrationHash[],
  folder: readonly FolderMigration[],
): string[] {
  const faults: string[] = [];
  const length = Math.max(pinned.length, folder.length);
  for (let index = 0; index < length; index += 1) {
    const pin = pinned[index];
    const migration = folder[index];
    if (pin === undefined) {
      faults.push(`${migration?.tag}: migration with no pinned hash`);
    } else if (migration === undefined) {
      faults.push(`${pin.tag}: pinned hash with no migration`);
    } else if (pin.tag !== migration.tag) {
      faults.push(`${pin.tag}: pinned where the journal holds ${migration.tag}`);
    } else if (pin.hash !== migration.hash) {
      faults.push(`${pin.tag}: shipped as ${pin.hash}, the file hashes ${migration.hash}`);
    }
  }
  return faults;
}

/**
 * The faults between a schema's Drizzle log and the folder's migrations: a
 * logged migration no journal entry holds, and one logged under a hash
 * other than its file's, each naming the tag and both hashes.
 */
export function appliedHashFaults(
  folder: readonly FolderMigration[],
  applied: readonly AppliedMigration[],
): string[] {
  return applied.flatMap((row) => {
    const migration = folder.find(({ when }) => when === row.createdAt);
    if (migration === undefined) return [`a migration logged at ${row.createdAt} is in no journal entry`];
    return migration.hash === row.hash
      ? []
      : [`${migration.tag} was applied as ${row.hash}, the shipped file hashes ${migration.hash}`];
  });
}

/** Refuses a schema name the migrator would have to quote, naming it. */
function checkedSchema(schema: string): string {
  if (!SCHEMA_NAME.test(schema)) {
    throw new Error(`hub migrator: "${schema}" is no schema name (lower case letters, digits and _, at most 63)`);
  }
  return schema;
}

/** Options of {@link migrateProjectSchema}. */
export interface MigrateOptions {
  /** The migrations folder to apply; the shipped one when left out. */
  readonly folder?: string;
}

/**
 * Brings one project's schema through every migration of the folder:
 * creates the schema when it is missing, refuses when its log holds a
 * migration under a hash other than the shipped file's, then applies the
 * migrations it has not, all with `search_path` set to the schema on one
 * reserved connection.
 */
export async function migrateProjectSchema(client: SQL, schema: string, options: MigrateOptions = {}): Promise<void> {
  const name = checkedSchema(schema);
  const folder = options.folder ?? SHIPPED_MIGRATIONS_FOLDER;
  const migrations = readFolderMigrations(folder);
  const reserved = await client.reserve();
  try {
    await reserved.unsafe(`CREATE SCHEMA IF NOT EXISTS "${name}"`);
    const faults = appliedHashFaults(migrations, await appliedMigrations(reserved, name));
    if (faults.length > 0) {
      throw new Error(`hub migrator: schema ${name} holds a migration the shipped files do not: ${faults.join('; ')}`);
    }
    await reserved.unsafe(`SET search_path TO "${name}"`);
    await migrate(drizzle({ client: reserved }), {
      migrationsFolder: folder,
      migrationsSchema: name,
      migrationsTable: MIGRATIONS_TABLE,
    });
  } finally {
    try {
      await reserved.unsafe('RESET search_path');
    } finally {
      reserved.release();
    }
  }
}

/** A schema's Drizzle log, oldest first; empty when the schema has none yet. */
async function appliedMigrations(client: SQL, schema: string): Promise<AppliedMigration[]> {
  const table = `"${schema}"."${MIGRATIONS_TABLE}"`;
  const [found] = await client.unsafe<{ present: boolean }[]>('SELECT to_regclass($1) IS NOT NULL AS present', [table]);
  if (found?.present !== true) return [];
  const rows = await client.unsafe<{ hash: string; created_at: string | number }[]>(
    `SELECT hash, created_at FROM ${table} ORDER BY id`,
  );
  return rows.map((row) => ({ hash: row.hash, createdAt: Number(row.created_at) }));
}
