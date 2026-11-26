/**
 * The connector's index search. Without a database, the refusals made
 * before the transaction opens run over a stand-in database that counts
 * the transactions asked of it, and the placeholder binding is read
 * through Drizzle's Postgres dialect. Where `POSTGRES_URL` is set, each
 * case opens its store under a schema prefix no other case or run holds,
 * pushes four rows whose words a fixture embedder counts, rebuilds, and
 * holds each mode's hit order; it drops only the project schemas that
 * prefix made and the build schemas its rebuilds named.
 *
 * The fixture's vectors count three words, so each query's cosine
 * distances are fixed and no two rows tie:
 *
 * | Row | Text | `parser` | `rewrite` |
 * | --- | --- | --- | --- |
 * | commits A1 | parser parser parser cache | 2nd | 3rd |
 * | commits A2 | parser rewrite | 1st | 4th |
 * | commits A3 | cache eviction | 4th | 1st |
 * | sessions A4 | parser cache cache notes | 3rd | 2nd |
 */
import type { PostgresHubStoreParts } from './hub-store.js';
import type { HubDatabase } from './hub-tables.js';
import type { IndexSearchOptions } from './index-search.js';
import type { WirePayload, WireRow } from '@open-tomato/rafa/store';
import type { IndexSearchHit, IndexSearchRequest } from '@open-tomato/rafa-hub-port';
import type { IndexEmbedder } from '@open-tomato/rafa-index';

import { WIRE_FORMAT, WIRE_VERSION } from '@open-tomato/rafa/store';
import { IndexSearchRefusal, NO_EMBEDDER } from '@open-tomato/rafa-index';
import { RRF_K } from '@open-tomato/rafa-index/fusion';
import { SQL } from 'bun';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test';
import { drizzle } from 'drizzle-orm/bun-sql';
import { PgDialect } from 'drizzle-orm/pg-core';

import { DEFAULT_PROJECT_ID, projectSchemaName } from './hub-projects.js';
import { openPostgresHubStoreParts } from './hub-store.js';
import { rebuildProjectIndex } from './index-build.js';
import { boundSql, ftsHits, searchProjectIndex } from './index-search.js';
import { DRIZZLE_WIRE_MIGRATIONS } from './wire-migrations.js';

const A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const B = 'bbbbbbbb-0000-4000-8000-00000000000b';

const T0 = '2026-11-26T10:00:00.000Z';

/** Every wire id the shipped migrations cover: what a migrated schema mirrors. */
const WIRE_IDS = DRIZZLE_WIRE_MIGRATIONS.flatMap(({ wire }) => wire);

/** The words the fixture embedder counts, one dimension each. */
const COUNTED = ['parser', 'cache', 'eviction'];

/** Vector search on, as a caller that measured it answers. */
const VECTOR_ON = Object.freeze({ vector: true, why: null });

/** Vector search off, with the why a caller measured. */
const VECTOR_OFF = Object.freeze({ vector: false, why: 'sqlite-vec is not loaded here' });

/**
 * An embedder of three numbers per text, each 1 plus 4 for every time
 * the text holds one of {@link COUNTED}, so no vector is zero; it records
 * every text it was handed.
 */
function wordEmbedder(dimension = COUNTED.length): IndexEmbedder & { readonly texts: string[] } {
  const texts: string[] = [];
  return {
    dimension,
    texts,
    embed: async (given) => {
      texts.push(...given);
      return given.map((text) => {
        const words = text.toLowerCase().split(/[^a-z]+/);
        return Float32Array.from({ length: dimension }, (_, at) => 1 + (4 * words.filter((word) => word === COUNTED[at]).length));
      });
    },
  };
}

/** A commit row of `origin`'s `originSeq`, its subject `subject`. */
function commit(origin: string, originSeq: number, subject: string): WireRow {
  return { seq: 50, sha: `sha-${origin}-${String(originSeq)}`, row_json: JSON.stringify({ subject }), origin_store: origin, origin_seq: originSeq };
}

