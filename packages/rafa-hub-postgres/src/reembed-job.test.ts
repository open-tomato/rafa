/**
 * The re-embed job beside the connector. Without a database, the two
 * whys name the records and the failure, and the job settles `failed` or
 * `closed` on a build that could not start, never rejecting.
 *
 * Where `POSTGRES_URL` is set, each case seeds a project under a schema
 * prefix no other case or run holds: a build of {@link SERVING_ROWS}
 * under {@link FIRST}, then {@link ADDED_ROWS} pushed to the row tables
 * alone, so an answer holding exactly the first rows is the serving
 * build's and one holding both is a new build's. It then opens the
 * connector again under {@link NEXT}, another model, dimension and
 * precision, with an embedder that holds the job's first embed until the
 * case lets it go. While it is held, {@link LOOPS} loops search `fts`
 * without a pause and must all answer the serving build, `vector` stays
 * `false` and the stored record stays {@link FIRST}; once it is let go,
 * the job swaps, the record is {@link NEXT}, `vector` is `true` and
 * every `fts` search answers the new build. The other cases hold a
 * reopen under the same record, a failed job, a `rebuild` asked beside
 * the job and a close under it.
 *
 * Each case drops only the project schema its prefix made and the build
 * that schema serves; the builds a swap replaced are dropped by it.
 */
import type { EmbeddingRecord } from './embedding-record.js';
import type { HubDatabase } from './hub-tables.js';
import type { ReembedOutcome } from './reembed-job.js';
import type { WirePayload, WireRow } from '@open-tomato/rafa/store';
import type { HubIndex, HubStoreContext, IndexSearchHit } from '@open-tomato/rafa-hub-port';
import type { IndexEmbedder } from '@open-tomato/rafa-index';

import { WIRE_FORMAT, WIRE_VERSION } from '@open-tomato/rafa/store';
import { SQL } from 'bun';
import { describe, expect, it } from 'bun:test';

import { describeEmbeddingRecord } from './embedding-record.js';
import { connectPostgresHub } from './hub-connector.js';
import { DEFAULT_PROJECT_ID, projectSchemaName } from './hub-projects.js';
import { reembeddingWhy, reembedFailedWhy, runReembedJob } from './reembed-job.js';
import { DRIZZLE_WIRE_MIGRATIONS } from './wire-migrations.js';

const A = 'aaaaaaaa-0000-4000-8000-00000000000a';

const CONTEXT: HubStoreContext = { directory: '/nonexistent', now: () => new Date('2026-11-26T10:00:00.000Z') };

/** The word every row of the fixture holds, and every search asks for. */
const QUERY = 'parser';

/** The `fts` loops searching at once beside the job. */
const LOOPS = 3;

/** How long a look for the loops' progress waits before a case gives up. */
const WAIT_MS = 15_000;

/** The pause between two looks. */
const LOOK_MS = 5;

/** The time one live case may take. */
const CASE_MS = 60_000;

/** The record the seeded build is made under. */
const FIRST: EmbeddingRecord = Object.freeze({ model: 'fixture-first', hash: 'sha256-first', dimension: 3, precision: 'half' });

/** The record the connector is opened under again: another model, hash, dimension and precision. */
const NEXT: EmbeddingRecord = Object.freeze({ model: 'fixture-next', hash: 'sha256-next', dimension: 4, precision: 'full' });

/** An embedder whose job of `dimension` numbers per text, none zero, can be held at its first call. */
interface HeldEmbedder extends IndexEmbedder {
  /** Resolves once the first call has begun. */
  readonly entered: Promise<void>;
  /** Lets the first call, and every call after it, go on. */
  readonly release: () => void;
  /** The texts embedded so far. */
  readonly texts: () => number;
}

