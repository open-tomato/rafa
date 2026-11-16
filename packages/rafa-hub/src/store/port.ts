/**
 * The hub's store port: what the hub keeps a team's effort rows in,
 * declared as types with no implementation behind them, so the routes
 * are written once and a storage backend is an adapter. SQLite's is
 * the first the plan for #325 lays down, as `sqlite.ts` beside this
 * file; a Postgres or Dolt adapter implements this same port and runs
 * the same cases, {@link HubStore}'s contract suite in `contract.ts`.
 *
 * ## Two interfaces, never one
 *
 * The port is two interfaces, each with a contract suite of its own.
 * {@link HubStore} keeps the rows: push, pull and status, every case of
 * `contract.ts`. {@link HubIndex} is the projection over those rows:
 * full-text and vector search, and the walks over `ref_links`, run by
 * `index-contract.ts`. A {@link HubConnector} opens both over one
 * context. The index takes and answers plain readonly records of
 * strings, numbers and nulls, the value set the wire allows, so nothing
 * engine-shaped crosses it; `search` answers row references, a table
 * and an origin pair with a score, never a row body, which a reader
 * fetches through the store. What an index can do is answered by
 * {@link HubIndex.capabilities}, measured when the connector opened.
 *
 * ## Devices and origins
 *
 * A device is named by its store's origin, the `origin_store` its own
 * rows carry (`context/effort-store.md`, "Row origins"), and never by a
 * machine or a login: one machine can hold several stores. A row is
 * identified by its origin pair (`origin_store`, `origin_seq`), whoever
 * pushed it, so a row a device merged from another and pushes on is the
 * same row the hub already holds.
 *
 * ## The wire, both ways
 *
 * A push carries a {@link WirePayload}, as `exportWirePayload` builds
 * it on the device, and a pull answers one, so the device materialises
 * it and merges it with `mergeStore` as it would any payload. The rows a
 * pull answers carry every column as pushed, the origin pair included,
 * with `seq` the hub's own and one exception: a commit's
 * `minutesSincePrevious` in its `row_json`, which core's merge rules
 * declare recomputed, so an adapter that merges through `mergeStore`
 * answers the gap over every commit the hub holds rather than the one
 * the pushing device measured. The payload's `cursor` is the hub cursor the
 * device passes to its next pull, as the push cursor it keeps for its
 * next push is its own store's.
 *
 * ## What an adapter owes
 *
 *   - **Push is idempotent.** A row whose origin pair the hub already
 *     holds adds nothing, so a repeated or overlapping push, or one
 *     relaying a row another device pushed first, leaves the hub as it
 *     was and answers `added: 0` for those rows.
 *   - **Pull answers what others created.** The rows past the cursor
 *     whose `origin_store` is not the caller's, in hub `seq` order per
 *     table. The exclusion is by origin, not by who pushed: a row of the
 *     caller's origin that another device relayed is still the caller's
 *     own, and a row another origin created is answered even when the
 *     caller relayed it.
 *   - **The answered cursor is a snapshot.** Pulling again with it
 *     answers only rows pushed since.
 *   - **Every push is a device's last push**, a repeated push that adds
 *     nothing included, stamped by the clock the adapter was made with.
 *     A pull is no push and names no device.
 *
 * What a push naming a migration the hub lacks is refused with is the
 * SQLite adapter's to settle, beside the migrations it holds.
 */
import type { WireCursor, WirePayload } from '@open-tomato/rafa/store';

/** One push: a device's rows past its push cursor. */
export interface HubPushRequest {
  /** The pushing device's store origin, its rows' `origin_store`. */
  readonly device: string;
  /** The rows, as `exportWirePayload` answers them on the device. */
  readonly payload: WirePayload;
}

/** What one push did. */
export interface HubPushResult {
  /** The rows the payload carried, across every table. */
  readonly received: number;
  /** The rows new to the hub; a row whose origin pair it held adds nothing. */
  readonly added: number;
  /** When the hub took the push, ISO 8601: the device's last push from now on. */
  readonly at: string;
}

/** One pull: the rows other devices created past the device's hub cursor. */
export interface HubPullRequest {
  /** The pulling device's store origin; rows of this origin are never answered. */
  readonly device: string;
  /** The hub cursor a previous pull answered; a table left out is read from the start. */
  readonly since: WireCursor;
}

