/**
 * The rebuild-beside routine (`rebuild.ts`), its refusals first: a
 * journal or log beside the index, a parallel file already there, a bad
 * stamp and a table named twice, then a build or check that fails — a
 * table missing or without an origin pair, a count mismatch, a failed
 * `integrity_check`, a short embedder answer and a throwing swap hook.
 * Each leaves the live index's bytes and inode as they were and no
 * parallel file of the run behind. The swap follows: the index file
 * gets a new inode under the same name, the store's sha256 is unchanged,
 * and the hook before the rename still sees the old index under the
 * name. The hash and inode readings each have a control that shows they
 * see a change.
 *
 * The store is a fixture planted with `bun:sqlite` under the temporary
 * directory: this package imports nothing from core, so no store of
 * core's own is made here.
 */
import type { IndexEmbedder, RebuildIndexOptions } from './rebuild.js';
import type { IndexMeta } from './schema.js';

import { appendFileSync, closeSync, mkdtempSync, openSync, readdirSync, readFileSync, readSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { createLoaderState, openWithVector } from './loader.js';
import {
  IndexRebuildRefusal,
  NO_EMBEDDER,
  parallelIndexPath,
  rebuildIndex,
  UNEMBEDDED_DIMENSION,
} from './rebuild.js';
import { FTS_TABLE, META_TABLE, readIndexMeta, VECTOR_TABLE } from './schema.js';

const DIMENSION = 3;

/** A deterministic fixture embedder: a body's length, vowels and spaces, each plus one. */
const FIXTURE_EMBEDDER: IndexEmbedder = {
  dimension: DIMENSION,
  embed: (texts) => Promise.resolve(texts.map((text) => new Float32Array([
    text.length + 1,
    (text.match(/[aeiou]/g)?.length ?? 0) + 1,
    (text.match(/ /g)?.length ?? 0) + 1,
  ]))),
};

let directory = '';
let storePath = '';
let indexPath = '';

/** Plant the fixture store: two tables with an origin pair, one without. */
function plantStore(path: string): void {
  const store = new Database(path);
  store.run('CREATE TABLE tasks (seq INTEGER PRIMARY KEY, title TEXT, notes VARCHAR(200), priority INTEGER, origin_store TEXT, origin_seq INTEGER)');
  store.run('CREATE TABLE bugs (seq INTEGER PRIMARY KEY, summary TEXT, origin_store TEXT, origin_seq INTEGER)');
  store.run('CREATE TABLE plain (seq INTEGER PRIMARY KEY, body TEXT)');
  store.run('INSERT INTO tasks VALUES (1, \'write the parser\', \'tokens first\', 2, \'store-a\', 1)');
  store.run('INSERT INTO tasks VALUES (2, \'ship the parser\', NULL, 1, \'store-a\', 2)');
  store.run('INSERT INTO tasks VALUES (3, \'review the lexer\', \'by friday\', 3, \'store-b\', 7)');
  store.run('INSERT INTO tasks VALUES (4, \'no origin yet\', NULL, 1, NULL, NULL)');
  store.run('INSERT INTO bugs VALUES (1, \'parser drops a token\', \'store-a\', 3)');
  store.run('INSERT INTO bugs VALUES (2, \'lexer loops\', \'store-b\', 8)');
  store.run('INSERT INTO plain VALUES (1, \'no pair\')');
  store.close();
}

/** The options of one rebuild over the fixture, on a fresh loader state. */
function options(overrides: Partial<RebuildIndexOptions> = {}): RebuildIndexOptions {
  return {
    indexPath,
    loader: { state: createLoaderState() },
    project: 'fixture-project',
    storePath,
    tables: ['tasks', 'bugs'],
    ...overrides,
  };
}

/** A file's sha256, hex. */
function sha256(path: string): string {
  return new Bun.CryptoHasher('sha256')
    .update(readFileSync(path))
    .digest('hex');
}

/** A file's sha256 and inode, what "untouched" compares. */
function fingerprint(path: string): { readonly hash: string; readonly inode: number } {
  return { hash: sha256(path), inode: statSync(path).ino };
}

/** The parallel files in the directory, any stamp. */
function parallelFiles(): readonly string[] {
  return readdirSync(directory).filter((name) => name.includes('.rebuild-'));
}

/** Append one page to a closed SQLite file and count it in the header, so `integrity_check` finds it never used. */
function addUnusedPage(path: string): void {
  const file = openSync(path, 'r+');
  try {
    const header = Buffer.alloc(100);
    readSync(file, header, 0, header.length, 0);
    const rawPageSize = header.readUInt16BE(16);
    const pageSize = rawPageSize === 1
      ? 65536
      : rawPageSize;
    const pages = Buffer.alloc(4);
    pages.writeUInt32BE(header.readUInt32BE(28) + 1);
    appendFileSync(path, Buffer.alloc(pageSize));
    writeSync(file, pages, 0, pages.length, 28);
  } finally {
    closeSync(file);
  }
}

/** The metadata row of an index file, read on a connection closed after. */
function metaOf(path: string): IndexMeta | null {
  const database = new Database(path, { readonly: true });
  try {
    return readIndexMeta(database);
  } finally {
    database.close();
  }
}

/** The full-text rows of an index file, keyed and sorted. */
function fullTextRows(path: string): readonly string[] {
  const database = new Database(path, { readonly: true });
  try {
    return database
      .query<{ readonly row: string }, []>(`SELECT row_table || ' ' || origin_store || ' ' || origin_seq || ': ' || body AS row FROM ${FTS_TABLE} ORDER BY row`)
      .all()
      .map((entry) => entry.row);
  } finally {
    database.close();
  }
}

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'rafa-index-rebuild-'));
  storePath = join(directory, 'store.sqlite');
  indexPath = join(directory, 'store.sqlite.index.sqlite');
  plantStore(storePath);
  await rebuildIndex(options({ stamp: 'live' }));
});

