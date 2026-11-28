/**
 * The push and pull halves of the SQLite hub store, over one served
 * project's store file: {@link openProjectStore} opens the file, with its
 * devices file beside it, and answers the port's push, pull and status
 * over that file alone. `sqlite.ts` learns the catalogue, lays the
 * projects out and routes each request to the file this module opened;
 * its module note says how the files are laid out and opened.
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
 * ask git about the directory the hub keeps its file in. The project a
 * push is for is chosen by the file it is merged into, never by the
 * merge.
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
 *     no table leaves `projected` as `{}`, a projection that cut none;
 *   - names in `projectedColumns` each such table's columns the store's
 *     own schema, the last scratch store, holds and the caller's does
 *     not, so the caller can count the columns waiting for it. A table
 *     cut by a rebuild that lost no column is left out of it.
 *
 * A plan is kept per pair of held and named lists, up to
 * {@link PROJECTION_PLANS} of them, the oldest dropped first, so a
 * device pulling again builds no scratch store. The plan is built from
 * the held ids the caller names, so an id the caller names that the
 * store lacks, a device ahead, changes nothing: that device is never
 * projected, and its push is refused as above.
 *
 * ## Pages
 *
 * A pull naming a `limit` is cut after the export and the projection,
 * so a table the caller's schema does not make never takes a row of
 * the page. The tables are taken in the order the export answers them,
 * each row in `seq` order, the caller's own already left out, until
 * `limit` rows are answered. The cursor of a table answered whole is the
 * export's; that of the table the page is cut in is the `seq` of its
 * last answered row; that of a table past the cut is the request's, `0`
 * when it named none. The export still reads every row past the cursor
 * before the cut, so a page costs the read of every row behind it. A
 * `limit` that is not a whole number above zero is refused with a
 * `RangeError` before the store is read.
 */
import type { HubDevice, HubPullRequest, HubPushRequest, HubPushResult, HubStoreStatus } from './port.js';
import type { MergeOptions, WireCursor, WirePayload, WireRow } from '@open-tomato/rafa/store';

