/**
 * The hub's store port as a package of its own: the types a hub
 * connector implements and the hub serves, with no implementation
 * behind them (`src/port.ts` holds the port and its rules).
 *
 * The entry exports the names a file outside this package imports,
 * twenty-two of the port's twenty-six; `IndexOriginPair`,
 * `IndexTableRows`, `IndexLink` and `HubEmbedding` stay reachable only
 * as the field types of the names exported here. A name a new importer needs is
 * added to this list, and `index.test.ts` holds the list.
 */
export type {
  HubCapabilities,
  HubConnector,
  HubContract,
  HubDevice,
  HubIndex,
  HubIndexCapabilities,
  HubPullRequest,
  HubPushRequest,
  HubPushResult,
  HubServedProject,
  HubStatusRequest,
  HubStore,
  HubStoreContext,
  HubStoreFactory,
  HubStoreStatus,
  IndexLinksRequest,
  IndexLinksResult,
  IndexRebuildRequest,
  IndexRebuildResult,
  IndexSearchHit,
  IndexSearchRequest,
  IndexSearchResult,
} from './src/port.js';
