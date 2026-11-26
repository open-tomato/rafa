/**
 * Holds the connector's schema to the wire it mirrors, read off a real
 * device store rather than a list written here.
 *
 * A store is opened through `@open-tomato/rafa/store` under the
 * temporary directory, so it is brought through every migration this
 * checkout ships, and one row is planted in each table its empty export
 * answers, every column given a value of its declared type with the
 * store's CHECK constraints off, since a planted row only has to carry
 * its columns. `exportWirePayload` then answers every wire table with a
 * row, and so with every column it carries: a table answered with no row
 * would name no column and pass whatever the schema held, so the case
 * first holds that every table came with one.
 *
 * The checks: each wire table is a table of {@link WIRE_TABLES} and each
 * of its row's columns a column of that table, keyed by the column's own
 * name, and the schema holds no table or column the wire does not carry;
 * each column's type and NOT NULL read across from the device's declared
 * ones; and the wire ids {@link DRIZZLE_WIRE_MIGRATIONS} covers are the
 * store's migration log, in order. The near-miss cases run the same
 * checker over a schema missing one column and a payload carrying one
 * more, so a checker that found nothing could not pass them.
 */
import type { WireTable } from './schema.js';
import type { WirePayload } from '@open-tomato/rafa/store';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { exportWirePayload, openSqliteStore } from '@open-tomato/rafa/store';
import { Database } from 'bun:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { getTableConfig, pgTable, text } from 'drizzle-orm/pg-core';

import { hubStoreMeta, WIRE_TABLES } from './schema.js';
import { DRIZZLE_WIRE_MIGRATIONS } from './wire-migrations.js';

/** One column as `PRAGMA table_info` answers it. */
interface DeviceColumn {
  readonly name: string;
  readonly type: string;
  readonly notnull: number;
}

/** The Drizzle column type each device SQLite type reads across as. */
const COLUMN_TYPE: Readonly<Record<string, string>> = {
  TEXT: 'PgText',
  INTEGER: 'PgBigInt53',
  REAL: 'PgDoublePrecision',
};

/** A value of the device's declared `type`, as a planted row holds it. */
function plantedValue(type: string, seq: number): string | number {
  if (type === 'INTEGER') return seq;
  if (type === 'REAL') return seq + 0.5;
  return `planted-${String(seq)}`;
}

/** The columns of `table` in the store `db` holds, in declared order. */
function deviceColumns(db: Database, table: string): readonly DeviceColumn[] {
  return db.query<DeviceColumn, []>(`PRAGMA table_info("${table}")`).all();
}

/** Plants one row in each of `tables` that holds none, every column filled. */
function plantRows(path: string, tables: readonly string[]): void {
  const db = new Database(path, { readwrite: true });
  try {
    db.run('PRAGMA ignore_check_constraints = ON');
    for (const table of tables) {
      const held = db.query<{ count: number }, []>(`SELECT COUNT(*) AS count FROM "${table}"`).get();
      if ((held?.count ?? 0) > 0) continue;
      const columns = deviceColumns(db, table);
      const names = columns.map(({ name }) => `"${name}"`).join(', ');
      const marks = columns.map(() => '?').join(', ');
      db.query<unknown, (string | number)[]>(`INSERT INTO "${table}" (${names}) VALUES (${marks})`)
        .run(...columns.map(({ type }) => plantedValue(type, 1)));
    }
  } finally {
    db.close();
  }
}

/** Each column name of `table`, as the schema names it. */
function schemaColumns(table: WireTable): readonly string[] {
  return getTableConfig(table).columns.map(({ name }) => name);
}

/**
 * Each fault between the payload's tables and columns and `tables`: a
 * wire table or column with no schema one, a schema one the wire does
 * not carry, and a column keyed by a name other than its own.
 */
function schemaFaults(payload: WirePayload, tables: Readonly<Record<string, WireTable>>): readonly string[] {
  const faults: string[] = [];
  for (const [name, rows] of Object.entries(payload.tables)) {
    const table = tables[name];
    if (table === undefined) {
      faults.push(`${name}: wire table with no schema table`);
      continue;
    }
    const wire = new Set(rows.flatMap((row) => Object.keys(row)));
    const schema = schemaColumns(table);
    for (const column of wire) if (!schema.includes(column)) faults.push(`${name}.${column}: wire column with no schema column`);
    for (const column of schema) if (!wire.has(column)) faults.push(`${name}.${column}: schema column the wire does not carry`);
    for (const column of getTableConfig(table).columns) {
      if (table[column.name] !== column) faults.push(`${name}.${column.name}: keyed by another name`);
    }
  }
  for (const name of Object.keys(tables)) {
    if (!(name in payload.tables)) faults.push(`${name}: schema table the wire does not carry`);
  }
  return faults;
}

