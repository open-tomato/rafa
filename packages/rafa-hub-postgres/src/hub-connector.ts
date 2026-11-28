/**
 * The connector the hub names `postgres`: {@link connectPostgresHub}
 * opens the connection on the URL the named environment variable holds
 * (`connection.ts`, which refuses an unset or empty variable and a
 * database missing `pg_search` or `pgvector`) and the store over it
 * (`hub-store.ts`).
 *
 * ## The index half
 *
 * The index beside the store measures its capabilities once at open
 * (`index-capabilities.ts`): `fts` true, `graph` when the first served
 * project's schema holds `ref_links`, `vector` only with `pgvector`
 * loaded and an embedder given, and `projection` `false`. The store's
 * `contract()` answers the same three beside `projection`.
 *
 * When the first served project has no serving build at open, the open
 * builds one from its rows with one rebuild, as the `sqlite` connector
 * builds a missing index file, so a search or a walk answers from the
 * start. A build already serving is left as it is. Another project's first
 * build is its first `rebuild`.
 *
 * `rebuild` builds the project's index as a build schema of its own and
 * swaps it in (`index-build.ts`), embedding with the embedder only while
 * `vector` is `true`, so a build without one holds full text alone and
 * answers `vector: false` with its why.
 *
 * ## The embedding record
 *
 * An embedder is given with the embedding record its vectors are made
 * under (`embedding-record.ts`): its `model`, `hash`, `dimension` and
 * `precision`. The open refuses, before it connects, an embedder with no
 * record, a record with no embedder, and a record whose dimension is not
 * the embedder's. Each build that embeds, the open's first build
 * included, claims the record in the project's store metadata: the first
 * writes it, and one under another record than the stored one is refused
 * naming both, with nothing changed; the first served project's record is
 * replaced by its re-embed alone (below). The record's precision chooses the
 * build's `halfvec` or `vector` column. `search` reads the project's
 * serving build (`index-search.ts`) under the measured vector answer: an
 * `fts` search answers, and a `vector` or `hybrid` one is refused naming
 * `fts` and the why while `vector` is `false`. `links` walks the serving
 * build's copy of `ref_links` (`index-links.ts`). Once the store is
 * closed, which closes the client both halves share, each refuses naming
 * the close.
 *
 * ## Another record than the stored one
 *
 * With an embedder and `pgvector` loaded, the open reads the first served
 * project's stored record. When one is stored and it is not the
 * configured one, the connector opens with `vector` `false`, its why
 * naming both records, and starts the re-embed job (`reembed-job.ts`)
 * beside it once the open is done: the job builds a new build from the
 * rows' text while the serving build answers `fts`, then swaps it in and
 * writes the configured record in one commit, and the connector measures
 * its capabilities again with nothing held back, so `capabilities()`,
 * `contract()` and `search` answer `vector` `true`. `contract().embedding`
 * answers the configured record's `model`, `hash` and `dimension` while
 * `vector` is `true`, and `null` while it is `false`. A failed job leaves
 * `vector` `false`, its why naming the failure. `onReembed` is handed the
 * job's outcome once the capabilities read it; a throw from it is left
 * unhandled. A `rebuild` asked while the job runs waits for it to settle.
 * `close()` marks the connector closed, which the job reads before its
 * next embed batch and before its swap and rolls its build back on, then
 * closes the client and waits for the job to settle.
 *
 * The leak rule holds here: what {@link connectPostgresHub} takes and
 * answers are the port's types and plain values.
 */
import type { EmbeddingRecord } from './embedding-record.js';
import type { ProjectSchema } from './hub-projects.js';
import type { HubDatabase } from './hub-tables.js';
import type { CapabilityReadings, MeasuredIndex } from './index-capabilities.js';
import type { ReembedOutcome } from './reembed-job.js';
import type {
  HubConnector,
  HubContract,
  HubIndex,
  HubStoreContext,
  IndexLinksRequest,
  IndexRebuildRequest,
  IndexSearchRequest,
} from '@open-tomato/rafa-hub-port';
import type { IndexEmbedder } from '@open-tomato/rafa-index';

import { drizzle } from 'drizzle-orm/bun-sql';

