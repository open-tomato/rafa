/**
 * What the connector's push, pull and status share: the Drizzle database
 * over the `Bun.sql` client, a transaction run with `search_path` set to
 * one project's schema, and the row tables read by their wire names.
 *
 * The tables name no schema (`schema.ts`), so every query of a project
 * runs inside {@link inProjectSchema}: `SET LOCAL search_path` lasts as
 * long as the transaction, and the pooled connection goes back with the
 * path it came with. Nothing here is exported from the package's entry.
 */
import type { WireTable } from './schema.js';
import type { WireRow, WireValue } from '@open-tomato/rafa/store';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql';
import type { PgColumn, PgTransactionConfig } from 'drizzle-orm/pg-core';

import { sql } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';

import { SCHEMA_NAME } from './migrator.js';

/** The connector's Drizzle database. */
export type HubDatabase = BunSQLDatabase;

/** A transaction of {@link HubDatabase}, with `search_path` set to one project's schema. */
export type HubTransaction = Parameters<Parameters<HubDatabase['transaction']>[0]>[0];

/** Runs `work` in one transaction of `db` with `search_path` set to `schema`. */
export function inProjectSchema<T>(
  db: HubDatabase,
  schema: string,
  work: (tx: HubTransaction) => Promise<T>,
  config?: PgTransactionConfig,
): Promise<T> {
  if (!SCHEMA_NAME.test(schema)) throw new TypeError(`hub postgres: "${schema}" is no schema name`);
  return db.transaction(async (tx) => {
    await tx.execute(sql.raw(`SET LOCAL search_path TO "${schema}"`));
    return work(tx);
  }, config);
}

/** The column `name` of `table`, refusing a name the table does not hold. */
export function columnOf(table: WireTable, name: string): PgColumn {
  const column = table[name];
  if (column === undefined) throw new Error(`hub postgres: ${getTableConfig(table).name} holds no column ${name}`);
  return column;
}

/** The names of `table`'s columns, `seq` first, as the wire carries them. */
export function columnNames(table: WireTable): readonly string[] {
  return getTableConfig(table).columns.map(({ name }) => name);
}

/** A value read back from a row table, refused when it is none the wire carries. */
function wireValue(table: string, column: string, value: unknown): WireValue {
  if (value === null || typeof value === 'string' || typeof value === 'number') return value;
  throw new TypeError(`hub postgres: ${table}.${column} read back a ${typeof value}, which the wire does not carry`);
}

/** A row read back from `table`, as the wire carries it: every column by name, frozen. */
export function wireRowOf(table: string, row: Readonly<Record<string, unknown>>): WireRow {
  return Object.freeze(Object.fromEntries(Object.entries(row).map(([column, value]) => [column, wireValue(table, column, value)])));
}
