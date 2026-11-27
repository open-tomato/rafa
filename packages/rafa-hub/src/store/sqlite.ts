/**
 * The hub store port's SQLite adapter: each served project's rows kept
 * in one effort store file of its own, so that every push is merged by
 * core's own merge (`mergeStore`, #322) and a pull is core's own export.
 * It reaches core only through `@open-tomato/rafa/store`.
 *
 * ## Files
 *
 * A single-project hub's store is {@link SqliteHubStoreOptions.fileName}
 * in the context's directory, `rafa-hub.sqlite` by default as
 * `hub.storePath` is: an effort store as a device's is, which a device's
 * rafa could read. Each listed project's store is its own file, the
 * `storePath` {@link SqliteHubStoreOptions.storeFiles} names (see
 * "Projects" below). Each device's last push is kept beside its
 * project's store in a file of its own, the store's name
 * with `.devices.sqlite` for `.sqlite` ({@link devicesFileName}), and
 * never in the store: `mergeStore` builds every merge in a new file and
 * renames it over the store, and a table it does not know would be one
 * `planSchema` might refuse. For the same reason the index
 * {@link connectSqliteHub} opens is its own file too, the store's name with
 * `.index.sqlite` for `.sqlite` ({@link indexFileName}); `sqlite-index.ts`
 * says how it is attached, rebuilt and attached again.
 *
 * ## Projects
 *
 * The store serves the projects the context lists. With none listed,
 * or the one `default` project alone ({@link servesOneProject}), it is
 * the single-project hub of before #1431: one store file, and every
 * request served in it whatever `project` it names or leaves out. With
 * projects listed, each project's store, devices and index files are
 * its own, under its `storePath`, `<id>.sqlite` in the context's
 * directory when the options name none. `mergeStore`'s whole-file swap
 * is then one project's file and never another's. Two projects over one
 * store file are refused at open. A request naming no project is served
 * in the first listed project. A push, pull, status, rebuild, search or
 * walk naming a project not listed is refused with
 * {@link HubProjectNotServed}, whose line names `hub.projects`, before
 * any file is touched.
 *
 * The first served project's store, and with the connector its index,
 * is opened when the adapter opens. Every other project's is opened on
 * its first use, and its store file is created then if it is not
 * there. `status()` answers the rows, devices and migrations of the
 * project its request names, with every listed project's `id` and
 * `name` in order, and leaves `projects` out when the context lists
 * none. `contract()` answers the first project's migrations.
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
 * ## Push, pull and pages
 *
 * Each project's store file is opened by `openProjectStore` in
 * `sqlite-project.ts`, whose module note says what a push does, in
 * order, how a pull is answered and projected to a device behind the
 * store, and how a pull naming a `limit` is cut into a page.
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
 * `projection`. Both answer the context's `maxPayloadRows` as given, and
 * `null`, no cap, when it gives none: the cap is the hub's config, and
 * the store enforces none of it.
 *
 * ## The connector
 *
 * {@link connectSqliteHub} is the `sqlite` `HubConnector`: the store
 * above and its index, `sqlite-index.ts`, over one context. It calls the
 * loader (`prepareSqlite`) before it opens any database, since on macOS a
 * SQLite library is named only before the process's first open. Then it
 * learns the catalogue, the one its `migrations` option hands down
 * when given, opens the store and opens the first served
 * project's index, handing it the loader's answer, the embedder and the
 * catalogue's tables. Its `fts`, `vector` and `graph` are the ones the
 * index answers, and its `projection` the store's.
 * Each index is opened once its store file exists, and a failed first
 * index open closes the store. Another project's index is opened on its
 * first use; an open that fails there is tried again on the next. An
 * index built at open records {@link SqliteHubConnectorOptions.project}
 * on a single-project hub, and the project's id otherwise. A rebuild,
 * a search or a walk runs on the index of the project it names
 * (`routeSqliteHubIndex` in `sqlite-index.ts`), a search or a walk
 * naming none on the first served project's. Closing the store closes every index's
 * connection too, since the port's index has no close of its own.
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
  HubIndex,
  HubServedProject,
  HubStore,
  HubStoreContext,
  HubStoreStatus,
} from './port.js';
import type { SqliteHubIndex } from './sqlite-index.js';
import type { Catalogue, HubMigrationCatalogue, ProjectStore } from './sqlite-project.js';
import type { IndexEmbedder, PrepareOptions } from '@open-tomato/rafa-index';

import { join, resolve } from 'node:path';

import { WIRE_CONTRACT_VERSION } from '@open-tomato/rafa/store';
import { prepareSqlite } from '@open-tomato/rafa-index';

import { DEFAULT_PROJECT_ID, DEFAULT_STORE_FILE } from '../config.js';

import { openSqliteHubIndex, routeSqliteHubIndex } from './sqlite-index.js';
import { openProjectStore, readCatalogue } from './sqlite-project.js';

export type { HubMigrationCatalogue } from './sqlite-project.js';
export { devicesFileName, HUB_PACKAGE, HUB_UPGRADE, HubUpgradeRequired, PROJECTION_PLANS } from './sqlite-project.js';

/** A push, pull, status or rebuild naming a project the hub does not list. */
export class HubProjectNotServed extends Error {
  override readonly name = 'HubProjectNotServed';
  /** The project the request named. */
  readonly project: string;

