/**
 * The index modules together, over a fixture store and a deterministic
 * fixture embedder: a rebuild builds the index file from the store's
 * rows, then `fts`, `vector` and `hybrid` search read it, and `links`
 * walks the store's own `ref_links` across two hops. A search run from
 * the rebuild's `beforeSwap` hook, with a second build waiting for its
 * rename, answers the full old index; after the swap the same search
 * answers the new one, and a reader opened before the swap keeps the old
 * file. The store's sha256 is the same after every rebuild.
 *
 * The store is a fixture planted with `bun:sqlite` under the temporary
 * directory, with a `ref_links` table of the columns the backfill spec's
 * migration (#1436) names: this package imports nothing from core, so no
 * store of core's own is made here. The embedder counts a fixed
 * vocabulary of words plus one constant, so which rows a query is near
 * is spelled by the fixture and no model runs.
 */
import type { IndexEmbedder } from './rebuild.js';
import type { IndexSearchHit, IndexSearchRequest, SearchTarget } from './search.js';
import type { Database } from 'bun:sqlite';

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database as SqliteDatabase } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { links } from './links.js';
import { createLoaderState, openWithVector } from './loader.js';
import { parallelIndexPath, rebuildIndex } from './rebuild.js';
import { readIndexMeta } from './schema.js';
import { search } from './search.js';

const VOCABULARY = ['parser', 'lexer', 'token', 'ship', 'review', 'friday'] as const;
const DIMENSION = VOCABULARY.length + 1;
const TABLES = ['tasks', 'bugs'] as const;
const PROJECT = 'fixture-project';

/** A deterministic fixture embedder: each vocabulary word's count in the text, then a constant one. */
const FIXTURE_EMBEDDER: IndexEmbedder = {
  dimension: DIMENSION,
  embed: (texts) => Promise.resolve(texts.map((text) => {
    const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
    return new Float32Array([
      ...VOCABULARY.map((word) => words.filter((found) => found === word).length),
      1,
    ]);
  })),
};

/** The strings in order, as a new list. */
function sorted(list: readonly string[]): string[] {
  return [...list].sort();
}

/** The hits' scores, in the hits' order. */
function scores(hits: readonly IndexSearchHit[]): number[] {
  return hits.map((hit) => hit.score);
}

/** A hit's key as one string: `table:store/seq`. */
function keyOf(hit: IndexSearchHit): string {
  return `${hit.table}:${hit.origin.originStore}/${String(hit.origin.originSeq)}`;
}

const TASK_1 = 'tasks:store-a/1';
const TASK_2 = 'tasks:store-a/2';
const TASK_3 = 'tasks:store-b/7';
const BUG_3 = 'bugs:store-a/3';
const BUG_8 = 'bugs:store-b/8';
const TASK_9 = 'tasks:store-a/9';

let directory = '';
let storePath = '';
let indexPath = '';
let opened: Database[] = [];

/** Plant the fixture store: two indexed tables and a `ref_links` table of two hops, a cycle and a dead end. */
function plantStore(path: string): void {
  const store = new SqliteDatabase(path);
  store.run('CREATE TABLE tasks (seq INTEGER PRIMARY KEY, title TEXT, notes TEXT, origin_store TEXT, origin_seq INTEGER)');
  store.run('CREATE TABLE bugs (seq INTEGER PRIMARY KEY, summary TEXT, origin_store TEXT, origin_seq INTEGER)');
  store.run('INSERT INTO tasks VALUES (1, \'write the parser\', \'tokens first\', \'store-a\', 1)');
  store.run('INSERT INTO tasks VALUES (2, \'ship the parser\', NULL, \'store-a\', 2)');
  store.run('INSERT INTO tasks VALUES (3, \'review the lexer\', \'by friday\', \'store-b\', 7)');
  store.run('INSERT INTO bugs VALUES (1, \'parser drops a token\', \'store-a\', 3)');
  store.run('INSERT INTO bugs VALUES (2, \'lexer loops\', \'store-b\', 8)');
  store.run('CREATE TABLE ref_links (from_kind TEXT NOT NULL, from_id TEXT NOT NULL, role TEXT NOT NULL, ref_kind TEXT NOT NULL, ref_text TEXT NOT NULL)');
  const insert = store.prepare('INSERT INTO ref_links VALUES (?, ?, ?, ?, ?)');
  insert.run('commit', 'abc123', 'fixes', 'issue', '#1');
  insert.run('issue', '#1', 'tracked-by', 'pr', '#2');
  insert.run('pr', '#2', 'closes', 'issue', '#3');
  insert.run('pr', '#2', 'built-from', 'commit', 'abc123');
  insert.run('issue', '#9', 'mentions', 'issue', '#10');
  store.close();
}

