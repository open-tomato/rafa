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
 * `pushed` with no path: the rows were delivered. A hub whose store
 * lacks a migration this one applied refuses the push with a `409`
 * naming the ids in `missing`, written as {@link HubUpgradeRequired}:
 * `effort sync: the hub is behind this rafa (migration <ids>); nothing
 * was sent. Next step: upgrade the hub, then sync again`. A `409` naming
 * no `missing`, from an older hub, passes on as `HubRefused` with its
 * message as it stands. Neither moves the push cursor.
 *
 * ## Pull
 *
 * Asks the hub for the rows other origins created past the pull cursor.
 * A payload naming a migration this rafa does not know is refused with
 * {@link RafaUpdateRequired}, `effort sync: this rafa is behind the hub
 * (migration <ids>); nothing was merged. Next step: rafa self-update,
 * then sync again`, whether or not it holds rows: its rows could not be
 * read here. Then:
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
 * ## The projected pull
 *
 * Under `effort.syncSkew: pull-projected` (core's key, which `selectSync`
 * hands on with the hub as `hub.syncSkew`; `refuse` when left out),
 * the pull sends the migrations this build knows, so a hub whose status
 * answered `projection: true` answers the rows cut down to this rafa's
 * schema rather than rows it could not read. A hub that cannot project
 * is sent no migrations (`client.ts`) and its rows are refused as
 * above, as under `refuse`; one that can but whose store cannot
 * answers a `409` naming in `missing` the ids this rafa lacks, written
 * as the same {@link RafaUpdateRequired}. A pull `409` naming no
 * `missing` passes on as `HubRefused` as it stands.
 *
 * A projected answer carries `projected`, each cut table with the ids
 * its rows lack, and is merged with that map as `mergeStore`'s option
 * of that name, so the merge lists each cut row in the store's
 * `held_rows`. Before the merge, outside a dry run, the state file
 * keeps `heldBack`, the pull cursor this contact started from, with
 * the time: only the first projected contact sets it, and a later one
 * leaves it there (`keepHeldBack`, `state.ts`), so the refill pulls
 * every row a projected contact cut. It is kept before the merge since
 * a `heldBack` with nothing cut after it costs a refill rows it already
 * holds, where a merge with no `heldBack` would lose the cut columns.
 * A projected pull that merged answers `pulled` with
 * {@link ServicePullResult.notice}, the line the contact writes:
 * `effort sync: pulled <n> rows projected to this rafa's schema; <m>
 * columns wait for rafa self-update`. `<n>` is the rows the answer
 * carried. `<m>` counts the columns the answer's `projectedColumns`
 * names, one per cut table and column: this build's catalogue cannot
 * name a newer build's columns, so the hub, whose schema holds them,
 * names them. A projected answer naming no `projectedColumns` counts
 * none.
 *
 * ## The refill
 *
 * The refill is the first pull, under either `syncSkew`, from a build
 * whose catalogue knows every migration id the store's `held_rows`
 * lists (core's `readHeldMigrations`) while the state file keeps a
 * `heldBack`: that pull asks the hub past `heldBack`'s cursor rather
 * than the pull cursor, so every row a projected contact cut comes
 * again. A build still lacking a listed id pulls past the pull cursor,
 * projected under `pull-projected` as above. The refill's answer is
 * merged as any pull's, and a whole one, naming no `projected`, takes
 * each held row whole (`mergeStore`'s held-copy step); outside a dry
 * run `heldBack` is then cleared, once the pull cursor is written. A
 * refill that merged answers `pulled` with the notice `effort sync:
 * refilled <n> rows held back since <date>`, `<n>` the merge's
 * `rowsRefilled` and `<date>` the UTC date `heldBack` was kept. A
 * refill answered projected again, by a hub that went further ahead
 * than this build, keeps `heldBack` and answers the `pulled <n> rows
 * projected` line; a dry run merges, checks and deletes and clears
 * nothing.
 *
 * A `heldBack` with nothing listed in `held_rows`, kept by a projected
 * answer that cut no table, is no refill: its contact pulls past the
 * pull cursor, since a pull past `heldBack` would refill nothing and,
 * on a build still behind, be projected again on every contact. A
 * whole answer to it clears `heldBack` outside a dry run, as nothing
 * waits to be refilled.
 *
 * The request's `sessionId` is the merge's own: a loop run's end-of-task
 * pull names its session id, and the merge's live-loop guard passes that
 * run's record and refuses any other live one, sharing its pid or not.
 *
 * The pull cursor becomes the payload's once a merge was swapped in or
 * no row needed one. A dry run builds, checks and deletes the merge and
 * moves no cursor, and a refusal moves none either.
 *
 * The migrations this rafa knows are learned once per strategy, on its
 * first pull before it asks the hub, as `rafa-hub` learns its own: two empty payloads are
 * materialised under the temporary directory, one merged into the
 * other, which brings it to every migration this build knows, and its
 * export names them. The store subpath exports no catalogue.
 *
 * ## The project
 *
 * Push and pull name the store's project to the hub as `project`: the
 * resolved `hub.project` when it is set, or else the root commit of the
 * repository at `repoRoot`, core's `readProjectIdentity(repoRoot)
 * .rootCommit`, read once per strategy, at its first contact after the
 * store's origin. Nobody is expected to set `hub.project`. A repository
 * with no commit has no root commit, so with `hub.project` unset push
 * and pull are refused with {@link ServiceSyncRefusal} in one line
 * naming both, before the token or the status is read: nothing is sent
 * or merged, and no cursor moves. The hub client sends the project only
 * to a hub whose status names `projects` (`client.ts`).
 *
 * ## The contract version
 *
 * Each push and pull reads the hub's status before it exports or asks
 * for anything; the hub client reads it once and keeps it, so a
 * strategy reads it once. A hub whose `contractVersion` is not this
 * rafa's, core's `WIRE_CONTRACT_VERSION`, is refused with
 * {@link HubContractMismatch} before `exportWirePayload` runs and
 * before any push or pull request: nothing is exported, sent or
 * merged, and no cursor moves. Its next step is {@link SELF_UPDATE}
 * when the hub is ahead, and upgrading the hub at `hub.url` when this
 * rafa is. A hub one release behind names no version and reads as
 * version `1` (`client.ts`), so it is not refused. A store with no file
 * yet answers `nothing-to-sync` with no contact, the status read
 * included.
 *
 * ## After a merge
 *
 * A merged store keeps its origin: core carries the `store_meta` row
 * through the swap, so a pull that merged moves nothing. `sync.test.ts`
 * measures both sides: a store records the same origin after a pull
 * merged and a write followed, and a copy renamed over the store, which
 * could be a second store, mints a new one. The state file keys its
 * cursors by origin, so a minted store's next contact starts both
 * cursors from zero and resends what it holds; both sides skip every
 * row they hold, so this costs time and never a row.
 *
 * ## Errors
 *
 * The hub client's own errors pass through: `HubUnreachable` (named so,
 * which core's contact matches) for a connect failure, the timeout or a
 * `5xx`, and `HubRefused` for a `4xx` such as a token refusal or a
 * `409` naming no `missing`, which is not unreachable. So does the token reader's
 * `HubTokenError`. A status read that fails passes its error through
 * the same way, so an unreachable hub is unreachable for push and pull
 * alike. The token is read once per strategy, at its first
 * contact, never when it is made.
 */
import type { HubClient, HubPullOptions } from './client.js';
import type { SecretReader } from './token.js';
import type { Sync, SyncPullRequest, SyncPullResult, SyncPushRequest, SyncPushResult } from '@open-tomato/rafa/ports';
import type { MergeOptions, StoreBackend, StoreMergeResult, WireCursor, WirePayload } from '@open-tomato/rafa/store';

import { randomUUID } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';

import {
  exportWirePayload,
  materialiseWirePayload,
  mergeStore,
  openSqliteStore,
  readHeldMigrations,
  STORE_BACKENDS,
  WIRE_CONTRACT_VERSION,
  WIRE_FORMAT,
  WIRE_VERSION,
} from '@open-tomato/rafa/store';
import { readProjectIdentity } from '@open-tomato/rafa/store/store-identity';
import { Database } from 'bun:sqlite';

import { createHubClient, HubRefused } from './client.js';
import { clearHeldBack, keepHeldBack, readSyncCursors, syncStatePath, writeSyncCursor } from './state.js';
import { defaultSecretReader, readHubToken } from './token.js';

/** The status a hub's migration refusal answers with. */
const CONFLICT = 409;

/** How many characters of an ISO 8601 time are its date: `YYYY-MM-DD`. */
const ISO_DATE_LENGTH = 10;

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

/** The next step a hub behind this rafa names: the hub's store lacks a migration this rafa applied. */
export const UPGRADE_HUB = 'upgrade the hub';

/** The ids `missing` names, as the refusal lines spell them. */
function idsOf(missing: readonly string[]): string {
  return missing.join(', ');
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
      `effort sync: this rafa is behind the hub (migration ${idsOf(missing)}); nothing was merged.`
        + ` Next step: ${SELF_UPDATE}, then sync again`,
    );
    this.missing = Object.freeze([...missing]);
  }
}

/** A push the hub refused with a `409` naming the migrations it lacks: the hub is behind this rafa. */
export class HubUpgradeRequired extends Error {
  override readonly name = 'HubUpgradeRequired';
  /** The ids the hub's `409` named in `missing`, in the hub's order. */
  readonly missing: readonly string[];
  /** The one thing to do next: {@link UPGRADE_HUB}. */
  readonly nextStep: string = UPGRADE_HUB;

  constructor(missing: readonly string[]) {
    super(
      `effort sync: the hub is behind this rafa (migration ${idsOf(missing)}); nothing was sent.`
        + ` Next step: ${UPGRADE_HUB}, then sync again`,
    );
    this.missing = Object.freeze([...missing]);
  }
}

/** The ids a hub's `409` named in `missing`, or undefined for any other error and a `409` naming none. */
function conflictMissing(error: unknown): readonly string[] | undefined {
  return error instanceof HubRefused && error.status === CONFLICT && error.missing !== undefined && error.missing.length > 0
    ? error.missing
    : undefined;
}

/** Sends `payload` under `origin`, writing a `409` that names `missing` as {@link HubUpgradeRequired}. */
async function pushOrRefuse(client: HubClient, origin: string, payload: WirePayload): Promise<void> {
  try {
    await client.push(origin, payload);
  } catch (error) {
    const missing = conflictMissing(error);
    if (missing !== undefined) throw new HubUpgradeRequired(missing);
    throw error;
  }
}

/** Pulls past `since` for `origin`, writing a `409` that names `missing` as {@link RafaUpdateRequired}. */
async function pullOrRefuse(client: HubClient, origin: string, since: WireCursor, options: HubPullOptions): Promise<WirePayload> {
  try {
    return await client.pull(origin, since, options);
  } catch (error) {
    const missing = conflictMissing(error);
    if (missing !== undefined) throw new RafaUpdateRequired(missing);
    throw error;
  }
}

/** The line a projected pull that merged answers; see the module note for what `rows` and `columns` count. */
export function projectedPullLine(rows: number, columns: number): string {
  return `effort sync: pulled ${String(rows)} rows projected to this rafa's schema; ${String(columns)} columns wait for ${SELF_UPDATE}`;
}

/**
 * The line a refill that merged answers: `rows` the held rows the merge
 * took whole, `since` the time `heldBack` was kept, written as its UTC
 * date. See the module note.
 */
export function refilledLine(rows: number, since: string): string {
  const date = new Date(since)
    .toISOString()
    .slice(0, ISO_DATE_LENGTH);
  return `effort sync: refilled ${String(rows)} rows held back since ${date}`;
}

/** The next step a contract mismatch names when this rafa is ahead of the hub at `url`. */
export function upgradeHubStep(url: string): string {
  return `upgrade the hub at ${url} to a rafa-hub that speaks this rafa's contract`;
}

/** A hub whose wire contract version is not this rafa's: refused before anything is exported or sent. */
export class HubContractMismatch extends Error {
  override readonly name = 'HubContractMismatch';
  /** The contract version the hub speaks. */
  readonly hubVersion: number;
  /** The contract version this rafa speaks: core's `WIRE_CONTRACT_VERSION`. */
  readonly rafaVersion: number;
  /** The one thing to do next: {@link SELF_UPDATE} when the hub is ahead, {@link upgradeHubStep} when this rafa is. */
  readonly nextStep: string;

  constructor(hubVersion: number, rafaVersion: number, hubUrl: string) {
    const nextStep = hubVersion > rafaVersion
      ? SELF_UPDATE
      : upgradeHubStep(hubUrl);
    super(
      `effort sync: the hub speaks contract ${String(hubVersion)}, this rafa contract ${String(rafaVersion)};`
        + ` nothing was sent. Next step: ${nextStep}`,
    );
    this.hubVersion = hubVersion;
    this.rafaVersion = rafaVersion;
    this.nextStep = nextStep;
  }
}

/**
 * What a sync does when this device is behind its hub: core's
 * `SyncSkewMode`, the resolved `effort.syncSkew`, spelled here as the
 * adapter context's `hub` spells its own shape.
 */
export type ServiceSyncSkew = 'refuse' | 'pull-projected';

/** A pull's answer: core's `SyncPullResult`, a projected pull that merged also carrying the line to write. */
export type ServicePullResult =
  | SyncPullResult
  | (Extract<SyncPullResult, { readonly status: 'pulled' }> & {
    /** The `pulled <n> rows projected` line; see the module note. */
    readonly notice: string;
  });

/** The `service` strategy: a `Sync` whose pull answers {@link ServicePullResult}. */
export interface ServiceSync extends Sync {
  readonly kind: 'service';
  pull: (request: SyncPullRequest) => Promise<ServicePullResult>;
}

/** The hub a strategy reaches, as `selectSync` hands it: `AdapterContext.hub`. */
export interface ServiceHub {
  /** The resolved `hub.url`. */
  readonly url: string;
  /** The resolved `hub.tokenSecret`: the secret's name, never the token. */
  readonly tokenSecret: string | null;
  /** The resolved `hub.timeout`, in milliseconds. */
  readonly timeoutMs: number;
  /** The resolved `effort.syncSkew`; `refuse` when left out. See the module note. */
  readonly syncSkew?: ServiceSyncSkew;
  /** The resolved `hub.project`; null or left out reads the repository's root commit. */
  readonly project?: string | null;
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
  /** Where the token is read from; `defaultSecretReader()` (`Bun.secrets` outside a test) when left out. */
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

/** The project push and pull name: `hub.project`, or else `repoRoot`'s root commit; see the module note. */
function resolveProject(repoRoot: string, configured: string | null | undefined): string {
  if (configured !== null && configured !== undefined) return configured;
  const { rootCommit } = readProjectIdentity(repoRoot);
  if (rootCommit !== null) return rootCommit;
  throw new ServiceSyncRefusal(
    `${REFUSAL}: the repository at ${repoRoot} has no root commit and hub.project is not set,`
      + ' so the hub could not tell which project its rows belong to. Nothing was sent.'
      + ' Next safe step: commit once in the repository, or set hub.project in .rafa/config.yaml',
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

/** The columns a projected answer's rows were cut of, one per table and column; see the module note. */
function waitingIn(payload: WirePayload): number {
  return Object.values(payload.projectedColumns ?? {}).reduce((total, columns) => total + columns.length, 0);
}

/** Merges `payload` into the store at `path` through a scratch store, with its `projected` map; see the module note. */
function mergePayload(path: string, payload: WirePayload, request: SyncPullRequest, now: () => Date): StoreMergeResult {
  const { dryRun, sessionId = null } = request;
  const { projected } = payload;
  const wire = materialiseWirePayload(payload, { now });
  try {
    const merge = mergeStore({
      path,
      otherPath: wire.path,
      backend: 'sqlite',
      dryRun,
      stamp: randomUUID(),
      now,
      sessionId,
      ...(projected === undefined
        ? {}
        : { projected }),
    });
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
export function createServiceSync(options: ServiceSyncOptions): ServiceSync {
  const { backend, hub } = options;
  const now = options.now ?? ((): Date => new Date());
  const storePath = openSqliteStore(options.repoRoot).path('commits');
  const statePath = syncStatePath(storePath);
  let client: Promise<HubClient> | undefined;
  let known: readonly string[] | undefined;
  let project: string | undefined;

  const hubClient = (): Promise<HubClient> => {
    project ??= resolveProject(options.repoRoot, hub.project);
    const named = project;
    client ??= readHubToken(hub.tokenSecret, options.readSecret ?? defaultSecretReader())
      .then((token) => createHubClient({ url: hub.url, token, timeoutMs: hub.timeoutMs, project: named, fetch: options.fetch }));
    return client;
  };

  /** The hub client, once its status names this rafa's contract; see the module note. */
  const agreedClient = async (): Promise<HubClient> => {
    const reached = await hubClient();
    const { contractVersion } = await reached.status();
    if (contractVersion !== WIRE_CONTRACT_VERSION) {
      throw new HubContractMismatch(contractVersion, WIRE_CONTRACT_VERSION, hub.url);
    }
    return reached;
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
    const reached = await agreedClient();
    const payload = exportWirePayload({ path: storePath, cursor: readSyncCursors(statePath, origin, hub.url).push });
    await pushOrRefuse(reached, origin, payload);
    writeSyncCursor(statePath, origin, hub.url, 'push', payload.cursor);
    return PUSHED;
  };

  const pull = async (request: SyncPullRequest): Promise<ServicePullResult> => {
    const { from, dryRun } = request;
    refusePath('from', from);
    const origin = originOf();
    if (origin === undefined) return NOTHING_TO_SYNC;
    const reached = await agreedClient();
    known ??= learnMigrations(now);
    const cursors = readSyncCursors(statePath, origin, hub.url);
    const { heldBack } = cursors;
    const held = heldBack === undefined
      ? []
      : readHeldMigrations(storePath);
    const caughtUp = held.every((id) => known?.includes(id) === true);
    const refill = heldBack !== undefined && held.length > 0 && caughtUp
      ? heldBack
      : undefined;
    const since = refill?.cursor ?? cursors.pull;
    const payload = await pullOrRefuse(reached, origin, since, hub.syncSkew === 'pull-projected'
      ? { migrations: known }
      : {});
    refuseUnknownMigrations(payload, known);
    const { projected } = payload;
    if (projected !== undefined && !dryRun) keepHeldBack(statePath, origin, hub.url, { cursor: since, since: now().toISOString() });
    const merge = rowsIn(payload) === 0
      ? undefined
      : mergePayload(storePath, payload, request, now);
    if (!dryRun) writeSyncCursor(statePath, origin, hub.url, 'pull', payload.cursor);
    if (heldBack !== undefined && projected === undefined && caughtUp && !dryRun) clearHeldBack(statePath, origin, hub.url);
    if (merge === undefined) return NOTHING_TO_SYNC;
    if (projected !== undefined) {
      return Object.freeze({ status: 'pulled', merge, notice: projectedPullLine(rowsIn(payload), waitingIn(payload)) });
    }
    return Object.freeze(refill === undefined
      ? { status: 'pulled', merge }
      : { status: 'pulled', merge, notice: refilledLine(merge.rowsRefilled, refill.since) });
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