  constructor(project: string) {
    super(`rafa-hub: project ${project} is not served here; add it under hub.projects`);
    this.project = project;
  }
}

/**
 * Whether `projects` is the single-project hub of before #1431: none
 * listed, or the one {@link DEFAULT_PROJECT_ID} project alone, so every
 * request is served in one file whatever project it names.
 */
export function servesOneProject(projects: readonly HubServedProject[]): boolean {
  return projects.length === 0 || (projects.length === 1 && projects[0]?.id === DEFAULT_PROJECT_ID);
}

/** One listed project's store file, as an entry of `hub.projects` names it. */
export interface SqliteHubStoreFile {
  /** The project's id, as {@link HubStoreContext.projects} lists it. */
  readonly id: string;
  /** Its store file, `hub.projects[n].storePath`; a relative path is resolved against the context's directory. */
  readonly storePath: string;
}

/** What the adapter may vary beyond the port's context. */
export interface SqliteHubStoreOptions {
  /**
   * The store file's name in the context's directory, {@link DEFAULT_STORE_FILE}
   * when absent: the one file of a single-project hub. Unread when the
   * context lists projects.
   */
  readonly fileName?: string;
  /** The catalogue the store is kept at, in place of this build's own; see the module note. */
  readonly migrations?: HubMigrationCatalogue;
  /**
   * Each listed project's store file. A listed project left out is kept
   * in `<id>.sqlite` in the context's directory; an entry naming a
   * project the context does not list is unread.
   */
  readonly storeFiles?: readonly SqliteHubStoreFile[];
}

