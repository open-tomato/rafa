/**
 * The connector the hub names `postgres`: {@link connectPostgresHub}
 * opens the connection on the URL the named environment variable holds
 * (`connection.ts`, which refuses an unset or empty variable and a
 * database missing `pg_search` or `pgvector`) and the store over it
 * (`hub-store.ts`).
 *
 * ## The index half is not built yet
 *
 * The index beside the store answers every capability `false`, as the
 * store's `contract()` does, and refuses `rebuild`, `search` and `links`
 * saying it holds no index. Once the store is closed, which closes the
 * client both halves share, each refuses naming the close.
 *
 * The leak rule holds here: what {@link connectPostgresHub} takes and
 * answers are the port's types and plain values.
 */
import type { HubConnector, HubIndex, HubIndexCapabilities, HubStoreContext } from '@open-tomato/rafa-hub-port';

import { openPostgresConnection } from './connection.js';
import { openPostgresHubStore } from './hub-store.js';

/** What the connector is opened with, beside the port's context. */
export interface PostgresHubOptions {
  /** The name of the variable holding the URL: `hub.store.postgres.urlVariable`. */
  readonly urlVariable: string;
  /** The environment to read it from; `process.env` when left out. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** The prefix of every project's schema name; `rafa_hub` when left out. */
  readonly schemaPrefix?: string;
}

/** What the index can answer while there is none: nothing. */
const NO_INDEX: HubIndexCapabilities = Object.freeze({ fts: false, vector: false, graph: false });

/** The index of a connector that holds none: every request refused, naming the close once `isClosed`. */
function absentIndex(isClosed: () => boolean): HubIndex {
  const refuse = (): Promise<never> => Promise.reject(new Error(isClosed()
    ? 'hub index: the index is closed'
    : 'hub postgres: the connector holds no index yet, so it serves no rebuild, search or links'));
  return Object.freeze({ rebuild: refuse, search: refuse, links: refuse, capabilities: () => NO_INDEX });
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
  const store = await openPostgresHubStore(context, { client, schemaPrefix });
  let closed = false;
  return {
    store: {
      ...store,
      close: async () => {
        closed = true;
        await store.close();
      },
    },
    index: absentIndex(() => closed),
  };
}
