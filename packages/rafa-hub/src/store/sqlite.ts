/**
 * The hub store port's SQLite adapter: the team's rows kept in one
 * effort store file, so that every push is merged by core's own merge
 * (`mergeStore`, #322) and a pull is core's own export. It reaches core
 * only through `@open-tomato/rafa/store`.
 *
 * ## Files
 *
 * The store is {@link SqliteHubStoreOptions.fileName} in the context's
 * directory, `rafa-hub.sqlite` by default as `hub.storePath` is: an
 * effort store as a device's is, which a device's rafa could read. Each
 * device's last push is kept beside it in its own file, the store's name
 * with `.devices.sqlite` for `.sqlite` ({@link devicesFileName}), and
 * never in the store: `mergeStore` builds every merge in a new file and
 * renames it over the store, and a table it does not know would be one
 * `planSchema` might refuse. For the same reason the index
 * {@link connectSqliteHub} opens is its own file too, the store's name with
 * `.index.sqlite` for `.sqlite` ({@link indexFileName}); `sqlite-index.ts`
 * says how it is attached, rebuilt and attached again.
 *
 * ## Opening
 *
 * Opening learns the migration catalogue the store is kept at, which
 * the store subpath does not export: two empty payloads are materialised
 * under the temporary directory, one is merged into the other, which
 * brings it to every migration of the catalogue, and its export names
 * them, and the merged tables with them. The scratch files are removed.
 * The catalogue is this build's own unless
 * {@link SqliteHubStoreOptions.migrations} hands another down, as a test
 * does to stand a hub one migration ahead of the build that runs it;
 * every materialise and merge the store runs then takes that one. A store
 * file that is not there is then built as an empty payload naming that
 * catalogue, materialised beside it and renamed into place, so the file
 * exists once the adapter is open. An open that fails throws, which is
 * what the server answers `503` on `/health` for. A store left behind
 * by an older hub is not brought forward on open; the next push's merge
 * brings it forward, as a merge brings any store it writes.
 *
 * ## Push
 *
 * In this order:
 *
 *   1. A payload naming a migration outside the catalogue is refused
 *      with {@link HubUpgradeRequired}, naming the ids and the hub
 *      upgrade to run, before anything is written: its store is newer
 *      than this hub. A payload naming fewer is taken, since the merge
 *      brings its materialised store forward.
 *   2. A payload holding rows is materialised (`materialiseWirePayload`)
 *      and merged into the store (`mergeStore`), the only route by which
 *      a row reaches it. `added` is the merge's `rowsAdded`: a row whose
 *      origin pair the store holds is matched and skipped. A payload
 *      holding no row is not merged, since a merge rewrites the whole
 *      file to add nothing.
 *   3. The merge's whole-file backup, `<store>.before-merge-<stamp>.bak`,
 *      is removed once the merged file is in place. A merge swaps in a
 *      file it has already checked, and a hub keeping one backup per
 *      push would hold a copy of its store for every push it took.
 *   4. The device's last push is stamped at the context's clock.
 *
 * Every step is synchronous, so one push runs to its end before any
 * other request is served, and two pushes never build over the same
 * file. One process holds the store: two hubs over one file would each
 * rename a merge over the other's.
 *
 * The merge is handed a project reader that names no project. The
 * store is never opened for writing through a device's route, so it is
 * never minted and records no project, and the merge would otherwise
 * ask git about the directory the hub keeps its file in.
 *
 * ## Pull
 *
 * The store's export past the cursor (`exportWirePayload`), with every
 * row whose `origin_store` is the caller's left out. The export's `seq`
 * is the store's own, so it is the hub `seq` the port names, and its
 * cursor, one snapshot of the store, moves past the rows left out too.
 *
 * ## The projected pull
 *
 * A pull naming the caller's `migrations` is projected when the store
 * holds an id the caller lacks; one naming every id the store holds, or
 * more, is answered whole, as a pull naming none is. The projection is
 * read off scratch stores, never assumed from a migration's SQL: one
 * empty payload is materialised at the held ids the caller names, the
 * caller's schema, and one more per lacking id, each adding that id to
 * the last, in catalogue order. A merged table whose columns change
 * between two of them lacks that step's id. The answer then:
 *
 *   - names the held ids the caller names as its `migrations`, so the
 *     caller materialises it through its own;
 *   - leaves out of `tables` and `cursor` every table the caller's
 *     schema does not make, so its next pull reads it from the start;
 *   - carries every other table's rows with only the columns the
 *     caller's schema gives it, and names each table it cut in
 *     `projected`, with the ids that table lacks. A lacking id that cut
 *     no table leaves `projected` as `{}`, a projection that cut none.
 *
 * A plan is kept per pair of held and named lists, up to
 * {@link PROJECTION_PLANS} of them, the oldest dropped first, so a
 * device pulling again builds no scratch store. The plan is built from
 * the held ids the caller names, so an id the caller names that the
 * store lacks, a device ahead, changes nothing: that device is never
 * projected, and its push is refused as above.
 *
 * ## Contract
 *
 * `contract()` answers `WIRE_CONTRACT_VERSION`, the contract version
 * this build's rafa speaks, with the migration ids the store file holds,
 * read from the file as `status()` reads them so the two never disagree.
 * The store {@link openSqliteHubStore} opens answers `projection: true`
 * and `fts`, `vector` and `graph` `false`: projection is a promise about
 * its own pull, and it has no index to search or walk. The store
 * {@link connectSqliteHub} opens answers `fts`, `vector` and `graph` from
 * its index and `projection` from the store, since the index answers no
 * `projection`.
 *
 * ## The connector
 *
 * {@link connectSqliteHub} is the `sqlite` `HubConnector`: the store
 * above and its index, `sqlite-index.ts`, over one context. It calls the
 * loader (`prepareSqlite`) before it opens any database, since on macOS a
 * SQLite library is named only before the process's first open. Then it
 * learns the catalogue, the one its `migrations` option hands down
 * when given, opens the store and opens the index, handing it the
 * loader's answer, the embedder and the catalogue's tables. The
 * index is opened once the store file exists, and a failed index open
 * closes the store. Closing the store closes the index's connection too,
 * since the port's index has no close of its own.
 *
 * ## What a development build refuses
 *
 * `mergeStore` refuses a development build (`bun` from a rafa checkout,
 * which this package's `bin` is when run from this repository) a write
 * to a store outside the temporary directory and `RAFA_EFFORT_DIR`.
 * The adapter passes that refusal on rather than overriding it.
 */
