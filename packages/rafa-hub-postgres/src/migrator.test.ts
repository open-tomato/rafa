/**
 * The migrator and the shipped migrations: every journal entry is pinned
 * to its file's hash and covered in `wire-migrations.ts`, a changed file
 * reddens the pin (with a tampered copy as the control that proves the
 * check can fail), and, where `POSTGRES_URL` is set, a project's schema is
 * built apart from `public`, migrated once, and refused when its log holds
 * a hash the shipped file does not. Each live case creates a uniquely
 * named schema and drops only that one.
 */
import { appendFileSync, cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SQL } from 'bun';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test';

import {
  MIGRATIONS_TABLE,
  SHIPPED_MIGRATION_HASHES,
  SHIPPED_MIGRATIONS_FOLDER,
  appliedHashFaults,
  migrateProjectSchema,
  pinnedHashFaults,
  readFolderMigrations,
} from './migrator.js';
import { WIRE_TABLES } from './schema.js';
import { DRIZZLE_WIRE_MIGRATIONS } from './wire-migrations.js';

const shipped = readFolderMigrations(SHIPPED_MIGRATIONS_FOLDER);

describe('the shipped migrations', () => {
  it('hash as pinned, entry by entry', () => {
    expect(pinnedHashFaults(SHIPPED_MIGRATION_HASHES, shipped)).toEqual([]);
  });

  it('are each covered in the wire-id table, in journal order', () => {
    expect(DRIZZLE_WIRE_MIGRATIONS.map(({ tag }) => tag)).toEqual(shipped.map(({ tag }) => tag));
  });

  it('have a snapshot beside each journal entry', () => {
    const missing = shipped
      .map((_, index) => join(SHIPPED_MIGRATIONS_FOLDER, 'meta', `${String(index).padStart(4, '0')}_snapshot.json`))
      .filter((path) => !existsSync(path));
    expect(missing).toEqual([]);
  });

  it('name no Postgres schema, so search_path places them', () => {
    const text = shipped.map(({ tag }) => readFileSync(join(SHIPPED_MIGRATIONS_FOLDER, `${tag}.sql`), 'utf8')).join('\n');
    expect(text).not.toMatch(/"public"\.|CREATE SCHEMA|SET search_path/i);
  });
});

describe('the pin check', () => {
  let scratch = '';

  beforeAll(() => {
    scratch = mkdtempSync(join(tmpdir(), 'rafa-hub-postgres-migrator-'));
    cpSync(SHIPPED_MIGRATIONS_FOLDER, scratch, { recursive: true });
  });

  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it('reads an untouched copy as the shipped folder', () => {
    expect(pinnedHashFaults(SHIPPED_MIGRATION_HASHES, readFolderMigrations(scratch))).toEqual([]);
  });

  it('names a shipped migration whose file changed', () => {
    const [first] = SHIPPED_MIGRATION_HASHES;
    if (first === undefined) throw new Error('no shipped migration');
    appendFileSync(join(scratch, `${first.tag}.sql`), '\n');
    const faults = pinnedHashFaults(SHIPPED_MIGRATION_HASHES, readFolderMigrations(scratch));
    expect(faults).toHaveLength(1);
    expect(faults[0]).toStartWith(`${first.tag}: shipped as ${first.hash}, the file hashes `);
  });

  it('names a migration with no pin and a pin with no migration', () => {
    const extra = { tag: '0001_next', when: 2, hash: 'b' };
    expect(pinnedHashFaults([], [extra])).toEqual(['0001_next: migration with no pinned hash']);
    expect(pinnedHashFaults([{ tag: '0001_next', hash: 'b' }], [])).toEqual(['0001_next: pinned hash with no migration']);
    expect(pinnedHashFaults([{ tag: '0001_other', hash: 'b' }], [extra])).toEqual([
      '0001_other: pinned where the journal holds 0001_next',
    ]);
  });
});

