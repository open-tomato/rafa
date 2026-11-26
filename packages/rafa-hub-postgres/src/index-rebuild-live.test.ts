/**
 * Searches that run while a project's index rebuilds, live where
 * `POSTGRES_URL` is set. In the first two cases {@link LOOPS} loops search
 * the connector without a pause, each going round `fts`, `vector` and
 * `hybrid`, while the project is rebuilt beside them: no search fails,
 * every answer is the serving build's until the swap, and the new build's
 * after it. The third holds the swap itself up.
 *
 * ## Telling the builds apart
 *
 * The project is built over {@link SERVING_ROWS}, then {@link ADDED_ROWS}
 * is pushed to the row tables alone. Every row of both holds the query's
 * word, and each added table is one the serving build holds a row of too.
 * An answer is therefore read from the serving build when it holds exactly
 * the first rows, and from the new build when it holds exactly both; any
 * other set, a part of either or none, is neither.
 *
 * ## Before and after the swap
 *
 * A logical clock ticks at the start and the end of every search, and at
 * the marks a case takes around its rebuild, so what overlapped what is
 * exact. A search that ended before the swap could have run must read the
 * serving build, one that started after the rebuild resolved must read
 * the new build, and one that overlapped the swap may read either, but no
 * search that started after the new build had answered reads the old one.
 *
 * The first case drives the connector's own `rebuild`, on the pool the
 * searches share, so the last instant known to be before the swap is the
 * rebuild's call. The second holds a rebuild through its `beforeSwap`
 * hook, the new build filled and indexed, until every loop has searched in
 * all three modes beside it, so "until the swap" reaches the swap itself.
 *
 * ## A swap the searches cannot hold off
 *
 * The loops never pause for the rebuild, so each of those cases gives it
 * {@link WAIT_MS} beside them and fails naming that when it takes longer.
 * Whether searches that overlap leave a swap waiting is a matter of timing
 * under load, so the third case sets it up: one reader holds the serving
 * build as a search does, a rebuild's swap waits for it, and a search
 * arriving then must queue behind the swap and read the new build, not join
 * the reader ahead of it. A swap overtaken that way waits for as long as
 * the searches keep overlapping.
 *
 * Each case opens its connector under a schema prefix no other case or run
 * holds, and drops only the project schema that prefix made and the build
 * it serves.
 */
import type { EmbeddingRecord } from './embedding-record.js';
import type { IndexBuildHooks } from './index-build.js';
import type { WirePayload, WireRow } from '@open-tomato/rafa/store';
import type { HubIndex, HubStoreContext, IndexSearchHit } from '@open-tomato/rafa-hub-port';
import type { IndexEmbedder, SearchMode } from '@open-tomato/rafa-index';

import { WIRE_FORMAT, WIRE_VERSION } from '@open-tomato/rafa/store';
import { SEARCH_MODES } from '@open-tomato/rafa-index';
import { SQL } from 'bun';
import { describe, expect, it } from 'bun:test';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sql';

import { connectPostgresHub } from './hub-connector.js';
import { DEFAULT_PROJECT_ID, projectSchemaName } from './hub-projects.js';
import { openPostgresHubStoreParts } from './hub-store.js';
import { inProjectSchema } from './hub-tables.js';
import { rebuildProjectIndex, servingBuild } from './index-build.js';
import { DRIZZLE_WIRE_MIGRATIONS } from './wire-migrations.js';

const A = 'aaaaaaaa-0000-4000-8000-00000000000a';

const CONTEXT: HubStoreContext = { directory: '/nonexistent', now: () => new Date('2026-11-26T10:00:00.000Z') };

/** Every wire id the shipped migrations cover: what a migrated schema mirrors. */
const WIRE_IDS = DRIZZLE_WIRE_MIGRATIONS.flatMap(({ wire }) => wire);

/** The word every row of the fixture holds, and every search asks for. */
const QUERY = 'parser';

/** The search loops running at once, fewer than the pool's connections so the rebuild has one. */
const LOOPS = 6;

/** How long the loops, or a rebuild beside them, are waited for before a case gives up. */
const WAIT_MS = 15_000;

/** The pause between two looks at the loops' progress. */
const LOOK_MS = 5;

/** The time one live case may take. */
const CASE_MS = 60_000;

/** An embedder of three numbers per text, none zero, so every row is a vector hit. */
const EMBEDDER: IndexEmbedder = Object.freeze({
  dimension: 3,
  embed: async (texts: readonly string[]) => texts.map((text) => Float32Array.from({ length: 3 }, (_, at) => 1 + ((text.length + at) % 5))),
});

/** The embedding record {@link EMBEDDER}'s vectors are made under. */
const RECORD: EmbeddingRecord = Object.freeze({ model: 'fixture-lengths', hash: 'fixture', dimension: 3, precision: 'half' });