/** A session row of `origin`'s `originSeq`, its topic `topic`. */
function session(origin: string, originSeq: number, topic: string): WireRow {
  return { seq: 51, session_id: `s-${String(originSeq)}`, row_json: JSON.stringify({ topic }), worktree: null, origin_store: origin, origin_seq: originSeq };
}

/** A payload carrying `tables`. */
function payloadOf(tables: Readonly<Record<string, readonly WireRow[]>>): WirePayload {
  return { format: WIRE_FORMAT, version: WIRE_VERSION, migrations: WIRE_IDS, tables, cursor: {} };
}

/** The four fixture rows of the module note. */
const ROWS = payloadOf({
  commits: [commit(A, 1, 'parser parser parser cache'), commit(A, 2, 'parser rewrite'), commit(A, 3, 'cache eviction')],
  sessions: [session(A, 4, 'parser cache cache notes')],
});

/** A hit's key, `<table>:<origin store>:<origin seq>`. */
function keyOf(hit: IndexSearchHit): string {
  return `${hit.table}:${hit.origin.originStore}:${String(hit.origin.originSeq)}`;
}

/** The key of `table`'s row of `origin`'s `originSeq`. */
function key(table: string, origin: string, originSeq: number): string {
  return `${table}:${origin}:${String(originSeq)}`;
}

const A1 = key('commits', A, 1);
const A2 = key('commits', A, 2);
const A3 = key('commits', A, 3);
const A4 = key('sessions', A, 4);

/** The scores of `hits`, best first, as a search must answer them. */
function sortedScores(hits: readonly IndexSearchHit[]): number[] {
  return hits
    .map((hit) => hit.score)
    .sort((left, right) => right - left);
}

describe('boundSql', () => {
  const dialect = new PgDialect();

  it('binds each $n placeholder as a parameter holding its binding, never as text', () => {
    const query = dialect.sqlToQuery(boundSql('SELECT $2 AS a, $1 AS b, $2 AS c', ['\'; DROP TABLE commits; --', 5]));

    expect(query.sql).toBe('SELECT $1 AS a, $2 AS b, $3 AS c');
    expect(query.params).toEqual([5, '\'; DROP TABLE commits; --', 5]);
  });

  it('refuses a placeholder past the bindings, naming it', () => {
    expect(() => boundSql('SELECT $1, $3', ['x', 'y'])).toThrow('the placeholder $3 has no binding');
  });

  it('names no request value in a hit query\'s text', () => {
    const text = ftsHits('index_default_abc', ['commits', 'sessions'], 1, 2);

    expect(text.match(/\$\d+/g)).toEqual(['$1', '$2', '$1', '$2', '$2']);
    expect(text).toContain('UNION ALL');
  });
});