/** A {@link HeldEmbedder}, held from its first call when `held`, failing every call with `fails` when given. */
function heldEmbedder(dimension: number, options: { readonly held?: boolean; readonly fails?: Error } = {}): HeldEmbedder {
  const entered = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<void>();
  if (options.held !== true) gate.resolve();
  let texts = 0;
  return {
    dimension,
    entered: entered.promise,
    release: () => gate.resolve(),
    texts: () => texts,
    embed: async (given) => {
      entered.resolve();
      await gate.promise;
      if (options.fails !== undefined) throw options.fails;
      texts += given.length;
      return given.map((text) => Float32Array.from({ length: dimension }, (_, at) => 1 + ((text.length + at) % 5)));
    },
  };
}

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
  return { format: WIRE_FORMAT, version: WIRE_VERSION, migrations: DRIZZLE_WIRE_MIGRATIONS.flatMap(({ wire }) => wire), tables, cursor: {} };
}

/** The rows the seeded build is made over. */
const SERVING_ROWS = payloadOf({ commits: [commit(1), commit(2)], sessions: [session(3)] });

/** The rows pushed once the seeded build serves, which only a new build holds. */
const ADDED_ROWS = payloadOf({ commits: [commit(4)], sessions: [session(5)] });

/** The key of `table`'s row of origin A's `originSeq`. */
function key(table: string, originSeq: number): string {
  return `${table}:${A}:${String(originSeq)}`;
}

/** Every key the seeded build answers, sorted. */
const SERVING_KEYS: readonly string[] = [key('commits', 1), key('commits', 2), key('sessions', 3)].sort();

/** Every key a new build answers, sorted. */
const NEW_KEYS: readonly string[] = [...SERVING_KEYS, key('commits', 4), key('sessions', 5)].sort();

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

/** One `fts` search that ended: its loop, its ticks, and the build it read or why it failed. */
interface Searched {
  readonly loop: number;
  readonly started: number;
  readonly ended: number;
  readonly read: string | null;
  readonly failure: string | null;
}

/** The `fts` loops of one case. */
interface FtsLoad {
  /** The next tick of the clock the searches are timed by. */
  readonly mark: () => number;
  /** Resolves once every loop has finished a search started after `since`. */
  readonly searchedSince: (since: number) => Promise<void>;
  /** Stops the loops and answers every search they ran. */
  readonly stop: () => Promise<readonly Searched[]>;
}

/** What `look` answers once it is no longer `undefined`, refused naming `what` after {@link WAIT_MS}. */
async function waitFor<T>(what: string, look: () => T | undefined): Promise<T> {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const found = look();
    if (found !== undefined) return found;
    if (Date.now() > deadline) throw new Error(`waited ${String(WAIT_MS)} ms for ${what}`);
    await Bun.sleep(LOOK_MS);
  }
}

/** Resolves once `promise` has, refused naming `what` after {@link WAIT_MS}. */
async function within(what: string, promise: Promise<void>): Promise<void> {
  let done = false;
  void promise.then(() => {
    done = true;
  });
  await waitFor(what, () => done || undefined);
}

