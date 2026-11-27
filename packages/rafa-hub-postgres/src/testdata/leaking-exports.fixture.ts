/**
 * The planted faults of `../public-types.test.ts`: an entry whose exports
 * break the leak rule, one way each, beside two clean controls. Nothing
 * imports it; the test reads its types.
 */
import type { HubDatabase } from '../hub-tables.js';
import type { HubStore } from '@open-tomato/rafa-hub-port';
import type { SQL as Fragment } from 'drizzle-orm';

import { SQL } from 'bun';

export { eq } from 'drizzle-orm';

/** A Drizzle SQL fragment, named under another name. */
export type LeakedFragment = Fragment<number>;

/** A Drizzle database, named through a type of the connector's own. */
export type LeakedDatabase = HubDatabase;

/** A `Bun.sql` transaction handle, two types of this file down. */
export interface LeakedNestedOptions {
  readonly hooks: Hooks;
}

interface Hooks {
  readonly onBegin: (tx: Bun.TransactionSQL) => void;
}

/** One of `bun-types`' deprecated aliases of a `Bun.sql` type. */
export type LeakedDeprecatedQuery = Bun.SQLQuery<number>;

/** A `Bun.sql` client as a parameter. */
export function leakedClient(client: SQL): string {
  return typeof client;
}

/** The global `Bun.sql` client, named through `typeof`. */
export function leakedGlobalClient(client: typeof Bun.sql): string {
  return typeof client;
}

/** A Drizzle database named inline, as an `import()` type. */
export function leakedImported(): import('drizzle-orm/bun-sql').BunSQLDatabase | null {
  return null;
}

/** A control: the port's store is plain. */
export type CleanStore = HubStore;

/** A control: the body uses `Bun.sql`, the signature does not. */
export async function cleanText(url: string): Promise<string> {
  const client: SQL = new SQL(url);
  await client.close();
  return url;
}
