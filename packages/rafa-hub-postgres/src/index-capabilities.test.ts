/**
 * The connector's capabilities, measured at open. Without a database,
 * {@link measureCapabilities} is held to each capability's two answers
 * from the readings the open hands it (`projection` has one, `false`),
 * `vector` also to what holds the embedder's vectors back.
 * Where `POSTGRES_URL` is set, each case opens the connector under a
 * schema prefix no other case or run holds and reads its answers: `graph`
 * before and after a `ref_links` table is planted in the project's
 * schema, `vector` with and without an embedder, and the store's
 * `contract()` answering the index's three beside `projection`. It drops
 * only the project schemas that prefix made and the build schemas its
 * rebuilds named.
 */
import type { EmbeddingRecord } from './embedding-record.js';
import type { WirePayload } from '@open-tomato/rafa/store';
import type { HubIndex, HubStore } from '@open-tomato/rafa-hub-port';
import type { IndexEmbedder } from '@open-tomato/rafa-index';

import { WIRE_FORMAT, WIRE_VERSION } from '@open-tomato/rafa/store';
import { NO_EMBEDDER } from '@open-tomato/rafa-index';
import { SQL } from 'bun';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test';

import { connectPostgresHub } from './hub-connector.js';
import { DEFAULT_PROJECT_ID, projectSchemaName } from './hub-projects.js';
import { LINKS_TABLE } from './index-build.js';
import { holdsRefLinksTable, measureCapabilities, NO_PGVECTOR } from './index-capabilities.js';
import { DRIZZLE_WIRE_MIGRATIONS } from './wire-migrations.js';

const A = 'aaaaaaaa-0000-4000-8000-00000000000a';

const T0 = '2026-11-26T10:00:00.000Z';

/** Both extensions the connection asks for, as `pg_extension` names them. */
const BOTH = ['pg_search', 'vector'];

/** An embedder of two numbers per text: 1 plus 4 per `parser`, then 1. */
const EMBEDDER: IndexEmbedder = {
  dimension: 2,
  embed: async (texts) => texts.map((text) => new Float32Array([1 + (4 * text.split(/[^a-z]+/).filter((word) => word === 'parser').length), 1])),
};

/** The embedding record {@link EMBEDDER}'s vectors are made under. */
const RECORD: EmbeddingRecord = { model: 'fixture-parser', hash: 'fixture', dimension: 2, precision: 'half' };

describe('measureCapabilities', () => {
  it('answers fts true with pg_search loaded, and false without it', () => {
    const loaded = measureCapabilities({ extensions: BOTH, embedder: false, refLinks: false });
    const missing = measureCapabilities({ extensions: ['vector'], embedder: false, refLinks: false });

    expect([loaded.capabilities.fts, missing.capabilities.fts]).toEqual([true, false]);
  });

  it('answers graph true when the schema holds ref_links, and false when it does not', () => {
    const held = measureCapabilities({ extensions: BOTH, embedder: false, refLinks: true });
    const absent = measureCapabilities({ extensions: BOTH, embedder: false, refLinks: false });

    expect([held.capabilities.graph, absent.capabilities.graph]).toEqual([true, false]);
  });

  it('answers vector true with pgvector loaded and an embedder given, with no why', () => {
    const measured = measureCapabilities({ extensions: BOTH, embedder: true, refLinks: false });

    expect(measured.capabilities.vector).toBe(true);
    expect(measured.vector).toEqual({ vector: true, why: null });
  });

  it('answers vector false with no embedder given, naming it', () => {
    const measured = measureCapabilities({ extensions: BOTH, embedder: false, refLinks: false });

    expect(measured.capabilities.vector).toBe(false);
    expect(measured.vector).toEqual({ vector: false, why: NO_EMBEDDER });
  });

  it('answers vector false without pgvector loaded though an embedder is given, naming the extension', () => {
    const measured = measureCapabilities({ extensions: ['pg_search'], embedder: true, refLinks: false });

    expect(measured.capabilities.vector).toBe(false);
    expect(measured.vector).toEqual({ vector: false, why: NO_PGVECTOR });
  });

  it('answers vector false while something holds the embedder\'s vectors back, naming it, and true once nothing does', () => {
    const held = measureCapabilities({ extensions: BOTH, embedder: true, refLinks: false, vectorHeld: 're-embedding' });
    const released = measureCapabilities({ extensions: BOTH, embedder: true, refLinks: false, vectorHeld: null });

    expect(held.vector).toEqual({ vector: false, why: 're-embedding' });
    expect([held.capabilities.vector, released.capabilities.vector]).toEqual([false, true]);
  });

  it('answers the missing extension and the missing embedder ahead of what holds the vectors back', () => {
    const noExtension = measureCapabilities({ extensions: ['pg_search'], embedder: true, refLinks: false, vectorHeld: 're-embedding' });
    const noEmbedder = measureCapabilities({ extensions: BOTH, embedder: false, refLinks: false, vectorHeld: 're-embedding' });

    expect([noExtension.vector.why, noEmbedder.vector.why]).toEqual([NO_PGVECTOR, NO_EMBEDDER]);
  });

  it('answers the index\'s three alone, frozen, so projection is never the index\'s', () => {
    const measured = measureCapabilities({ extensions: BOTH, embedder: true, refLinks: true });

    expect(Object.keys(measured.capabilities).sort()).toEqual(['fts', 'graph', 'vector']);
    expect([Object.isFrozen(measured), Object.isFrozen(measured.capabilities), Object.isFrozen(measured.vector)]).toEqual([true, true, true]);
  });
});