/** A commit row of origin A's `originSeq`. */
function commit(originSeq: number): WireRow {
  return { seq: 50, sha: `sha-${String(originSeq)}`, row_json: JSON.stringify({ subject: `parser change ${String(originSeq)}` }), origin_store: A, origin_seq: originSeq };
}

/** A session row of origin A's `originSeq`. */
function session(originSeq: number): WireRow {
  return { seq: 51, session_id: `s-${String(originSeq)}`, row_json: JSON.stringify({ topic: `parser notes ${String(originSeq)}` }), worktree: null, origin_store: A, origin_seq: originSeq };
}

/** A payload carrying `tables`. */
function payloadOf(tables: Readonly<Record<string, readonly WireRow[]>>): WirePayload {
  return { format: WIRE_FORMAT, version: WIRE_VERSION, migrations: WIRE_IDS, tables, cursor: {} };
}

/** The rows the serving build is made over. */
const SERVING_ROWS = payloadOf({ commits: [commit(1), commit(2)], sessions: [session(3)] });

/** The rows pushed once the serving build is up, which only a new build holds. */
const ADDED_ROWS = payloadOf({ commits: [commit(4)], sessions: [session(5), session(6)] });

/** The key of `table`'s row of origin A's `originSeq`. */
function key(table: string, originSeq: number): string {
  return `${table}:${A}:${String(originSeq)}`;
}

/** Every key the serving build answers, sorted. */
const SERVING_KEYS: readonly string[] = [key('commits', 1), key('commits', 2), key('sessions', 3)].sort();

/** Every key the new build answers, sorted. */
const NEW_KEYS: readonly string[] = [...SERVING_KEYS, key('commits', 4), key('sessions', 5), key('sessions', 6)].sort();

/** The build an answer was read from, or what it held when it is neither's whole answer. */
function buildOf(hits: readonly IndexSearchHit[]): string {
  const keys = hits
    .map((hit) => `${hit.table}:${hit.origin.originStore}:${String(hit.origin.originSeq)}`)
    .sort()
    .join(' ');
  if (keys === SERVING_KEYS.join(' ')) return 'serving';
  if (keys === NEW_KEYS.join(' ')) return 'new';
  return `neither build: [${keys}]`;
}

/** One search that ended: its loop and mode, its ticks, and the build it read or why it failed. */
interface Searched {
  readonly loop: number;
  readonly mode: SearchMode;
  readonly started: number;
  readonly ended: number;
  readonly read: string | null;
  readonly failure: string | null;
}

/** The search loops of one case. */
interface SearchLoad {
  /** The next tick of the clock the searches are timed by. */
  readonly mark: () => number;
  /** Resolves once every loop has finished one search of each mode started after `since`. */
  readonly searchedSince: (since: number) => Promise<void>;
  /** Stops the loops and answers every search they ran. */
  readonly stop: () => Promise<readonly Searched[]>;
}

/** Starts {@link LOOPS} loops searching `index` one search after another, each going round the modes, until stopped. */
function startSearchLoad(index: HubIndex): SearchLoad {
  const searches: Searched[] = [];
  let clock = 0;
  let stopped = false;
  const mark = (): number => {
    clock += 1;
    return clock;
  };
  const searchOnce = async (loop: number, mode: SearchMode): Promise<Searched> => {
    const started = mark();
    try {
      const { hits } = await index.search({ mode, query: QUERY });
      return { loop, mode, started, ended: mark(), read: buildOf(hits), failure: null };
    } catch (error) {
      return { loop, mode, started, ended: mark(), read: null, failure: `${mode}: ${String(error)}` };
    }
  };
  const run = async (loop: number): Promise<void> => {
    for (let turn = loop; !stopped; turn += 1) {
      searches.push(await searchOnce(loop, SEARCH_MODES[turn % SEARCH_MODES.length] ?? 'fts'));
    }
  };
  const running = Array.from({ length: LOOPS }, (_, loop) => run(loop));
  const everyLoopSearched = (since: number): boolean => Array.from({ length: LOOPS }, (_, loop) => loop)
    .every((loop) => new Set(searches
      .filter((search) => search.loop === loop && search.started > since)
      .map((search) => search.mode)).size === SEARCH_MODES.length);
  return {
    mark,
    searchedSince: async (since) => {
      await waitFor('each search loop to search every mode', () => everyLoopSearched(since) || undefined);
    },
    stop: async () => {
      stopped = true;
      await Promise.all(running);
      return [...searches];
    },
  };
}

/**
 * What `rebuild` answers while the loops of `load` go on searching. One
 * still unsettled after {@link WAIT_MS} fails the case: the loops are
 * stopped, so it can end and the schemas be dropped, and the refusal says
 * it did not swap beside them.
 */