afterEach(() => {
  rmSync(directory, { force: true, recursive: true });
});

describe('rebuildIndex, refused before any file is written', () => {
  it('refuses a journal or a log beside the index file', async () => {
    const live = fingerprint(indexPath);
    for (const suffix of ['-journal', '-wal']) {
      writeFileSync(`${indexPath}${suffix}`, '');
      const refusal: unknown = await rebuildIndex(options({ stamp: 'next' })).catch((error: unknown) => error);
      expect(refusal).toBeInstanceOf(IndexRebuildRefusal);
      expect((refusal as Error).message).toContain(`${indexPath}${suffix} is there, so a write to the index is in flight`);
      rmSync(`${indexPath}${suffix}`);
      expect(fingerprint(indexPath)).toEqual(live);
      expect(parallelFiles()).toEqual([]);
    }
  });

  it('refuses a parallel file already there, and leaves it as it found it', async () => {
    const live = fingerprint(indexPath);
    const taken = parallelIndexPath(indexPath, 'next');
    writeFileSync(taken, 'another run\'s file');
    await expect(rebuildIndex(options({ stamp: 'next' }))).rejects.toThrow(`${taken} is already there`);
    expect(readFileSync(taken, 'utf8')).toBe('another run\'s file');
    expect(parallelFiles()).toEqual(['store.sqlite.index.sqlite.rebuild-next']);
    expect(fingerprint(indexPath)).toEqual(live);
  });

  it('refuses a stamp that would leave the directory, and a table named twice', async () => {
    const live = fingerprint(indexPath);
    await expect(rebuildIndex(options({ stamp: '../next' }))).rejects.toThrow('holds a character other than a letter');
    await expect(rebuildIndex(options({ stamp: 'next', tables: ['tasks', 'bugs', 'tasks'] }))).rejects.toThrow('the table tasks is named twice');
    expect(fingerprint(indexPath)).toEqual(live);
    expect(parallelFiles()).toEqual([]);
  });
});

describe('rebuildIndex, failing its build or its checks', () => {
  /** Run a rebuild that fails, and hold the live index and the directory to how they were. */
  async function expectFailure(overrides: Partial<RebuildIndexOptions>, message: string): Promise<void> {
    const live = fingerprint(indexPath);
    await expect(rebuildIndex(options({ stamp: 'next', ...overrides }))).rejects.toThrow(message);
    expect(fingerprint(indexPath)).toEqual(live);
    expect(parallelFiles()).toEqual([]);
    expect(metaOf(indexPath)?.stamp).toBe('live');
  }

  it('refuses a store table that is not there, and one carrying no origin pair', async () => {
    await expectFailure({ tables: ['tasks', 'missing'] }, 'the store holds no table missing');
    await expectFailure({ tables: ['plain'] }, 'the store table plain carries no origin pair');
  });

  it('refuses a count mismatch: an index row lost between the build and the check', async () => {
    const afterBuild = (parallelPath: string): void => {
      const database = new Database(parallelPath);
      database.run(`DELETE FROM ${FTS_TABLE} WHERE rowid = (SELECT min(rowid) FROM ${FTS_TABLE})`);
      database.close();
    };
    await expectFailure({ hooks: { afterBuild } }, `the rebuilt ${FTS_TABLE} holds 4 rows, the build read 5`);
  });

  it('refuses a file failing integrity_check, with SQLite\'s own answer', async () => {
    await expectFailure({ hooks: { afterBuild: addUnusedPage } }, 'the rebuilt index failed integrity_check: *** in database main ***; Page');
  });

  it('control: the page the integrity case adds is all it takes, as the file reads fine before', async () => {
    let integrity = '';
    const afterBuild = (parallelPath: string): void => {
      const database = new Database(parallelPath, { readonly: true });
      integrity = database.query<{ readonly integrity_check: string }, []>('PRAGMA integrity_check').get()?.integrity_check ?? '';
      database.close();
    };
    await rebuildIndex(options({ hooks: { afterBuild }, stamp: 'next' }));
    expect(integrity).toBe('ok');
  });

  it('refuses an embedder answering fewer vectors than texts', async () => {
    const short: IndexEmbedder = { dimension: DIMENSION, embed: (texts) => FIXTURE_EMBEDDER.embed(texts.slice(1)) };
    await expectFailure({ embedder: short }, 'the embedder answered 4 vectors for 5 texts');
  });

  it('removes the parallel file when the hook before the rename throws', async () => {
    const beforeSwap = (): void => {
      throw new Error('fixture: swap hook failed');
    };
    await expectFailure({ hooks: { beforeSwap } }, 'fixture: swap hook failed');
  });
});