/** What the connector may vary beyond the store's options. */
export interface SqliteHubConnectorOptions extends SqliteHubStoreOptions {
  /** The embedder vector search embeds with; without one, `vector` is `false`. */
  readonly embedder?: IndexEmbedder;
  /** The loader's inputs (the install record's `sqliteLibrary` is its `library`), the process's own when left out. */
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

/** Where one served project is kept. */
interface ProjectPlace {
  /** The project's id, {@link DEFAULT_PROJECT_ID} for the one project of a single-project hub. */
  readonly id: string;
  /** Its store file's absolute path; the devices and index files are beside it. */
  readonly storePath: string;
  /** Whether it is the one project of a single-project hub, served whatever project a request names. */
  readonly shared: boolean;
}

/** Every served project's place, and the one a request is served in. */
interface ProjectLayout {
  /** The first listed project's place, where a request naming none is served. */
  readonly first: ProjectPlace;
  /** The place a request naming `project` is served in; throws {@link HubProjectNotServed} for one not listed. */
  readonly placeOf: (project: string | undefined) => ProjectPlace;
}

/** What the adapter can answer beyond push, pull and status: a projected pull, and no index of its own. */
const CAPABILITIES: HubCapabilities = Object.freeze({ fts: false, vector: false, graph: false, projection: true });

/** The file the index is kept in, beside the store `fileName` (a name or a path). */
export function indexFileName(fileName: string): string {
  return `${fileName.replace(/\.sqlite$/, '')}.index.sqlite`;
}

/** Runs `work` now, answering its value or its throw as a promise. */
function settle<T>(work: () => T): Promise<T> {
  return new Promise((resolve) => {
    resolve(work());
  });
}

/**
 * Where each served project is kept, read from the context and the
 * options, and the place a request naming `project` is served in. Throws
 * when two projects would share one store file; see the module note on
 * projects.
 */
function layoutOf(context: HubStoreContext, options: SqliteHubStoreOptions): ProjectLayout {
  const listed = context.projects ?? [];
  if (servesOneProject(listed)) {
    const one: ProjectPlace = Object.freeze({
      id: listed[0]?.id ?? DEFAULT_PROJECT_ID,
      storePath: join(context.directory, options.fileName ?? DEFAULT_STORE_FILE),
      shared: true,
    });
    return { first: one, placeOf: () => one };
  }
  const given = new Map((options.storeFiles ?? []).map(({ id, storePath }) => [id, storePath]));
  const places: readonly ProjectPlace[] = listed.map(({ id }) => Object.freeze({
    id,
    storePath: resolve(context.directory, given.get(id) ?? `${id}.sqlite`),
    shared: false,
  }));
  places.forEach((place, position) => {
    const earlier = places.findIndex((other) => other.storePath === place.storePath);
    if (earlier !== position) {
      throw new TypeError(`rafa-hub: projects ${places[earlier]?.id ?? ''} and ${place.id} share the store file ${place.storePath}; expected one store file per project`);
    }
  });
  const [first] = places as [ProjectPlace, ...ProjectPlace[]];
  return {
    first,
    placeOf: (project) => {
      const id = project ?? first.id;
      const found = places.find((place) => place.id === id);
      if (found === undefined) throw new HubProjectNotServed(id);
      return found;
    },
  };
}

/** The projects `status()` names: every one the context lists, in order, or none when it lists none. */
function servedOf(context: HubStoreContext): Pick<HubStoreStatus, 'projects'> {
  if (context.projects === undefined) return {};
  return { projects: Object.freeze(context.projects.map(({ id, name }) => Object.freeze({ id, name }))) };
}

/** The store over every served project, and the project store a place opens to, opened on first use. */
interface RoutedStore {
  readonly store: HubStore;
  readonly opened: (place: ProjectPlace) => ProjectStore;
}

/** Opens the router over `layout`, the first project's file opened now and every other's on first use. */
function openRoutedStore(context: HubStoreContext, layout: ProjectLayout, catalogue: Catalogue): RoutedStore {
  const { now } = context;
  const stores = new Map<string, ProjectStore>();
  let closed = false;
  const opened = (place: ProjectPlace): ProjectStore => {
    if (closed) throw new Error('hub store: the store is closed');
    const held = stores.get(place.id);
    if (held !== undefined) return held;
    const store = openProjectStore(place.storePath, catalogue, now);
    stores.set(place.id, store);
    return store;
  };
  opened(layout.first);
  const served = servedOf(context);

  return {
    opened,
    store: {
      push: (request) => settle(() => opened(layout.placeOf(request.project)).push(request)),
      pull: (request) => settle(() => opened(layout.placeOf(request.project)).pull(request)),
      status: (request = {}) => settle(() => ({ ...opened(layout.placeOf(request.project)).status(), ...served })),
      contract: (): HubContract => Object.freeze({
        contractVersion: WIRE_CONTRACT_VERSION,
        migrations: opened(layout.first).migrations(),
        capabilities: CAPABILITIES,
        maxPayloadRows: context.maxPayloadRows ?? null,
      }),
      close: () => settle(() => {
        closed = true;
        for (const store of stores.values()) store.close();
        stores.clear();
      }),
    },
  };
}

/**
 * Opens the SQLite hub store over `context`, the first served project's
 * file created when it is not there and every other project's on first
 * use. Throws when the catalogue cannot be learned, the first file
 * cannot be made, or two projects would share one file; see the module
 * note.
 */
export function openSqliteHubStore(context: HubStoreContext, options: SqliteHubStoreOptions = {}): HubStore {
  return openRoutedStore(context, layoutOf(context, options), readCatalogue(context.now, options.migrations)).store;
}

/**
 * The `sqlite` connector, a `HubConnector`: opens the store over
 * `context` as {@link openSqliteHubStore} does, then the first served
 * project's index beside its store file, the loader called before either
 * opens a database; every other project's index opens on its first use.
 * Rejects when the store or the first index cannot be opened, with
 * nothing left open; see the module note.
 */
export async function connectSqliteHub(context: HubStoreContext, options: SqliteHubConnectorOptions = {}): Promise<SqliteHub> {
  const prepared = prepareSqlite(options.loader);
  const catalogue = readCatalogue(context.now, options.migrations);
  const layout = layoutOf(context, options);
  const routed = openRoutedStore(context, layout, catalogue);
  const openHalf = (place: ProjectPlace): Promise<SqliteHubIndex> => openSqliteHubIndex({
    embedder: options.embedder,
    indexPath: indexFileName(place.storePath),
    loaderState: options.loader?.state,
    now: context.now,
    prepared,
    project: place.shared
      ? options.project ?? DEFAULT_INDEX_PROJECT
      : place.id,
    storePath: place.storePath,
    tables: catalogue.tables,
  });
  let first: SqliteHubIndex;
  try {
    first = await openHalf(layout.first);
  } catch (error) {
    await routed.store.close();
    throw error;
  }
  const halves = new Map<string, Promise<SqliteHubIndex>>([[layout.first.id, Promise.resolve(first)]]);
  let closed = false;

  /** The half of the place `project` is served in, opened over its store file on first use; a failed open is tried again next time. */
  const halfOf = (project: string | undefined): Promise<HubIndex> => {
    if (closed) return Promise.reject(new Error('hub index: the index is closed'));
    let place: ProjectPlace;
    try {
      place = layout.placeOf(project);
      routed.opened(place);
    } catch (error) {
      return Promise.reject(error as Error);
    }
    let half = halves.get(place.id);
    if (half === undefined) {
      half = openHalf(place);
      halves.set(place.id, half);
      half.catch(() => halves.delete(place.id));
    }
    return half.then(({ index }) => index);
  };

  const index = routeSqliteHubIndex({ capabilities: first.index.capabilities(), halfOf });
  const { store } = routed;
  return {
    index,
    store: Object.freeze({
      ...store,
      close: async () => {
        closed = true;
        const opened = await Promise.allSettled(halves.values());
        for (const half of opened) {
          if (half.status === 'fulfilled') half.value.close();
        }
        halves.clear();
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