/** Starts {@link LOOPS} loops searching `index` by `fts`, one search after another, until stopped. */
function startFtsLoad(index: HubIndex): FtsLoad {
  const searches: Searched[] = [];
  let clock = 0;
  let stopped = false;
  const mark = (): number => {
    clock += 1;
    return clock;
  };
  const run = async (loop: number): Promise<void> => {
    while (!stopped) {
      const started = mark();
      try {
        const { hits } = await index.search({ mode: 'fts', query: QUERY });
        searches.push({ loop, started, ended: mark(), read: buildOf(hits), failure: null });
      } catch (error) {
        searches.push({ loop, started, ended: mark(), read: null, failure: String(error) });
      }
    }
  };
  const running = Array.from({ length: LOOPS }, (_, loop) => run(loop));
  const everyLoopSearched = (since: number): boolean => Array.from({ length: LOOPS }, (_, loop) => loop)
    .every((loop) => searches.some((search) => search.loop === loop && search.started > since));
  return {
    mark,
    searchedSince: async (since) => {
      await waitFor('each fts loop to search', () => everyLoopSearched(since) || undefined);
    },
    stop: async () => {
      stopped = true;
      await Promise.all(running);
      return [...searches];
    },
  };
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

describe('the re-embed whys', () => {
  it('names the configured and the stored record while the job runs', () => {
    const why = reembeddingWhy(FIRST, NEXT);

    expect(why).toContain(`configured embedding record (${describeEmbeddingRecord(NEXT)})`);
    expect(why).toContain(`stored one being (${describeEmbeddingRecord(FIRST)})`);
  });

  it('names the configured record and the failure once the job failed', () => {
    const why = reembedFailedWhy(NEXT, new Error('the model is gone'));

    expect(why).toContain(describeEmbeddingRecord(NEXT));
    expect(why).toContain('failed: the model is gone');
  });
});

describe('runReembedJob, on a build that cannot start', () => {
  /** A database whose every transaction is refused with `error`. */
  const refusing = (error: unknown): HubDatabase => ({ transaction: () => Promise.reject(error) }) as unknown as HubDatabase;
  const place = { id: DEFAULT_PROJECT_ID, schema: 'rafa_hub_default' };
  const job = (db: HubDatabase, closed: boolean): Promise<ReembedOutcome> => runReembedJob({
    db,
    place,
    now: CONTEXT.now,
    embedder: heldEmbedder(NEXT.dimension),
    record: NEXT,
    stored: FIRST,
    isClosed: () => closed,
  });

  it('settles failed with the error, naming the project and both records, without rejecting', async () => {
    const error = new Error('connection refused');

    const outcome = await job(refusing(error), false);

    expect(outcome).toEqual({ state: 'failed', project: DEFAULT_PROJECT_ID, stored: FIRST, record: NEXT, error });
  });

  it('settles failed with an Error made from a thrown value that is none', async () => {
    const outcome = await job(refusing('lost'), false);

    expect(outcome.state === 'failed' && outcome.error.message).toBe('lost');
  });

  it('settles closed once the connector was closed under it', async () => {
    const outcome = await job(refusing(new Error('the client is closed')), true);

    expect(outcome).toEqual({ state: 'closed', project: DEFAULT_PROJECT_ID, stored: FIRST, record: NEXT });
  });
});

const url = process.env['POSTGRES_URL']?.trim() ?? '';

describe.skipIf(url === '')('the re-embed job, live on POSTGRES_URL', () => {
  /** What a case works over: its prefix, the project's schema, the seeded build, and reads of the database. */
  interface Seeded {
    readonly prefix: string;
    readonly seededBuild: string;
    readonly servingBuild: () => Promise<string | undefined>;
    readonly storedRecord: () => Promise<EmbeddingRecord | null>;
    readonly buildMeta: (build: string) => Promise<{ readonly dimension: number | null; readonly precision: string | null }>;
  }

  /** Seeds a project under a fresh prefix, runs `work` over it, then drops the project schema and the build it serves. */
  async function overSeeded(work: (seeded: Seeded) => Promise<void>): Promise<void> {
    const prefix = `test_reembed_${crypto
      .randomUUID()
      .replaceAll('-', '')
      .slice(0, 8)}`;
    const schema = projectSchemaName(prefix, DEFAULT_PROJECT_ID);
    const admin = new SQL(url);
    const servingBuild = async (): Promise<string | undefined> => {
      const [pointer] = await admin.unsafe<{ build_schema: string }[]>(`SELECT build_schema FROM "${schema}".hub_index_serving`);
      return pointer?.build_schema;
    };
    const storedRecord = async (): Promise<EmbeddingRecord | null> => {
      const [row] = await admin.unsafe<{ model: string | null; hash: string; dimension: number; precision: 'half' | 'full' }[]>(
        `SELECT embedding_model AS model, embedding_hash AS hash, embedding_dimension AS dimension, embedding_precision AS precision FROM "${schema}".hub_store_meta`,
      );
      return row === undefined || row.model === null
        ? null
        : { model: row.model, hash: row.hash, dimension: Number(row.dimension), precision: row.precision };
    };
    const buildMeta = async (build: string): Promise<{ readonly dimension: number | null; readonly precision: string | null }> => {
      const [row] = await admin.unsafe<{ dimension: number | null; precision: string | null }[]>(`SELECT dimension, precision FROM "${build}".index_meta`);
      return { dimension: row?.dimension ?? null, precision: row?.precision ?? null };
    };
    try {
      const seeding = await connectPostgresHub(CONTEXT, { urlVariable: 'POSTGRES_URL', schemaPrefix: prefix, embedder: heldEmbedder(FIRST.dimension), embeddingRecord: FIRST });
      try {
        await seeding.store.push({ device: A, payload: SERVING_ROWS });
        await seeding.index.rebuild({ project: DEFAULT_PROJECT_ID });
        await seeding.store.push({ device: A, payload: ADDED_ROWS });
      } finally {
        await seeding.store.close();
      }
      const seededBuild = await servingBuild();
      if (seededBuild === undefined) throw new Error('the seeding left no serving build');
      await work({ prefix, seededBuild, servingBuild, storedRecord, buildMeta });
    } finally {
      // A case that failed before the schema was made has no pointer to read.
      const build = await servingBuild().catch(() => undefined);
      if (build !== undefined) await admin.unsafe(`DROP SCHEMA IF EXISTS "${build}" CASCADE`);
      await admin.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.close();
    }
  }

  /** Opens the connector under `prefix` with `embedder` and `record`, handing each re-embed outcome to `outcomes`. */
  function open(prefix: string, embedder: IndexEmbedder, record: EmbeddingRecord, outcomes: ReembedOutcome[]): ReturnType<typeof connectPostgresHub> {
    return connectPostgresHub(CONTEXT, {
      urlVariable: 'POSTGRES_URL',
      schemaPrefix: prefix,
      embedder,
      embeddingRecord: record,
      onReembed: (outcome) => outcomes.push(outcome),
    });
  }

  it('opens with vector false under another record, holds fts answering the serving build through the job, then swaps, stores the record and turns vector true', async () => {
    await overSeeded(async ({ prefix, seededBuild, servingBuild, storedRecord, buildMeta }) => {
      const embedder = heldEmbedder(NEXT.dimension, { held: true });
      const outcomes: ReembedOutcome[] = [];
      const { store, index } = await open(prefix, embedder, NEXT, outcomes);
      const why = reembeddingWhy(FIRST, NEXT);
      const load = startFtsLoad(index);
      let entered = 0;
      let released = 0;
      let swapped = 0;
      let searches: readonly Searched[] = [];
      try {
        expect([index.capabilities().vector, store.contract().capabilities.vector]).toEqual([false, false]);
        await expect(index.search({ mode: 'vector', query: QUERY })).rejects.toThrow(`(${why}); search with mode 'fts'`);

        await within('the job\'s first embed', embedder.entered);
        entered = load.mark();
        await load.searchedSince(entered);
        await load.searchedSince(load.mark());

        expect(await storedRecord()).toEqual(FIRST);
        expect(await servingBuild()).toBe(seededBuild);
        expect([index.capabilities().vector, outcomes.length]).toEqual([false, 0]);
        await expect(index.search({ mode: 'hybrid', query: QUERY })).rejects.toThrow(why);

        released = load.mark();
        embedder.release();
        await waitFor('the re-embed to settle', () => outcomes[0]);
        swapped = load.mark();
        await load.searchedSince(swapped);
      } finally {
        // A case failing while the job is held lets it go, so the loops can end.
        embedder.release();
        searches = await load.stop();
      }

      const held = searches.filter(({ started, ended }) => started > entered && ended < released);
      const after = searches.filter(({ started }) => started > swapped);

      expect(outcomes).toEqual([{ state: 'swapped', project: DEFAULT_PROJECT_ID, stored: FIRST, record: NEXT, vectors: NEW_KEYS.length }]);
      expect(failuresOf(searches)).toEqual([]);
      expect(held.length).toBeGreaterThanOrEqual(2 * LOOPS);
      expect(readsOf(held)).toEqual(['serving']);
      expect(readsOf(after)).toEqual(['new']);
      expect([index.capabilities().vector, store.contract().capabilities.vector]).toEqual([true, true]);
      expect(await storedRecord()).toEqual(NEXT);
      const swappedIn = await servingBuild();
      expect(swappedIn).not.toBe(seededBuild);
      expect(await buildMeta(swappedIn ?? '')).toEqual({ dimension: NEXT.dimension, precision: NEXT.precision });
      expect(buildOf((await index.search({ mode: 'vector', query: QUERY })).hits)).toBe('new');
      expect(embedder.texts()).toBe(NEW_KEYS.length + 1);

      await store.close();
    });
  }, CASE_MS);

  it('opens with vector true under the stored record, starting no job and leaving the serving build as it is', async () => {
    await overSeeded(async ({ prefix, seededBuild, servingBuild, storedRecord }) => {
      const embedder = heldEmbedder(FIRST.dimension);
      const outcomes: ReembedOutcome[] = [];
      const { store, index } = await open(prefix, embedder, FIRST, outcomes);

      expect(index.capabilities().vector).toBe(true);
      expect(buildOf((await index.search({ mode: 'fts', query: QUERY })).hits)).toBe('serving');
      const rebuilt = await index.rebuild({ project: DEFAULT_PROJECT_ID });
      expect([rebuilt.vector, rebuilt.vectors]).toEqual([true, NEW_KEYS.length]);
      expect(await servingBuild()).not.toBe(seededBuild);
      expect([outcomes, await storedRecord()]).toEqual([[], FIRST]);

      await store.close();
    });
  }, CASE_MS);

  it('leaves vector false naming the failure, the stored record and the serving build when the job fails, fts answering', async () => {
    await overSeeded(async ({ prefix, seededBuild, servingBuild, storedRecord }) => {
      const error = new Error('the model would not load');
      const outcomes: ReembedOutcome[] = [];
      const { store, index } = await open(prefix, heldEmbedder(NEXT.dimension, { fails: error }), NEXT, outcomes);

      await waitFor('the re-embed to settle', () => outcomes[0]);

      expect(outcomes).toEqual([{ state: 'failed', project: DEFAULT_PROJECT_ID, stored: FIRST, record: NEXT, error }]);
      expect(index.capabilities().vector).toBe(false);
      await expect(index.search({ mode: 'vector', query: QUERY })).rejects.toThrow(reembedFailedWhy(NEXT, error));
      expect(buildOf((await index.search({ mode: 'fts', query: QUERY })).hits)).toBe('serving');
      expect([await storedRecord(), await servingBuild()]).toEqual([FIRST, seededBuild]);
      await expect(index.rebuild({ project: DEFAULT_PROJECT_ID, scope: 'vector' })).rejects.toThrow(`(${reembedFailedWhy(NEXT, error)}); rebuild with scope 'fts'`);

      await store.close();
    });
  }, CASE_MS);

  it('holds a rebuild asked beside the job until the job settles, then rebuilds under the new record', async () => {
    await overSeeded(async ({ prefix, storedRecord }) => {
      const embedder = heldEmbedder(NEXT.dimension, { held: true });
      const outcomes: ReembedOutcome[] = [];
      const { store, index } = await open(prefix, embedder, NEXT, outcomes);
      await within('the job\'s first embed', embedder.entered);
      let settled = false;

      const rebuilding = index.rebuild({ project: DEFAULT_PROJECT_ID }).finally(() => {
        settled = true;
      });
      await Bun.sleep(100);
      const settledBeside = settled;
      embedder.release();
      const rebuilt = await rebuilding;

      expect(settledBeside).toBe(false);
      expect(outcomes.map(({ state }) => state)).toEqual(['swapped']);
      expect([rebuilt.vector, rebuilt.vectors, rebuilt.why]).toEqual([true, NEW_KEYS.length, null]);
      expect(await storedRecord()).toEqual(NEXT);

      await store.close();
    });
  }, CASE_MS);

  it('settles the job closed when the connector closes under it, leaving the stored record and the serving build', async () => {
    await overSeeded(async ({ prefix, seededBuild, servingBuild, storedRecord }) => {
      const embedder = heldEmbedder(NEXT.dimension, { held: true });
      const outcomes: ReembedOutcome[] = [];
      const { store, index } = await open(prefix, embedder, NEXT, outcomes);
      await within('the job\'s first embed', embedder.entered);

      const closing = store.close();
      embedder.release();
      await closing;

      expect(outcomes.map(({ state }) => state)).toEqual(['closed']);
      expect([await storedRecord(), await servingBuild()]).toEqual([FIRST, seededBuild]);
      await expect(index.rebuild({ project: DEFAULT_PROJECT_ID })).rejects.toThrow('closed');
    });
  }, CASE_MS);
});
