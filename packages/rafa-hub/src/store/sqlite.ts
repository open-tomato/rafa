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
 * `planSchema` might refuse.
 *
 * ## Opening
 *
 * Opening learns this build's migration catalogue, which the store
 * subpath does not export: two empty payloads are materialised under
 * the temporary directory, one is merged into the other, which brings
 * it to every migration this rafa knows, and its export names them, and
 * the merged tables with them. The scratch files are removed. A store
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
 * ## What a development build refuses
 *
 * `mergeStore` refuses a development build (`bun` from a rafa checkout,
 * which this package's `bin` is when run from this repository) a write
 * to a store outside the temporary directory and `RAFA_EFFORT_DIR`.
 * The adapter passes that refusal on rather than overriding it.
 */
import type {
  HubDevice,
  HubPullRequest,
  HubPushRequest,
  HubPushResult,
  HubStore,
  HubStoreContext,
  HubStoreStatus,
} from './port.js';
import type { MergeOptions, WireCursor, WirePayload } from '@open-tomato/rafa/store';

import { randomUUID } from 'node:crypto';
import { existsSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import {
  exportWirePayload,
  materialiseWirePayload,
  mergeStore,
  WIRE_FORMAT,
  WIRE_VERSION,
} from '@open-tomato/rafa/store';
import { Database } from 'bun:sqlite';

import { DEFAULT_STORE_FILE } from '../config.js';

/** The package a hub refused as too old is upgraded to. */
export const HUB_PACKAGE = '@open-tomato/rafa-hub';

/** What a refused push is told to do next. */
export const HUB_UPGRADE = `upgrade the hub to a ${HUB_PACKAGE} release whose rafa knows these migrations, then push again`;

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

/** What the adapter may vary beyond the port's context. */
export interface SqliteHubStoreOptions {
  /** The store file's name in the context's directory; {@link DEFAULT_STORE_FILE} when absent. */
  readonly fileName?: string;
}

/** This build's migrations and merged tables, as its own export names them. */
interface Catalogue {
  readonly migrations: readonly string[];
  readonly tables: readonly string[];
}

/** The merge's project reader: the hub's store names no project. */
const NO_PROJECT: NonNullable<MergeOptions['readProject']> = () => ({ rootCommit: null, remote: null });

const DEVICES_SCHEMA = 'CREATE TABLE IF NOT EXISTS devices (device TEXT PRIMARY KEY NOT NULL, last_push_at TEXT NOT NULL) STRICT';

const STAMP_DEVICE = `INSERT INTO devices (device, last_push_at) VALUES (?, ?)
  ON CONFLICT (device) DO UPDATE SET last_push_at = excluded.last_push_at`;

const READ_DEVICES = 'SELECT device, last_push_at AS lastPushAt FROM devices ORDER BY device';

/** The file each device's last push is kept in, beside the store `fileName`. */
export function devicesFileName(fileName: string): string {
  return `${fileName.replace(/\.sqlite$/, '')}.devices.sqlite`;
}

/** A payload with no rows naming `migrations`. */
function emptyPayload(migrations: readonly string[]): WirePayload {
  return { format: WIRE_FORMAT, version: WIRE_VERSION, migrations, tables: {}, cursor: {} };
}

/** Merges the store at `otherPath` into the one at `path`, swapping the merged file in. */
function merge(path: string, otherPath: string, now: () => Date): ReturnType<typeof mergeStore> {
  return mergeStore({
    path,
    otherPath,
    backend: 'sqlite',
    dryRun: false,
    stamp: randomUUID(),
    now,
    readProject: NO_PROJECT,
  });
}

/** Learns this build's catalogue from a scratch store it merges forward; see the module note. */
function readCatalogue(now: () => Date): Catalogue {
  const base = materialiseWirePayload(emptyPayload([]), { now });
  try {
    const other = materialiseWirePayload(emptyPayload([]), { now });
    try {
      merge(base.path, other.path, now);
    } finally {
      other.release();
    }
    const exported = exportWirePayload({ path: base.path });
    return Object.freeze({ migrations: exported.migrations, tables: Object.freeze(Object.keys(exported.tables)) });
  } finally {
    base.release();
  }
}

/** Builds an empty store holding `catalogue`'s migrations at `path`, in `directory`. */
function createStore(path: string, directory: string, catalogue: Catalogue, now: () => Date): void {
  const built = materialiseWirePayload(emptyPayload(catalogue.migrations), { now, tempDir: directory });
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
  const fileName = options.fileName ?? DEFAULT_STORE_FILE;
  const path = join(context.directory, fileName);
  const { now } = context;
  const catalogue = readCatalogue(now);
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
      const wire = materialiseWirePayload(payload, { now });
      try {
        const merged = merge(path, wire.path, now);
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

  const pull = (request: HubPullRequest): WirePayload => {
    const exported = exportWirePayload({ path, cursor: request.since });
    const tables = Object.fromEntries(Object.entries(exported.tables)
      .map(([table, rows]) => [table, Object.freeze(rows.filter((row) => row['origin_store'] !== request.device))]));
    return Object.freeze({ ...exported, tables: Object.freeze(tables) });
  };

  const status = (): HubStoreStatus => ({
    migrations: exportWirePayload({ path, cursor: pastEverything }).migrations,
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
    close: () => settle(() => {
      devices.close();
    }),
  };
}
