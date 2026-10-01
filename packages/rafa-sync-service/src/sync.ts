/**
 * The `service` sync strategy: a device's effort store synced through
 * `rafa-hub` (`packages/rafa-hub/`). This module's default export is
 * the `create` the package's `rafa` manifest names under
 * `provides.sync`, which core's `loadModules` registers as `sync/service`
 * and `selectSync` makes with the `AdapterContext` it builds.
 *
 * ## The store
 *
 * Both directions act on the SQLite file every other command opens,
 * `effort.sqlite` in `RAFA_EFFORT_DIR` or `<root>/.rafa/effort/`, as
 * core's `openSqliteStore(repoRoot).path` names it, and on the state
 * file beside it (`state.ts`). A device is named to the hub by its
 * store's origin, the `store_id` of its `store_meta` row, read from the
 * file before any contact. Before anything is read or sent:
 *
 *   - A project whose `store` is `ndjson` is refused with
 *     {@link ServiceSyncRefusal} naming `rafa effort move --to=sqlite`:
 *     its sessions and commits are NDJSON, which carries no origin.
 *   - A store file that is not there yet answers `nothing-to-sync` with
 *     no contact: it holds no rows to push and none to merge into. Its
 *     first write makes it, and it syncs on the contact after.
 *   - A store with no origin, one written only outside a git repository
 *     or by a rafa older than origins, is refused naming what mints one:
 *     the hub could not tell its rows apart from any other device's.
 *
 * ## Push
 *
 * Exports the rows past the push cursor with core's `exportWirePayload`
 * and sends them to the hub under the store's origin. Once the hub has
 * taken them, the push cursor becomes the export's. Every push reaches
 * the hub, one with no rows included, so the hub records the device's
 * last push and refuses a store newer than it at once. It answers
 * `pushed` with no path: the rows were delivered.
 *
 * ## Pull
 *
 * Asks the hub for the rows other origins created past the pull cursor.
 * A payload naming a migration this rafa does not know is refused with
 * {@link RafaUpdateRequired}, naming the ids and `rafa self-update`,
 * whether or not it holds rows: its rows could not be read here. Then:
 *
 *   - A payload holding no row is not merged, since a merge rewrites the
 *     whole file to add nothing. It answers `nothing-to-sync`.
 *   - Any other is built into a scratch store with core's
 *     `materialiseWirePayload` and merged into this one with core's
 *     `mergeStore`, the only route by which a row reaches the store, and
 *     answers `pulled` with the merge's result. Every refusal of the
 *     merge's is passed on unchanged. The merge's whole-file backup is
 *     removed once the merged file is in place, and the answer's
 *     `backupPath` is null: a device pulls on every contact, a loop at
 *     the end of every task, and the rows the merge added are still
 *     the hub's to answer again.
 *
 * The pull cursor becomes the payload's once a merge was swapped in or
 * no row needed one. A dry run builds, checks and deletes the merge and
 * moves no cursor, and a refusal moves none either.
 *
 * The migrations this rafa knows are learned once per strategy, on its
 * first pull, as `rafa-hub` learns its own: two empty payloads are
 * materialised under the temporary directory, one merged into the
 * other, which brings it to every migration this build knows, and its
 * export names them. The store subpath exports no catalogue.
 *
 * ## After a merge
 *
 * A merged file is a new file, so core mints the store a new origin at
 * its next writing open. `sync.test.ts` measures both sides: a store
 * records another origin after a pull merged and a write followed, and
 * keeps its origin across writes with no merge between them. The state
 * file keys its cursors by origin, so that store's next contact starts
 * both cursors from zero and resends what it holds; both sides skip
 * every row they hold, so this costs time and never a row.
 *
 * ## Errors
 *
 * The hub client's own errors pass through: `HubUnreachable` (named so,
 * which core's contact matches) for a connect failure, the timeout or a
 * `5xx`, and `HubRefused` for a `4xx` such as a token or migration
 * refusal, which is not unreachable. So does the token reader's
 * `HubTokenError`. The token is read once per strategy, at its first
 * contact, never when it is made.
 */
import type { HubClient } from './client.js';
import type { SecretReader } from './token.js';
import type { Sync, SyncPullRequest, SyncPullResult, SyncPushRequest, SyncPushResult } from '@open-tomato/rafa/ports';
import type { MergeOptions, StoreBackend, StoreMergeResult, WirePayload } from '@open-tomato/rafa/store';

import { randomUUID } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';

import {
  exportWirePayload,
  materialiseWirePayload,
  mergeStore,
  openSqliteStore,
  STORE_BACKENDS,
  WIRE_FORMAT,
  WIRE_VERSION,
} from '@open-tomato/rafa/store';
import { Database } from 'bun:sqlite';

import { createHubClient } from './client.js';
import { readSyncCursors, syncStatePath, writeSyncCursor } from './state.js';
import { bunSecretReader, readHubToken } from './token.js';

/** What every refusal opens with. */
const REFUSAL = 'effort sync (service)';