/** Add one task to the planted store, so a second rebuild reads a row the first did not. */
function addTask(): void {
  const store = new SqliteDatabase(storePath);
  store.run('INSERT INTO tasks VALUES (9, \'ship the lexer\', NULL, \'store-a\', 9)');
  store.close();
}

/** A file's sha256, hex. */
function sha256(path: string): string {
  return new Bun.CryptoHasher('sha256')
    .update(readFileSync(path))
    .digest('hex');
}

/** One rebuild of the fixture store, the loader on a state of the test's own. */
function rebuild(stamp: string, beforeSwap?: (parallelPath: string) => void | Promise<void>): ReturnType<typeof rebuildIndex> {
  return rebuildIndex({
    embedder: FIXTURE_EMBEDDER,
    hooks: beforeSwap === undefined
      ? undefined
      : { beforeSwap },
    indexPath,
    loader: { state: createLoaderState() },
    project: PROJECT,
    stamp,
    storePath,
    tables: TABLES,
  });
}

/** Open the index file as a search target, closed after the test. */
function openIndex(): SearchTarget {
  const index = openWithVector(indexPath, { open: { readonly: true }, state: createLoaderState() });
  opened.push(index.database);
  return { database: index.database, embedder: FIXTURE_EMBEDDER, vector: index.vector, why: index.why };
}

/** Search a target and answer the hits' keys, best first. */
async function keys(target: SearchTarget, request: IndexSearchRequest): Promise<readonly string[]> {
  return (await search(target, request)).hits.map(keyOf);
}

/** The store opened read-only, closed after the test. */
function openStore(path = storePath): Database {
  const store = new SqliteDatabase(path, { readonly: true });
  opened.push(store);
  return store;
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'rafa-index-integration-'));
  storePath = join(directory, 'store.db');
  indexPath = join(directory, 'index.db');
  opened = [];
  plantStore(storePath);
});

afterEach(() => {
  for (const database of opened) {
    database.close();
  }
  rmSync(directory, { force: true, recursive: true });
});

describe('rebuild', () => {
  it('indexes every store row with vectors and leaves the store file untouched', async () => {
    const before = sha256(storePath);

    const result = await rebuild('one');

    expect(result.rows).toBe(5);
    expect(result.vectors).toBe(5);
    expect(result.vector).toBe(true);
    expect(sha256(storePath)).toBe(before);
    const target = openIndex();
    expect(readIndexMeta(target.database)).toEqual({ dimension: DIMENSION, project: PROJECT, stamp: 'one' });
  });
});

describe('search over the rebuilt index', () => {
  it('answers fts hits as table, origin pair and score, never a body', async () => {
    await rebuild('one');

    const { hits } = await search(openIndex(), { limit: 10, mode: 'fts', query: 'parser' });

    expect(sorted(hits.map(keyOf))).toEqual(sorted([BUG_3, TASK_1, TASK_2]));
    for (const hit of hits) {
      expect(sorted(Object.keys(hit))).toEqual(['origin', 'score', 'table']);
      expect(hit.score).toBeGreaterThan(0);
    }
    expect(scores(hits)).toEqual([...scores(hits)].sort((a, b) => b - a));
  });

  it('finds a word of a row\'s second text column and nothing for an absent word', async () => {
    await rebuild('one');
    const target = openIndex();

    expect(await keys(target, { mode: 'fts', query: 'friday' })).toEqual([TASK_3]);
    expect(await keys(target, { mode: 'fts', query: 'absent' })).toEqual([]);
  });

  it('answers the nearest row first in vector mode, with a cosine score of one for an identical vector', async () => {
    await rebuild('one');
    const target = openIndex();

    const { hits } = await search(target, { limit: 1, mode: 'vector', query: 'parser' });

    expect(hits.map(keyOf)).toEqual([TASK_1]);
    expect(hits[0]?.score).toBeCloseTo(1, 5);
    expect(sorted(await keys(target, { limit: 3, mode: 'vector', query: 'parser' })))
      .toEqual(sorted([BUG_3, TASK_1, TASK_2]));
  });

  it('ranks rows found by both searches above rows only the vector search finds', async () => {
    await rebuild('one');

    const { hits } = await search(openIndex(), { limit: 5, mode: 'hybrid', query: 'parser' });

    const found = hits.map(keyOf);
    expect(sorted(found.slice(0, 3))).toEqual(sorted([BUG_3, TASK_1, TASK_2]));
    expect(found.slice(3)).toEqual([BUG_8, TASK_3]);
    expect(scores(hits)).toEqual([...scores(hits)].sort((a, b) => b - a));
    expect(hits[2]?.score).toBeGreaterThan(hits[3]?.score ?? Infinity);
  });

  it('refuses a vector request naming fts when the target answers vector off', async () => {
    await rebuild('one');
    const target = { ...openIndex(), vector: false, why: 'no extension' };

    await expect(search(target, { mode: 'hybrid', query: 'parser' })).rejects.toThrow('fts');
    expect(await keys(target, { mode: 'fts', query: 'parser' })).toHaveLength(3);
  });
});