/** One device the hub has taken a push from. */
export interface HubDevice {
  /** The device's store origin. */
  readonly device: string;
  /** When its latest push was taken, ISO 8601. */
  readonly lastPushAt: string;
}

/** What the hub's store holds, for `GET /v1/status`. */
export interface HubStoreStatus {
  /** The migration ids the hub's store holds, in apply order: its schema. */
  readonly migrations: readonly string[];
  /** The rows held per merged table; a table left out holds none. */
  readonly rows: Readonly<Record<string, number>>;
  /** Every device that has pushed, in `device` order. */
  readonly devices: readonly HubDevice[];
}

/**
 * What a store can answer beyond the port's push, pull and status, by
 * capability name. Every name is a boolean, `false` for a store that
 * cannot: the names are the contract version's, so a new one comes with
 * a new {@link HubContract.contractVersion}, and a store only says
 * whether it has each. A connector answers them from what it measured
 * when it opened, never from what its engine is assumed to hold.
 */
export type HubCapabilities = Readonly<{
  /**
   * Full-text search over the rows it holds. `true` promises that
   * {@link HubIndex.search} answers `mode: 'fts'`; a connector answers
   * `false` when its engine has no full-text index, and a store with
   * no index behind it answers `false`.
   */
  fts: boolean;
  /**
   * Vector search over the rows it holds. `true` promises that
   * {@link HubIndex.search} answers `mode: 'vector'` and `'hybrid'`;
   * a connector answers `false` when its vector extension did not load
   * at open (macOS without a vanilla `libsqlite3`, or an engine with no
   * extension loading at all) or when it was given no embedder, and
   * then a vector search is refused with a message naming `fts`.
   */
  vector: boolean;
  /**
   * Graph queries over the rows it holds. `true` promises that
   * {@link HubIndex.links} walks the store's `ref_links` table,
   * recursively; a connector answers `false` when the store holds no
   * `ref_links` table or its engine cannot recurse.
   */
  graph: boolean;
  /**
   * Projected rows answered to a device whose schema is behind the
   * hub's. `true` promises that a pull from such a device answers its
   * rows projected to the device's schema rather than refusing it; a
   * connector answers `false` until it can project, and then that
   * device is refused.
   */
  projection: boolean;
}>;

/**
 * The wire contract a store speaks: two numbers, never one.
 *
 * `contractVersion` names the grammar and the semantics, the payload
 * shape, the cursor rules, the request fields, the capability names,
 * the refusal codes and the skew rules, as `WIRE_CONTRACT_VERSION`
 * does on a device; inside one version they evolve additively only.
 * `migrations` names the schema inside that version, the ordered
 * migration ids the store holds, which grow under the same version.
 */
export interface HubContract {
  /** The wire contract version the store speaks, a whole number above zero. */
  readonly contractVersion: number;
  /** The migration ids the store holds, in apply order, as `status()` answers them. */
  readonly migrations: readonly string[];
  /** Which capabilities the store has. */
  readonly capabilities: HubCapabilities;
}

/** The hub's store: where every device's pushed rows are kept and pulled from. */
export interface HubStore {
  /** Takes a device's rows; see the module note on idempotence. */
  readonly push: (request: HubPushRequest) => Promise<HubPushResult>;
  /** The rows other origins created past `since`, with the cursor to pass next. */
  readonly pull: (request: HubPullRequest) => Promise<WirePayload>;
  /** Row counts, the schema and every device's last push. */
  readonly status: () => Promise<HubStoreStatus>;
  /** The wire contract the store speaks; its `migrations` are the ones `status()` answers. */
  readonly contract: () => HubContract;
  /** Releases whatever the adapter holds open; the store is not used after. */
  readonly close: () => Promise<void>;
}

/** A row's origin: the store it originated in and its sequence number there. */
export interface IndexOriginPair {
  /** The row's `origin_store`. */
  readonly originStore: string;
  /** The row's `origin_seq`. */
  readonly originSeq: number;
}

/** What one rebuild of the index asks. */
export interface IndexRebuildRequest {
  /** The project whose rows the index holds, recorded in its metadata. */
  readonly project: string;
  /** Which half is rebuilt; both when left out. */
  readonly scope?: 'fts' | 'vector' | 'all';
}

/** An index table with the rows a rebuild counted in it. */
export interface IndexTableRows {
  /** The index table's name. */
  readonly table: string;
  /** The rows it holds. */
  readonly rows: number;
}

