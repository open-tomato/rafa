/**
 * Every connector the hub package knows, by name: the record both
 * contract suites run over, `contract.ts` for rows and `index-contract.ts`
 * for the index, so a connector added here is held to both.
 *
 * Here that is `sqlite`, {@link connectSqliteHub} with its defaults, and
 * `postgres`, `connectPostgresHub` of `@open-tomato/rafa-hub-postgres`
 * reading its URL from `hub.store.postgres.urlVariable`'s default,
 * `POSTGRES_URL`. The in-memory stand-in in `contract.test.ts` is no
 * connector: it has no index and keeps its own run of the row suite.
 */
import type { HubConnector } from './port.js';

import { connectPostgresHub } from '@open-tomato/rafa-hub-postgres';

import { DEFAULT_POSTGRES_URL_VARIABLE } from '../config-store.js';

import { connectSqliteHub } from './sqlite.js';

/** The hub's connectors by name, frozen. */
export const HUB_CONNECTORS: Readonly<Record<string, HubConnector>> = Object.freeze({
  sqlite: (context) => connectSqliteHub(context),
  postgres: (context) => connectPostgresHub(context, { urlVariable: DEFAULT_POSTGRES_URL_VARIABLE }),
});