describe('a search run while a rebuild is in flight', () => {
  it('answers the full old index from the beforeSwap hook, then the new one after the swap', async () => {
    await rebuild('one');
    const before = sha256(indexPath);
    const old = await keys(openIndex(), { limit: 5, mode: 'hybrid', query: 'lexer' });
    addTask();
    const seen: { parallel: boolean; stamp: string | undefined; hybrid: readonly string[]; fts: readonly string[] }[] = [];

    await rebuild('two', async (parallelPath) => {
      const target = openIndex();
      seen.push({
        fts: await keys(target, { mode: 'fts', query: 'lexer' }),
        hybrid: await keys(target, { limit: 5, mode: 'hybrid', query: 'lexer' }),
        parallel: existsSync(parallelPath),
        stamp: readIndexMeta(target.database)?.stamp,
      });
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]?.stamp).toBe('one');
    expect(seen[0]?.parallel).toBe(true);
    expect(seen[0]?.hybrid).toEqual(old);
    expect(seen[0]?.hybrid).not.toContain(TASK_9);
    expect(sorted(seen[0]?.fts ?? [])).toEqual(sorted([BUG_8, TASK_3]));
    const fresh = openIndex();
    expect(readIndexMeta(fresh.database)?.stamp).toBe('two');
    expect(sorted(await keys(fresh, { mode: 'fts', query: 'lexer' }))).toEqual(sorted([BUG_8, TASK_3, TASK_9]));
    expect(sha256(indexPath)).not.toBe(before);
  });

  it('leaves a reader opened before the swap on the old file and no parallel file behind', async () => {
    await rebuild('one');
    const reader = openIndex();
    addTask();

    await rebuild('two');

    expect(await keys(reader, { mode: 'fts', query: 'lexer' })).toHaveLength(2);
    expect(readIndexMeta(reader.database)?.stamp).toBe('one');
    expect(existsSync(parallelIndexPath(indexPath, 'two'))).toBe(false);
    expect(await keys(openIndex(), { mode: 'fts', query: 'lexer' })).toHaveLength(3);
  });
});

describe('links over the store', () => {
  it('answers one hop at the default depth', async () => {
    const result = await links({ database: openStore() }, { id: 'abc123', kind: 'commit' });

    expect(result).toEqual({ graph: true, links: [{ depth: 1, id: '#1', kind: 'issue' }] });
  });

  it('answers two hops nearest first, each node once and never the start node through the cycle', async () => {
    const result = await links({ database: openStore() }, { depth: 2, id: 'abc123', kind: 'commit' });

    expect(result.graph).toBe(true);
    expect(result.links).toEqual([
      { depth: 1, id: '#1', kind: 'issue' },
      { depth: 2, id: '#2', kind: 'pr' },
    ]);
  });

  it('reaches the third hop only when the depth allows it, the cycle ending the walk', async () => {
    const result = await links({ database: openStore() }, { depth: 3, id: 'abc123', kind: 'commit' });

    expect(result.links.map((link) => `${link.kind}:${link.id}@${String(link.depth)}`)).toEqual([
      'issue:#1@1',
      'pr:#2@2',
      'issue:#3@3',
    ]);
  });

  it('answers graph false with no links for a store holding no ref_links table', async () => {
    const bare = join(directory, 'bare.db');
    const store = new SqliteDatabase(bare);
    store.run('CREATE TABLE tasks (seq INTEGER PRIMARY KEY)');
    store.close();

    const result = await links({ database: openStore(bare) }, { depth: 2, id: 'abc123', kind: 'commit' });

    expect(result).toEqual({ graph: false, links: [] });
  });
});
