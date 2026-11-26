/**
 * The gate the `postgres` connector's contract cases run behind:
 * `POSTGRES_URL`, the one way a test reaches a database.
 *
 * Closed, the variable unset or empty, {@link describePostgresGate}
 * registers one skipped case whose title names the gate, so a run that
 * held nothing to Postgres says so. Open, it registers the gate case,
 * which connects and fails when the connection is refused, so a database
 * that has gone away never reads as a pass.
 *
 * Every store opened here takes a schema prefix no other case or run
 * holds, and its `close()` drops the schemas that prefix made, with the
 * index build each one serves, and no other.
 */
import type { HubStoreContext, HubStoreFactory } from '../port.js';

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { connectPostgresHub } from '@open-tomato/rafa-hub-postgres';
import { SQL } from 'bun';
import { describe, expect, it } from 'bun:test';

/** The variable that opens the gate. */
export const POSTGRES_GATE = 'POSTGRES_URL';

/** The title of the skipped case a closed gate leaves. */
export const POSTGRES_SKIP_LINE: string = `skipped: ${POSTGRES_GATE} is unset or empty; set it to a Postgres with pg_search and pgvector to run the postgres cases`;

/** The title of the case an open gate runs. */
export const POSTGRES_GATE_CASE: string = `connects to the database ${POSTGRES_GATE} names`;

/** The `describe` the gate's case is registered under. */
export const POSTGRES_GATE_SUITE = 'the postgres gate';

/** The gate as one environment reads it: open with the URL, or closed. */
export type PostgresGate =
  | { readonly open: true; readonly url: string }
  | { readonly open: false };

/** Reads the gate off `env`; white space alone counts as empty, as the connector reads it. */
export function postgresGate(env: Readonly<Record<string, string | undefined>>): PostgresGate {
  const url = env[POSTGRES_GATE];
  return url === undefined || url.trim() === ''
    ? { open: false }
    : { open: true, url };
}

/** The index build the project schema `name` serves, `null` for none or a schema with no pointer. */
async function servingBuildOf(admin: SQL, name: string): Promise<string | null> {
  const [pointer] = await admin.unsafe<{ found: string | null }[]>('SELECT to_regclass($1)::text AS found', [`"${name}".hub_index_serving`]);
  if (!pointer?.found) return null;
  const [serving] = await admin.unsafe<{ build_schema: string }[]>(`SELECT build_schema FROM "${name}".hub_index_serving`);
  return serving?.build_schema ?? null;
}

/**
 * Drops every schema named `<prefix>_…`, the ones a store under `prefix`
 * made, and first the build each serves, which is named `index_…` and so
 * is found only through its project schema's pointer.
 */
export async function dropSchemas(url: string, prefix: string): Promise<void> {
  const admin = new SQL(url);
  try {
    const made = await admin.unsafe<{ schema_name: string }[]>(
      'SELECT schema_name FROM information_schema.schemata WHERE starts_with(schema_name, $1)',
      [`${prefix}_`],
    );
    for (const { schema_name: name } of made) {
      const build = await servingBuildOf(admin, name);
      if (build !== null) await admin.unsafe(`DROP SCHEMA IF EXISTS "${build}" CASCADE`);
      await admin.unsafe(`DROP SCHEMA "${name}" CASCADE`);
    }
  } finally {
    await admin.close();
  }
}

/** The row suite's factory over the database at `url`: each store in schemas of its own. */
export function isolatedPostgresStore(url: string): HubStoreFactory {
  return async (context: HubStoreContext) => {
    // 17 bytes, which leaves room for `_` and a 40-character project id in 63.
    const schemaPrefix = `test_hct_${crypto
      .randomUUID()
      .replaceAll('-', '')
      .slice(0, 8)}`;
    try {
      const { store } = await connectPostgresHub(context, {
        urlVariable: POSTGRES_GATE,
        env: { [POSTGRES_GATE]: url },
        schemaPrefix,
      });
      return {
        ...store,
        close: async () => {
          try {
            await store.close();
          } finally {
            await dropSchemas(url, schemaPrefix);
          }
        },
      };
    } catch (error) {
      // The drop of a database that refused the open fails too; the open's refusal is the one to report.
      await dropSchemas(url, schemaPrefix).catch(() => undefined);
      throw error;
    }
  };
}

/**
 * What a refused open is reported as: the error's code alone when it has
 * one, since `Bun.sql` can repeat a value it cannot parse, password and all.
 */
function refusalOf(error: unknown): string {
  const { code } = error as { readonly code?: unknown };
  if (typeof code === 'string') return code;
  return error instanceof Error
    ? error.message
    : String(error);
}

/** Opens one store on `url` and closes it, answering `connected` or why it could not. */
async function tryConnect(url: string): Promise<string> {
  const directory = mkdtempSync(join(tmpdir(), 'rafa-hub-postgres-gate-'));
  try {
    const store = await isolatedPostgresStore(url)({ directory, now: () => new Date() });
    await store.close();
    return 'connected';
  } catch (error) {
    return `${POSTGRES_GATE} is set and the connection failed: ${refusalOf(error)}`;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** Registers the skip line of a closed gate, or the gate case of an open one. */
export function describePostgresGate(gate: PostgresGate): void {
  describe(POSTGRES_GATE_SUITE, () => {
    if (!gate.open) {
      it.skip(POSTGRES_SKIP_LINE, () => undefined);
      return;
    }
    it(POSTGRES_GATE_CASE, async () => {
      expect(await tryConnect(gate.url)).toBe('connected');
    });
  });
}