async function besideTheLoad<T>(load: SearchLoad, rebuild: Promise<T>): Promise<T> {
  const late = Symbol('late');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<typeof late>((resolve) => {
    timer = setTimeout(() => resolve(late), WAIT_MS);
  });
  try {
    const first = await Promise.race([rebuild, deadline]);
    if (first !== late) return first;
  } finally {
    clearTimeout(timer);
  }
  await load.stop();
  await rebuild;
  throw new Error(`the rebuild had not swapped after ${String(WAIT_MS)} ms beside the search loops; it ended only once they stopped`);
}

/** What `look` answers once it is no longer `undefined`, refused naming `what` after {@link WAIT_MS}. */
async function waitFor<T>(what: string, look: () => T | undefined | Promise<T | undefined>): Promise<T> {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const found = await look();
    if (found !== undefined) return found;
    if (Date.now() > deadline) throw new Error(`waited ${String(WAIT_MS)} ms for ${what}`);
    await Bun.sleep(LOOK_MS);
  }
}

/** The failures among `searches`. */
function failuresOf(searches: readonly Searched[]): string[] {
  return searches.flatMap(({ failure }) => failure === null
    ? []
    : [failure]);
}

/** The distinct builds `searches` read, sorted. */
function readsOf(searches: readonly Searched[]): string[] {
  return [...new Set(searches.map(({ read }) => read ?? 'failed'))].sort();
}

/** The modes `searches` ran, in {@link SEARCH_MODES} order. */
function modesOf(searches: readonly Searched[]): SearchMode[] {
  return SEARCH_MODES.filter((mode) => searches.some((search) => search.mode === mode));
}

/** The searches that started after a search reading the new build had ended: none may read an older one. */
function afterTheNewAnswered(searches: readonly Searched[]): readonly Searched[] {
  const first = Math.min(...searches.filter(({ read }) => read === 'new').map(({ ended }) => ended));
  return searches.filter(({ started }) => started > first);
}

const url = process.env['POSTGRES_URL']?.trim() ?? '';