import type {
  HubCapabilities,
  HubContract,
  HubDevice,
  HubIndex,
  HubPullRequest,
  HubPushRequest,
  HubPushResult,
  HubStore,
  HubStoreContext,
  HubStoreStatus,
} from './port.js';
import type { SqliteHubIndex } from './sqlite-index.js';
import type { MergeOptions, WireCursor, WirePayload, WireRow } from '@open-tomato/rafa/store';
import type { IndexEmbedder, PrepareOptions } from '@open-tomato/rafa-index';

import { randomUUID } from 'node:crypto';
import { existsSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import {
  exportWirePayload,
  materialiseWirePayload,
  mergeStore,
  WIRE_CONTRACT_VERSION,
  WIRE_FORMAT,
  WIRE_VERSION,
} from '@open-tomato/rafa/store';
import { prepareSqlite } from '@open-tomato/rafa-index';
import { Database } from 'bun:sqlite';

import { DEFAULT_STORE_FILE } from '../config.js';

import { openSqliteHubIndex } from './sqlite-index.js';

/** The package a hub refused as too old is upgraded to. */
export const HUB_PACKAGE = '@open-tomato/rafa-hub';

/** What a refused push is told to do next. */
export const HUB_UPGRADE: string = `upgrade the hub to a ${HUB_PACKAGE} release whose rafa knows these migrations, then push again`;

/** A push whose store has applied migrations this hub does not know. */
export class HubUpgradeRequired extends Error {
  override readonly name = 'HubUpgradeRequired';
  /** The ids the payload named that the hub lacks, in the payload's order. */
  readonly missing: readonly string[];
  /** The one thing to do next: {@link HUB_UPGRADE}. */
  readonly nextStep: string = HUB_UPGRADE;

  constructor(missing: readonly string[]) {
    super(`rafa-hub: the pushing store has applied migration ${missing.join(', ')}, which this hub does not know. Nothing was merged. Next step: ${HUB_UPGRADE}.`);
    this.missing = Object.freeze([...missing]);
  }
}

/** A migration catalogue, in apply order: the entries `mergeStore` brings a store through. */
export type HubMigrationCatalogue = NonNullable<MergeOptions['migrations']>;

/** What the adapter may vary beyond the port's context. */
export interface SqliteHubStoreOptions {
  /** The store file's name in the context's directory; {@link DEFAULT_STORE_FILE} when absent. */
  readonly fileName?: string;
  /** The catalogue the store is kept at, in place of this build's own; see the module note. */
  readonly migrations?: HubMigrationCatalogue;
}

/** What the connector may vary beyond the store's options. */
export interface SqliteHubConnectorOptions extends SqliteHubStoreOptions {
  /** The embedder vector search embeds with; without one, `vector` is `false`. */
  readonly embedder?: IndexEmbedder;
  /** The loader's inputs (`hub.store.sqliteLibrary` is its `library`), the process's own when left out. */
  readonly loader?: PrepareOptions;
  /** The project an index built at open records; {@link DEFAULT_INDEX_PROJECT} when left out. */
  readonly project?: string;
}

/** The project an index built at open records when the connector is given none. */
export const DEFAULT_INDEX_PROJECT = 'rafa-hub';

/** The store and index the `sqlite` connector opens. */
export interface SqliteHub {
  readonly store: HubStore;
  readonly index: HubIndex;
}

/** The catalogue's migrations and merged tables, as its own export names them. */
interface Catalogue {
  readonly migrations: readonly string[];
  readonly tables: readonly string[];
  /** The entries handed down, `undefined` for this build's own. */
  readonly entries: HubMigrationCatalogue | undefined;
}

/** Each merged table a schema makes, with its columns. */
type Shape = ReadonlyMap<string, readonly string[]>;

/** How a pull from a caller lacking some held ids is answered; see the module note. */
interface ProjectionPlan {
  /** The held ids the caller names, in the store's order: the answer's `migrations`. */
  readonly migrations: readonly string[];
  /** The caller's schema. */
  readonly shape: Shape;
  /** Each table of the caller's schema the lacking ids cut, with the ids that cut it. */
  readonly cut: ReadonlyMap<string, readonly string[]>;
}

/** The most projection plans one store keeps; see the module note. */
export const PROJECTION_PLANS = 16;

/** The merge's project reader: the hub's store names no project. */
const NO_PROJECT: NonNullable<MergeOptions['readProject']> = () => ({ rootCommit: null, remote: null });

/** What the adapter can answer beyond push, pull and status: a projected pull, and no index of its own. */
const CAPABILITIES: HubCapabilities = Object.freeze({ fts: false, vector: false, graph: false, projection: true });

const DEVICES_SCHEMA = 'CREATE TABLE IF NOT EXISTS devices (device TEXT PRIMARY KEY NOT NULL, last_push_at TEXT NOT NULL) STRICT';

const STAMP_DEVICE = `INSERT INTO devices (device, last_push_at) VALUES (?, ?)
  ON CONFLICT (device) DO UPDATE SET last_push_at = excluded.last_push_at`;

const READ_DEVICES = 'SELECT device, last_push_at AS lastPushAt FROM devices ORDER BY device';

/** The file each device's last push is kept in, beside the store `fileName`. */
export function devicesFileName(fileName: string): string {
  return `${fileName.replace(/\.sqlite$/, '')}.devices.sqlite`;
}

/** The file the index is kept in, beside the store `fileName`. */
export function indexFileName(fileName: string): string {
  return `${fileName.replace(/\.sqlite$/, '')}.index.sqlite`;
}

/** A payload with no rows naming `migrations`. */
function emptyPayload(migrations: readonly string[]): WirePayload {
  return { format: WIRE_FORMAT, version: WIRE_VERSION, migrations, tables: {}, cursor: {} };
}

/** Merges the store at `otherPath` into the one at `path` under `entries`, swapping the merged file in. */
function merge(path: string, otherPath: string, now: () => Date, entries: HubMigrationCatalogue | undefined): ReturnType<typeof mergeStore> {
  return mergeStore({
    path,
    otherPath,
    backend: 'sqlite',
    dryRun: false,
    stamp: randomUUID(),
    migrations: entries,
    now,
    readProject: NO_PROJECT,
  });
}

/** Learns the catalogue, `entries` or this build's own, from a scratch store it merges forward; see the module note. */
function readCatalogue(now: () => Date, entries: HubMigrationCatalogue | undefined): Catalogue {
  const base = materialiseWirePayload(emptyPayload([]), { now, migrations: entries });
  try {
    const other = materialiseWirePayload(emptyPayload([]), { now, migrations: entries });
    try {
      merge(base.path, other.path, now, entries);
    } finally {
      other.release();
    }
    const exported = exportWirePayload({ path: base.path });
    return Object.freeze({ migrations: exported.migrations, tables: Object.freeze(Object.keys(exported.tables)), entries });
  } finally {
    base.release();
  }
}

/** Builds an empty store holding `catalogue`'s migrations at `path`, in `directory`. */
function createStore(path: string, directory: string, catalogue: Catalogue, now: () => Date): void {
  const built = materialiseWirePayload(emptyPayload(catalogue.migrations), { now, tempDir: directory, migrations: catalogue.entries });
  try {
    renameSync(built.path, path);
  } finally {
    built.release();
  }
}

/** Refuses a payload naming a migration outside `catalogue`. */
function refuseNewerStore(payload: WirePayload, catalogue: Catalogue): void {
  const missing = payload.migrations.filter((id) => !catalogue.migrations.includes(id));
  if (missing.length > 0) throw new HubUpgradeRequired(missing);
}

/** The rows held in each merged table the store at `path` holds. */
function countRows(path: string, tables: readonly string[]): Readonly<Record<string, number>> {
  const db = new Database(path, { readonly: true });
  try {
    const held = new Set(db
      .query<{ name: string }, []>('SELECT name FROM sqlite_master WHERE type = \'table\'')
      .all()
      .map(({ name }) => name));
    return Object.freeze(Object.fromEntries(tables
      .filter((table) => held.has(table))
      .map((table) => [table, db.query<{ n: number }, []>(`SELECT count(*) AS n FROM "${table}"`).get()?.n ?? 0])));
  } finally {
    db.close();
  }
}

/** The merged tables a scratch store at `ids` makes, with their columns; see the module note. */
function readShape(ids: readonly string[], catalogue: Catalogue, now: () => Date): Shape {
  const built = materialiseWirePayload(emptyPayload(ids), { now, migrations: catalogue.entries });
  try {
    const db = new Database(built.path, { readonly: true });
    try {
      const columns = db.query<{ name: string }, [string]>('SELECT name FROM pragma_table_info(?)');
      return new Map(catalogue.tables
        .map((table): [string, readonly string[]] => [table, Object.freeze(columns.all(table).map(({ name }) => name))])
        .filter(([, names]) => names.length > 0));
    } finally {
      db.close();
    }
  } finally {
    built.release();
  }
}

/** Whether two column lists name the same columns. */
function sameColumns(left: readonly string[] | undefined, right: readonly string[] | undefined): boolean {
  return [...left ?? []].sort().join(',') === [...right ?? []].sort().join(',');
}

/** How a pull from a caller naming `named` is projected off a store holding `held`; `null` when it is answered whole. */
function planProjection(held: readonly string[], named: readonly string[], catalogue: Catalogue, now: () => Date): ProjectionPlan | null {
  const lacking = held.filter((id) => !named.includes(id));
  if (lacking.length === 0) return null;
  const kept = held.filter((id) => named.includes(id));
  const shape = readShape(kept, catalogue, now);
  const steps = [shape, ...lacking.map((_, index) => readShape([...kept, ...lacking.slice(0, index + 1)], catalogue, now))];
  const cut = [...shape.keys()]
    .map((table): [string, readonly string[]] => [
      table,
      Object.freeze(lacking.filter((_, index) => !sameColumns(steps[index]?.get(table), steps[index + 1]?.get(table)))),
    ])
    .filter(([, ids]) => ids.length > 0);
  return Object.freeze({ migrations: Object.freeze(kept), shape, cut: new Map(cut) });
}

/** `row` with only `columns`. */
function pick(row: WireRow, columns: readonly string[]): WireRow {
  return Object.freeze(Object.fromEntries(columns.filter((column) => column in row).map((column) => [column, row[column] ?? null])));
}

/** `payload` projected under `plan`; see the module note. */
function project(payload: WirePayload, plan: ProjectionPlan): WirePayload {
  const tables = Object.fromEntries(Object.entries(payload.tables)
    .filter(([table]) => plan.shape.has(table))
    .map(([table, rows]) => {
      const columns = plan.shape.get(table);
      return [table, plan.cut.has(table) && columns !== undefined
        ? Object.freeze(rows.map((row) => pick(row, columns)))
        : rows];
    }));
  const cursor = Object.fromEntries(Object.entries(payload.cursor).filter(([table]) => plan.shape.has(table)));
  const projected = Object.fromEntries([...plan.cut].filter(([table]) => table in tables));
  return Object.freeze({
    ...payload,
    migrations: plan.migrations,
    tables: Object.freeze(tables),
    cursor: Object.freeze(cursor),
    projected: Object.freeze(projected),
  });
}

/** Runs `work` now, answering its value or its throw as a promise. */
function settle<T>(work: () => T): Promise<T> {
  return new Promise((resolve) => {
    resolve(work());
  });
}

/**
 * Opens the SQLite hub store in `context.directory`, creating its file
 * when it is not there. Throws when the catalogue cannot be learned or
 * the file cannot be made; see the module note.
 */
export function openSqliteHubStore(context: HubStoreContext, options: SqliteHubStoreOptions = {}): HubStore {
  return openStore(context, options.fileName ?? DEFAULT_STORE_FILE, readCatalogue(context.now, options.migrations));
}

/** Opens the store file `fileName` in the context's directory under a catalogue already learned. */
function openStore(context: HubStoreContext, fileName: string, catalogue: Catalogue): HubStore {
  const path = join(context.directory, fileName);
  const { now } = context;
  if (!existsSync(path)) createStore(path, context.directory, catalogue, now);
  const devices = new Database(join(context.directory, devicesFileName(fileName)), { create: true, readwrite: true, strict: true });
  devices.run(DEVICES_SCHEMA);
  const pastEverything: WireCursor = Object.fromEntries(catalogue.tables.map((table) => [table, Number.MAX_SAFE_INTEGER]));

  const push = (request: HubPushRequest): HubPushResult => {
    const { device, payload } = request;
    refuseNewerStore(payload, catalogue);
    const received = Object.values(payload.tables).reduce((total, rows) => total + rows.length, 0);
    let added = 0;
    if (received > 0) {
      const wire = materialiseWirePayload(payload, { now, migrations: catalogue.entries });
      try {
        const merged = merge(path, wire.path, now, catalogue.entries);
        added = merged.rowsAdded;
        if (merged.backupPath !== null) rmSync(merged.backupPath, { force: true });
      } finally {
        wire.release();
      }
    }
    const at = now().toISOString();
    devices.query(STAMP_DEVICE).run(device, at);
    return { received, added, at };
  };

  const plans = new Map<string, ProjectionPlan | null>();
  const planFor = (held: readonly string[], named: readonly string[]): ProjectionPlan | null => {
    const key = JSON.stringify([held, named]);
    const kept = plans.get(key);
    if (kept !== undefined) return kept;
    const plan = planProjection(held, named, catalogue, now);
    if (plans.size >= PROJECTION_PLANS) plans.delete(plans.keys().next().value ?? key);
    plans.set(key, plan);
    return plan;
  };

  const pull = (request: HubPullRequest): WirePayload => {
    const exported = exportWirePayload({ path, cursor: request.since });
    const tables = Object.fromEntries(Object.entries(exported.tables)
      .map(([table, rows]) => [table, Object.freeze(rows.filter((row) => row['origin_store'] !== request.device))]));
    const whole: WirePayload = Object.freeze({ ...exported, tables: Object.freeze(tables) });
    const plan = request.migrations === undefined
      ? null
      : planFor(exported.migrations, request.migrations);
    return plan === null
      ? whole
      : project(whole, plan);
  };

  const heldMigrations = (): readonly string[] => exportWirePayload({ path, cursor: pastEverything }).migrations;

  const status = (): HubStoreStatus => ({
    migrations: heldMigrations(),
    rows: countRows(path, catalogue.tables),
    devices: devices
      .query<HubDevice, []>(READ_DEVICES)
      .all()
      .map((row) => Object.freeze({ ...row })),
  });

  return {
    push: (request) => settle(() => push(request)),
    pull: (request) => settle(() => pull(request)),
    status: () => settle(status),
    contract: (): HubContract => Object.freeze({
      contractVersion: WIRE_CONTRACT_VERSION,
      migrations: heldMigrations(),
      capabilities: CAPABILITIES,
    }),
    close: () => settle(() => {
      devices.close();
    }),
  };
}

/**
 * The `sqlite` connector, a `HubConnector`: opens the store in
 * `context.directory` as {@link openSqliteHubStore} does, then its index
 * beside it, the loader called before either opens a database. Rejects
 * when the store or the index cannot be opened, with nothing left open;
 * see the module note.
 */
export async function connectSqliteHub(context: HubStoreContext, options: SqliteHubConnectorOptions = {}): Promise<SqliteHub> {
  const prepared = prepareSqlite(options.loader);
  const fileName = options.fileName ?? DEFAULT_STORE_FILE;
  const catalogue = readCatalogue(context.now, options.migrations);
  const store = openStore(context, fileName, catalogue);
  let half: SqliteHubIndex;
  try {
    half = await openSqliteHubIndex({
      embedder: options.embedder,
      indexPath: join(context.directory, indexFileName(fileName)),
      loaderState: options.loader?.state,
      now: context.now,
      prepared,
      project: options.project ?? DEFAULT_INDEX_PROJECT,
      storePath: join(context.directory, fileName),
      tables: catalogue.tables,
    });
  } catch (error) {
    await store.close();
    throw error;
  }
  const { index } = half;
  return {
    index,
    store: Object.freeze({
      ...store,
      close: async () => {
        half.close();
        await store.close();
      },
      contract: (): HubContract => {
        const own = store.contract();
        const capabilities: HubCapabilities = Object.freeze({ ...index.capabilities(), projection: own.capabilities.projection });
        return Object.freeze({ ...own, capabilities });
      },
    }),
  };
}
