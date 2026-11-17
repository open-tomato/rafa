/**
 * Search over an index (`search.ts`), its refusals first: an unknown
 * mode, an empty query, a limit that is not a whole number from 1 to
 * 100, a database holding no index or no schema of the name, and a
 * `vector` or `hybrid` request with vector search off by each measure,
 * refused naming `fts` before the embedder is called. Then the three
 * modes over a planted index whose order and scores the test spells,
 * each answering only (table, origin pair, score), and the same search
 * over the index attached to another connection. Controls show that the
 * raw query text would be read as FTS5 syntax, that the zero vector
 * would be a vector hit without the distance bound, and that a limit of
 * 1 and of 100 are taken.
 *
 * The index is planted with `bun:sqlite` through the schema module, and
 * the embedder is a fixture counting keywords, so every vector is known.
 */
import type { VectorAnswer } from './loader.js';
import type { IndexEmbedder } from './rebuild.js';
import type { IndexSearchHit, IndexSearchRequest, SearchMode, SearchTarget } from './search.js';

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database } from 'bun:sqlite';
import { describe, expect, it } from 'bun:test';

import { createLoaderState, loadVector, openWithVector } from './loader.js';
import { NO_EMBEDDER } from './rebuild.js';
import { createIndexSchema, FTS_TABLE, VECTOR_TABLE } from './schema.js';
import { DEFAULT_LIMIT, ftsQuery, IndexSearchRefusal, MAX_LIMIT, search } from './search.js';

/** The keywords the fixture embedder counts, one dimension each. */
const KEYWORDS = ['parser', 'index', 'ship'] as const;

/** A fixture embedder: each component counts one keyword in the text. */
function keywordEmbedder(): IndexEmbedder & { readonly calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    dimension: KEYWORDS.length,
    embed: (texts) => {
      calls.push([...texts]);
      return Promise.resolve(texts.map((text) => {
        const words = text.toLowerCase().split(/\s+/u);
        return new Float32Array(KEYWORDS.map((keyword) => words.filter((word) => word === keyword).length));
      }));
    },
  };
}

/** A planted row: table, origin store, origin seq, body, and its vector as `vec0` JSON. */
type PlantedRow = readonly [table: string, store: string, seq: number, body: string, vector: string];

/**
 * The planted index. Full text for `parser`: a:2 (twice, short) then
 * a:1. Vectors are the fixture embedder's of each body, so a:3, holding
 * no keyword, has the zero vector and no cosine distance.
 */
const ROWS: readonly PlantedRow[] = [
  ['tasks', 'store-a', 1, 'write the parser', '[1,0,0]'],
  ['tasks', 'store-a', 2, 'ship parser parser', '[2,0,1]'],
  ['bugs', 'store-b', 1, 'the index is slow', '[0,1,0]'],
  ['tasks', 'store-a', 3, 'nothing here', '[0,0,0]'],
];

/** The schema answers of a planted index, with vector search on and off. */
const VECTOR_ON: VectorAnswer = { vector: true, why: null };
const VECTOR_OFF: VectorAnswer = { vector: false, why: 'fixture: built without vectors' };

/** Plant the index tables and rows; with `vector`, on a database the extension is loaded into. */
function plantIndex(database: Database, vector: boolean): void {
  const meta = { dimension: KEYWORDS.length, project: 'fixture-project', stamp: '20261108T230000Z' };
  if (vector) {
    createIndexSchema(database, meta, VECTOR_ON);
  } else {
    createIndexSchema(database, { ...meta, dimension: null }, VECTOR_OFF);
  }
  for (const [table, store, seq, body, embedding] of ROWS) {
    database.run(`INSERT INTO ${FTS_TABLE} (row_table, origin_store, origin_seq, body) VALUES (?, ?, ?, ?)`, [table, store, seq, body]);
    if (vector) {
      database.run(`INSERT INTO ${VECTOR_TABLE} (embedding, row_table, origin_store, origin_seq) VALUES (?, ?, ?, ?)`, [embedding, table, store, seq]);
    }
  }
}

/** A target over a planted in-memory index with vector search on and the fixture embedder. */
function plantedTarget(embedder: IndexEmbedder = keywordEmbedder()): SearchTarget {
  const opened = openWithVector(':memory:', { state: createLoaderState() });
  expect(opened.vector).toBe(true);
  plantIndex(opened.database, true);
  return { database: opened.database, embedder, vector: true, why: null };
}

