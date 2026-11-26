/**
 * The connector the hub names `postgres`: {@link connectPostgresHub}
 * opens the connection on the URL the named environment variable holds
 * (`connection.ts`, which refuses an unset or empty variable and a
 * database missing `pg_search` or `pgvector`) and the store over it
 * (`hub-store.ts`).
 *
 * ## The index half is built in part
 *
 * The index beside the store rebuilds: `rebuild` builds the project's
 * index as a build schema of its own and swaps it in
 * (`index-build.ts`), with no embedder, so a build holds full text alone
 * and answers `vector: false` with the why `no embedder configured`.
 * `search` reads the project's serving build (`index-search.ts`) under
 * that same answer: an `fts` search answers, and a `vector` or `hybrid`
 * one is refused naming `fts` and the why. `links` is refused, saying
 * the connector serves no links yet, and every capability answers
 * `false`, as the store's `contract()` does, until they are measured at
 * open. Once the store is closed, which closes the client both halves
 * share, each refuses naming the close.
 *
 * The leak rule holds here: what {@link connectPostgresHub} takes and
 * answers are the port's types and plain values.
 */
import type { ProjectSchema } from './hub-projects.js';
import type { HubDatabase } from './hub-tables.js';
import type { SearchVectorState } from './index-search.js';
import type { HubConnector, HubIndex, HubIndexCapabilities, HubStoreContext, IndexRebuildRequest, IndexSearchRequest } from '@open-tomato/rafa-hub-port';

import { NO_EMBEDDER } from '@open-tomato/rafa-index';
import { drizzle } from 'drizzle-orm/bun-sql';

import { openPostgresConnection } from './connection.js';
import { openPostgresHubStoreParts } from './hub-store.js';
import { rebuildProjectIndex } from './index-build.js';
import { searchProjectIndex } from './index-search.js';

/** What the connector is opened with, beside the port's context. */
export interface PostgresHubOptions {
  /** The name of the variable holding the URL: `hub.store.postgres.urlVariable`. */
  readonly urlVariable: string;
  /** The environment to read it from; `process.env` when left out. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** The prefix of every project's schema name; `rafa_hub` when left out. */
  readonly schemaPrefix?: string;
}

/** What the index answers until its capabilities are measured: nothing. */
const NO_INDEX: HubIndexCapabilities = Object.freeze({ fts: false, vector: false, graph: false });

/** The vector answer the index works under: off, since the connector is given no embedder yet. */
const VECTOR_OFF: SearchVectorState = Object.freeze({ vector: false, why: NO_EMBEDDER });

/** The refusal of a call once the connector is closed. */
function closedIndex(): Error {
  return new Error('hub index: the index is closed');
}

/** What the index half is built over: the database, the store's schema lookup, the clock and whether it is closed. */
interface IndexHalf {
  readonly db: HubDatabase;
  readonly placeOf: (project: string | undefined) => Promise<ProjectSchema>;
  readonly now: () => Date;
  readonly isClosed: () => boolean;
}

/** The index of the connector: a rebuild that swaps a build in, a search of the serving build, and a refused walk. */
function partialIndex(half: IndexHalf): HubIndex {
  const { db, isClosed, now, placeOf } = half;
  const refuse = (): Promise<never> => Promise.reject(isClosed()
    ? closedIndex()
    : new Error('hub postgres: the connector serves no links yet'));
  return Object.freeze({
    rebuild: async (request: IndexRebuildRequest) => {
      if (isClosed()) throw closedIndex();
      const place = await placeOf(request.project);
      return (await rebuildProjectIndex({ db, place, request, now })).result;
    },
    search: async (request: IndexSearchRequest) => {
      if (isClosed()) throw closedIndex();
      const place = await placeOf(request.project);
      return searchProjectIndex({ db, place, request, vector: VECTOR_OFF });
    },
    links: refuse,
    capabilities: () => NO_INDEX,
  });
}

/**
 * Opens the `postgres` connector's store and index over `context`.
 * Rejects, with nothing left open, when the variable, the database's
 * extensions or the first project's schema is refused.
 */
export async function connectPostgresHub(
  context: HubStoreContext,
  options: PostgresHubOptions,
): ReturnType<HubConnector> {
  const { urlVariable, env, schemaPrefix } = options;
  const { client } = await openPostgresConnection({ urlVariable, env });
  const { store, placeOf } = await openPostgresHubStoreParts(context, { client, schemaPrefix });
  let closed = false;
  return {
    store: {
      ...store,
      close: async () => {
        closed = true;
        await store.close();
      },
    },
    index: partialIndex({ db: drizzle({ client }), placeOf, now: context.now, isClosed: () => closed }),
  };
}