/** The command a refused pull names: it brings rafa to a build that knows more migrations. */
export const SELF_UPDATE = 'rafa self-update';

/** The command that moves an NDJSON project's rows into the SQLite store, as core spells it. */
export const MOVE_TO_SQLITE = 'rafa effort move --to=sqlite';

/** How long reading the origin waits on a writer: core's `effort.busyTimeoutMs` default. */
const BUSY_TIMEOUT_MS = 5000;

/** What a push or pull that moves no rows answers. */
const NOTHING_TO_SYNC: SyncPushResult & SyncPullResult = Object.freeze({ status: 'nothing-to-sync' });

/** What a push the hub took answers. */
const PUSHED: SyncPushResult = Object.freeze({ status: 'pushed', path: null });

/** The merge's project reader for the scratch stores: they name no project. */
const NO_PROJECT: NonNullable<MergeOptions['readProject']> = () => ({ rootCommit: null, remote: null });

/** A push or pull refused before anything was sent or merged. */
export class ServiceSyncRefusal extends Error {
  override readonly name = 'ServiceSyncRefusal';
}

/** A pull whose rows name migrations this rafa does not know. */
export class RafaUpdateRequired extends Error {
  override readonly name = 'RafaUpdateRequired';
  /** The ids the hub named that this rafa lacks, in the hub's order. */
  readonly missing: readonly string[];
  /** The one thing to do next: {@link SELF_UPDATE}. */
  readonly nextStep: string = SELF_UPDATE;

  constructor(missing: readonly string[]) {
    super(
      `${REFUSAL}: the hub's store has applied migration ${missing.join(', ')}, which this rafa does not know,`
        + ` so its rows cannot be merged here. Nothing was merged. Next step: ${SELF_UPDATE}, then sync again.`,
    );
    this.missing = Object.freeze([...missing]);
  }
}

/** The hub a strategy reaches, as `selectSync` hands it: `AdapterContext.hub`. */
export interface ServiceHub {
  /** The resolved `hub.url`. */
  readonly url: string;
  /** The resolved `hub.tokenSecret`: the secret's name, never the token. */
  readonly tokenSecret: string | null;
  /** The resolved `hub.timeout`, in milliseconds. */
  readonly timeoutMs: number;
}

/** The fields of core's `AdapterContext` this strategy reads. */
export interface ServiceSyncContext {
  readonly repoRoot: string;
  readonly store?: StoreBackend;
  readonly hub?: ServiceHub;
}

/** What {@link createServiceSync} is made with. */
export interface ServiceSyncOptions {
  /** The repository whose store is synced. */
  readonly repoRoot: string;
  /** The project's resolved `store` backend. */
  readonly backend: StoreBackend;
  readonly hub: ServiceHub;
  /** Where the token is read from; `Bun.secrets` when left out. */
  readonly readSecret?: SecretReader;
  /** The fetch the hub client calls; the global `fetch` when left out. */
  readonly fetch?: typeof fetch;
  /** The clock the scratch stores and the merge are stamped from. */
  readonly now?: () => Date;
}

/** A payload with no rows naming `migrations`. */
function emptyPayload(migrations: readonly string[]): WirePayload {
  return { format: WIRE_FORMAT, version: WIRE_VERSION, migrations, tables: {}, cursor: {} };
}

/** The migrations this build knows, learned from a scratch store it merges forward; see the module note. */
function learnMigrations(now: () => Date): readonly string[] {
  const base = materialiseWirePayload(emptyPayload([]), { now });
  try {
    const other = materialiseWirePayload(emptyPayload([]), { now });
    try {
      mergeStore({ path: base.path, otherPath: other.path, backend: 'sqlite', dryRun: false, stamp: randomUUID(), now, readProject: NO_PROJECT });
    } finally {
      other.release();
    }
    return exportWirePayload({ path: base.path }).migrations;
  } finally {
    base.release();
  }
}

/** Rejects a request path: this strategy fetches and delivers rows itself. */
function refusePath(field: 'to' | 'from', value: string | null): void {
  if (value === null) return;
  throw new TypeError(`${REFUSAL}: ${field} is ${JSON.stringify(value)}, expected null: this strategy reaches the hub itself`);
}

/** Refuses a project whose sessions and commits are NDJSON. */
function refuseNdjson(backend: StoreBackend): void {
  if (backend !== 'ndjson') return;
  throw new ServiceSyncRefusal(
    `${REFUSAL}: this project keeps its sessions and commits as NDJSON (store: ndjson), which carries no origin,`
      + ` so the hub could not tell its rows apart. Nothing was sent. Next safe step: ${MOVE_TO_SQLITE}`,
  );
}