/** What one rebuild that swapped its new index in answers. */
export interface IndexRebuildResult {
  /** The project recorded in the index's metadata. */
  readonly project: string;
  /** The build stamp recorded in the index's metadata. */
  readonly stamp: string;
  /** The rows read from the store, one full-text row each. */
  readonly rows: number;
  /** The rows embedded, one vector row each: `rows` with vector search on, 0 with it off. */
  readonly vectors: number;
  /** Each index table with the rows the rebuild's check counted in it. */
  readonly tables: readonly IndexTableRows[];
  /** Whether the index holds the vector half. */
  readonly vector: boolean;
  /** Why it does not, `null` when it does. */
  readonly why: string | null;
}

/** What one search of the index asks. */
export interface IndexSearchRequest {
  /**
   * How the hits are found: `fts` by full text, `vector` by embedding,
   * `hybrid` both fused by rank. `vector` and `hybrid` are refused when
   * {@link HubCapabilities.vector} is `false`.
   */
  readonly mode: 'fts' | 'vector' | 'hybrid';
  /** The words searched for, plain text. */
  readonly query: string;
  /** The most hits answered, a whole number above zero; the connector's default when left out. */
  readonly limit?: number;
}

/** One hit: the row's table and origin pair, and its score. Never a row body. */
export interface IndexSearchHit {
  /** The store table the row lives in. */
  readonly table: string;
  /** The row's origin pair, its identity on every device and on the hub. */
  readonly origin: IndexOriginPair;
  /** The hit's score in its mode, higher is better. */
  readonly score: number;
}

/** What one search answers: row references, best first, which a reader fetches through {@link HubStore}. */
export interface IndexSearchResult {
  /** The hits, best first. */
  readonly hits: readonly IndexSearchHit[];
}

/** What one walk over `ref_links` asks. */
export interface IndexLinksRequest {
  /** The start node's kind, such as `commit` or `issue`. */
  readonly kind: string;
  /** The start node's id, such as a sha or `#1436`. */
  readonly id: string;
  /** The most hops taken, a whole number above zero; one when left out. */
  readonly depth?: number;
}

/** One node a walk reached: its kind and id, and the fewest hops to it. Never a row body. */
export interface IndexLink {
  /** The node's kind. */
  readonly kind: string;
  /** The node's id. */
  readonly id: string;
  /** The fewest hops from the start node, from 1 to the request's depth. */
  readonly depth: number;
}

/** What one walk answers: whether the store holds `ref_links`, and the nodes reached, nearest first. */
export interface IndexLinksResult {
  /** Whether the store holds a `ref_links` table; `false` answers no links. */
  readonly graph: boolean;
  /** The nodes reached, nearest first. */
  readonly links: readonly IndexLink[];
}

/**
 * The hub's index: the projection over the rows its {@link HubStore}
 * holds, rebuilt from them and never migrated. Every answer is a frozen
 * plain record; see the module note on what crosses it.
 */
export interface HubIndex {
  /** Rebuilds the index from the store's rows beside the live one and swaps it in; the store is left untouched. */
  readonly rebuild: (request: IndexRebuildRequest) => Promise<IndexRebuildResult>;
  /** The rows matching a query, as references; refused for a mode its capabilities do not hold. */
  readonly search: (request: IndexSearchRequest) => Promise<IndexSearchResult>;
  /** The nodes reached from one node over `ref_links`, recursively. */
  readonly links: (request: IndexLinksRequest) => Promise<IndexLinksResult>;
  /** What the index can answer, computed once when the connector opened. */
  readonly capabilities: () => HubCapabilities;
}

/** What an adapter factory is handed, by the hub or by the contract suite. */
export interface HubStoreContext {
  /** A directory the adapter may keep files in, empty the first time. */
  readonly directory: string;
  /** The clock every push is stamped from. */
  readonly now: () => Date;
}

/** Makes one adapter's store over a context. */
export type HubStoreFactory = (context: HubStoreContext) => HubStore | Promise<HubStore>;

/**
 * Opens one connector's store and its index over a context, the pair a
 * hub serves and both contract suites run over: {@link HubStore}'s
 * `contract.ts` and {@link HubIndex}'s `index-contract.ts`.
 */
export type HubConnector = (context: HubStoreContext) => Promise<{ readonly store: HubStore; readonly index: HubIndex }>;