import { openPostgresConnection } from './connection.js';
import { checkEmbeddingRecord } from './embedding-record.js';
import { openPostgresHubStoreParts } from './hub-store.js';
import { inProjectSchema } from './hub-tables.js';
import { rebuildProjectIndex, servingBuild } from './index-build.js';
import { holdsRefLinksTable, measureCapabilities } from './index-capabilities.js';
import { walkProjectLinks } from './index-links.js';
import { searchProjectIndex } from './index-search.js';
import { reembedFailedWhy, reembeddingWhy, runReembedJob, storedRecordToReplace } from './reembed-job.js';

/** What the connector is opened with, beside the port's context. */
export interface PostgresHubOptions {
  /** The name of the variable holding the URL: `hub.store.postgres.urlVariable`. */
  readonly urlVariable: string;
  /** The environment to read it from; `process.env` when left out. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** The prefix of every project's schema name; `rafa_hub` when left out. */
  readonly schemaPrefix?: string;
  /** The embedder a rebuild and a vector search embed with; without one `vector` is `false`. */
  readonly embedder?: IndexEmbedder;
  /** The embedding record the embedder's vectors are made under: required with an embedder, refused without one. */
  readonly embeddingRecord?: EmbeddingRecord;
  /** Handed the re-embed job's outcome once it settles, when the open started one. */
  readonly onReembed?: (outcome: ReembedOutcome) => void;
}

/** The refusal of a call once the connector is closed. */
function closedIndex(): Error {
  return new Error('hub index: the index is closed');
}

/** What the index half is built over: the database, the store's schema lookup, the clock, what is measured now, the re-embed job and whether it is closed. */
interface IndexHalf {
  readonly db: HubDatabase;
  readonly placeOf: (project: string | undefined) => Promise<ProjectSchema>;
  readonly now: () => Date;
  readonly measured: () => MeasuredIndex;
  readonly embedder: IndexEmbedder | undefined;
  readonly record: EmbeddingRecord | undefined;
  /** Settles once the re-embed job has, at once when the open started none; never rejects. */
  readonly reembedded: () => Promise<unknown>;
  readonly isClosed: () => boolean;
}

/** Builds and swaps in the index of the project at `place` when none is serving it. */
async function buildMissingIndex(half: IndexHalf, place: ProjectSchema): Promise<void> {
  const { db, now } = half;
  if (await inProjectSchema(db, place.schema, servingBuild) !== null) return;
  await rebuildProjectIndex({ db, place, request: { project: place.id }, now, ...embeddingOf(half) });
}

/** What a build embeds with: the embedder and its record while `vector` is `true`, else neither and why it is off. */
function embeddingOf(half: IndexHalf): { readonly embedder?: IndexEmbedder; readonly record?: EmbeddingRecord; readonly vectorOff?: string } {
  const { embedder, record } = half;
  const { vector } = half.measured();
  if (vector.vector && embedder !== undefined) return { embedder, record };
  return vector.why === null
    ? {}
    : { vectorOff: vector.why };
}

/** The embedder and its record, checked as one pair before anything connects; see the module note. */
function checkedEmbedding(options: PostgresHubOptions): Pick<IndexHalf, 'embedder' | 'record'> {
  const { embedder, embeddingRecord } = options;
  if (embedder === undefined) {
    if (embeddingRecord !== undefined) {
      throw new TypeError('hub postgres: an embedding record is given with no embedder; give the embedder its vectors are made by, or neither');
    }
    return { embedder: undefined, record: undefined };
  }
  return { embedder, record: checkEmbeddingRecord(embeddingRecord, embedder) };
}

/** The index of the connector: a rebuild that swaps a build in, and a search and a walk of the serving build. */
function connectorIndex(half: IndexHalf): HubIndex {
  const { db, embedder, isClosed, measured, now, placeOf, reembedded } = half;
  return Object.freeze({
    rebuild: async (request: IndexRebuildRequest) => {
      if (isClosed()) throw closedIndex();
      await reembedded();
      if (isClosed()) throw closedIndex();
      const place = await placeOf(request.project);
      return (await rebuildProjectIndex({ db, place, request, now, ...embeddingOf(half) })).result;
    },
    search: async (request: IndexSearchRequest) => {
      if (isClosed()) throw closedIndex();
      const place = await placeOf(request.project);
      const { vector } = measured();
      return searchProjectIndex({ db, place, request, vector, embedder });
    },
    links: async (request: IndexLinksRequest) => {
      if (isClosed()) throw closedIndex();
      const place = await placeOf(request.project);
      return walkProjectLinks({ db, place, request });
    },
    capabilities: () => measured().capabilities,
  });
}