const url = process.env['POSTGRES_URL']?.trim() ?? '';

describe.skipIf(url === '')('the connector\'s capabilities, live on POSTGRES_URL', () => {
  let admin: SQL;
  const opened: HubStore[] = [];
  const projectSchemas: string[] = [];
  const builds: string[] = [];

  /** A fresh schema prefix, its project schema recorded for the drop. */
  function freshPrefix(): { readonly prefix: string; readonly schema: string } {
    const prefix = `test_idxcaps_${crypto
      .randomUUID()
      .replaceAll('-', '')
      .slice(0, 8)}`;
    const schema = projectSchemaName(prefix, DEFAULT_PROJECT_ID);
    projectSchemas.push(schema);
    return { prefix, schema };
  }

  /** Records for the drop the build the pointer of `schema` names. */
  async function recordBuild(schema: string): Promise<void> {
    const [pointer] = await admin.unsafe<{ build_schema: string }[]>(`SELECT build_schema FROM "${schema}".hub_index_serving`);
    if (pointer !== undefined) builds.push(pointer.build_schema);
  }

  /** Opens the connector under `prefix`, its store closed after the case. */
  async function open(prefix: string, embedder?: IndexEmbedder): Promise<{ readonly store: HubStore; readonly index: HubIndex }> {
    const hub = await connectPostgresHub(
      { directory: '/nonexistent', now: () => new Date(T0) },
      { urlVariable: 'POSTGRES_URL', env: { POSTGRES_URL: url }, schemaPrefix: prefix, ...embedder === undefined
        ? {}
        : { embedder, embeddingRecord: RECORD } },
    );
    opened.push(hub.store);
    await recordBuild(projectSchemaName(prefix, DEFAULT_PROJECT_ID));
    return hub;
  }

  /** Rebuilds the project, recording the build it swapped in for the drop. */
  async function rebuild(index: HubIndex, schema: string): Promise<boolean> {
    const result = await index.rebuild({ project: DEFAULT_PROJECT_ID });
    await recordBuild(schema);
    return result.vector;
  }

  /** One commit whose subject holds `parser`. */
  const PAYLOAD: WirePayload = {
    format: WIRE_FORMAT,
    version: WIRE_VERSION,
    migrations: DRIZZLE_WIRE_MIGRATIONS.flatMap(({ wire }) => wire),
    tables: { commits: [{ seq: 1, sha: 'sha-1', row_json: JSON.stringify({ subject: 'parser rewrite' }), origin_store: A, origin_seq: 1 }] },
    cursor: {},
  };

  beforeAll(() => {
    admin = new SQL(url);
  });

  afterEach(async () => {
    for (const store of opened.splice(0)) await store.close();
    for (const name of [...builds.splice(0), ...projectSchemas.splice(0)]) await admin.unsafe(`DROP SCHEMA IF EXISTS "${name}" CASCADE`);
  });

  afterAll(async () => {
    await admin.close();
  });

  it('answers fts true and projection false, and the store\'s contract the index\'s three beside projection', async () => {
    const { index, store } = await open(freshPrefix().prefix);

    const capabilities = index.capabilities();

    expect(capabilities.fts).toBe(true);
    expect(store.contract().capabilities).toEqual({ ...capabilities, projection: false });
    expect(Object.isFrozen(store.contract().capabilities)).toBe(true);
  });

  it('answers graph false over a schema holding no ref_links, and true once one is planted and the connector opens again', async () => {
    const { prefix, schema } = freshPrefix();
    const without = await open(prefix);
    await admin.unsafe(`CREATE TABLE "${schema}".${LINKS_TABLE} (from_kind text, from_id text, ref_kind text, ref_text text)`);
    const reopened = await open(prefix);

    expect(without.index.capabilities().graph).toBe(false);
    expect(reopened.index.capabilities().graph).toBe(true);
    expect(reopened.store.contract().capabilities.graph).toBe(true);
  });

  it('answers vector false with no embedder given, refusing a vector search naming it, and rebuilds full text alone', async () => {
    const { prefix, schema } = freshPrefix();
    const { index, store } = await open(prefix);
    await store.push({ device: A, payload: PAYLOAD });

    const embedded = await rebuild(index, schema);

    expect(index.capabilities().vector).toBe(false);
    expect(embedded).toBe(false);
    await expect(index.search({ mode: 'vector', query: 'parser' })).rejects.toThrow(`(${NO_EMBEDDER}); search with mode 'fts'`);
  });

  it('answers vector true with an embedder given, embedding on rebuild and answering a vector search', async () => {
    const { prefix, schema } = freshPrefix();
    const { index, store } = await open(prefix, EMBEDDER);
    await store.push({ device: A, payload: PAYLOAD });

    const embedded = await rebuild(index, schema);
    const { hits } = await index.search({ mode: 'vector', query: 'parser' });

    expect(index.capabilities().vector).toBe(true);
    expect(store.contract().capabilities.vector).toBe(true);
    expect(embedded).toBe(true);
    expect(hits.map((hit) => hit.origin)).toEqual([{ originStore: A, originSeq: 1 }]);
  });

  it('reads ref_links in the schema named and no other', async () => {
    const { prefix, schema } = freshPrefix();
    const other = freshPrefix();
    await open(prefix);
    await open(other.prefix);
    await admin.unsafe(`CREATE TABLE "${schema}".${LINKS_TABLE} (from_kind text)`);

    expect([await holdsRefLinksTable(admin, schema), await holdsRefLinksTable(admin, other.schema)]).toEqual([true, false]);
  });
});
