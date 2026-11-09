/**
 * The `sqlite` connector's index half (`sqlite-index.ts`), opened through
 * `connectSqliteHub` in `sqlite.ts`: refusals first, a vector search
 * naming `fts` while vector search is off, under either reason, then what
 * the half answers. That covers the index file attached on open,
 * capabilities from the loader, the embedder and `ref_links`, and the
 * file attached again after a rebuild or a push renames a new one in.
 *
 * Stores are made under the temporary directory, as the contract suite
 * makes them: the connector creates its own, and a push carries a commit
 * built from a real export. A `ref_links` table is planted in the store
 * file with `bun:sqlite`, with the four columns the walk reads, since no
 * migration holds it yet (#1436). The loader runs on a state of the
 * test's own, so no other file's opens reach its answer. The embedder is
 * a fixture that counts two letters, so no model runs.
 */
import type { HubConnector, HubIndex, HubStore, IndexSearchHit } from './port.js';
import type { CommitEffortRow, WirePayload, WireRow } from '@open-tomato/rafa/store';
import type { IndexEmbedder, PrepareOptions } from '@open-tomato/rafa-index';

import { copyFileSync, existsSync, mkdtempSync, readdirSync, realpathSync, renameSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { decodeWirePayload, exportWirePayload, openSqliteStore, WIRE_FORMAT, WIRE_VERSION } from '@open-tomato/rafa/store';
import { createLoaderState } from '@open-tomato/rafa-index/loader';
import { Database } from 'bun:sqlite';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';

import { DEFAULT_STORE_FILE } from '../config.js';

import { compiledWith, INDEX_SCHEMA } from './sqlite-index.js';
import { connectSqliteHub, indexFileName, openSqliteHubStore } from './sqlite.js';

const A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const T0 = '2026-11-09T10:00:00.000Z';
const PROJECT = 'fixture-project';

/** The connector as the port types it, so the case below fails to compile if it stops fitting. */
const CONNECTOR: HubConnector = connectSqliteHub;

/** A fixture embedder: the count of `a` and of `b` in the text, then a constant one. */
const FIXTURE_EMBEDDER: IndexEmbedder = {
  dimension: 3,
  embed: (texts) => Promise.resolve(texts.map((text) => new Float32Array([
    [...text].filter((letter) => letter === 'a').length,
    [...text].filter((letter) => letter === 'b').length,
    1,
  ]))),
};

/** A commit row from a real export, its key and origin pair set by the case. */
let template: { readonly migrations: readonly string[]; readonly commit: WireRow } | undefined;

function readTemplate(): NonNullable<typeof template> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-hub-index-template-')));
  try {
    const store = openSqliteStore(root);
    store.append('commits', [{ sha: 'f'.repeat(40), timestamp: T0 } as CommitEffortRow]);
    const exported = exportWirePayload({ path: store.path('commits') });
    const commit = exported.tables['commits']?.[0];
    if (commit === undefined) throw new Error('the template export holds no commit');
    return { migrations: exported.migrations, commit };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function held(): NonNullable<typeof template> {
  if (template === undefined) throw new Error('the template was not read');
  return template;
}

/** The sha of the commit `origin` created as its `originSeq`th row. */
function shaOf(origin: string, originSeq: number): string {
  return new Bun.CryptoHasher('sha1')
    .update(`${origin}:${String(originSeq)}`)
    .digest('hex');
}

/** A payload of one commit created by `origin` as its `originSeq`th row. */
function payload(origin: string, originSeq: number): WirePayload {
  const sha = shaOf(origin, originSeq);
  const commit = { ...held().commit, seq: originSeq, sha, row_json: JSON.stringify({ sha, timestamp: T0 }), origin_store: origin, origin_seq: originSeq };
  const built = { format: WIRE_FORMAT, version: WIRE_VERSION, migrations: held().migrations, tables: { commits: [commit] }, cursor: { commits: originSeq } };
  return decodeWirePayload(JSON.stringify(built));
}

/** A hit's key as one string: `table:store/seq`. */
function keyOf(hit: IndexSearchHit): string {
  return `${hit.table}:${hit.origin.originStore}/${String(hit.origin.originSeq)}`;
}

/** A file's device and inode, as one string. */
function inodeOf(path: string): string {
  const stats = statSync(path);
  return `${String(stats.dev)}:${String(stats.ino)}`;
}

/** What a rejected call rejected with, as a message. */
async function refusal(work: Promise<unknown>): Promise<string> {
  const error = await work.then(() => null, (thrown: unknown) => thrown);
  if (!(error instanceof Error)) throw new Error('the call did not reject');
  return error.message;
}

describe('the sqlite connector\'s index half', () => {
  let directory = '';
  let storePath = '';
  let indexPath = '';
  let opened: HubStore[] = [];

  /** Opens the connector over the test's directory, its store closed after the test. */
  const connect = async (options: { embedder?: IndexEmbedder; loader?: PrepareOptions } = {}): Promise<{ store: HubStore; index: HubIndex }> => {
    const hub = await connectSqliteHub(
      { directory, now: () => new Date(T0) },
      { embedder: options.embedder, loader: { state: createLoaderState(), ...options.loader }, project: PROJECT },
    );
    opened.push(hub.store);
    return hub;
  };

  /** Plants a `ref_links` table in the store file holding the links given. */
  const plantLinks = (path: string, links: readonly (readonly [string, string, string, string])[]): void => {
    const store = new Database(path);
    try {
      store.run('CREATE TABLE IF NOT EXISTS ref_links (from_kind TEXT NOT NULL, from_id TEXT NOT NULL, role TEXT NOT NULL, ref_kind TEXT NOT NULL, ref_text TEXT NOT NULL)');
      for (const [fromKind, fromId, refKind, refText] of links) {
        store.run('INSERT INTO ref_links VALUES (?, ?, \'mentions\', ?, ?)', [fromKind, fromId, refKind, refText]);
      }
    } finally {
      store.close();
    }
  };

  /** Makes the store file through the plain store and closes it, so a case can plant in it before connecting. */
  const makeStore = async (): Promise<void> => {
    await openSqliteHubStore({ directory, now: () => new Date(T0) }).close();
  };

  beforeAll(() => {
    template = readTemplate();
  });
  beforeEach(() => {
    directory = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-hub-sqlite-index-')));
    storePath = join(directory, DEFAULT_STORE_FILE);
    indexPath = join(directory, indexFileName(DEFAULT_STORE_FILE));
  });
  afterEach(async () => {
    await Promise.all(opened.map((store) => store.close()));
    opened = [];
    rmSync(directory, { recursive: true, force: true });
  });

  describe('vector search off', () => {
    it('refuses a vector and a hybrid search naming fts when no embedder is given', async () => {
      const { index } = await connect();

      const vector = await refusal(index.search({ mode: 'vector', query: 'parser' }));
      const hybrid = await refusal(index.search({ mode: 'hybrid', query: 'parser' }));

      expect(index.capabilities().vector).toBe(false);
      expect(vector).toContain('\'fts\'');
      expect(vector).toContain('no embedder configured');
      expect(hybrid).toContain('\'fts\'');
    });

    it('refuses a vector search naming fts and the loader\'s why when the loader answers false, an embedder given', async () => {
      const { index } = await connect({ embedder: FIXTURE_EMBEDDER, loader: { library: null, platform: 'darwin' } });

      const vector = await refusal(index.search({ mode: 'vector', query: 'parser' }));

      expect(index.capabilities().vector).toBe(false);
      expect(vector).toContain('\'fts\'');
      expect(vector).toContain('no SQLite library is named');
    });

    it('refuses a vector-scoped rebuild naming fts, writing nothing', async () => {
      const { index } = await connect();
      const before = inodeOf(indexPath);

      const refused = await refusal(index.rebuild({ project: PROJECT, scope: 'vector' }));

      expect(refused).toContain('\'fts\'');
      expect(inodeOf(indexPath)).toBe(before);
    });

    it('answers the same searches in fts mode, as the control', async () => {
      const { index } = await connect();

      const answered = await index.search({ mode: 'fts', query: 'parser' });

      expect(answered.hits).toEqual([]);
    });
  });

  describe('a call it cannot answer', () => {
    it('refuses a search once the index file is gone, naming the rebuild, and a rebuild brings it back', async () => {
      const { index } = await connect();
      rmSync(indexPath);

      const refused = await refusal(index.search({ mode: 'fts', query: 'parser' }));
      const rebuilt = await index.rebuild({ project: PROJECT });
      const answered = await index.search({ mode: 'fts', query: 'parser' });

      expect(refused).toContain(indexPath);
      expect(refused).toContain('rebuild');
      expect(rebuilt.project).toBe(PROJECT);
      expect(answered.hits).toEqual([]);
    });

    it('refuses every call once its store is closed', async () => {
      const { index, store } = await connect();
      await store.close();
      opened = [];

      const refused = await Promise.all([
        refusal(index.search({ mode: 'fts', query: 'parser' })),
        refusal(index.links({ id: '#1', kind: 'issue' })),
        refusal(index.rebuild({ project: PROJECT })),
      ]);

      expect(refused.every((message) => message.includes('closed'))).toBe(true);
    });
  });

  describe('the FTS5 probe', () => {
    it('answers false for a compile option the engine was not built with, and true for FTS5', () => {
      const database = new Database(':memory:');
      try {
        expect(compiledWith(database, 'OMIT_FIXTURE_NEVER_COMPILED')).toBe(false);
        expect(compiledWith(database, 'ENABLE_FTS5')).toBe(true);
      } finally {
        database.close();
      }
    });
  });

  describe('its file', () => {
    it('names the index file from the store file it is given', () => {
      expect(indexFileName('team.sqlite')).toBe('team.index.sqlite');
      expect(indexFileName(DEFAULT_STORE_FILE)).toBe('rafa-hub.index.sqlite');
    });

    it('builds <store>.index.sqlite on open from the rows the store held, and attaches it', async () => {
      const plain = openSqliteHubStore({ directory, now: () => new Date(T0) });
      await plain.push({ device: A, payload: payload(A, 1) });
      await plain.close();
      expect(existsSync(indexPath)).toBe(false);

      const { index } = await CONNECTOR({ directory, now: () => new Date(T0) }).then((hub) => {
        opened.push(hub.store);
        return hub;
      });
      const found = await index.search({ mode: 'fts', query: shaOf(A, 1) });
      const missing = await index.search({ mode: 'fts', query: shaOf(A, 2) });

      expect(readdirSync(directory)).toContain(indexFileName(DEFAULT_STORE_FILE));
      expect(found.hits.map(keyOf)).toEqual([`commits:${A}/1`]);
      expect(missing.hits).toEqual([]);
    });

    it('attaches an index file already there without rebuilding it', async () => {
      const first = await connect();
      await first.store.close();
      opened = [];
      const before = inodeOf(indexPath);

      await connect();

      expect(inodeOf(indexPath)).toBe(before);
      expect(INDEX_SCHEMA).toBe('hub_index');
    });
  });

  describe('capabilities', () => {
    it('answers fts and vector from the loader and the embedder, graph false with no ref_links, projection false', async () => {
      const { index, store } = await connect({ embedder: FIXTURE_EMBEDDER });

      const capabilities = index.capabilities();

      expect(capabilities).toEqual({ fts: true, graph: false, projection: false, vector: true });
      expect(Object.isFrozen(capabilities)).toBe(true);
      expect(store.contract().capabilities).toEqual(capabilities);
    });

    it('answers every capability false from the plain store, as the control', async () => {
      const plain = openSqliteHubStore({ directory, now: () => new Date(T0) });
      opened.push(plain);

      expect(plain.contract().capabilities).toEqual({ fts: false, graph: false, projection: false, vector: false });
    });

    it('answers graph true over a store holding ref_links, and walks it', async () => {
      await makeStore();
      plantLinks(storePath, [['commit', 'abc123', 'issue', '#1'], ['issue', '#1', 'pr', '#2']]);

      const { index } = await connect();
      const walked = await index.links({ depth: 2, id: 'abc123', kind: 'commit' });

      expect(index.capabilities().graph).toBe(true);
      expect(walked).toEqual({ graph: true, links: [{ depth: 1, id: '#1', kind: 'issue' }, { depth: 2, id: '#2', kind: 'pr' }] });
    });
  });

  describe('attaching again', () => {
    it('attaches the index again after a rebuild renames a new file in, a push having swapped the store first', async () => {
      const { index, store } = await connect({ embedder: FIXTURE_EMBEDDER });
      const storeBefore = inodeOf(storePath);
      const indexBefore = inodeOf(indexPath);

      await store.push({ device: A, payload: payload(A, 1) });
      const beforeRebuild = await index.search({ mode: 'fts', query: shaOf(A, 1) });
      const rebuilt = await index.rebuild({ project: PROJECT });
      const byText = await index.search({ mode: 'fts', query: shaOf(A, 1) });
      const byVector = await index.search({ mode: 'vector', query: 'a' });

      expect(inodeOf(storePath)).not.toBe(storeBefore);
      expect(beforeRebuild.hits).toEqual([]);
      expect([rebuilt.rows, rebuilt.vectors, rebuilt.vector, rebuilt.why]).toEqual([1, 1, true, null]);
      expect(inodeOf(indexPath)).not.toBe(indexBefore);
      expect(byText.hits.map(keyOf)).toEqual([`commits:${A}/1`]);
      expect(byVector.hits.map(keyOf)).toEqual([`commits:${A}/1`]);
      expect(Object.keys(byVector.hits[0] ?? {}).sort()).toEqual(['origin', 'score', 'table']);
    });

    it('attaches the store again after a new store file is renamed over it, as a merge does', async () => {
      await makeStore();
      plantLinks(storePath, [['commit', 'abc123', 'issue', '#1']]);
      const { index } = await connect();
      const before = await index.links({ id: 'abc123', kind: 'commit' });
      const storeBefore = inodeOf(storePath);
      const next = join(directory, 'next.sqlite');
      copyFileSync(storePath, next);
      plantLinks(next, [['commit', 'abc123', 'issue', '#7']]);

      renameSync(next, storePath);
      const after = await index.links({ id: 'abc123', kind: 'commit' });

      expect(inodeOf(storePath)).not.toBe(storeBefore);
      expect(before.links.map((link) => link.id)).toEqual(['#1']);
      expect(after.links.map((link) => link.id)).toEqual(['#1', '#7']);
    });
  });
});