/** The origin the store at `path` records, or a refusal naming what mints one. */
function readOrigin(path: string): string {
  const db = new Database(path, { readonly: true });
  let origin: unknown;
  try {
    db.run(`PRAGMA busy_timeout = ${String(BUSY_TIMEOUT_MS)}`);
    const hasMeta = db
      .query<{ name: string }, []>('SELECT name FROM sqlite_master WHERE type = \'table\' AND name = \'store_meta\'')
      .get() !== null;
    origin = hasMeta
      ? db.query<{ store_id: unknown }, []>('SELECT store_id FROM store_meta WHERE id = 1').get()?.store_id
      : undefined;
  } finally {
    db.close();
  }
  if (typeof origin === 'string' && origin !== '') return origin;
  throw new ServiceSyncRefusal(
    `${REFUSAL}: the store at ${path} records no origin, so the hub could not tell its rows apart from another device's.`
      + ' Nothing was sent. A rafa command that writes the store inside the project\'s git repository mints one.',
  );
}

/** The rows `payload` carries, across its tables. */
function rowsIn(payload: WirePayload): number {
  return Object.values(payload.tables).reduce((total, rows) => total + rows.length, 0);
}

/** Refuses a payload naming a migration outside `known`. */
function refuseUnknownMigrations(payload: WirePayload, known: readonly string[]): void {
  const missing = payload.migrations.filter((id) => !known.includes(id));
  if (missing.length > 0) throw new RafaUpdateRequired(missing);
}

/** Merges `payload` into the store at `path` through a scratch store; see the module note. */
function mergePayload(path: string, payload: WirePayload, dryRun: boolean, now: () => Date): StoreMergeResult {
  const wire = materialiseWirePayload(payload, { now });
  try {
    const merge = mergeStore({ path, otherPath: wire.path, backend: 'sqlite', dryRun, stamp: randomUUID(), now });
    if (merge.backupPath === null) return merge;
    rmSync(merge.backupPath, { force: true });
    return { ...merge, backupPath: null };
  } finally {
    wire.release();
  }
}

/**
 * Makes the `service` strategy over `options.repoRoot`'s store, for the
 * hub `options.hub` names. A new frozen `Sync` on each call; see the
 * module note for what push and pull do.
 */
export function createServiceSync(options: ServiceSyncOptions): Sync {
  const { backend, hub } = options;
  const now = options.now ?? ((): Date => new Date());
  const storePath = openSqliteStore(options.repoRoot).path('commits');
  const statePath = syncStatePath(storePath);
  let client: Promise<HubClient> | undefined;
  let known: readonly string[] | undefined;

  const hubClient = (): Promise<HubClient> => {
    client ??= readHubToken(hub.tokenSecret, options.readSecret ?? bunSecretReader)
      .then((token) => createHubClient({ url: hub.url, token, timeoutMs: hub.timeoutMs, fetch: options.fetch }));
    return client;
  };

  /** The store's origin, or undefined when there is no store yet. */
  const originOf = (): string | undefined => {
    refuseNdjson(backend);
    return existsSync(storePath)
      ? readOrigin(storePath)
      : undefined;
  };

  const push = async ({ to }: SyncPushRequest): Promise<SyncPushResult> => {
    refusePath('to', to);
    const origin = originOf();
    if (origin === undefined) return NOTHING_TO_SYNC;
    const payload = exportWirePayload({ path: storePath, cursor: readSyncCursors(statePath, origin, hub.url).push });
    await (await hubClient()).push(origin, payload);
    writeSyncCursor(statePath, origin, hub.url, 'push', payload.cursor);
    return PUSHED;
  };

  const pull = async ({ from, dryRun }: SyncPullRequest): Promise<SyncPullResult> => {
    refusePath('from', from);
    const origin = originOf();
    if (origin === undefined) return NOTHING_TO_SYNC;
    const payload = await (await hubClient()).pull(origin, readSyncCursors(statePath, origin, hub.url).pull);
    known ??= learnMigrations(now);
    refuseUnknownMigrations(payload, known);
    const merge = rowsIn(payload) === 0
      ? undefined
      : mergePayload(storePath, payload, dryRun, now);
    if (!dryRun) writeSyncCursor(statePath, origin, hub.url, 'pull', payload.cursor);
    return merge === undefined
      ? NOTHING_TO_SYNC
      : Object.freeze({ status: 'pulled', merge });
  };

  return Object.freeze({ kind: 'service', push, pull });
}

/**
 * The adapter's `create`, as `loadModules` imports it: the `service`
 * strategy over `context.repoRoot`, for the project's `store` backend
 * and the `hub` `selectSync` hands on. Refuses a context naming no hub
 * or no backend, as a strategy that guessed either would sync the wrong
 * rows or none.
 */
export default function create(context: ServiceSyncContext): Sync {
  const { repoRoot, store, hub } = context;
  if (hub === undefined) {
    throw new ServiceSyncRefusal(`${REFUSAL}: no hub was handed to the strategy; set hub.url in .rafa/config.yaml`);
  }
  if (store === undefined || !(STORE_BACKENDS as readonly unknown[]).includes(store)) {
    throw new TypeError(
      `${REFUSAL}: the context names store ${JSON.stringify(store) ?? 'undefined'}, expected one of: ${STORE_BACKENDS.join(', ')}`,
    );
  }
  return createServiceSync({ repoRoot, backend: store, hub });
}