describe('searchProjectIndex, before it opens a transaction', () => {
  /** Options over a database that counts the transactions asked of it and opens none. */
  function standIn(extra: Partial<IndexSearchOptions>): { readonly options: IndexSearchOptions; readonly opened: () => number } {
    let transactions = 0;
    const db = { transaction: async () => { transactions += 1; throw new Error('the stand-in opens no transaction'); } } as unknown as HubDatabase;
    const options: IndexSearchOptions = {
      db,
      place: { id: DEFAULT_PROJECT_ID, schema: 'p_default' },
      request: { mode: 'fts', query: 'parser' },
      vector: VECTOR_ON,
      embedder: wordEmbedder(),
      ...extra,
    };
    return { options, opened: () => transactions };
  }

  it('refuses a mode none of the three, a query holding no word and a limit out of range', async () => {
    const requests: IndexSearchRequest[] = [
      { mode: 'phrase' as IndexSearchRequest['mode'], query: 'parser' },
      { mode: 'fts', query: '  ' },
      { limit: 0, mode: 'fts', query: 'parser' },
      { limit: 1.5, mode: 'fts', query: 'parser' },
      { limit: 101, mode: 'fts', query: 'parser' },
    ];
    const cases = requests.map((request) => standIn({ request }));

    const refused = await Promise.all(cases.map(({ options }) => searchProjectIndex(options).catch((error: unknown) => error)));

    expect(refused.every((error) => error instanceof IndexSearchRefusal)).toBe(true);
    expect(refused.map((error) => (error as Error).message)).toEqual([
      'index search: mode must be one of fts, vector, hybrid, got "phrase"',
      'index search: query must hold a word',
      'index search: limit must be a whole number from 1 to 100, got 0',
      'index search: limit must be a whole number from 1 to 100, got 1.5',
      'index search: limit must be a whole number from 1 to 100, got 101',
    ]);
    expect(cases.map(({ opened }) => opened())).toEqual([0, 0, 0, 0, 0]);
  });

  it('refuses a vector and a hybrid search while vector search is off, naming the why and fts', async () => {
    const vector = standIn({ request: { mode: 'vector', query: 'parser' }, vector: VECTOR_OFF });
    const hybrid = standIn({ request: { mode: 'hybrid', query: 'parser' }, vector: VECTOR_OFF });

    await expect(searchProjectIndex(vector.options)).rejects.toThrow('a vector search needs vector search, which is off (sqlite-vec is not loaded here); search with mode \'fts\'');
    await expect(searchProjectIndex(hybrid.options)).rejects.toThrow('a hybrid search needs vector search, which is off (sqlite-vec is not loaded here); search with mode \'fts\'');
    expect([vector.opened(), hybrid.opened()]).toEqual([0, 0]);
  });

  it('refuses a vector search with no embedder given, naming it and fts', async () => {
    const { options, opened } = standIn({ request: { mode: 'vector', query: 'parser' }, embedder: undefined });

    await expect(searchProjectIndex(options)).rejects.toThrow(`(${NO_EMBEDDER}); search with mode 'fts'`);
    expect(opened()).toBe(0);
  });

  it('refuses an embedder answering no vector of its dimension for the query', async () => {
    const none = standIn({ request: { mode: 'vector', query: 'parser' }, embedder: { dimension: 3, embed: async () => [] } });
    const short = standIn({ request: { mode: 'hybrid', query: 'parser' }, embedder: { dimension: 3, embed: async () => [Float32Array.of(1, 2)] } });

    await expect(searchProjectIndex(none.options)).rejects.toThrow('the embedder answered 0 vectors for one query');
    await expect(searchProjectIndex(short.options)).rejects.toThrow('the embedder answered a vector of 2 numbers, its dimension being 3');
    expect([none.opened(), short.opened()]).toEqual([0, 0]);
  });

  it('opens a transaction for an fts search while vector search is off, as the control', async () => {
    const { options, opened } = standIn({ vector: VECTOR_OFF, embedder: undefined });

    await expect(searchProjectIndex(options)).rejects.toThrow('the stand-in opens no transaction');
    expect(opened()).toBe(1);
  });
});

const url = process.env['POSTGRES_URL']?.trim() ?? '';