describe('the applied-hash check', () => {
  const folder = [{ tag: '0000_first', when: 10, hash: 'a' }];

  it('accepts a log of the shipped hashes, and an empty one', () => {
    expect(appliedHashFaults(folder, [{ hash: 'a', createdAt: 10 }])).toEqual([]);
    expect(appliedHashFaults(folder, [])).toEqual([]);
  });

  it('names a migration logged under another hash, with both hashes', () => {
    expect(appliedHashFaults(folder, [{ hash: 'z', createdAt: 10 }])).toEqual([
      '0000_first was applied as z, the shipped file hashes a',
    ]);
  });

  it('names a logged migration no journal entry holds', () => {
    expect(appliedHashFaults(folder, [{ hash: 'a', createdAt: 11 }])).toEqual([
      'a migration logged at 11 is in no journal entry',
    ]);
  });
});

const url = process.env['POSTGRES_URL'];

describe('migrateProjectSchema, without a database', () => {
  it('refuses a schema name it would have to quote, before it connects', async () => {
    const client = { reserve: () => { throw new Error('connected'); } } as unknown as SQL;
    await expect(migrateProjectSchema(client, 'Project"; DROP')).rejects.toThrow('is no schema name');
  });
});

describe.skipIf(url === undefined || url === '')('migrateProjectSchema, live on POSTGRES_URL', () => {
  let client: SQL;
  const created: string[] = [];

  /** A schema name no other case or run holds, recorded for the drop. */
  function freshSchema(): string {
    const name = `test_migrator_${crypto.randomUUID().replaceAll('-', '')}`;
    created.push(name);
    return name;
  }

  /** The tables a schema holds. */
  async function tablesOf(schema: string): Promise<string[]> {
    const rows = await client.unsafe<{ table_name: string }[]>(
      'SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name',
      [schema],
    );
    return rows.map((row) => row.table_name);
  }

  beforeAll(() => {
    client = new SQL(url as string);
  });

  afterEach(async () => {
    for (const name of created.splice(0)) await client.unsafe(`DROP SCHEMA IF EXISTS "${name}" CASCADE`);
  });

  afterAll(async () => {
    await client.close();
  });

  it('builds every table in the project\'s schema, with its log beside them', async () => {
    const schema = freshSchema();
    await migrateProjectSchema(client, schema);
    expect(await tablesOf(schema)).toEqual(
      [...Object.keys(WIRE_TABLES), 'hub_devices', 'hub_index_serving', 'hub_store_meta', MIGRATIONS_TABLE].sort(),
    );
  });

  it('builds two projects apart, and resets search_path on the pooled connection', async () => {
    const first = freshSchema();
    const second = freshSchema();
    await migrateProjectSchema(client, first);
    await migrateProjectSchema(client, second);
    expect(await tablesOf(second)).toEqual(await tablesOf(first));
    const [path] = await client.unsafe<{ search_path: string }[]>('SHOW search_path');
    expect(path?.search_path).not.toContain('test_migrator_');
  });

  it('applies each migration once, however often it runs', async () => {
    const schema = freshSchema();
    await migrateProjectSchema(client, schema);
    await migrateProjectSchema(client, schema);
    const rows = await client.unsafe<{ hash: string }[]>(`SELECT hash FROM "${schema}"."${MIGRATIONS_TABLE}"`);
    expect(rows.map((row) => row.hash)).toEqual(SHIPPED_MIGRATION_HASHES.map(({ hash }) => hash));
  });

  it('refuses a schema whose log holds another hash, naming the tag and both hashes', async () => {
    const schema = freshSchema();
    await migrateProjectSchema(client, schema);
    await client.unsafe(`UPDATE "${schema}"."${MIGRATIONS_TABLE}" SET hash = 'edited'`);
    const [first] = SHIPPED_MIGRATION_HASHES;
    await expect(migrateProjectSchema(client, schema)).rejects.toThrow(
      `${first?.tag} was applied as edited, the shipped file hashes ${first?.hash}`,
    );
  });
});
