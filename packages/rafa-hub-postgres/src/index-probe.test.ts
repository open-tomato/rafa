/**
 * The connector's index probe. Without a database, a schema that is no
 * name the connector quotes is refused before any query. Where
 * `POSTGRES_URL` is set, each case opens the connector under a schema
 * prefix no other case or run holds and reads the two identities through
 * {@link postgresIndexProbe}: the store's held across a rebuild and a
 * search, the index's new after each rebuild, and `none` once no build
 * serves.
 * Each reading that must stay is paired with a control that moves it: a
 * push, and an index put on a row table, change the store's identity. It
 * drops only the project schemas that prefix made and the build schemas
 * their opens and rebuilds named.
 */
import type { WirePayload } from '@open-tomato/rafa/store';
import type { HubIndex, HubStore, HubStoreContext } from '@open-tomato/rafa-hub-port';

import { WIRE_FORMAT, WIRE_VERSION } from '@open-tomato/rafa/store';
import { SQL } from 'bun';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test';

import { connectPostgresHub } from './hub-connector.js';
import { DEFAULT_PROJECT_ID, projectSchemaName } from './hub-projects.js';
import { NO_SERVING_BUILD, postgresIndexProbe, rowTablesChecksum, servingBuildIdentity } from './index-probe.js';
import { DRIZZLE_WIRE_MIGRATIONS } from './wire-migrations.js';

const A = 'aaaaaaaa-0000-4000-8000-00000000000a';

const T0 = '2026-11-26T10:00:00.000Z';

/** The context every case opens over; the probe reads the schema from the prefix the case keeps. */
const CONTEXT: HubStoreContext = { directory: '/nonexistent', now: () => new Date(T0) };

/** A payload of one commit, the `originSeq`th of `A`. */
function payloadOf(originSeq: number): WirePayload {
  return {
    format: WIRE_FORMAT,
    version: WIRE_VERSION,
    migrations: DRIZZLE_WIRE_MIGRATIONS.flatMap(({ wire }) => wire),
    tables: { commits: [{ seq: 1, sha: `sha-${String(originSeq)}`, row_json: JSON.stringify({ subject: 'parser rewrite' }), origin_store: A, origin_seq: originSeq }] },
    cursor: {},
  };
}

describe('the probe\'s readings, before they query', () => {
  /** A client that refuses every query, so a refusal before one is the reading's own. */
  const refusing = { unsafe: () => Promise.reject(new Error('the stand-in runs no query')) } as unknown as SQL;

  it('refuses a schema that is no schema name, naming it, before any query', async () => {
    await expect(rowTablesChecksum(refusing, 'p"; DROP SCHEMA x; --')).rejects.toThrow('is no schema name');
    await expect(servingBuildIdentity(refusing, 'Upper')).rejects.toThrow('"Upper" is no schema name');
  });

  it('reaches the client for a schema name it takes', async () => {
    await expect(rowTablesChecksum(refusing, 'p_default')).rejects.toThrow('the stand-in runs no query');
  });
});

const url = process.env['POSTGRES_URL']?.trim() ?? '';

describe.skipIf(url === '')('postgresIndexProbe, live on POSTGRES_URL', () => {
  let admin: SQL;
  let schema = '';
  let hub: { readonly store: HubStore; readonly index: HubIndex } | undefined;
  const builds: string[] = [];
  const probe = postgresIndexProbe({ url, schemaOf: () => schema });

  /** Opens the connector under a fresh prefix; the probe reads its project's schema. */
  async function open(): Promise<{ readonly store: HubStore; readonly index: HubIndex }> {
    const prefix = `test_idxprobe_${crypto
      .randomUUID()
      .replaceAll('-', '')
      .slice(0, 8)}`;
    schema = projectSchemaName(prefix, DEFAULT_PROJECT_ID);
    hub = await connectPostgresHub(CONTEXT, { urlVariable: 'POSTGRES_URL', env: { POSTGRES_URL: url }, schemaPrefix: prefix });
    await recordBuild();
    return hub;
  }

  /** Records the build the pointer names for the drop. */
  async function recordBuild(): Promise<void> {
    const [pointer] = await admin.unsafe<{ build_schema: string }[]>(`SELECT build_schema FROM "${schema}".hub_index_serving`);
    if (pointer !== undefined) builds.push(pointer.build_schema);
  }

  /** Rebuilds the project, recording the build it swapped in for the drop. */
  async function rebuild(index: HubIndex): Promise<void> {
    await index.rebuild({ project: DEFAULT_PROJECT_ID });
    await recordBuild();
  }

  beforeAll(() => {
    admin = new SQL(url);
  });

  afterEach(async () => {
    await hub?.store.close();
    hub = undefined;
    for (const name of [...builds.splice(0), schema]) await admin.unsafe(`DROP SCHEMA IF EXISTS "${name}" CASCADE`);
  });

  afterAll(async () => {
    await admin.close();
  });

  describe('the store identity', () => {
    it('is held across a rebuild, its swap and a search', async () => {
      const { index, store } = await open();
      await store.push({ device: A, payload: payloadOf(1) });
      const before = await probe.storeIdentity(CONTEXT);

      await rebuild(index);
      await rebuild(index);
      await index.search({ mode: 'fts', query: 'parser' });

      expect(await probe.storeIdentity(CONTEXT)).toBe(before);
    });

    it('changes with a row pushed, the control that a write is seen', async () => {
      const { store } = await open();
      const before = await probe.storeIdentity(CONTEXT);

      await store.push({ device: A, payload: payloadOf(1) });

      expect(await probe.storeIdentity(CONTEXT)).not.toBe(before);
    });

    it('changes with an index put on a row table, the control that an index on the rows is seen', async () => {
      await open();
      const before = await probe.storeIdentity(CONTEXT);

      await admin.unsafe(`CREATE INDEX probe_control ON "${schema}".commits (sha)`);

      expect(await probe.storeIdentity(CONTEXT)).not.toBe(before);
    });
  });

  describe('the index identity', () => {
    it('answers none for a project no build serves', async () => {
      await open();
      await admin.unsafe(`DELETE FROM "${schema}".hub_index_serving`);

      expect(await probe.indexIdentity(CONTEXT)).toBe(NO_SERVING_BUILD);
    });

    it('names the serving build, each of its tables with its relfilenode and the BM25 index on the copy', async () => {
      const { index, store } = await open();
      await store.push({ device: A, payload: payloadOf(1) });
      await rebuild(index);

      const lines = (await probe.indexIdentity(CONTEXT)).split('\n');

      expect(lines[0]).toBe(builds.at(-1));
      expect(lines.find((line) => line.startsWith('commits@'))).toMatch(/^commits@\d+\[commits_bm25=\d+\]$/);
      expect(lines.find((line) => line.startsWith('index_meta@'))).toMatch(/^index_meta@\d+\[index_meta_pkey=\d+\]$/);
    });

    it('is held across a search and reads, and new after each rebuild', async () => {
      const { index, store } = await open();
      await store.push({ device: A, payload: payloadOf(1) });
      await rebuild(index);
      const first = await probe.indexIdentity(CONTEXT);
      await index.search({ mode: 'fts', query: 'parser' });
      const searched = await probe.indexIdentity(CONTEXT);

      await rebuild(index);
      const second = await probe.indexIdentity(CONTEXT);

      expect(searched).toBe(first);
      expect(second).not.toBe(first);
      expect(second.split('\n')[0]).toBe(builds.at(-1));
    });
  });
});
