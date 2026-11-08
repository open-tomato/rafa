/**
 * The index schema (`schema.ts`), its refusals first: metadata the table
 * cannot hold, a database already holding the tables, and the vector
 * table left out under `vector: false`, with the control that a `vec0`
 * table on a database without `sqlite-vec` throws, so leaving it out is
 * what keeps such a database usable. The tables created under
 * `vector: true` follow, over a real `sqlite-vec` load: the key columns
 * of both search tables, a vector query answering them, and the
 * metadata row read back.
 */
import type { VectorAnswer } from './loader.js';
import type { IndexMeta } from './schema.js';

import { Database } from 'bun:sqlite';
import { describe, expect, it } from 'bun:test';

import { createLoaderState, openWithVector } from './loader.js';
import {
  createIndexSchema,
  FTS_TABLE,
  indexTables,
  MAX_DIMENSION,
  META_TABLE,
  readIndexMeta,
  VECTOR_TABLE,
} from './schema.js';

const META: IndexMeta = { dimension: 3, project: 'fixture-project', stamp: '20261108T230000Z' };

const VECTOR_OFF: VectorAnswer = { vector: false, why: 'fixture: no extension' };

/** A database with `sqlite-vec` loaded through the loader, on a fresh state. */
function vectorDatabase(): { readonly database: Database; readonly answer: VectorAnswer } {
  const opened = openWithVector(':memory:', { state: createLoaderState() });
  return { answer: { vector: opened.vector, why: opened.why }, database: opened.database };
}

/** The names of the tables and virtual tables the database holds, the shadow tables left out. */
function tableNames(database: Database): readonly string[] {
  return database
    .query<{ readonly name: string }, []>('SELECT name FROM sqlite_master WHERE type = \'table\' ORDER BY name')
    .all()
    .map((row) => row.name)
    .filter((name) => [FTS_TABLE, META_TABLE, VECTOR_TABLE].includes(name));
}

describe('createIndexSchema, refused', () => {
  it('refuses a dimension that is not a whole number from 1 to the cap, creating nothing', () => {
    for (const dimension of [0, -1, 1.5, Number.NaN, MAX_DIMENSION + 1]) {
      const database = new Database(':memory:');
      expect(() => createIndexSchema(database, { ...META, dimension }, VECTOR_OFF)).toThrow('dimension must be a whole number from 1 to 8192');
      expect(tableNames(database)).toEqual([]);
    }
  });

  it('refuses a null dimension when the vector table is to be made, creating nothing', () => {
    const { answer, database } = vectorDatabase();
    expect(answer.vector).toBe(true);
    expect(() => createIndexSchema(database, { ...META, dimension: null }, answer)).toThrow('the vector table needs a dimension, got null');
    expect(tableNames(database)).toEqual([]);
  });

  it('refuses an empty project or stamp', () => {
    const database = new Database(':memory:');
    expect(() => createIndexSchema(database, { ...META, project: ' ' }, VECTOR_OFF)).toThrow('project must be a non-empty string');
    expect(() => createIndexSchema(database, { ...META, stamp: '' }, VECTOR_OFF)).toThrow('stamp must be a non-empty string');
    expect(tableNames(database)).toEqual([]);
  });

  it('throws on a database that already holds the tables, and keeps the first metadata row', () => {
    const database = new Database(':memory:');
    createIndexSchema(database, META, VECTOR_OFF);
    expect(() => createIndexSchema(database, { ...META, project: 'other' }, VECTOR_OFF)).toThrow('already exists');
    expect(readIndexMeta(database)?.project).toBe(META.project);
  });

  it('takes the cap itself, the largest dimension sqlite-vec 0.1.9 creates', () => {
    const { answer, database } = vectorDatabase();
    expect(answer.vector).toBe(true);
    expect(createIndexSchema(database, { ...META, dimension: MAX_DIMENSION }, answer)).toContain(VECTOR_TABLE);
  });
});

describe('createIndexSchema under vector: false', () => {
  it('control: a vec0 table on a database without sqlite-vec throws', () => {
    const database = new Database(':memory:');
    expect(() => database.run('CREATE VIRTUAL TABLE probe USING vec0(embedding float[3])')).toThrow('no such module: vec0');
  });

  it('creates the full-text and metadata tables and no vector table', () => {
    const database = new Database(':memory:');
    const created = createIndexSchema(database, META, VECTOR_OFF);
    expect(created).toEqual([FTS_TABLE, META_TABLE]);
    expect(tableNames(database)).toEqual([FTS_TABLE, META_TABLE]);
  });

  it('leaves the vector table out on the answer alone, even with sqlite-vec loaded', () => {
    const { answer, database } = vectorDatabase();
    expect(answer.vector).toBe(true);
    createIndexSchema(database, META, VECTOR_OFF);
    expect(tableNames(database)).toEqual([FTS_TABLE, META_TABLE]);
  });
});