/** The store's root, its file, the export with a row in every table, and each table's device columns. */
let root = '';
let payload: WirePayload;
let device: Readonly<Record<string, readonly DeviceColumn[]>> = {};

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-hub-postgres-schema-')));
  const store = openSqliteStore(root);
  store.append('commits', [{ sha: 'f'.repeat(40), timestamp: '2026-11-26T10:00:00.000Z' } as never]);
  const path = store.path('commits');
  plantRows(path, Object.keys(exportWirePayload({ path }).tables));
  payload = exportWirePayload({ path });
  const db = new Database(path, { readonly: true });
  try {
    device = Object.fromEntries(Object.keys(payload.tables).map((table) => [table, deviceColumns(db, table)]));
  } finally {
    db.close();
  }
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('the wire the export answers', () => {
  it('answers every table with a row, so every column is read', () => {
    const empty = Object.entries(payload.tables)
      .filter(([, rows]) => rows.length === 0)
      .map(([table]) => table);
    expect(Object.keys(payload.tables).length).toBeGreaterThan(0);
    expect(empty).toEqual([]);
  });
});

describe('the row tables', () => {
  it('hold every wire table and column, keyed by its name, and nothing else', () => {
    expect(schemaFaults(payload, WIRE_TABLES)).toEqual([]);
  });

  it('read each column\'s type across from the device\'s declared type', () => {
    const faults = Object.entries(device).flatMap(([name, columns]) => columns.flatMap((column) => {
      const schema = getTableConfig(WIRE_TABLES[name] as WireTable).columns.find((held) => held.name === column.name);
      const expected = COLUMN_TYPE[column.type];
      return schema?.columnType === expected
        ? []
        : [`${name}.${column.name}: ${column.type} as ${String(schema?.columnType)}`];
    }));
    expect(faults).toEqual([]);
  });

  it('hold a column NOT NULL exactly where the device does, `seq` the primary key', () => {
    const faults = Object.entries(device).flatMap(([name, columns]) => columns.flatMap((column) => {
      const schema = getTableConfig(WIRE_TABLES[name] as WireTable).columns.find((held) => held.name === column.name);
      const notNull = column.name === 'seq' || column.notnull === 1;
      return schema?.notNull === notNull
        ? []
        : [`${name}.${column.name}: notNull ${String(schema?.notNull)}, device ${String(notNull)}`];
    }));
    expect(faults).toEqual([]);
    const primary = Object.entries(WIRE_TABLES).flatMap(([name, table]) => getTableConfig(table).columns
      .filter((column) => column.primary)
      .map((column) => `${name}.${column.name}`));
    expect(primary).toEqual(Object.keys(WIRE_TABLES).map((name) => `${name}.seq`));
  });

  it('keep the origin pair unique, where `origin_store` is set', () => {
    const faults = Object.entries(WIRE_TABLES).flatMap(([name, table]) => {
      const index = getTableConfig(table).indexes.find((held) => held.config.name === `${name}_by_origin`);
      const columns = index?.config.columns.map((column) => ('name' in column
        ? column.name
        : '?'));
      return index?.config.unique === true && index.config.where !== undefined && columns?.join(',') === 'origin_store,origin_seq'
        ? []
        : [`${name}: no unique ${name}_by_origin over the origin pair`];
    });
    expect(faults).toEqual([]);
  });

  it('name no Postgres schema, so a project\'s search_path places them', () => {
    const schemas = [...Object.values(WIRE_TABLES), hubStoreMeta].map((table) => getTableConfig(table).schema);
    expect(schemas.filter((schema) => schema !== undefined)).toEqual([]);
  });
});

describe('the checker the row tables are held by', () => {
  it('names a wire column a schema table lacks', () => {
    const lacking = pgTable('sessions', {
      seq: text('seq'),
      session_id: text('session_id'),
      row_json: text('row_json'),
      origin_store: text('origin_store'),
      origin_seq: text('origin_seq'),
    }) as unknown as WireTable;
    expect(schemaFaults(payload, { ...WIRE_TABLES, sessions: lacking })).toEqual(['sessions.worktree: wire column with no schema column']);
  });

  it('names a column the wire carries that no schema table holds, and a table it lacks', () => {
    const [first, ...rest] = payload.tables['commits'] ?? [];
    const grown: WirePayload = {
      ...payload,
      tables: { ...payload.tables, commits: [{ ...first, grown: 'x' }, ...rest], ref_links: [{ seq: 1 }] },
    };
    expect(schemaFaults(grown, WIRE_TABLES)).toEqual([
      'commits.grown: wire column with no schema column',
      'ref_links: wire table with no schema table',
    ]);
  });
});

describe('the store metadata', () => {
  it('is no wire table, and holds the project, the contract and the four fields of the embedding record', () => {
    expect(Object.keys(WIRE_TABLES)).not.toContain(getTableConfig(hubStoreMeta).name);
    expect(getTableConfig(hubStoreMeta).columns.map(({ name }) => name)).toEqual([
      'id',
      'project_id',
      'contract_version',
      'created_at',
      'embedding_model',
      'embedding_hash',
      'embedding_dimension',
      'embedding_precision',
    ]);
  });
});

describe('the Drizzle migrations\' wire ids', () => {
  it('cover the device store\'s migration log, in order', () => {
    expect(DRIZZLE_WIRE_MIGRATIONS.flatMap(({ wire }) => wire)).toEqual([...payload.migrations]);
  });

  it('name each Drizzle migration once, under a journal tag', () => {
    const tags = DRIZZLE_WIRE_MIGRATIONS.map(({ tag }) => tag);
    expect(new Set(tags).size).toBe(tags.length);
    expect(tags.filter((tag) => !/^\d{4}_\w+$/.test(tag))).toEqual([]);
  });
});
