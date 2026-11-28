/**
 * The connector `HUB_CONNECTORS` names `postgres`: it opens the store on
 * the URL the named environment variable holds, beside an index that is
 * built at open when none serves the first project, rebuilds, searches
 * its serving build by full text alone with no embedder given, walks its
 * links, and answers the capabilities it measured at open (`index-capabilities.test.ts` holds each one's two
 * answers). Without a database, the cases hold the refusals
 * made before anything connects; where `POSTGRES_URL` is set, each live
 * case opens both halves under a schema prefix of its own and drops only
 * the schema that prefix made and the build it serves.
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
  /** Runs `work` under a fresh schema prefix, dropping after it the project schema and the build that schema serves. */
  async function underPrefix(work: (prefix: string, servingBuild: () => Promise<string | undefined>) => Promise<void>): Promise<void> {
    const prefix = `test_connector_${crypto
      .randomUUID()
      .replaceAll('-', '')
      .slice(0, 6)}`;
    const schema = projectSchemaName(prefix, DEFAULT_PROJECT_ID);
    const admin = new SQL(url);
    const servingBuild = async (): Promise<string | undefined> => {
      const [pointer] = await admin.unsafe<{ build_schema: string }[]>(`SELECT build_schema FROM "${schema}".hub_index_serving`);
      return pointer?.build_schema;
    };
    try {
      await work(prefix, servingBuild);
    } finally {
      // A case that failed before the schema was made has no pointer to read.
      const build = await servingBuild().catch(() => undefined);
      if (build !== undefined) await admin.unsafe(`DROP SCHEMA IF EXISTS "${build}" CASCADE`);
      await admin.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.close();
    }
  }

  const open = (schemaPrefix: string): ReturnType<typeof connectPostgresHub> => connectPostgresHub(CONTEXT, { urlVariable: 'POSTGRES_URL', schemaPrefix });

  it('builds the index at open when none serves the project, so a search and a walk answer before any rebuild', async () => {
    await underPrefix(async (prefix, servingBuild) => {
      const { store, index } = await open(prefix);

      expect(await servingBuild()).toStartWith('index_default_');
      expect((await index.search({ mode: 'fts', query: 'x' })).hits).toEqual([]);
      expect(await index.links({ kind: 'commit', id: 'x' })).toEqual({ graph: false, links: [] });

      await store.close();
    });
  });

  it('leaves the serving build as it is when the connector opens again', async () => {
    await underPrefix(async (prefix, servingBuild) => {
      const first = await open(prefix);
      const built = await servingBuild();
      await first.store.close();

      const second = await open(prefix);

      expect(built).toBeDefined();
      expect(await servingBuild()).toBe(built);
      await second.store.close();
    });
  });

  it('opens a store and an index that rebuilds, searches and walks under fts alone, both refusing a request once the store is closed', async () => {
    await underPrefix(async (prefix, servingBuild) => {
      const { store, index } = await open(prefix);
      const opened = await servingBuild();

      expect((await store.status()).devices).toEqual([]);
      expect(index.capabilities()).toEqual({ fts: true, vector: false, graph: false });
      expect(store.contract().capabilities).toEqual({ fts: true, vector: false, graph: false, projection: false });
      const rebuilt = await index.rebuild({ project: DEFAULT_PROJECT_ID });
      expect([rebuilt.project, rebuilt.rows, rebuilt.vector, rebuilt.why]).toEqual([DEFAULT_PROJECT_ID, 0, false, 'no embedder configured']);
      expect(await servingBuild()).not.toBe(opened);
      expect((await index.search({ mode: 'fts', query: 'x' })).hits).toEqual([]);
      await expect(index.search({ mode: 'hybrid', query: 'x' })).rejects.toThrow('(no embedder configured); search with mode \'fts\'');

      await store.close();

      await expect(store.status()).rejects.toThrow('closed');
      await expect(index.search({ mode: 'fts', query: 'x' })).rejects.toThrow('closed');
      await expect(index.rebuild({ project: DEFAULT_PROJECT_ID })).rejects.toThrow('closed');
      await expect(index.links({ kind: 'commit', id: 'x' })).rejects.toThrow('closed');
    });
  });
});
