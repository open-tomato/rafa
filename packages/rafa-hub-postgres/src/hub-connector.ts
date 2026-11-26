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
 * naming both, with nothing changed. The record's precision chooses the
 * build's `halfvec` or `vector` column. `search` reads the project's
 * serving build (`index-search.ts`) under the measured vector answer: an
 * `fts` search answers, and a `vector` or `hybrid` one is refused naming
 * `fts` and the why while `vector` is `false`. `links` walks the serving
 * build's copy of `ref_links` (`index-links.ts`). Once the store is
 * closed, which closes the client both halves share, each refuses naming
 * the close.
 *
 * The leak rule holds here: what {@link connectPostgresHub} takes and
 * answers are the port's types and plain values.
 */
import type { EmbeddingRecord } from './embedding-record.js';
import type { ProjectSchema } from './hub-projects.js';
import type { HubDatabase } from './hub-tables.js';
import type { MeasuredIndex } from './index-capabilities.js';
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
}

/** The refusal of a call once the connector is closed. */
function closedIndex(): Error {
  return new Error('hub index: the index is closed');
}

/** What the index half is built over: the database, the store's schema lookup, the clock, what was measured and whether it is closed. */
interface IndexHalf {
  readonly db: HubDatabase;
  readonly placeOf: (project: string | undefined) => Promise<ProjectSchema>;
  readonly now: () => Date;
  readonly measured: MeasuredIndex;
  readonly embedder: IndexEmbedder | undefined;
  readonly record: EmbeddingRecord | undefined;
  readonly isClosed: () => boolean;
}

/** Builds and swaps in the index of the project at `place` when none is serving it. */
async function buildMissingIndex(half: IndexHalf, place: ProjectSchema): Promise<void> {
  const { db, now } = half;
  if (await inProjectSchema(db, place.schema, servingBuild) !== null) return;
  await rebuildProjectIndex({ db, place, request: { project: place.id }, now, ...embeddingOf(half) });
}

/** The embedder and its record a build embeds with: both while `vector` is `true`, neither while it is not. */
function embeddingOf(half: IndexHalf): { readonly embedder?: IndexEmbedder; readonly record?: EmbeddingRecord } {
  const { embedder, measured, record } = half;
  return measured.vector.vector && embedder !== undefined
    ? { embedder, record }
    : {};
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
  const { db, isClosed, measured, now, placeOf } = half;
  const embedding = embeddingOf(half);
  const { embedder } = embedding;
  return Object.freeze({
    rebuild: async (request: IndexRebuildRequest) => {
      if (isClosed()) throw closedIndex();
      const place = await placeOf(request.project);
      return (await rebuildProjectIndex({ db, place, request, now, ...embedding })).result;
    },
    search: async (request: IndexSearchRequest) => {
      if (isClosed()) throw closedIndex();
      const place = await placeOf(request.project);
      return searchProjectIndex({ db, place, request, vector: measured.vector, embedder });
    },
    links: async (request: IndexLinksRequest) => {
      if (isClosed()) throw closedIndex();
      const place = await placeOf(request.project);
      return walkProjectLinks({ db, place, request });
    },
    capabilities: () => measured.capabilities,
  });
}

/**
 * Opens the `postgres` connector's store and index over `context`,
 * measuring the index's capabilities once the first project's schema is
 * ready, then building that project's index when none serves it. Rejects
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
  let half: IndexHalf;
  try {
    const first = await placeOf(undefined);
    const refLinks = await holdsRefLinksTable(client, first.schema);
    const measured = measureCapabilities({ extensions, embedder: embedder !== undefined, refLinks });
    half = { db, placeOf, now: context.now, measured, embedder, record, isClosed: () => closed };
    await buildMissingIndex(half, first);
  } catch (error) {
    await store.close();
    throw error;
  }
  const { measured } = half;
  return {
    store: {
      ...store,
      contract: (): HubContract => {
        const contract = store.contract();
        return Object.freeze({ ...contract, capabilities: Object.freeze({ ...measured.capabilities, projection: false }) });
      },
      close: async () => {
        closed = true;
        await store.close();
      },
    },
    index: connectorIndex(half),
  };
}