/** The hits as `table:store:seq` keys, in order. */
function keys(hits: readonly IndexSearchHit[]): readonly string[] {
  return hits.map((hit) => `${hit.table}:${hit.origin.originStore}:${String(hit.origin.originSeq)}`);
}

/** The refusal a search rejects with. */
async function refusal(target: SearchTarget, request: IndexSearchRequest): Promise<IndexSearchRefusal> {
  try {
    await search(target, request);
  } catch (error) {
    expect(error).toBeInstanceOf(IndexSearchRefusal);
    return error as IndexSearchRefusal;
  }
  throw new Error(`the ${request.mode} search was answered, not refused`);
}

describe('search, a request refused', () => {
  it('refuses a mode it does not know, naming the three', async () => {
    const mode = 'regex' as SearchMode;
    expect((await refusal(plantedTarget(), { mode, query: 'parser' })).message)
      .toBe('index search: mode must be one of fts, vector, hybrid, got "regex"');
  });

  it('refuses a query holding no word', async () => {
    for (const query of ['', '  \n ']) {
      expect((await refusal(plantedTarget(), { mode: 'fts', query })).message).toBe('index search: query must hold a word');
    }
  });

  it('refuses a limit that is not a whole number from 1 to 100', async () => {
    const target = plantedTarget();
    const limits = [0, -1, 101, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '10' as unknown as number];
    for (const limit of limits) {
      expect((await refusal(target, { limit, mode: 'fts', query: 'parser' })).message)
        .toStartWith('index search: limit must be a whole number from 1 to 100, got ');
    }
  });

  it('control: takes a limit of 1 and of 100, and 10 when left out', async () => {
    const target = plantedTarget();
    expect(MAX_LIMIT).toBe(100);
    expect(DEFAULT_LIMIT).toBe(10);
    expect((await search(target, { limit: 1, mode: 'fts', query: 'parser' })).hits).toHaveLength(1);
    expect((await search(target, { limit: MAX_LIMIT, mode: 'fts', query: 'parser' })).hits).toHaveLength(2);
    expect((await search(target, { mode: 'vector', query: 'parser' })).hits).toHaveLength(3);
  });

  it('refuses a database holding no index, and a schema that is no attached database', async () => {
    const empty: SearchTarget = { database: new Database(':memory:'), vector: false, why: 'fixture' };
    expect((await refusal(empty, { mode: 'fts', query: 'parser' })).message)
      .toBe('index search: the database holds no index: there is no index_meta table');
    expect((await refusal({ ...empty, schema: 'idx' }, { mode: 'fts', query: 'parser' })).message)
      .toBe('index search: no database is attached as idx');
    expect((await refusal({ ...empty, schema: 'x; DROP' }, { mode: 'fts', query: 'parser' })).message)
      .toBe('index search: schema "x; DROP" is not an SQL identifier');
  });
});

