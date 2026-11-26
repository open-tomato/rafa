/**
 * The connector's index rebuild over a real Postgres where `POSTGRES_URL`
 * is set: a build is a schema `index_<project>_<build>` holding a copy of
 * each indexed row table with its body, a copy of `ref_links` and the
 * build's metadata; its BM25 and HNSW indexes sit on the copies and none
 * on the row tables; a rebuild repoints the project in one transaction
 * and drops the old build, and one that fails changes nothing. Each case
 * opens its store under a schema prefix no other case or run holds, and
 * drops only the project schemas that prefix made and the build schemas
 * its rebuilds named. Without a database, the refusals made before
 * anything connects run over a stand-in database.
 */
import type { PostgresHubStoreParts } from './hub-store.js';
import type { HubDatabase } from './hub-tables.js';
import type { IndexBuildOptions } from './index-build.js';
import type { WirePayload, WireRow } from '@open-tomato/rafa/store';
import type { HubServedProject, HubStoreContext } from '@open-tomato/rafa-hub-port';
import type { IndexEmbedder } from '@open-tomato/rafa-index';

import { WIRE_FORMAT, WIRE_VERSION } from '@open-tomato/rafa/store';
import { IndexRebuildRefusal, NO_EMBEDDER } from '@open-tomato/rafa-index';
import { SQL } from 'bun';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test';
import { drizzle } from 'drizzle-orm/bun-sql';

import { DEFAULT_PROJECT_ID, projectSchemaName } from './hub-projects.js';
import { openPostgresHubStoreParts } from './hub-store.js';
import { inProjectSchema } from './hub-tables.js';
import {
  BODY_COLUMN,
  BUILD_META_TABLE,
  buildSchemaName,
  EMBEDDING_COLUMN,
  HNSW_MAX_DIMENSION,
  LINKS_TABLE,
  rebuildProjectIndex,
  servingBuild,
} from './index-build.js';
import { WIRE_TABLES } from './schema.js';
import { DRIZZLE_WIRE_MIGRATIONS } from './wire-migrations.js';

const A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const B = 'bbbbbbbb-0000-4000-8000-00000000000b';

const T0 = '2026-11-26T10:00:00.000Z';
const ONE: HubServedProject = { id: '1'.repeat(40), name: 'open-tomato/one' };
const TWO: HubServedProject = { id: '2'.repeat(40), name: 'open-tomato/two' };

/** Every wire id the shipped migrations cover: what a migrated schema mirrors. */
const WIRE_IDS = DRIZZLE_WIRE_MIGRATIONS.flatMap(({ wire }) => wire);

/** A build schema's name, its tail the 12 hex digits a rebuild draws. */
const BUILD_NAME = /^index_default_[0-9a-f]{12}$/;

/** A commit row of `origin`'s `originSeq`. */
function commit(origin: string | null, originSeq: number | null, subject = 'parser rewrite'): WireRow {
  return { seq: 50, sha: `sha-${String(origin)}-${String(originSeq)}`, row_json: JSON.stringify({ subject }), origin_store: origin, origin_seq: originSeq };
}

/** A session row of `origin`'s `originSeq`. */
function session(origin: string, originSeq: number): WireRow {
  return { seq: 51, session_id: `s-${String(originSeq)}`, row_json: '{"topic":"cache eviction"}', worktree: null, origin_store: origin, origin_seq: originSeq };
}

/** A payload carrying `tables`. */
function payloadOf(tables: Readonly<Record<string, readonly WireRow[]>>): WirePayload {
  return { format: WIRE_FORMAT, version: WIRE_VERSION, migrations: WIRE_IDS, tables, cursor: {} };
}

/** An embedder of `dimension` numbers per text, recording every text it was handed; no vector is zero. */
function recordingEmbedder(dimension = 3): IndexEmbedder & { readonly texts: string[] } {
  const texts: string[] = [];
  return {
    dimension,
    texts,
    embed: async (given) => {
      texts.push(...given);
      return given.map((text) => Float32Array.from({ length: dimension }, (_, at) => 1 + ((text.length + at) % 5)));
    },
  };
}