describe.skipIf(url === '')('searches during an index rebuild, live on POSTGRES_URL', () => {
  /** A connector serving a build of {@link SERVING_ROWS}, its row tables holding {@link ADDED_ROWS} too. */
  interface Served {
    readonly index: HubIndex;
    readonly schemaPrefix: string;
  }

  /** Runs `work` over a fresh {@link Served}, dropping after it the project schema and the build that schema serves. */
  async function overServedProject(work: (served: Served) => Promise<void>): Promise<void> {
    const schemaPrefix = `test_idxlive_${crypto
      .randomUUID()
      .replaceAll('-', '')
      .slice(0, 8)}`;
    const schema = projectSchemaName(schemaPrefix, DEFAULT_PROJECT_ID);
    const admin = new SQL(url);
    try {
      const { store, index } = await connectPostgresHub(CONTEXT, { urlVariable: 'POSTGRES_URL', schemaPrefix, embedder: EMBEDDER, embeddingRecord: RECORD });
      try {
        await store.push({ device: A, payload: SERVING_ROWS });
        await index.rebuild({ project: DEFAULT_PROJECT_ID });
        await store.push({ device: A, payload: ADDED_ROWS });
        await work({ index, schemaPrefix });
      } finally {
        await store.close();
      }
    } finally {
      // A case that failed before the schema was made has no pointer to read.
      const [pointer] = await admin
        .unsafe<{ build_schema: string }[]>(`SELECT build_schema FROM "${schema}".hub_index_serving`)
        .catch(() => []);
      if (pointer !== undefined) await admin.unsafe(`DROP SCHEMA IF EXISTS "${pointer.build_schema}" CASCADE`);
      await admin.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.close();
    }
  }

  /** The backends waiting for a lock the backend `pid` holds, or waits for ahead of them. */
  async function blockedBy(client: SQL, pid: number): Promise<readonly number[]> {
    const rows = await client.unsafe<{ pid: number }[]>('SELECT pid FROM pg_stat_activity WHERE $1::int = ANY(pg_blocking_pids(pid))', [pid]);
    return rows.map((row) => Number(row.pid));
  }

  /** A reader holding the serving build's pointer, as a search does, until released. */
  interface HeldReader {
    /** The backend its transaction runs on. */
    readonly pid: number;
    /** Ends its transaction. */
    readonly release: () => Promise<void>;
  }

  /** Opens a {@link HeldReader} of the project schema `schema` over `client`. */
  async function holdServingBuild(client: SQL, schema: string): Promise<HeldReader> {
    const held = Promise.withResolvers<void>();
    const locked = Promise.withResolvers<number>();
    const reading = inProjectSchema(drizzle({ client }), schema, async (tx) => {
      await servingBuild(tx);
      const [backend] = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`);
      locked.resolve(Number(backend?.pid));
      await held.promise;
    });
    reading.catch(locked.reject);
    return {
      pid: await locked.promise,
      release: async () => {
        held.resolve();
        await reading;
      },
    };
  }

  /** Rebuilds the served project with `hooks`, over a connection of its own, as another hub on the database would. */
  async function rebuildHeld(schemaPrefix: string, hooks: IndexBuildHooks): Promise<void> {
    const client = new SQL(url);
    const { store, placeOf } = await openPostgresHubStoreParts(CONTEXT, { client, schemaPrefix });
    try {
      const place = await placeOf(undefined);
      await rebuildProjectIndex({ db: drizzle({ client }), place, request: { project: place.id }, now: CONTEXT.now, embedder: EMBEDDER, record: RECORD, hooks });
    } finally {
      await store.close();
    }
  }

  it('fails no search while the connector rebuilds, each answering the serving build or the new one and never the old after the new', async () => {
    await overServedProject(async ({ index }) => {
      const load = startSearchLoad(index);
      let called = 0;
      let resolved = 0;
      let searches: readonly Searched[] = [];
      try {
        await load.searchedSince(0);
        called = load.mark();
        const rebuilt = await besideTheLoad(load, index.rebuild({ project: DEFAULT_PROJECT_ID }));
        resolved = load.mark();
        expect([rebuilt.rows, rebuilt.vectors]).toEqual([NEW_KEYS.length, NEW_KEYS.length]);
        await load.searchedSince(resolved);
      } finally {
        searches = await load.stop();
      }

      const before = searches.filter(({ ended }) => ended < called);
      const during = searches.filter(({ started, ended }) => started < resolved && ended > called);
      const after = searches.filter(({ started }) => started > resolved);

      expect(failuresOf(searches)).toEqual([]);
      expect(during.length).toBeGreaterThanOrEqual(LOOPS);
      expect([modesOf(before), modesOf(after)]).toEqual([[...SEARCH_MODES], [...SEARCH_MODES]]);
      expect(readsOf(searches)).toEqual(['new', 'serving']);
      expect(readsOf(before)).toEqual(['serving']);
      expect(readsOf(after)).toEqual(['new']);
      expect(readsOf(afterTheNewAnswered(searches))).toEqual(['new']);
    });
  }, CASE_MS);

  it('answers every search from the serving build until the swap and from the new build after it', async () => {
    await overServedProject(async ({ index, schemaPrefix }) => {
      const load = startSearchLoad(index);
      let built = 0;
      let released = 0;
      let resolved = 0;
      let searches: readonly Searched[] = [];
      try {
        await load.searchedSince(0);
        await besideTheLoad(load, rebuildHeld(schemaPrefix, {
          beforeSwap: async () => {
            built = load.mark();
            await load.searchedSince(built);
            released = load.mark();
          },
        }));
        resolved = load.mark();
        await load.searchedSince(resolved);
      } finally {
        searches = await load.stop();
      }

      const untilSwap = searches.filter(({ ended }) => ended < released);
      const besideTheNewBuild = untilSwap.filter(({ started }) => started > built);
      const after = searches.filter(({ started }) => started > resolved);

      expect(failuresOf(searches)).toEqual([]);
      expect([modesOf(besideTheNewBuild), modesOf(after)]).toEqual([[...SEARCH_MODES], [...SEARCH_MODES]]);
      expect(readsOf(searches)).toEqual(['new', 'serving']);
      expect(readsOf(untilSwap)).toEqual(['serving']);
      expect(readsOf(after)).toEqual(['new']);
      expect(readsOf(afterTheNewAnswered(searches))).toEqual(['new']);
    });
  }, CASE_MS);

  it('queues a search arriving while the swap waits for a reader, so it reads the new build and cannot hold the swap off', async () => {
    await overServedProject(async ({ index, schemaPrefix }) => {
      const client = new SQL(url);
      try {
        const reader = await holdServingBuild(client, projectSchemaName(schemaPrefix, DEFAULT_PROJECT_ID));
        let rebuild: Promise<unknown> = Promise.resolve();
        let search: Promise<unknown> = Promise.resolve();
        let read: string | undefined;
        try {
          rebuild = index.rebuild({ project: DEFAULT_PROJECT_ID });
          const swap = await waitFor('the swap to wait for the reader', async () => (await blockedBy(client, reader.pid))[0]);
          search = index.search({ mode: 'fts', query: QUERY }).then(({ hits }) => {
            read = buildOf(hits);
          });
          await waitFor('the late search to answer or to queue behind the swap', async () => read ?? (await blockedBy(client, swap))[0]);

          expect(read).toBeUndefined();
        } finally {
          await reader.release();
          await Promise.all([rebuild, search]);
        }

        expect(read).toBe('new');
      } finally {
        await client.close();
      }
    });
  }, CASE_MS);
});