describe('search, vector search off', () => {
  const MODES: readonly SearchMode[] = ['vector', 'hybrid'];

  it('refuses a vector or hybrid request when vector is false, naming fts and the why, before embedding', async () => {
    const embedder = keywordEmbedder();
    const target: SearchTarget = { ...plantedTarget(embedder), vector: false, why: 'loading sqlite-vec threw: fixture' };
    for (const mode of MODES) {
      expect((await refusal(target, { mode, query: 'parser' })).message).toBe(
        `index search: a ${mode} search needs vector search, which is off (loading sqlite-vec threw: fixture); search with mode 'fts'`,
      );
    }
    expect(embedder.calls).toEqual([]);
  });

  it('control: the same target answers an fts request', async () => {
    const target: SearchTarget = { ...plantedTarget(), vector: false, why: 'fixture' };
    expect(keys((await search(target, { mode: 'fts', query: 'parser' })).hits)).toEqual(['tasks:store-a:2', 'tasks:store-a:1']);
  });

  it('refuses naming fts when no embedder was handed', async () => {
    const { database } = plantedTarget();
    for (const mode of MODES) {
      expect((await refusal({ database, vector: true, why: null }, { mode, query: 'parser' })).message)
        .toBe(`index search: a ${mode} search needs vector search, which is off (${NO_EMBEDDER}); search with mode 'fts'`);
    }
  });

  it('refuses naming fts when the index holds no vector table', async () => {
    const database = new Database(':memory:');
    plantIndex(database, false);
    const embedder = keywordEmbedder();
    for (const mode of MODES) {
      expect((await refusal({ database, embedder, vector: true, why: null }, { mode, query: 'parser' })).message)
        .toBe(`index search: a ${mode} search needs vector search, which is off (the index holds no ${VECTOR_TABLE} table); search with mode 'fts'`);
    }
    expect(embedder.calls).toEqual([]);
  });

  it('refuses an embedder of another dimension than the index, and an answer not one vector of it', async () => {
    const fixture = keywordEmbedder();
    const wide: IndexEmbedder = { ...fixture, dimension: 4 };
    expect((await refusal(plantedTarget(wide), { mode: 'vector', query: 'parser' })).message)
      .toBe('index search: the embedder\'s dimension is 4, the index\'s 3; rebuild the index');
    const two: IndexEmbedder = { dimension: 3, embed: () => Promise.resolve([new Float32Array(3), new Float32Array(3)]) };
    expect((await refusal(plantedTarget(two), { mode: 'vector', query: 'parser' })).message)
      .toBe('index search: the embedder answered 2 vectors for one query');
    const short: IndexEmbedder = { dimension: 3, embed: () => Promise.resolve([new Float32Array(2)]) };
    expect((await refusal(plantedTarget(short), { mode: 'hybrid', query: 'parser' })).message)
      .toBe('index search: the embedder answered a vector of 2 numbers, its dimension being 3');
  });
});

describe('search, fts', () => {
  it('answers the rows holding every word, the most relevant first, scored -rank', async () => {
    const target = plantedTarget();
    const { hits } = await search(target, { mode: 'fts', query: 'parser' });
    expect(keys(hits)).toEqual(['tasks:store-a:2', 'tasks:store-a:1']);
    const ranks = target.database
      .query<{ readonly rank: number }, [string]>(`SELECT rank FROM ${FTS_TABLE} WHERE ${FTS_TABLE} MATCH ? ORDER BY rank`)
      .all('parser');
    expect(hits.map((hit) => hit.score)).toEqual(ranks.map((row) => -row.rank));
    expect(hits[0]?.score).toBeGreaterThan(hits[1]?.score ?? Number.POSITIVE_INFINITY);
    expect(keys((await search(target, { mode: 'fts', query: 'write  parser' })).hits)).toEqual(['tasks:store-a:1']);
    expect((await search(target, { mode: 'fts', query: 'absent' })).hits).toEqual([]);
  });

  it('reads the query as plain words: an operator or a quote is a word, and the raw text would be syntax', async () => {
    const target = plantedTarget();
    expect(ftsQuery('parser AND "x')).toBe('"parser" "AND" """x"');
    expect((await search(target, { mode: 'fts', query: 'parser AND' })).hits).toEqual([]);
    expect((await search(target, { mode: 'fts', query: '"' })).hits).toEqual([]);
    // Control: the same text as a raw MATCH argument is FTS5 syntax, refused by the engine.
    expect(() => target.database.query(`SELECT rowid FROM ${FTS_TABLE} WHERE ${FTS_TABLE} MATCH ?`).all('parser AND'))
      .toThrow('fts5: syntax error');
  });

  it('runs without the extension or an embedder, and never calls the embedder', async () => {
    const embedder = keywordEmbedder();
    const database = new Database(':memory:');
    plantIndex(database, false);
    const { hits } = await search({ database, embedder, vector: false, why: 'fixture' }, { mode: 'fts', query: 'index' });
    expect(keys(hits)).toEqual(['bugs:store-b:1']);
    expect(embedder.calls).toEqual([]);
  });
});