/** A context over the clock reading {@link T0}, with `extra` in it. */
function contextOf(extra: Partial<HubStoreContext> = {}): HubStoreContext {
  return { directory: '/nonexistent', now: () => new Date(T0), ...extra };
}

describe('buildSchemaName', () => {
  it('names index_<project>_<build>, the project lower-cased', () => {
    expect(buildSchemaName(DEFAULT_PROJECT_ID, 'abc123')).toBe('index_default_abc123');
    expect(buildSchemaName('AB12', 'f0')).toBe('index_ab12_f0');
  });

  it('refuses a name past 63 bytes, naming it', () => {
    expect(() => buildSchemaName('1'.repeat(40), 'f'.repeat(17))).toThrow('which is no schema name');
    expect(buildSchemaName('1'.repeat(40), 'f'.repeat(16))).toHaveLength(63);
  });
});

describe('rebuildProjectIndex, before it connects', () => {
  /** Options over a database that counts the transactions asked of it and opens none. */
  function standIn(extra: Partial<IndexBuildOptions>): { readonly options: IndexBuildOptions; readonly opened: () => number } {
    let transactions = 0;
    const db = { transaction: async () => { transactions += 1; throw new Error('the stand-in opens no transaction'); } } as unknown as HubDatabase;
    const options: IndexBuildOptions = {
      db,
      place: { id: DEFAULT_PROJECT_ID, schema: 'p_default' },
      request: { project: DEFAULT_PROJECT_ID },
      now: () => new Date(T0),
      ...extra,
    };
    return { options, opened: () => transactions };
  }

  it('refuses a vector-scoped rebuild with no embedder naming fts, before it opens a transaction', async () => {
    const { options, opened } = standIn({ request: { project: DEFAULT_PROJECT_ID, scope: 'vector' } });

    const refused = rebuildProjectIndex(options);

    await expect(refused).rejects.toBeInstanceOf(IndexRebuildRefusal);
    await expect(refused).rejects.toThrow('rebuild with scope \'fts\'');
    expect(opened()).toBe(0);
  });

  it('refuses a dimension the HNSW index of its precision cannot take, before it opens a transaction', async () => {
    const half = standIn({ embedder: recordingEmbedder(HNSW_MAX_DIMENSION.half + 1) });
    const full = standIn({ embedder: recordingEmbedder(HNSW_MAX_DIMENSION.full + 1), precision: 'full' });
    const none = standIn({ embedder: recordingEmbedder(0) });

    await expect(rebuildProjectIndex(half.options)).rejects.toThrow('from 1 to 4000, the most an HNSW index on halfvec takes');
    await expect(rebuildProjectIndex(full.options)).rejects.toThrow('from 1 to 2000, the most an HNSW index on vector takes');
    await expect(rebuildProjectIndex(none.options)).rejects.toBeInstanceOf(IndexRebuildRefusal);
    expect([half.opened(), full.opened(), none.opened()]).toEqual([0, 0, 0]);
  });

  it('opens a transaction for a dimension within the cap, as the control', async () => {
    const { options, opened } = standIn({ embedder: recordingEmbedder(HNSW_MAX_DIMENSION.full), precision: 'full' });

    await expect(rebuildProjectIndex(options)).rejects.toThrow('the stand-in opens no transaction');
    expect(opened()).toBe(1);
  });
});

const url = process.env['POSTGRES_URL']?.trim() ?? '';

