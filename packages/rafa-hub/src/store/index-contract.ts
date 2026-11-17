/**
 * The hub index port's contract suite: the cases every {@link HubIndex}
 * a connector opens passes, exported as one function a test calls with a
 * name, a connector and options, as `contract.ts` does for the rows. A
 * connector written outside this package (Postgres, Dolt) runs exactly
 * the cases the SQLite one does.
 *
 * ```ts
 * import { hubIndexContract, INDEX_CONTRACT_EMBEDDER } from './index-contract.js';
 *
 * // `connectSomeHub` stands for any connector, taking the setup the suite hands it.
 * hubIndexContract('some', connectSomeHub, { embedder: INDEX_CONTRACT_EMBEDDER, files });
 * hubIndexContract('some, extension off', connectSomeHub, { embedder: INDEX_CONTRACT_EMBEDDER, files, holdExtensionOff: true });
 * ```
 *
 * ## What it covers
 *
 *   - **rebuild**: the rows read, one full-text row each, the vector rows
 *     the capability allows, the project recorded, a new stamp each time.
 *   - **`fts` search**: a word finds the rows holding it across tables,
 *     the limit holds, operators and quotes are plain words.
 *   - **`vector` and `hybrid` search, under both capability answers**: a
 *     run made without `holdExtensionOff` holds that `vector` is `true`
 *     and both modes answer; a run made with it holds that `vector` is
 *     `false`, that both modes are refused with a message naming `fts`,
 *     and that `fts` still answers. One runner, called twice, covers both.
 *   - **`links`** over a `ref_links` table planted in the store, and over
 *     a store holding none.
 *   - **A rebuild beside a push**: the store file's sha256 is the one the
 *     push left, whatever the rebuild did, and the index file is a new
 *     one, since a rebuild builds a file beside the index and swaps it in.
 *   - **A second push** keeps the index attached and answering.
 *   - **What a search answers**: a table, an origin pair and a score per
 *     hit, in frozen records, and no row body.
 *
 * ## What it is handed
 *
 * The connector is called as `connector(context, setup)`: the port's
 * `HubStoreContext`, then the {@link HubIndexSetup} the run's options
 * name, the embedder to embed with and whether the vector extension is
 * to be held off. A connector that cannot be told is handed the setup
 * and ignores it, so only the run that holds nothing off can pass it.
 * The options also name the store file and the index file in the
 * directory ({@link HubIndexFiles}), which the file cases hash and
 * `stat`, and in whose store file the `ref_links` table is planted.
 *
 * ## The pushes it makes
 *
 * Real ones, as `contract.ts` builds them (`readTemplate` and `builders`
 * from it): a store is made under the temporary directory through
 * `@open-tomato/rafa/store`, exported, and every row is a copy of the
 * export's row with its key, `row_json` and origin pair set by the
 * case, then passed through `decodeWirePayload`. The `row_json` of each
 * row carries a word a search looks for, since a row's text columns are
 * what the index holds.
 *
 * ## Each case's world
 *
 * A fresh directory under the temporary directory and a clock per case,
 * the connector's store closed and the directory removed after it,
 * whatever the case did.
 */
import type { WireTemplate } from './contract.js';
import type { HubConnector, HubIndex, HubStore, HubStoreContext, IndexSearchHit } from './port.js';
import type { WireRow, WirePayload } from '@open-tomato/rafa/store';
import type { IndexEmbedder } from '@open-tomato/rafa-index';

import { mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';

import { builders, readTemplate } from './contract.js';

/** The two devices a case pushes as, each named by its store origin. */
const A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const B = 'bbbbbbbb-0000-4000-8000-00000000000b';

/** The clock every case's connector reads. */
const T0 = '2026-11-09T10:00:00.000Z';

/** The project every rebuild records. */
const PROJECT = 'index-contract-project';

/** The tables the suite fills. */
const COMMITS = 'commits';
const SESSIONS = 'sessions';

/** The words the rows carry, and the one no row holds. */
const PARSER = 'parser';
const CACHE = 'cache';
const ABSENT = 'zzzabsent';

/** The keys a hit, its origin and a search answer hold, and nothing else. */
const HIT_KEYS: readonly string[] = ['origin', 'score', 'table'];
const ORIGIN_KEYS: readonly string[] = ['originSeq', 'originStore'];
const RESULT_KEYS: readonly string[] = ['hits'];

/**
 * The fixture embedder the suite's options are given: the count of `a`
 * and of `b` in a text, then a constant one, so no vector is zero and no
 * model runs.
 */
export const INDEX_CONTRACT_EMBEDDER: IndexEmbedder = {
  dimension: 3,
  embed: (texts) => Promise.resolve(texts.map((text) => new Float32Array([
    [...text].filter((letter) => letter === 'a').length,
    [...text].filter((letter) => letter === 'b').length,
    1,
  ]))),
};

/** The names of the two files a connector keeps in a case's directory. */
export interface HubIndexFiles {
  /** The store file's name, whose bytes a rebuild must leave as they were. */
  readonly store: string;
  /** The index file's name, which a rebuild replaces with a new file. */
  readonly index: string;
}

/** What a run is configured with. */
export interface HubIndexContractOptions {
  /** The embedder vector search embeds with; {@link INDEX_CONTRACT_EMBEDDER} is the fixture. */
  readonly embedder: IndexEmbedder;
  /** The files the connector keeps in the case's directory. */
  readonly files: HubIndexFiles;
  /** Whether the vector extension is held off, so `vector` is `false` though an embedder is given. */
  readonly holdExtensionOff?: boolean;
}

/** What the connector is handed beside the context. */
export interface HubIndexSetup {
  /** The embedder to embed with. */
  readonly embedder: IndexEmbedder;
  /** Whether the vector extension is to be held off. */
  readonly holdExtensionOff: boolean;
}

/** A connector the suite can tell what to embed with and whether to hold the extension off. */
export type HubIndexConnector = (context: HubStoreContext, setup: HubIndexSetup) => ReturnType<HubConnector>;

/** The store and index one case opened. */
interface Connected {
  readonly store: HubStore;
  readonly index: HubIndex;
}

/** `row` with `text` added to its `row_json` under `key`, its other keys kept. */
function withText(row: WireRow, key: string, text: string): WireRow {
  const rowJson = row['row_json'];
  const parsed = typeof rowJson === 'string'
    ? JSON.parse(rowJson) as Record<string, unknown>
    : {};
  return { ...row, row_json: JSON.stringify({ ...parsed, [key]: text }) };
}

/** A hit's key as one string: `table:store/seq`. */
function keyOf(hit: IndexSearchHit): string {
  return `${hit.table}:${hit.origin.originStore}/${String(hit.origin.originSeq)}`;
}

/** The keys of `hits`, sorted. */
function keysOf(hits: readonly IndexSearchHit[]): string[] {
  return hits.map(keyOf).sort();
}

/** A file's device and inode, as one string. */
function inodeOf(path: string): string {
  const stats = statSync(path);
  return `${String(stats.dev)}:${String(stats.ino)}`;
}

/** The sha256 of a file's bytes. */
function sha256Of(path: string): string {
  return new Bun.CryptoHasher('sha256')
    .update(readFileSync(path))
    .digest('hex');
}

/** What a rejected call rejected with, as a message. */
async function refusal(work: Promise<unknown>): Promise<string> {
  const error = await work.then(() => null, (thrown: unknown) => thrown);
  if (!(error instanceof Error)) throw new Error('hub index contract: the call did not reject');
  return error.message;
}

/** Plants a `ref_links` table in the store file, holding the links given: from kind and id, then ref kind and text. */
function plantRefLinks(path: string, links: readonly (readonly [string, string, string, string])[]): void {
  const database = new Database(path);
  try {
    database.run('CREATE TABLE IF NOT EXISTS ref_links (from_kind TEXT NOT NULL, from_id TEXT NOT NULL, role TEXT NOT NULL, ref_kind TEXT NOT NULL, ref_text TEXT NOT NULL)');
    for (const [fromKind, fromId, refKind, refText] of links) {
      database.run('INSERT INTO ref_links VALUES (?, ?, \'mentions\', ?, ?)', [fromKind, fromId, refKind, refText]);
    }
  } finally {
    database.close();
  }
}

/** Whether `value` is a plain record whose own keys are exactly `keys`, frozen. */
function frozenWithKeys(value: object, keys: readonly string[]): boolean {
  return Object.isFrozen(value) && Object.keys(value).sort()
    .join() === [...keys].sort().join();
}

/** Whether a search answer holds nothing but frozen (table, origin pair, score) records. */
function holdsOnlyReferences(answer: { readonly hits: readonly IndexSearchHit[] }): boolean {
  return frozenWithKeys(answer, RESULT_KEYS)
    && Object.isFrozen(answer.hits)
    && answer.hits.every((hit) => frozenWithKeys(hit, HIT_KEYS)
      && frozenWithKeys(hit.origin, ORIGIN_KEYS)
      && typeof hit.table === 'string'
      && typeof hit.origin.originStore === 'string'
      && Number.isInteger(hit.origin.originSeq)
      && typeof hit.score === 'number'
      && Number.isFinite(hit.score));
}

/**
 * Registers the contract's cases for one connector, under a `describe`
 * naming it. Call it from a test file, once per connector and once more
 * with `holdExtensionOff` for the vector answer that is `false`.
 */
export function hubIndexContract(name: string, connector: HubIndexConnector, options: HubIndexContractOptions): void {
  const { embedder, files } = options;
  const holdExtensionOff = options.holdExtensionOff === true;
  const setup: HubIndexSetup = { embedder, holdExtensionOff };

  describe(`the hub index contract: ${name}`, () => {
    let template: WireTemplate | undefined;
    let directory = '';
    let opened: HubStore[] = [];
    const { commit, payload, session } = builders(() => {
      if (template === undefined) throw new Error('hub index contract: the template was not read');
      return template;
    });
    const storePath = (): string => join(directory, files.store);
    const indexPath = (): string => join(directory, files.index);

    /** The rows a push carries: two commits and a session, each holding a word a search looks for. */
    const rows = (origin: string, first: number): Readonly<Record<string, readonly WireRow[]>> => ({
      [COMMITS]: [
        withText(commit(origin, first), 'subject', `${PARSER} rewrite`),
        withText(commit(origin, first + 1), 'subject', `${CACHE} eviction`),
      ],
      [SESSIONS]: [withText(session(origin, first + 2), 'topic', `${PARSER} notes`)],
    });

    /** A payload of {@link rows} created by `origin`. */
    const pushOf = (origin: string, first = 1): WirePayload => payload(rows(origin, first));

    /** The key of the row `origin` created as its `originSeq`th, in `table`. */
    const key = (table: string, origin: string, originSeq: number): string => `${table}:${origin}/${String(originSeq)}`;

    /** Opens the connector over the case's directory, its store closed after the case. */
    const connect = async (): Promise<Connected> => {
      const hub = await connector({ directory, now: () => new Date(T0) }, setup);
      opened.push(hub.store);
      return hub;
    };

    /** Opens the connector, pushes `first`'s rows as A and rebuilds, so a search finds them. */
    const connectWithRows = async (): Promise<Connected> => {
      const hub = await connect();
      await hub.store.push({ device: A, payload: pushOf(A) });
      await hub.index.rebuild({ project: PROJECT });
      return hub;
    };

    /** Opens the connector once, closes it, plants links in the store file, and opens it again. */
    const connectWithLinks = async (links: readonly (readonly [string, string, string, string])[]): Promise<Connected> => {
      const first = await connect();
      await first.store.close();
      opened = [];
      plantRefLinks(storePath(), links);
      return connect();
    };

    beforeAll(() => {
      template = readTemplate();
    });
    beforeEach(() => {
      directory = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-hub-index-contract-')));
    });
    afterEach(async () => {
      const stores = opened;
      opened = [];
      try {
        await Promise.all(stores.map((store) => store.close()));
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    });

    describe('capabilities', () => {
      it('answers fts true and projection false, frozen, as measured at open', async () => {
        const { index } = await connect();

        const capabilities = index.capabilities();

        expect(capabilities.fts).toBe(true);
        expect(capabilities.projection).toBe(false);
        expect(Object.isFrozen(capabilities)).toBe(true);
        expect(Object.keys(capabilities).sort()).toEqual(['fts', 'graph', 'projection', 'vector']);
      });

      it('answers the store\'s contract the index\'s capabilities', async () => {
        const { index, store } = await connect();

        expect(store.contract().capabilities).toEqual(index.capabilities());
      });

      it('answers graph false over a store holding no ref_links, and true over one holding it', async () => {
        const without = await connect();
        const withLinks = await connectWithLinks([['commit', 'abc123', 'issue', '#1']]);

        expect(without.index.capabilities().graph).toBe(false);
        expect(withLinks.index.capabilities().graph).toBe(true);
      });
    });

    describe('rebuild', () => {
      it('answers the project, a stamp and the rows it read, one full-text row each', async () => {
        const { index, store } = await connect();
        await store.push({ device: A, payload: pushOf(A) });

        const rebuilt = await index.rebuild({ project: PROJECT });

        expect(rebuilt.project).toBe(PROJECT);
        expect(rebuilt.stamp.length).toBeGreaterThan(0);
        expect(rebuilt.rows).toBe(3);
        expect(rebuilt.tables.length).toBeGreaterThan(0);
        expect(Object.isFrozen(rebuilt)).toBe(true);
        expect(Object.isFrozen(rebuilt.tables)).toBe(true);
      });

      it('reads no row from a store holding none', async () => {
        const { index } = await connect();

        const rebuilt = await index.rebuild({ project: PROJECT });

        expect([rebuilt.rows, rebuilt.vectors]).toEqual([0, 0]);
      });

      it('answers a new stamp each time it is run', async () => {
        const { index } = await connectWithRows();

        const first = await index.rebuild({ project: PROJECT });
        const second = await index.rebuild({ project: PROJECT });

        expect(second.stamp).not.toBe(first.stamp);
        expect(second.rows).toBe(first.rows);
      });

      it('finds the rows a push added once the index is rebuilt', async () => {
        const { index, store } = await connectWithRows();
        await store.push({ device: B, payload: pushOf(B, 1) });

        await index.rebuild({ project: PROJECT });
        const found = await index.search({ mode: 'fts', query: CACHE });

        expect(keysOf(found.hits)).toEqual([key(COMMITS, A, 2), key(COMMITS, B, 2)]);
      });
    });

    describe('fts search', () => {
      it('finds every row holding a word, across tables, as references', async () => {
        const { index } = await connectWithRows();

        const found = await index.search({ mode: 'fts', query: PARSER });

        expect(keysOf(found.hits)).toEqual([key(COMMITS, A, 1), key(SESSIONS, A, 3)]);
      });

      it('answers no hit for a word no row holds', async () => {
        const { index } = await connectWithRows();

        const found = await index.search({ mode: 'fts', query: ABSENT });

        expect(found.hits).toEqual([]);
      });

      it('answers best first, a higher score first, and at most the limit', async () => {
        const { index } = await connectWithRows();

        const all = await index.search({ mode: 'fts', query: PARSER });
        const one = await index.search({ limit: 1, mode: 'fts', query: PARSER });

        expect(all.hits.length).toBe(2);
        expect(all.hits[0]?.score ?? 0).toBeGreaterThanOrEqual(all.hits[1]?.score ?? 0);
        expect(one.hits.map(keyOf)).toEqual(all.hits.slice(0, 1).map(keyOf));
      });

      it('requires every word of a query, and reads an operator as a word', async () => {
        const { index } = await connectWithRows();

        const both = await index.search({ mode: 'fts', query: `${PARSER} rewrite` });
        const mismatched = await index.search({ mode: 'fts', query: `${PARSER} eviction` });
        const operator = await index.search({ mode: 'fts', query: `${PARSER} OR ${CACHE}` });

        expect(both.hits.map(keyOf)).toEqual([key(COMMITS, A, 1)]);
        expect(mismatched.hits).toEqual([]);
        expect(operator.hits).toEqual([]);
      });

      it('answers quotes, wildcards and emoji as plain words, never as a failure', async () => {
        const { index } = await connectWithRows();

        const answers = await Promise.all(['"', `${PARSER}" OR ${CACHE}"`, '* NEAR(', '🙂', '\'; DROP TABLE commits; --']
          .map((query) => index.search({ mode: 'fts', query })));

        expect(answers.map((answer) => answer.hits)).toEqual([[], [], [], [], []]);
      });

      it('refuses an empty query and a limit that is no whole number above zero', async () => {
        const { index } = await connectWithRows();

        const refused = await Promise.all([
          refusal(index.search({ mode: 'fts', query: '  ' })),
          refusal(index.search({ limit: 0, mode: 'fts', query: PARSER })),
          refusal(index.search({ limit: 1.5, mode: 'fts', query: PARSER })),
        ]);

        expect(refused.every((message) => message.length > 0)).toBe(true);
      });
    });

    if (holdExtensionOff) {
      describe('vector search off', () => {
        it('answers vector false though an embedder was given', async () => {
          const { index } = await connect();

          expect(index.capabilities().vector).toBe(false);
        });

        it('refuses a vector search naming fts', async () => {
          const { index } = await connectWithRows();

          const refused = await refusal(index.search({ mode: 'vector', query: PARSER }));

          expect(refused).toContain('fts');
        });

        it('refuses a hybrid search naming fts', async () => {
          const { index } = await connectWithRows();

          const refused = await refusal(index.search({ mode: 'hybrid', query: PARSER }));

          expect(refused).toContain('fts');
        });

        it('answers the same query in fts mode, as the control', async () => {
          const { index } = await connectWithRows();

          const found = await index.search({ mode: 'fts', query: PARSER });

          expect(keysOf(found.hits)).toEqual([key(COMMITS, A, 1), key(SESSIONS, A, 3)]);
        });

        it('rebuilds with no vector row, answering why, and refuses a vector-scoped rebuild naming fts', async () => {
          const { index, store } = await connect();
          await store.push({ device: A, payload: pushOf(A) });
          const before = inodeOf(indexPath());

          const rebuilt = await index.rebuild({ project: PROJECT });
          const refused = await refusal(index.rebuild({ project: PROJECT, scope: 'vector' }));

          expect([rebuilt.rows, rebuilt.vectors, rebuilt.vector]).toEqual([3, 0, false]);
          expect(rebuilt.why).not.toBeNull();
          expect(refused).toContain('fts');
          expect(inodeOf(indexPath())).not.toBe(before);
        });
      });
    } else {
      describe('vector search on', () => {
        it('answers vector true, an embedder given and the extension loaded', async () => {
          const { index } = await connect();

          expect(index.capabilities().vector).toBe(true);
        });

        it('rebuilds one vector row per row read, answering no why', async () => {
          const { index, store } = await connect();
          await store.push({ device: A, payload: pushOf(A) });

          const rebuilt = await index.rebuild({ project: PROJECT });

          expect([rebuilt.rows, rebuilt.vectors, rebuilt.vector, rebuilt.why]).toEqual([3, 3, true, null]);
        });

        it('answers a vector search with every row, nearest first, a score of at most one', async () => {
          const { index } = await connectWithRows();

          const found = await index.search({ mode: 'vector', query: 'a' });

          expect(keysOf(found.hits)).toEqual([key(COMMITS, A, 1), key(COMMITS, A, 2), key(SESSIONS, A, 3)]);
          expect(found.hits.every((hit) => hit.score <= 1)).toBe(true);
          expect(found.hits.map((hit) => hit.score)).toEqual([...found.hits.map((hit) => hit.score)].sort((left, right) => right - left));
        });

        it('answers at most the limit of a vector search', async () => {
          const { index } = await connectWithRows();

          const found = await index.search({ limit: 2, mode: 'vector', query: 'a' });

          expect(found.hits.length).toBe(2);
        });

        it('answers a hybrid search ranking the rows both searches find first', async () => {
          const { index } = await connectWithRows();

          const found = await index.search({ mode: 'hybrid', query: CACHE });

          expect(found.hits.map(keyOf)[0]).toBe(key(COMMITS, A, 2));
          expect(keysOf(found.hits)).toEqual([key(COMMITS, A, 1), key(COMMITS, A, 2), key(SESSIONS, A, 3)]);
        });

        it('answers a hybrid search for a word no row holds from the vector half alone', async () => {
          const { index } = await connectWithRows();

          const found = await index.search({ mode: 'hybrid', query: ABSENT });

          expect(found.hits.length).toBeGreaterThan(0);
        });
      });
    }

    describe('links', () => {
      const LINKS: readonly (readonly [string, string, string, string])[] = [
        ['commit', 'abc123', 'issue', '#1'],
        ['issue', '#1', 'pr', '#2'],
        ['pr', '#2', 'issue', '#3'],
      ];

      it('walks one hop from a node when no depth is named', async () => {
        const { index } = await connectWithLinks(LINKS);

        const walked = await index.links({ id: 'abc123', kind: 'commit' });

        expect(walked).toEqual({ graph: true, links: [{ depth: 1, id: '#1', kind: 'issue' }] });
      });

      it('walks to the depth named, nearest first, each node once with its fewest hops', async () => {
        const { index } = await connectWithLinks(LINKS);

        const walked = await index.links({ depth: 3, id: 'abc123', kind: 'commit' });

        expect(walked.links).toEqual([
          { depth: 1, id: '#1', kind: 'issue' },
          { depth: 2, id: '#2', kind: 'pr' },
          { depth: 3, id: '#3', kind: 'issue' },
        ]);
      });

      it('answers no link from a node nothing links from', async () => {
        const { index } = await connectWithLinks(LINKS);

        const walked = await index.links({ depth: 3, id: 'unknown', kind: 'commit' });

        expect(walked).toEqual({ graph: true, links: [] });
      });

      it('answers graph false and no link over a store holding no ref_links', async () => {
        const { index } = await connect();

        const walked = await index.links({ id: 'abc123', kind: 'commit' });

        expect(walked).toEqual({ graph: false, links: [] });
      });

      it('answers frozen records holding only the kind, the id and the depth of each node', async () => {
        const { index } = await connectWithLinks(LINKS);

        const walked = await index.links({ depth: 2, id: 'abc123', kind: 'commit' });

        expect(Object.isFrozen(walked)).toBe(true);
        expect(Object.isFrozen(walked.links)).toBe(true);
        expect(walked.links.every((link) => frozenWithKeys(link, ['depth', 'id', 'kind']))).toBe(true);
      });

      it('refuses a start node with no id and a depth that is no whole number above zero', async () => {
        const { index } = await connectWithLinks(LINKS);

        const refused = await Promise.all([
          refusal(index.links({ id: '', kind: 'commit' })),
          refusal(index.links({ depth: 0, id: 'abc123', kind: 'commit' })),
        ]);

        expect(refused.every((message) => message.length > 0)).toBe(true);
      });
    });

    describe('a rebuild beside a push', () => {
      it('leaves the store file\'s sha256 as the push left it, and swaps a new index file in', async () => {
        const { index, store } = await connectWithRows();
        const indexBefore = inodeOf(indexPath());

        const pushing = store.push({ device: B, payload: pushOf(B) });
        const rebuilding = index.rebuild({ project: PROJECT });
        const pushed = await pushing;
        const storeAfterPush = sha256Of(storePath());
        const rebuilt = await rebuilding;

        expect(pushed.added).toBe(3);
        expect(rebuilt.project).toBe(PROJECT);
        expect(sha256Of(storePath())).toBe(storeAfterPush);
        expect(inodeOf(indexPath())).not.toBe(indexBefore);
      });

      it('leaves the store file\'s sha256 unchanged by a rebuild run alone', async () => {
        const { index } = await connectWithRows();
        const storeBefore = sha256Of(storePath());
        const indexBefore = inodeOf(indexPath());

        await index.rebuild({ project: PROJECT });

        expect(sha256Of(storePath())).toBe(storeBefore);
        expect(inodeOf(indexPath())).not.toBe(indexBefore);
      });

      it('holds the rows of both once a rebuild is run after them', async () => {
        const { index, store } = await connectWithRows();
        const pushing = store.push({ device: B, payload: pushOf(B) });
        const rebuilding = index.rebuild({ project: PROJECT });
        await Promise.all([pushing, rebuilding]);

        await index.rebuild({ project: PROJECT });
        const found = await index.search({ mode: 'fts', query: PARSER });
        const status = await store.status();

        expect(keysOf(found.hits)).toEqual([
          key(COMMITS, A, 1),
          key(COMMITS, B, 1),
          key(SESSIONS, A, 3),
          key(SESSIONS, B, 3),
        ]);
        expect(status.rows[COMMITS]).toBe(4);
      });
    });

    describe('a second push', () => {
      it('keeps the index attached and answering the rows indexed before it', async () => {
        const { index, store } = await connectWithRows();
        const first = await index.search({ mode: 'fts', query: PARSER });

        const second = await store.push({ device: B, payload: pushOf(B) });
        const answered = await index.search({ mode: 'fts', query: PARSER });

        expect(second.added).toBe(3);
        expect(keysOf(answered.hits)).toEqual(keysOf(first.hits));
      });

      it('keeps the index answering after a push that adds nothing', async () => {
        const { index, store } = await connectWithRows();

        const again = await store.push({ device: A, payload: pushOf(A) });
        const answered = await index.search({ mode: 'fts', query: CACHE });

        expect(again.added).toBe(0);
        expect(keysOf(answered.hits)).toEqual([key(COMMITS, A, 2)]);
      });

      it('answers both pushes\' rows from the index once it is rebuilt', async () => {
        const { index, store } = await connectWithRows();
        await store.push({ device: B, payload: pushOf(B) });

        await index.rebuild({ project: PROJECT });
        const answered = await index.search({ mode: 'fts', query: CACHE });

        expect(keysOf(answered.hits)).toEqual([key(COMMITS, A, 2), key(COMMITS, B, 2)]);
      });
    });

    describe('what a search answers', () => {
      it('holds only a table, an origin pair and a score per hit, in frozen records, for fts', async () => {
        const { index } = await connectWithRows();

        const found = await index.search({ mode: 'fts', query: PARSER });

        expect(found.hits.length).toBe(2);
        expect(holdsOnlyReferences(found)).toBe(true);
      });

      it('holds no row body: no sha, subject or topic text is in the answer', async () => {
        const { index } = await connectWithRows();

        const answers = [await index.search({ mode: 'fts', query: PARSER })];
        if (!holdExtensionOff) {
          answers.push(await index.search({ mode: 'vector', query: PARSER }), await index.search({ mode: 'hybrid', query: PARSER }));
        }
        const text = JSON.stringify(answers);

        for (const body of [PARSER, 'rewrite', 'notes', 'eviction', 'row_json']) {
          expect(text).not.toContain(body);
        }
      });

      it('names a row by the origin pair it was created with, whoever pushed it', async () => {
        const { index, store } = await connect();
        await store.push({ device: B, payload: pushOf(A) });
        await index.rebuild({ project: PROJECT });

        const found = await index.search({ mode: 'fts', query: CACHE });

        expect(found.hits.map((hit) => hit.origin)).toEqual([{ originSeq: 2, originStore: A }]);
      });

      if (!holdExtensionOff) {
        it('holds only a table, an origin pair and a score per hit for vector and hybrid too', async () => {
          const { index } = await connectWithRows();

          const vector = await index.search({ mode: 'vector', query: 'a' });
          const hybrid = await index.search({ mode: 'hybrid', query: PARSER });

          expect(vector.hits.length).toBeGreaterThan(0);
          expect(hybrid.hits.length).toBeGreaterThan(0);
          expect(holdsOnlyReferences(vector)).toBe(true);
          expect(holdsOnlyReferences(hybrid)).toBe(true);
        });
      }
    });
  });
}