/** What the capabilities read once the re-embed settled with `outcome`: nothing held once it swapped, its failure once it failed, unchanged once closed. */
function remeasured(readings: CapabilityReadings, outcome: ReembedOutcome): MeasuredIndex | null {
  if (outcome.state === 'swapped') return measureCapabilities(readings);
  if (outcome.state === 'failed') return measureCapabilities({ ...readings, vectorHeld: reembedFailedWhy(outcome.record, outcome.error) });
  return null;
}

/** The record's three fields `/v1/status` answers while `vector` is `true`, else `null`. */
function servedEmbedding(vector: boolean, record: EmbeddingRecord | undefined): HubContract['embedding'] {
  if (!vector || record === undefined) return null;
  const { model, hash, dimension } = record;
  return Object.freeze({ model, hash, dimension });
}

/** The stored record the open re-embeds over: one other than the configured, read only while vectors could serve. */
async function recordToReplace(db: HubDatabase, place: ProjectSchema, measured: MeasuredIndex, record: EmbeddingRecord | undefined): Promise<EmbeddingRecord | null> {
  return measured.vector.vector && record !== undefined
    ? storedRecordToReplace(db, place, record)
    : null;
}

/**
 * Opens the `postgres` connector's store and index over `context`,
 * measuring the index's capabilities once the first project's schema is
 * ready, then building that project's index when none serves it, and
 * starting the re-embed job beside it when the project's stored
 * embedding record is not the configured one. Rejects
 * before it connects when the embedder and its record are no pair, and,
 * with nothing left open, when the variable, the database's extensions,
 * the first project's schema or that first build is refused.
 */
export async function connectPostgresHub(
  context: HubStoreContext,
  options: PostgresHubOptions,
): ReturnType<HubConnector> {
  const { urlVariable, env, schemaPrefix } = options;
  const { embedder, record } = checkedEmbedding(options);
  const { client, extensions } = await openPostgresConnection({ urlVariable, env });
  const { store, placeOf } = await openPostgresHubStoreParts(context, { client, schemaPrefix });
  const db = drizzle({ client });
  let closed = false;
  let measured: MeasuredIndex;
  let reembedding: Promise<unknown> = Promise.resolve();
  const isClosed = (): boolean => closed;
  const half: IndexHalf = { db, placeOf, now: context.now, measured: () => measured, embedder, record, reembedded: () => reembedding, isClosed };
  try {
    const first = await placeOf(undefined);
    const readings: CapabilityReadings = { extensions, embedder: embedder !== undefined, refLinks: await holdsRefLinksTable(client, first.schema) };
    measured = measureCapabilities(readings);
    const stored = await recordToReplace(db, first, measured, record);
    if (stored !== null && record !== undefined) measured = measureCapabilities({ ...readings, vectorHeld: reembeddingWhy(stored, record) });
    await buildMissingIndex(half, first);
    if (stored !== null && embedder !== undefined && record !== undefined) {
      const job = runReembedJob({ db, place: first, now: context.now, embedder, record, stored, isClosed }).then((outcome) => {
        measured = remeasured(readings, outcome) ?? measured;
        return outcome;
      });
      reembedding = job;
      if (options.onReembed !== undefined) void job.then(options.onReembed);
    }
  } catch (error) {
    await store.close();
    throw error;
  }
  return {
    store: {
      ...store,
      contract: (): HubContract => {
        const contract = store.contract();
        const capabilities = Object.freeze({ ...measured.capabilities, projection: false });
        return Object.freeze({ ...contract, capabilities, embedding: servedEmbedding(capabilities.vector, record) });
      },
      close: async () => {
        closed = true;
        await store.close();
        await reembedding;
      },
    },
    index: connectorIndex(half),
  };
}