describe.skipIf(url === '')('rebuildProjectIndex, live on POSTGRES_URL', () => {
  let admin: SQL;
  let parts: PostgresHubStoreParts | undefined;
  let db: HubDatabase;
  const projectSchemas: string[] = [];
  const builds: string[] = [];

  /** Opens a store under a fresh prefix, recording the schemas its projects make for the drop. */
  async function open(extra: Partial<HubStoreContext> = {}): Promise<PostgresHubStoreParts> {
    const prefix = `test_idxbuild_${crypto
      .randomUUID()
      .replaceAll('-', '')
      .slice(0, 8)}`;
    const ids = extra.projects?.map(({ id }) => id) ?? [DEFAULT_PROJECT_ID];
    projectSchemas.push(...ids.map((id) => projectSchemaName(prefix, id)));
    const client = new SQL(url);
    db = drizzle({ client });
    parts = await openPostgresHubStoreParts(contextOf(extra), { client, schemaPrefix: prefix });
    return parts;
  }

  /** Rebuilds the project `project` names, recording the build it made for the drop. */
  async function rebuild(project: string | undefined, extra: Partial<IndexBuildOptions> = {}): Promise<Awaited<ReturnType<typeof rebuildProjectIndex>>> {
    const place = await (parts as PostgresHubStoreParts).placeOf(project);
    const built = await rebuildProjectIndex({ db, place, request: { project: place.id }, now: () => new Date(T0), ...extra });
    builds.push(built.schema);
    return built;
  }

  /** Whether the schema `name` is there, as a connection outside every rebuild sees it. */
  async function exists(name: string): Promise<boolean> {
    const [row] = await admin.unsafe<{ found: boolean }[]>('SELECT to_regnamespace($1) IS NOT NULL AS found', [name]);
    return row?.found === true;
  }

  /** The build schema the pointer of `schema` names, read from outside, `null` before the first swap. */
  async function pointerOf(schema: string): Promise<string | null> {
    const rows = await admin.unsafe<{ build_schema: string }[]>(`SELECT build_schema FROM "${schema}".hub_index_serving`);
    return rows[0]?.build_schema ?? null;
  }

  /** The tables of `schema`, sorted. */
  async function tablesOf(schema: string): Promise<string[]> {
    const rows = await admin.unsafe<{ table_name: string }[]>(
      'SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name',
      [schema],
    );
    return rows.map((row) => row.table_name);
  }

  /** Every BM25 and HNSW index on a table of `schema`, as `<table>:<access method>`, sorted. */
  async function searchIndexesOn(schema: string): Promise<string[]> {
    const rows = await admin.unsafe<{ on_table: string; method: string }[]>(
      `SELECT t.relname AS on_table, am.amname AS method FROM pg_index i
         JOIN pg_class t ON t.oid = i.indrelid
         JOIN pg_class c ON c.oid = i.indexrelid
         JOIN pg_am am ON am.oid = c.relam
       WHERE t.relnamespace = to_regnamespace($1) AND am.amname IN ('bm25', 'hnsw')
       ORDER BY 1, 2`,
      [schema],
    );
    return rows.map((row) => `${row.on_table}:${row.method}`);
  }

  beforeAll(() => {
    admin = new SQL(url);
  });

  afterEach(async () => {
    await parts?.store.close();
    parts = undefined;
    for (const name of [...builds.splice(0), ...projectSchemas.splice(0)]) await admin.unsafe(`DROP SCHEMA IF EXISTS "${name}" CASCADE`);
  });

  afterAll(async () => {
    await admin.close();
  });

  describe('what a build holds', () => {
    it('copies each indexed row table and ref_links into index_<project>_<build>, the null-origin rows left out', async () => {
      const { store } = await open();
      const schema = projectSchemas[0] ?? '';
      await store.push({ device: A, payload: payloadOf({ commits: [commit(A, 1), commit(A, 2), commit(null, null)], sessions: [session(A, 3)] }) });
      await admin.unsafe(`CREATE TABLE "${schema}".${LINKS_TABLE} (from_kind text, from_id text, ref_kind text, ref_text text)`);
      await admin.unsafe(`INSERT INTO "${schema}".${LINKS_TABLE} VALUES ('commit', 'sha-1', 'issue', '#1')`);

      const { schema: build, result } = await rebuild(undefined);

      expect(build).toMatch(BUILD_NAME);
      expect(await tablesOf(build)).toEqual([...Object.keys(WIRE_TABLES), LINKS_TABLE, BUILD_META_TABLE].sort());
      const counted = Object.fromEntries(result.tables.map(({ table, rows }) => [table, rows]));
      expect([counted['commits'], counted['sessions'], counted[LINKS_TABLE], counted[BUILD_META_TABLE]]).toEqual([2, 1, 1, 1]);
      expect([result.project, result.rows, result.vectors, result.vector, result.why]).toEqual([DEFAULT_PROJECT_ID, 3, 0, false, NO_EMBEDDER]);
      expect(Object.isFrozen(result) && Object.isFrozen(result.tables)).toBe(true);
    });

    it('holds each row\'s body: its text columns but origin_store, in column order, joined by a newline', async () => {
      const { store } = await open();
      await store.push({ device: A, payload: payloadOf({ commits: [commit(A, 1)] }) });

      const { schema: build } = await rebuild(undefined);
      const [row] = await admin.unsafe<{ body: string }[]>(`SELECT ${BODY_COLUMN} AS body FROM "${build}".commits`);

      expect(row?.body).toBe(`sha-${A}-1\n{"subject":"parser rewrite"}`);
    });

    it('records the project, the stamp and no dimension in the build\'s metadata, and points the project at the build', async () => {
      await open();
      const schema = projectSchemas[0] ?? '';

      const { schema: build, result } = await rebuild(undefined);
      const [meta] = await admin.unsafe<{ project: string; stamp: string; dimension: number | null; precision: string | null }[]>(
        `SELECT project, stamp, dimension, precision FROM "${build}".${BUILD_META_TABLE}`,
      );

      expect(meta).toEqual({ project: DEFAULT_PROJECT_ID, stamp: result.stamp, dimension: null, precision: null });
      expect(await pointerOf(schema)).toBe(build);
    });
  });

  describe('the build\'s indexes', () => {
    it('puts a BM25 and an HNSW index on each copy, and none on the row tables', async () => {
      const { store } = await open();
      const schema = projectSchemas[0] ?? '';
      await store.push({ device: A, payload: payloadOf({ commits: [commit(A, 1), commit(A, 2)], sessions: [session(A, 3)] }) });

      const { schema: build, result } = await rebuild(undefined, { embedder: recordingEmbedder() });

      expect(await searchIndexesOn(schema)).toEqual([]);
      const expected = Object.keys(WIRE_TABLES)
        .flatMap((table) => [`${table}:bm25`, `${table}:hnsw`])
        .sort();
      expect(await searchIndexesOn(build)).toEqual(expected);
      expect([result.rows, result.vectors, result.vector, result.why]).toEqual([3, 3, true, null]);
    });

    it('finds a BM25 index planted on a row table, as the control that the check can fail', async () => {
      await open();
      const schema = projectSchemas[0] ?? '';
      await rebuild(undefined);

      await admin.unsafe(`CREATE INDEX planted_bm25 ON "${schema}".commits USING bm25 (seq, sha) WITH (key_field = 'seq')`);

      expect(await searchIndexesOn(schema)).toEqual(['commits:bm25']);
    });

    it('stores vectors as halfvec under precision half and vector under full, embedding every body once', async () => {
      const { store } = await open();
      await store.push({ device: A, payload: payloadOf({ commits: [commit(A, 1)], sessions: [session(A, 3)] }) });
      const embedder = recordingEmbedder();

      const half = await rebuild(undefined, { embedder });
      const [halfType] = await admin.unsafe<{ type: string }[]>(`SELECT format_type(atttypid, atttypmod) AS type FROM pg_attribute
        WHERE attrelid = to_regclass($1) AND attname = '${EMBEDDING_COLUMN}'`, [`"${half.schema}".commits`]);
      const full = await rebuild(undefined, { embedder, precision: 'full' });
      const [fullType] = await admin.unsafe<{ type: string }[]>(`SELECT format_type(atttypid, atttypmod) AS type FROM pg_attribute
        WHERE attrelid = to_regclass($1) AND attname = '${EMBEDDING_COLUMN}'`, [`"${full.schema}".commits`]);

      expect([halfType?.type, fullType?.type]).toEqual(['halfvec(3)', 'vector(3)']);
      expect(embedder.texts.length).toBe(4);
    });
  });

  describe('the swap', () => {
    it('repoints the project at a new build on a second rebuild and drops the old one', async () => {
      await open();
      const schema = projectSchemas[0] ?? '';

      const first = await rebuild(undefined);
      const second = await rebuild(undefined);

      expect(second.schema).not.toBe(first.schema);
      expect(second.result.stamp).not.toBe(first.result.stamp);
      expect(await pointerOf(schema)).toBe(second.schema);
      expect([await exists(first.schema), await exists(second.schema)]).toEqual([false, true]);
    });

    it('shows nothing of a build before its swap, and changes nothing when the build fails', async () => {
      await open();
      const schema = projectSchemas[0] ?? '';
      const serving = await rebuild(undefined);
      let seen: { readonly name: string; readonly visible: boolean } | undefined;

      const failed = rebuild(undefined, {
        hooks: {
          beforeSwap: async (name) => {
            seen = { name, visible: await exists(name) };
            throw new Error('planted failure before the swap');
          },
        },
      });

      await expect(failed).rejects.toThrow('planted failure before the swap');
      expect(seen?.visible).toBe(false);
      expect(await exists(seen?.name ?? '')).toBe(false);
      expect(await pointerOf(schema)).toBe(serving.schema);
      expect(await exists(serving.schema)).toBe(true);
    });

    it('refuses an embedder answering another count of vectors, with nothing changed', async () => {
      const { store } = await open();
      const schema = projectSchemas[0] ?? '';
      await store.push({ device: A, payload: payloadOf({ commits: [commit(A, 1), commit(A, 2)] }) });
      const short: IndexEmbedder = { dimension: 3, embed: async () => [Float32Array.of(1, 2, 3)] };

      await expect(rebuild(undefined, { embedder: short })).rejects.toThrow('the embedder answered 1 vectors for 2 texts');
      expect(await pointerOf(schema)).toBeNull();
    });

    it('keeps a reader on the build it locked until it is done, the swap waiting for it', async () => {
      const { store } = await open();
      const schema = projectSchemas[0] ?? '';
      await store.push({ device: A, payload: payloadOf({ commits: [commit(A, 1)] }) });
      const first = await rebuild(undefined);
      let next: Promise<unknown> | undefined;

      const read = await inProjectSchema(drizzle({ client: admin }), schema, async (tx) => {
        const locked = await servingBuild(tx);
        let swapped = false;
        next = rebuild(undefined).then(() => { swapped = true; });
        await Bun.sleep(300);
        const [row] = await admin.unsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM "${locked?.schema ?? ''}".commits`);
        return { locked: locked?.schema, rows: row?.n, pointer: await pointerOf(schema), swapped };
      });
      await next;

      expect(read).toEqual({ locked: first.schema, rows: 1, pointer: first.schema, swapped: false });
      expect(await exists(first.schema)).toBe(false);
      expect(await pointerOf(schema)).toBe(builds.at(-1) ?? '');
    });

    it('runs two rebuilds of one project one after the other, one build left serving', async () => {
      await open();
      const schema = projectSchemas[0] ?? '';

      const both = await Promise.all([rebuild(undefined), rebuild(undefined)]);
      const left = await Promise.all(both.map(({ schema: name }) => exists(name)));

      expect(left.filter(Boolean)).toHaveLength(1);
      expect(await pointerOf(schema)).toBe(both[left.indexOf(true)]?.schema ?? '');
    });
  });

  it('keeps each listed project\'s build apart, holding that project\'s rows', async () => {
    const { store } = await open({ projects: [ONE, TWO] });
    await store.push({ device: B, project: TWO.id, payload: payloadOf({ commits: [commit(B, 1)] }) });

    const one = await rebuild(ONE.id);
    const two = await rebuild(TWO.id);

    expect(one.schema.startsWith(`index_${ONE.id}_`)).toBe(true);
    expect(two.schema.startsWith(`index_${TWO.id}_`)).toBe(true);
    expect([one.result.rows, two.result.rows]).toEqual([0, 1]);
    expect([await pointerOf(projectSchemas[0] ?? ''), await pointerOf(projectSchemas[1] ?? '')]).toEqual([one.schema, two.schema]);
  });
});
