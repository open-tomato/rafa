/**
 * The fusion query (`fusion.ts`), its refusals first: an empty hit
 * query, one ending in a semicolon, and a limit that is not a whole
 * number of 1 or more. Then the query over planted hits, two plain
 * tables standing for the full-text and vector searches, whose fused
 * order and scores the test spells: the rows in both rankings first, a
 * row in one alone still ranked, and the control that an inner join on
 * the key would have dropped it. Last, the query over the real index
 * tables, FTS5 `MATCH` and a `vec0` KNN query, with `sqlite-vec` loaded,
 * and the control that the hits unmaterialized are refused by `vec0`.
 */
import type { FusedHit, HitQueries } from './fusion.js';

import { Database } from 'bun:sqlite';
import { describe, expect, it } from 'bun:test';

import { FTS_RANKED, fusionSql, RRF_K, VECTOR_RANKED } from './fusion.js';
import { createLoaderState, openWithVector } from './loader.js';
import { createIndexSchema, FTS_TABLE, VECTOR_TABLE } from './schema.js';

/** The planted hit queries: each table answers its hits with their order, best first. */
const PLANTED: HitQueries = {
  fts: 'SELECT row_table, origin_store, origin_seq, hit_order FROM fts_hits',
  vector: 'SELECT row_table, origin_store, origin_seq, hit_order FROM vector_hits',
};

/** A planted hit: its key, as `table:store:seq`, and its order in its own ranking. */
type Planted = readonly [key: string, hitOrder: number];

/**
 * The planted rankings. Full text: A, B, C, D. Vector: D, C, E. The
 * `hit_order` values are inserted out of rank order, so the CTE's
 * `row_number()` is what ranks them, not the insert order.
 */
const FTS_PLANTED: readonly Planted[] = [
  ['tasks:store-a:4', 0.9],
  ['tasks:store-a:1', 0.1],
  ['bugs:store-b:3', 0.5],
  ['tasks:store-a:2', 0.3],
];
const VECTOR_PLANTED: readonly Planted[] = [
  ['tasks:store-c:7', 0.6],
  ['tasks:store-a:4', 0.05],
  ['bugs:store-b:3', 0.2],
];

/** A database holding the two planted hit tables. */
function plantedDatabase(): Database {
  const database = new Database(':memory:');
  for (const [table, planted] of [['fts_hits', FTS_PLANTED], ['vector_hits', VECTOR_PLANTED]] as const) {
    database.run(`CREATE TABLE ${table} (row_table TEXT, origin_store TEXT, origin_seq INTEGER, hit_order REAL)`);
    for (const [key, hitOrder] of planted) {
      const [rowTable, originStore, originSeq] = key.split(':');
      database.run(`INSERT INTO ${table} VALUES (?, ?, ?, ?)`, [rowTable ?? '', originStore ?? '', Number(originSeq), hitOrder]);
    }
  }
  return database;
}

/** The fused rows of the planted hits, at most `limit`. */
function fuse(database: Database, limit: number): readonly FusedHit[] {
  return database
    .query<FusedHit, []>(fusionSql(PLANTED, limit))
    .all();
}

/** The fused rows of a query as `table:store:seq` keys, in order. */
function keys(rows: readonly FusedHit[]): readonly string[] {
  return rows.map((row) => `${row.row_table}:${row.origin_store}:${String(row.origin_seq)}`);
}

describe('fusionSql, refused', () => {
  it('refuses an empty hit query, naming which', () => {
    expect(() => fusionSql({ ...PLANTED, fts: ' ' }, 10)).toThrow('the full-text hit query must be a non-empty SELECT');
    expect(() => fusionSql({ ...PLANTED, vector: '' }, 10)).toThrow('the vector hit query must be a non-empty SELECT');
  });

  it('refuses a hit query ending in a semicolon', () => {
    expect(() => fusionSql({ ...PLANTED, vector: `${PLANTED.vector}; ` }, 10)).toThrow('must not end in a semicolon');
  });

  it('refuses a limit that is not a whole number of 1 or more', () => {
    for (const limit of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => fusionSql(PLANTED, limit)).toThrow('limit must be a whole number of 1 or more');
    }
  });
});

describe('fusionSql, the text', () => {
  it('names k = 60 and scores 1.0 / (k + rank)', () => {
    expect(RRF_K).toBe(60);
    expect(fusionSql(PLANTED, 10)).toContain('sum(1.0 / (60 + hit_rank)) AS score');
  });

  it('ranks each search in its own CTE by row_number()', () => {
    const sql = fusionSql(PLANTED, 10);
    for (const cte of [FTS_RANKED, VECTOR_RANKED]) {
      expect(sql).toContain(`${cte} AS (\n  SELECT row_table, origin_store, origin_seq, row_number() OVER (ORDER BY hit_order,`);
      expect(sql).toContain(`${cte}_found AS MATERIALIZED (`);
    }
  });

  it('adds no placeholder of its own and writes the limit in', () => {
    const sql = fusionSql(PLANTED, 7);
    expect(sql).not.toMatch(/[?$:]\w*/u);
    expect(sql.endsWith('LIMIT 7')).toBe(true);
  });
});