import { randomUUID } from 'node:crypto';
import { existsSync, renameSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';

import {
  exportWirePayload,
  materialiseWirePayload,
  mergeStore,
  WIRE_FORMAT,
  WIRE_VERSION,
} from '@open-tomato/rafa/store';
import { Database } from 'bun:sqlite';

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

/** The catalogue's migrations and merged tables, as its own export names them. */
export interface Catalogue {
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
  /** Each cut table's columns the store's schema holds and the caller's does not: the answer's `projectedColumns`. */
  readonly lost: ReadonlyMap<string, readonly string[]>;
}

/** The most projection plans one store keeps; see the module note. */
export const PROJECTION_PLANS = 16;

/** The merge's project reader: the hub's store names no project. */
const NO_PROJECT: NonNullable<MergeOptions['readProject']> = () => ({ rootCommit: null, remote: null });

const DEVICES_SCHEMA = 'CREATE TABLE IF NOT EXISTS devices (device TEXT PRIMARY KEY NOT NULL, last_push_at TEXT NOT NULL) STRICT';

const STAMP_DEVICE = `INSERT INTO devices (device, last_push_at) VALUES (?, ?)
  ON CONFLICT (device) DO UPDATE SET last_push_at = excluded.last_push_at`;

const READ_DEVICES = 'SELECT device, last_push_at AS lastPushAt FROM devices ORDER BY device';

/** The file each device's last push is kept in, beside the store `fileName` (a name or a path). */
export function devicesFileName(fileName: string): string {
  return `${fileName.replace(/\.sqlite$/, '')}.devices.sqlite`;
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

/** Learns the catalogue, `entries` or this build's own, from a scratch store it merges forward; see `sqlite.ts`'s note on opening. */
export function readCatalogue(now: () => Date, entries: HubMigrationCatalogue | undefined): Catalogue {
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
  const full = steps.at(-1) ?? shape;
  const lost = cut
    .map(([table]): [string, readonly string[]] => [
      table,
      Object.freeze((full.get(table) ?? []).filter((column) => !(shape.get(table) ?? []).includes(column))),
    ])
    .filter(([, columns]) => columns.length > 0);
  return Object.freeze({ migrations: Object.freeze(kept), shape, cut: new Map(cut), lost: new Map(lost) });
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
  const projectedColumns = Object.fromEntries([...plan.lost].filter(([table]) => table in tables));
  return Object.freeze({
    ...payload,
    migrations: plan.migrations,
    tables: Object.freeze(tables),
    cursor: Object.freeze(cursor),
    projected: Object.freeze(projected),
    projectedColumns: Object.freeze(projectedColumns),
  });
}

/** Refuses a pull `limit` that is not a whole number above zero; see the module note on pages. */
function checkLimit(limit: number | undefined): void {
  if (limit === undefined || (Number.isInteger(limit) && limit > 0)) return;
  throw new RangeError(`rafa-hub: a pull limit of ${String(limit)} cannot be served; expected a whole number above zero`);
}

/**
 * `payload`, read past `since`, cut to its first `limit` rows across its
 * tables, with the cursor past the rows it kept; `payload` itself when
 * no limit is given. See the module note on pages.
 */
function cutPage(payload: WirePayload, since: WireCursor, limit: number | undefined): WirePayload {
  if (limit === undefined) return payload;
  const tables: Record<string, readonly WireRow[]> = {};
  const cursor: Record<string, number> = { ...payload.cursor };
  let room = limit;
  for (const [table, rows] of Object.entries(payload.tables)) {
    if (rows.length <= room) {
      tables[table] = rows;
      room -= rows.length;
      continue;
    }
    const kept = Object.freeze(rows.slice(0, room));
    const last = kept.at(-1);
    tables[table] = kept;
    cursor[table] = last === undefined
      ? since[table] ?? 0
      : Number(last.seq);
    room = 0;
  }
  return Object.freeze({ ...payload, tables: Object.freeze(tables), cursor: Object.freeze(cursor) });
}

/** One project's store file opened: the port's calls over that file alone. */
export interface ProjectStore {
  readonly push: (request: HubPushRequest) => HubPushResult;
  readonly pull: (request: HubPullRequest) => WirePayload;
  /** The project's migrations, rows and devices, without the projects served. */
  readonly status: () => HubStoreStatus;
  /** The migration ids the project's store file holds. */
  readonly migrations: () => readonly string[];
  readonly close: () => void;
}

/**
 * Opens the store file at `path` under a catalogue already learned,
 * creating it when it is not there, with its devices file beside it.
 */
export function openProjectStore(path: string, catalogue: Catalogue, now: () => Date): ProjectStore {
  if (!existsSync(path)) createStore(path, dirname(path), catalogue, now);
  const devices = new Database(devicesFileName(path), { create: true, readwrite: true, strict: true });
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
    checkLimit(request.limit);
    const exported = exportWirePayload({ path, cursor: request.since });
    const tables = Object.fromEntries(Object.entries(exported.tables)
      .map(([table, rows]) => [table, Object.freeze(rows.filter((row) => row['origin_store'] !== request.device))]));
    const whole: WirePayload = Object.freeze({ ...exported, tables: Object.freeze(tables) });
    const plan = request.migrations === undefined
      ? null
      : planFor(exported.migrations, request.migrations);
    const answered = plan === null
      ? whole
      : project(whole, plan);
    return cutPage(answered, request.since, request.limit);
  };

  const migrations = (): readonly string[] => exportWirePayload({ path, cursor: pastEverything }).migrations;

  const status = (): HubStoreStatus => ({
    migrations: migrations(),
    rows: countRows(path, catalogue.tables),
    devices: devices
      .query<HubDevice, []>(READ_DEVICES)
      .all()
      .map((row) => Object.freeze({ ...row })),
  });

  return {
    push,
    pull,
    status,
    migrations,
    close: () => {
      devices.close();
    },
  };
}