describe('rebuildIndex, swapped in', () => {
  it('control: the store hash and the index inode each see a change', async () => {
    const before = fingerprint(storePath);
    const store = new Database(storePath);
    store.run('INSERT INTO bugs VALUES (3, \'new bug\', \'store-c\', 1)');
    store.close();
    expect(sha256(storePath)).not.toBe(before.hash);
    const index = statSync(indexPath).ino;
    writeFileSync(join(directory, 'beside'), '');
    expect(statSync(join(directory, 'beside')).ino).not.toBe(index);
  });

  it('gives the index file a new inode under the same name, and leaves the store\'s sha256 unchanged', async () => {
    const live = fingerprint(indexPath);
    const store = sha256(storePath);
    const beside = readdirSync(directory).sort();
    const result = await rebuildIndex(options({ stamp: 'next' }));
    expect(statSync(indexPath).ino).not.toBe(live.inode);
    expect(sha256(storePath)).toBe(store);
    expect(readdirSync(directory).sort()).toEqual(beside);
    expect(metaOf(indexPath)).toEqual({
      dimension: UNEMBEDDED_DIMENSION,
      project: 'fixture-project',
      stamp: 'next',
    });
    expect(result).toEqual({
      project: 'fixture-project',
      rows: 5,
      stamp: 'next',
      tables: [{ rows: 5, table: FTS_TABLE }, { rows: 1, table: META_TABLE }],
      vector: false,
      vectors: 0,
      why: NO_EMBEDDER,
    });
  });

  it('indexes each row with an origin pair by its text columns other than origin_store, nulls left out', () => {
    expect(fullTextRows(indexPath)).toEqual([
      'bugs store-a 3: parser drops a token',
      'bugs store-b 8: lexer loops',
      'tasks store-a 1: write the parser\ntokens first',
      'tasks store-a 2: ship the parser',
      'tasks store-b 7: review the lexer\nby friday',
    ]);
  });

  it('keeps the old index under the name until the rename, while the parallel file holds the new rows', async () => {
    const store = new Database(storePath);
    store.run('INSERT INTO bugs VALUES (3, \'new bug\', \'store-c\', 1)');
    store.close();
    const seen: { stamp?: string; old?: number; parallel?: number } = {};
    const beforeSwap = (parallelPath: string): void => {
      seen.stamp = metaOf(indexPath)?.stamp;
      seen.old = fullTextRows(indexPath).length;
      seen.parallel = fullTextRows(parallelPath).length;
    };
    await rebuildIndex(options({ hooks: { beforeSwap }, stamp: 'next' }));
    expect(seen).toEqual({ old: 5, parallel: 6, stamp: 'live' });
    expect(fullTextRows(indexPath)).toHaveLength(6);
  });

  it('writes one vector row per row read with an embedder, its key answering a vector query', async () => {
    const result = await rebuildIndex(options({ embedder: FIXTURE_EMBEDDER, stamp: 'next' }));
    expect(result).toMatchObject({ rows: 5, vector: true, vectors: 5, why: null });
    expect(result.tables).toContainEqual({ rows: 5, table: VECTOR_TABLE });
    const { database } = openWithVector(indexPath, { open: { readonly: true }, state: createLoaderState() });
    const [query] = await FIXTURE_EMBEDDER.embed(['lexer loops']);
    const nearest = database
      .query<{ readonly row_table: string; readonly origin_store: string; readonly origin_seq: number }, [Float32Array]>(
        `SELECT row_table, origin_store, origin_seq FROM ${VECTOR_TABLE} WHERE embedding MATCH ? AND k = 1`,
      )
      .get(query as Float32Array);
    database.close();
    expect(nearest).toEqual({ origin_seq: 8, origin_store: 'store-b', row_table: 'bugs' });
    expect(metaOf(indexPath)?.dimension).toBe(DIMENSION);
  });
});