describe('fusionSql over planted hits', () => {
  it('answers the fused order the rankings spell: D, C, A, B, E', () => {
    // Ranks: full text A1 B2 C3 D4, vector D1 C2 E3.
    // D = 1/64 + 1/61, C = 1/63 + 1/62, A = 1/61, B = 1/62, E = 1/63.
    const rows = fuse(plantedDatabase(), 10);
    expect(keys(rows)).toEqual([
      'tasks:store-a:4',
      'bugs:store-b:3',
      'tasks:store-a:1',
      'tasks:store-a:2',
      'tasks:store-c:7',
    ]);
    const expected = [1 / 64 + 1 / 61, 1 / 63 + 1 / 62, 1 / 61, 1 / 62, 1 / 63];
    rows.forEach((row, at) => expect(row.score).toBeCloseTo(expected[at] ?? Number.NaN, 12));
  });

  it('ranks a hit present in one CTE alone, by that ranking', () => {
    const rows = fuse(plantedDatabase(), 10);
    const onlyVector = rows.find((row) => row.origin_store === 'store-c');
    const onlyFts = rows.find((row) => row.origin_store === 'store-a' && row.origin_seq === 2);
    expect(onlyVector?.score).toBeCloseTo(1 / 63, 12);
    expect(onlyFts?.score).toBeCloseTo(1 / 62, 12);
  });

  it('control: an inner join on the key keeps only the hits in both rankings', () => {
    const joined = plantedDatabase()
      .query<{ readonly n: number }, []>(
        'SELECT count(*) AS n FROM fts_hits JOIN vector_hits USING (row_table, origin_store, origin_seq)',
      )
      .get();
    expect(joined).toEqual({ n: 2 });
  });

  it('answers at most the limit, the best first', () => {
    const rows = fuse(plantedDatabase(), 2);
    expect(keys(rows)).toEqual(['tasks:store-a:4', 'bugs:store-b:3']);
  });

  it('answers the key and score only, never a body', () => {
    const [row] = fuse(plantedDatabase(), 1);
    expect(Object.keys(row ?? {}).sort()).toEqual(['origin_seq', 'origin_store', 'row_table', 'score']);
  });

  it('breaks a score tie by the key', () => {
    const database = plantedDatabase();
    database.run('DELETE FROM vector_hits');
    database.run('INSERT INTO vector_hits VALUES (\'bugs\', \'store-z\', 1, 0.1)');
    // A is first in full text and the store-z bug first in vector: both 1/61.
    const rows = fuse(database, 2);
    expect(keys(rows)).toEqual(['bugs:store-z:1', 'tasks:store-a:1']);
  });
});

describe('fusionSql over the index tables', () => {
  it('fuses an FTS5 MATCH and a vec0 KNN query, binding their placeholders in text order', () => {
    const opened = openWithVector(':memory:', { state: createLoaderState() });
    expect(opened.vector).toBe(true);
    const { database } = opened;
    createIndexSchema(database, { dimension: 2, project: 'fixture-project', stamp: '20261108T230000Z' }, opened);
    const rows: readonly (readonly [string, number, string, string])[] = [
      ['store-a', 1, 'rebuild rebuild rebuild', '[0,1]'],
      ['store-a', 2, 'rebuild the index beside the store and then some more words', '[1,0]'],
      ['store-a', 3, 'nothing to see', '[0.9,0.1]'],
    ];
    for (const [store, seq, body, embedding] of rows) {
      database.run(`INSERT INTO ${FTS_TABLE} (row_table, origin_store, origin_seq, body) VALUES ('tasks', ?, ?, ?)`, [store, seq, body]);
      database.run(`INSERT INTO ${VECTOR_TABLE} (embedding, row_table, origin_store, origin_seq) VALUES (?, 'tasks', ?, ?)`, [embedding, store, seq]);
    }
    const sql = fusionSql({
      fts: `SELECT row_table, origin_store, origin_seq, rank AS hit_order FROM ${FTS_TABLE} WHERE ${FTS_TABLE} MATCH ?`,
      vector: `SELECT row_table, origin_store, origin_seq, distance AS hit_order FROM ${VECTOR_TABLE} WHERE embedding MATCH ? AND k = ?`,
    }, 10);
    // Full text: seq 1 (three hits, short), seq 2. Vector toward [1,0]: seq 2, seq 3, seq 1.
    // seq 2 = 1/62 + 1/61, seq 1 = 1/61 + 1/63, seq 3 = 1/62.
    const fused = database.query<FusedHit, [string, string, number]>(sql).all('rebuild', '[1,0]', 3);
    expect(keys(fused)).toEqual(['tasks:store-a:2', 'tasks:store-a:1', 'tasks:store-a:3']);
    expect(fused[2]?.score).toBeCloseTo(1 / 62, 12);
    // Control: unmaterialized, the window's order reaches the vec0 query, which refuses it.
    expect(() => database.query(sql.replaceAll(' AS MATERIALIZED (', ' AS (')))
      .toThrow('Only a single \'ORDER BY distance\' clause is allowed on vec0 KNN queries');
  });
});
