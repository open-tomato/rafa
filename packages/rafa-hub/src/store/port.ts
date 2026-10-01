/**
 * The hub's store port: what the hub keeps a team's effort rows in,
 * declared as types with no implementation behind them, so the routes
 * are written once and a storage backend is an adapter. SQLite's is
 * the first the plan for #325 lays down, as `sqlite.ts` beside this
 * file; a Postgres or Dolt adapter implements this same port and runs
 * the same cases, {@link HubStore}'s contract suite in `contract.ts`.
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

/** The hub's store: where every device's pushed rows are kept and pulled from. */
export interface HubStore {
  /** Takes a device's rows; see the module note on idempotence. */
  readonly push: (request: HubPushRequest) => Promise<HubPushResult>;
  /** The rows other origins created past `since`, with the cursor to pass next. */
  readonly pull: (request: HubPullRequest) => Promise<WirePayload>;
  /** Row counts, the schema and every device's last push. */
  readonly status: () => Promise<HubStoreStatus>;
  /** Releases whatever the adapter holds open; the store is not used after. */
  readonly close: () => Promise<void>;
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