describe.skipIf(url === '')('searchProjectIndex, live on POSTGRES_URL', () => {
  let admin: SQL;
  let parts: PostgresHubStoreParts | undefined;
  let db: HubDatabase;
  const projectSchemas: string[] = [];
  const builds: string[] = [];

  /** Opens a store under a fresh prefix, recording the schema its project makes for the drop. */
  async function open(): Promise<PostgresHubStoreParts> {
    const prefix = `test_idxsearch_${crypto
      .randomUUID()
      .replaceAll('-', '')
      .slice(0, 8)}`;
    projectSchemas.push(projectSchemaName(prefix, DEFAULT_PROJECT_ID));
    const client = new SQL(url);
    db = drizzle({ client });
    parts = await openPostgresHubStoreParts({ directory: '/nonexistent', now: () => new Date(T0) }, { client, schemaPrefix: prefix });
    return parts;
  }

  /** Rebuilds the project, recording the build it made for the drop. */
  async function rebuild(embedder?: IndexEmbedder, precision: 'half' | 'full' = 'half'): Promise<void> {
    const place = await (parts as PostgresHubStoreParts).placeOf(undefined);
    const record = embedder === undefined
      ? undefined
      : { model: 'fixture-words', hash: 'fixture', dimension: embedder.dimension, precision };
    const built = await rebuildProjectIndex({ db, place, request: { project: place.id }, now: () => new Date(T0), embedder, record });
    builds.push(built.schema);
  }

  /** Opens a store holding the fixture rows and rebuilds it with the fixture embedder. */
  async function openBuilt(precision?: 'half' | 'full'): Promise<IndexEmbedder> {
    const { store } = await open();
    await store.push({ device: A, payload: ROWS });
    const embedder = wordEmbedder();
    await rebuild(embedder, precision);
    return embedder;
  }

  /** Searches the project with `request`, vector search on and `embedder` given. */
  async function search(request: IndexSearchRequest, embedder?: IndexEmbedder): Promise<readonly IndexSearchHit[]> {
    const place = await (parts as PostgresHubStoreParts).placeOf(undefined);
    return (await searchProjectIndex({ db, place, request, vector: VECTOR_ON, embedder })).hits;
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

  describe('fts', () => {
    it('answers every row holding the word across tables, best first, the row holding it more often above', async () => {
      await openBuilt();

      const hits = await search({ mode: 'fts', query: 'parser' });
      const keys = hits.map(keyOf);

      expect([...keys].sort()).toEqual([A1, A2, A4]);
      expect(keys.indexOf(A1)).toBeLessThan(keys.indexOf(A2));
      expect(hits.map((hit) => hit.score)).toEqual(sortedScores(hits));
      expect(hits.every((hit) => hit.score > 0)).toBe(true);
    });

    it('answers at most the limit, the best hits of the unlimited answer', async () => {
      await openBuilt();

      const all = await search({ mode: 'fts', query: 'parser' });
      const one = await search({ limit: 1, mode: 'fts', query: 'parser' });

      expect(one.map(keyOf)).toEqual(all.slice(0, 1).map(keyOf));
    });

    it('requires every word, reads an operator as a word, and answers a query of no word with no hit', async () => {
      await openBuilt();

      const both = await search({ mode: 'fts', query: 'parser rewrite' });
      const operator = await search({ mode: 'fts', query: 'parser OR eviction' });
      const quotes = await search({ mode: 'fts', query: '"' });

      expect(both.map(keyOf)).toEqual([A2]);
      expect([operator, quotes]).toEqual([[], []]);
    });

    it('reads the serving build, not the row tables: a row pushed since is found once a rebuild swaps it in', async () => {
      await openBuilt();
      await (parts as PostgresHubStoreParts).store.push({ device: B, payload: payloadOf({ commits: [commit(B, 1, 'rewrite')] }) });

      const before = await search({ mode: 'fts', query: 'rewrite' });
      await rebuild();
      const after = await search({ mode: 'fts', query: 'rewrite' });

      expect(before.map(keyOf)).toEqual([A2]);
      expect([...after.map(keyOf)].sort()).toEqual([A2, key('commits', B, 1)]);
    });
  });

  describe('vector', () => {
    it('answers every row nearest first, a score of at most one, under each precision', async () => {
      const half = await openBuilt('half');
      const halfHits = await search({ mode: 'vector', query: 'parser' }, half);
      const rewrite = await search({ mode: 'vector', query: 'rewrite' }, half);
      // A project holds one embedding record, so the full build is another project's.
      await parts?.store.close();
      const full = await openBuilt('full');
      const fullHits = await search({ mode: 'vector', query: 'parser' }, full);

      expect(halfHits.map(keyOf)).toEqual([A2, A1, A4, A3]);
      expect(rewrite.map(keyOf)).toEqual([A3, A4, A1, A2]);
      expect(fullHits.map(keyOf)).toEqual([A2, A1, A4, A3]);
      expect(halfHits.map((hit) => hit.score)).toEqual(sortedScores(halfHits));
      expect(halfHits.every((hit) => hit.score <= 1)).toBe(true);
      expect(fullHits[0]?.score).toBeCloseTo(1, 5);
    });

    it('answers at most the limit, the nearest rows', async () => {
      const embedder = await openBuilt();

      const hits = await search({ limit: 2, mode: 'vector', query: 'parser' }, embedder);

      expect(hits.map(keyOf)).toEqual([A2, A1]);
    });

    it('answers no row whose vector is zero', async () => {
      const { store } = await open();
      await store.push({ device: A, payload: ROWS });
      const zeroOnRewrite: IndexEmbedder = {
        dimension: 3,
        embed: async (texts) => texts.map((text) => (text.includes('rewrite')
          ? Float32Array.of(0, 0, 0)
          : Float32Array.of(1, 2, 3))),
      };
      await rebuild(zeroOnRewrite);

      const hits = await search({ mode: 'vector', query: 'parser' }, zeroOnRewrite);

      expect([...hits.map(keyOf)].sort()).toEqual([A1, A3, A4]);
    });
  });

  describe('hybrid', () => {
    it('fuses both rankings: the one row full text finds goes first, the vector ranking orders the rest', async () => {
      const embedder = await openBuilt();

      const vector = await search({ mode: 'vector', query: 'rewrite' }, embedder);
      const hits = await search({ mode: 'hybrid', query: 'rewrite' }, embedder);

      expect(vector.map(keyOf)).toEqual([A3, A4, A1, A2]);
      expect(hits.map(keyOf)).toEqual([A2, A3, A4, A1]);
      expect(hits.map((hit) => hit.score)).toEqual([
        (1 / (RRF_K + 1)) + (1 / (RRF_K + 4)),
        1 / (RRF_K + 1),
        1 / (RRF_K + 2),
        1 / (RRF_K + 3),
      ].map((score) => expect.closeTo(score, 10)));
    });

    it('answers from the vector ranking alone for a word no row holds, and at most the limit', async () => {
      const embedder = await openBuilt();

      const vector = await search({ mode: 'vector', query: 'zeppelin' }, embedder);
      const absent = await search({ mode: 'hybrid', query: 'zeppelin' }, embedder);
      const limited = await search({ limit: 2, mode: 'hybrid', query: 'rewrite' }, embedder);

      expect(await search({ mode: 'fts', query: 'zeppelin' })).toEqual([]);
      expect(absent.map(keyOf)).toEqual(vector.map(keyOf));
      expect(absent).toHaveLength(4);
      expect(limited.map(keyOf)).toEqual([A2, A3]);
    });
  });

  describe('refusals over a build', () => {
    it('refuses a search of a project with no build yet, naming the rebuild', async () => {
      await open();

      await expect(search({ mode: 'fts', query: 'parser' })).rejects.toThrow(`project ${DEFAULT_PROJECT_ID} has no index built yet; rebuild the index`);
    });

    it('refuses a vector and a hybrid search of a build holding no vectors, naming fts, and answers fts over it', async () => {
      const { store } = await open();
      await store.push({ device: A, payload: ROWS });
      await rebuild();
      const embedder = wordEmbedder();

      await expect(search({ mode: 'vector', query: 'parser' }, embedder)).rejects.toThrow('(the serving build holds no vectors); search with mode \'fts\'');
      await expect(search({ mode: 'hybrid', query: 'parser' }, embedder)).rejects.toThrow('(the serving build holds no vectors); search with mode \'fts\'');
      expect((await search({ mode: 'fts', query: 'parser' })).length).toBe(3);
    });

    it('refuses an embedder of another dimension than the build\'s, naming the rebuild', async () => {
      await openBuilt();

      await expect(search({ mode: 'vector', query: 'parser' }, wordEmbedder(4))).rejects.toThrow('the embedder\'s dimension is 4, the serving build\'s 3; rebuild the index');
    });
  });
});