describe('createIndexSchema under vector: true', () => {
  it('creates the three tables, in the order indexTables names them', () => {
    const { answer, database } = vectorDatabase();
    const created = createIndexSchema(database, META, answer);
    expect(created).toEqual([FTS_TABLE, VECTOR_TABLE, META_TABLE]);
    expect(created).toEqual(indexTables(answer));
    expect([...tableNames(database)].sort()).toEqual([FTS_TABLE, META_TABLE, VECTOR_TABLE].sort());
  });

  it('keys a full-text hit by table and origin pair, matching the body only', () => {
    const database = new Database(':memory:');
    createIndexSchema(database, META, VECTOR_OFF);
    database.run(
      `INSERT INTO ${FTS_TABLE} (row_table, origin_store, origin_seq, body) VALUES (?, ?, ?, ?), (?, ?, ?, ?)`,
      ['tasks', 'store-a', 4, 'rebuild the index beside', 'bugs', 'store-b', 9, 'tasks drift'],
    );
    const hits = database
      .query(`SELECT row_table, origin_store, origin_seq FROM ${FTS_TABLE} WHERE ${FTS_TABLE} MATCH ? ORDER BY rank`)
      .all('rebuild');
    expect(hits).toEqual([{ origin_seq: 4, origin_store: 'store-a', row_table: 'tasks' }]);
    // The key columns are unindexed: a table name is no full-text hit.
    expect(database.query(`SELECT count(*) AS n FROM ${FTS_TABLE} WHERE ${FTS_TABLE} MATCH 'bugs'`).get()).toEqual({ n: 0 });
  });

  it('keys a vector hit by table and origin pair, and refuses a vector off the dimension', () => {
    const { answer, database } = vectorDatabase();
    createIndexSchema(database, META, answer);
    const insert = `INSERT INTO ${VECTOR_TABLE} (embedding, row_table, origin_store, origin_seq) VALUES (?, ?, ?, ?)`;
    database.run(insert, ['[1,0,0]', 'tasks', 'store-a', 4]);
    database.run(insert, ['[0,1,0]', 'bugs', 'store-b', 9]);
    expect(() => database.run(insert, ['[1,0]', 'tasks', 'store-a', 5])).toThrow('Expected 3 dimensions but received 2');
    const hits = database
      .query(`SELECT row_table, origin_store, origin_seq FROM ${VECTOR_TABLE} WHERE embedding MATCH ? AND k = 2 ORDER BY distance`)
      .all('[0.9,0.1,0]');
    expect(hits).toEqual([
      { origin_seq: 4, origin_store: 'store-a', row_table: 'tasks' },
      { origin_seq: 9, origin_store: 'store-b', row_table: 'bugs' },
    ]);
  });

  it('passes PRAGMA integrity_check', () => {
    const { answer, database } = vectorDatabase();
    createIndexSchema(database, META, answer);
    expect(database.query('PRAGMA integrity_check').all()).toEqual([{ integrity_check: 'ok' }]);
  });
});

describe('readIndexMeta', () => {
  it('answers null for a database with no metadata table', () => {
    expect(readIndexMeta(new Database(':memory:'))).toBeNull();
  });

  it('records a null dimension for an index made with no vector table', () => {
    const database = new Database(':memory:');
    const meta: IndexMeta = { ...META, dimension: null };
    expect(createIndexSchema(database, meta, VECTOR_OFF)).toEqual([FTS_TABLE, META_TABLE]);
    expect(readIndexMeta(database)).toEqual(meta);
  });

  it('answers the project, the dimension and the build stamp written', () => {
    const database = new Database(':memory:');
    createIndexSchema(database, META, VECTOR_OFF);
    expect(readIndexMeta(database)).toEqual(META);
  });

  it('holds one row: a second insert is refused by the key', () => {
    const database = new Database(':memory:');
    createIndexSchema(database, META, VECTOR_OFF);
    expect(() => database.run(`INSERT INTO ${META_TABLE} (id, project, dimension, stamp) VALUES (2, 'p', 3, 's')`)).toThrow('CHECK constraint failed');
  });
});
