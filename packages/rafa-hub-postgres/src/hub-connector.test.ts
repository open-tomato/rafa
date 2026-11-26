/**
 * The connector `HUB_CONNECTORS` names `postgres`: it opens the store on
 * the URL the named environment variable holds, beside an index that
 * rebuilds, searches its serving build by full text alone, answers every
 * capability `false` and refuses a walk until it lands. Without a database, the cases hold the refusals
 * made before anything connects; where `POSTGRES_URL` is set, the live
 * case opens both halves under a schema prefix of its own and drops only
 * the schema that prefix made and the build its rebuild swapped in.
 */
import type { HubStoreContext } from '@open-tomato/rafa-hub-port';

import { SQL } from 'bun';
import { describe, expect, it } from 'bun:test';

import { connectPostgresHub } from './hub-connector.js';
import { DEFAULT_PROJECT_ID, projectSchemaName } from './hub-projects.js';

const CONTEXT: HubStoreContext = { directory: '/nonexistent', now: () => new Date('2026-11-26T10:00:00.000Z') };

describe('connectPostgresHub, before it connects', () => {
  it('refuses an unset URL variable, naming it', async () => {
    const opened = connectPostgresHub(CONTEXT, { urlVariable: 'HUB_DB_URL', env: {} });

    await expect(opened).rejects.toThrow('the environment variable HUB_DB_URL is unset');
  });

  it('refuses an empty URL variable, naming it', async () => {
    const opened = connectPostgresHub(CONTEXT, { urlVariable: 'HUB_DB_URL', env: { HUB_DB_URL: '  ' } });

    await expect(opened).rejects.toThrow('the environment variable HUB_DB_URL is empty');
  });
});

const url = process.env['POSTGRES_URL']?.trim() ?? '';

describe.skipIf(url === '')('connectPostgresHub, live on POSTGRES_URL', () => {
  it('opens a store and an index that rebuilds and searches with no capability, both refusing a request once the store is closed', async () => {
    const schemaPrefix = `test_connector_${crypto
      .randomUUID()
      .replaceAll('-', '')
      .slice(0, 6)}`;
    const schema = projectSchemaName(schemaPrefix, DEFAULT_PROJECT_ID);
    const admin = new SQL(url);
    let build: string | undefined;
    try {
      const { store, index } = await connectPostgresHub(CONTEXT, { urlVariable: 'POSTGRES_URL', schemaPrefix });

      expect((await store.status()).devices).toEqual([]);
      expect(index.capabilities()).toEqual({ fts: false, vector: false, graph: false });
      await expect(index.search({ mode: 'fts', query: 'x' })).rejects.toThrow('has no index built yet; rebuild the index');
      await expect(index.links({ kind: 'commit', id: 'x' })).rejects.toThrow('serves no links yet');
      const rebuilt = await index.rebuild({ project: DEFAULT_PROJECT_ID });
      expect((await index.search({ mode: 'fts', query: 'x' })).hits).toEqual([]);
      await expect(index.search({ mode: 'hybrid', query: 'x' })).rejects.toThrow('(no embedder configured); search with mode \'fts\'');
      const [pointer] = await admin.unsafe<{ build_schema: string }[]>(`SELECT build_schema FROM "${schema}".hub_index_serving`);
      build = pointer?.build_schema;
      expect([rebuilt.project, rebuilt.rows, rebuilt.vector, rebuilt.why]).toEqual([DEFAULT_PROJECT_ID, 0, false, 'no embedder configured']);
      expect(build).toStartWith('index_default_');

      await store.close();

      await expect(store.status()).rejects.toThrow('closed');
      await expect(index.search({ mode: 'fts', query: 'x' })).rejects.toThrow('closed');
      await expect(index.rebuild({ project: DEFAULT_PROJECT_ID })).rejects.toThrow('closed');
      await expect(index.links({ kind: 'commit', id: 'x' })).rejects.toThrow('closed');
    } finally {
      await admin.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      if (build !== undefined) await admin.unsafe(`DROP SCHEMA IF EXISTS "${build}" CASCADE`);
      await admin.close();
    }
  });
});