describe('search, vector', () => {
  it('answers the nearest rows by cosine, scored 1 - distance, embedding the query once', async () => {
    const embedder = keywordEmbedder();
    const { hits } = await search(plantedTarget(embedder), { mode: 'vector', query: 'parser' });
    // Query [1,0,0]: a:1 [1,0,0] cos 1, a:2 [2,0,1] cos 2/sqrt(5), b:1 [0,1,0] cos 0.
    expect(keys(hits)).toEqual(['tasks:store-a:1', 'tasks:store-a:2', 'bugs:store-b:1']);
    const expected = [1, 2 / Math.sqrt(5), 0];
    hits.forEach((hit, at) => expect(hit.score).toBeCloseTo(expected[at] ?? Number.NaN, 5));
    expect(embedder.calls).toEqual([['parser']]);
  });

  it('never answers the zero vector, which has no cosine distance', async () => {
    const target = plantedTarget();
    const { hits } = await search(target, { mode: 'vector', query: 'parser' });
    expect(keys(hits)).not.toContain('tasks:store-a:3');
    expect((await search(target, { mode: 'vector', query: 'nothing' })).hits).toEqual([]);
    // Control: without the distance bound the KNN query answers it, its distance null.
    const raw = target.database
      .query<{ readonly origin_seq: number; readonly distance: number | null }, [Float32Array, number]>(
        `SELECT origin_seq, distance FROM ${VECTOR_TABLE} WHERE embedding MATCH ? AND k = ?`,
      )
      .all(new Float32Array([1, 0, 0]), 4);
    expect(raw.find((row) => row.origin_seq === 3)).toEqual({ distance: null, origin_seq: 3 });
  });

  it('answers at most the limit', async () => {
    const { hits } = await search(plantedTarget(), { limit: 2, mode: 'vector', query: 'parser' });
    expect(keys(hits)).toEqual(['tasks:store-a:1', 'tasks:store-a:2']);
  });
});

describe('search, hybrid', () => {
  it('fuses the two rankings, a row in the vector ranking alone still ranked', async () => {
    const { hits } = await search(plantedTarget(), { mode: 'hybrid', query: 'ship parser' });
    // Full text: a:2 alone. Vector, query [1,0,1]: a:2 (cos 0.95), a:1 (0.71), b:1 (0).
    // a:2 = 1/61 + 1/61, a:1 = 1/62, b:1 = 1/63.
    expect(keys(hits)).toEqual(['tasks:store-a:2', 'tasks:store-a:1', 'bugs:store-b:1']);
    const expected = [2 / 61, 1 / 62, 1 / 63];
    hits.forEach((hit, at) => expect(hit.score).toBeCloseTo(expected[at] ?? Number.NaN, 12));
  });

  it('answers at most the limit, the best first', async () => {
    const { hits } = await search(plantedTarget(), { limit: 1, mode: 'hybrid', query: 'ship parser' });
    expect(keys(hits)).toEqual(['tasks:store-a:2']);
  });
});

describe('search, the answer', () => {
  it('holds only (table, origin pair, score) in every mode, frozen', async () => {
    const target = plantedTarget();
    for (const mode of ['fts', 'vector', 'hybrid'] as const) {
      const result = await search(target, { mode, query: 'parser' });
      expect(Object.keys(result)).toEqual(['hits']);
      expect(result.hits.length).toBeGreaterThan(0);
      expect(Object.isFrozen(result) && Object.isFrozen(result.hits)).toBe(true);
      for (const hit of result.hits) {
        expect(Object.keys(hit).sort()).toEqual(['origin', 'score', 'table']);
        expect(Object.keys(hit.origin).sort()).toEqual(['originSeq', 'originStore']);
        expect([typeof hit.table, typeof hit.origin.originStore, typeof hit.origin.originSeq, typeof hit.score])
          .toEqual(['string', 'string', 'number', 'number']);
        expect(Object.isFrozen(hit) && Object.isFrozen(hit.origin)).toBe(true);
      }
    }
  });

  it('reads an index attached to another connection under the schema named', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'rafa-index-search-'));
    try {
      const indexPath = join(directory, 'store.sqlite.index.sqlite');
      const opened = openWithVector(indexPath, { state: createLoaderState() });
      plantIndex(opened.database, true);
      opened.database.close();
      const connection = new Database(':memory:');
      expect(loadVector(connection).vector).toBe(true);
      connection.run('ATTACH DATABASE ? AS idx', [indexPath]);
      const target: SearchTarget = { database: connection, embedder: keywordEmbedder(), schema: 'idx', vector: true, why: null };
      for (const mode of ['fts', 'vector', 'hybrid'] as const) {
        const attached = await search(target, { mode, query: 'ship parser' });
        const direct = await search(plantedTarget(), { mode, query: 'ship parser' });
        expect(attached).toEqual(direct);
      }
      // Control: under main the connection holds no index.
      expect((await refusal({ ...target, schema: undefined }, { mode: 'fts', query: 'parser' })).message)
        .toContain('the database holds no index');
      connection.close();
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
