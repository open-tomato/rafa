/**
 * The SQLite connector's index half: the {@link HubIndex} over the hub's
 * store file, built on `packages/rafa-index`. `connectSqliteHub` in
 * `sqlite.ts` opens it beside the store half; this file names no store
 * file of its own and takes both paths from its caller.
 *
 * ## The files
 *
 * The index lives in its own file beside the store, `<store>.index.sqlite`
 * (`indexFileName` in `sqlite.ts`), and never in the store file:
 * `mergeStore` builds every merge in a new file and renames it over the
 * store, so an index table inside it would be gone after the next push.
 * The index is never written in place. {@link HubIndex.rebuild} runs
 * `rebuildIndex`, which builds a file beside the index, checks it and
 * renames it over the index in one step.
 *
 * ## One read connection, attached
 *
 * The index half holds one read-only connection on the store file, with
 * the index file attached to it as {@link INDEX_SCHEMA}. The store is its
 * `main`, which `links` walks, and the index is the attached schema, which
 * `search` reads. Both files are replaced by a rename while the hub runs:
 * the store by every push that adds rows, the index by every rebuild. A
 * connection that opened the old file keeps reading it. So before each
 * `search` and `links` the half reads both files' device and inode and
 * compares them with what it attached. When either has changed, it
 * closes the connection and opens and attaches again. Each file is
 * read before it is opened or attached. If a rename lands between the
 * read and the open, the half holds an older identity than the file it
 * opened, and the next call attaches once more.
 *
 * When the index file is not there at open, the half builds it from the
 * store's rows with one rebuild, recording {@link SqliteHubIndexOptions.project},
 * so the file can be attached and a search answers. When it is gone at a
 * later `search` or `links`, that call is refused, naming the file and the
 * rebuild, and a `rebuild` builds it again: a rebuild reads the store's
 * tables on a short read connection of its own and needs no index attached.
 *
 * ## Capabilities
 *
 * They are computed once, at open, from what was measured there and never
 * from what the engine is assumed to hold:
 *
 *   - `fts` is whether the engine has FTS5 compiled in, read with
 *     `sqlite_compileoption_used('ENABLE_FTS5')` on the read connection.
 *     Every index table set needs FTS5, so an engine without it fails
 *     the open, naming FTS5, before any index file is written.
 *   - `vector` is `true` when the loader's answer, which the connector
 *     takes before it opens any database ({@link SqliteHubIndexOptions.prepared}),
 *     is `true`, `sqlite-vec` loads into the read connection, and an
 *     embedder was given. Otherwise it is `false`, and the half keeps the
 *     why: the loader's, the load's, or `no embedder configured`.
 *   - `graph` is whether the store holds a `ref_links` table at open.
 *   - `projection` is `false`: this connector projects no pull.
 *
 * ## Refusals
 *
 * A `search` with `mode: 'vector'` or `'hybrid'` while `vector` is `false`
 * is refused by `rafa-index`'s `search`, with a message naming the why and
 * `fts`. A `rebuild` with `scope: 'vector'` while `vector` is `false` is
 * refused the same way, naming `fts`, before any file is touched.
 *
 * ## What a rebuild reads
 *
 * The tables indexed are the catalogue tables the store holds whose rows
 * carry an origin pair (`origin_store`, `origin_seq`), read from the store
 * at each rebuild, since a push can bring the store forward to a table it
 * did not hold. A rebuild of any scope builds the whole file: the swap
 * replaces the whole file, so a scope names the least the rebuild must
 * hold. It embeds only when `vector` is `true`, so the vector half is
 * built under the answer `capabilities()` gives.
 */
import type {
  HubCapabilities,
  HubIndex,
  IndexLinksRequest,
  IndexLinksResult,
  IndexRebuildRequest,
  IndexRebuildResult,
  IndexSearchRequest,
  IndexSearchResult,
} from './port.js';
import type { IndexEmbedder, LoaderState, RebuildIndexResult, VectorAnswer } from '@open-tomato/rafa-index';
import type { Database } from 'bun:sqlite';

import { randomUUID } from 'node:crypto';
import { statSync } from 'node:fs';

import {
  holdsRefLinks,
  IndexRebuildRefusal,
  links as walkLinks,
  loadVector,
  NO_EMBEDDER,
  openDatabase,
  rebuildIndex,
  search as searchIndex,
} from '@open-tomato/rafa-index';

/** The schema the index file is attached as, on the read connection to the store. */
export const INDEX_SCHEMA = 'hub_index';

/** The compile option an engine with FTS5 answers `1` for. */
const FTS5_OPTION = 'ENABLE_FTS5';

/** The columns a store table must carry to be indexed. */
const ORIGIN_COLUMNS: readonly string[] = Object.freeze(['origin_store', 'origin_seq']);

/** What the index half is opened with. */
export interface SqliteHubIndexOptions {
  /** The store file, opened read-only. */
  readonly storePath: string;
  /** The index file, attached to the read connection; built at open when it is not there. */
  readonly indexPath: string;
  /** This build's catalogue tables. Those the store holds with an origin pair are indexed. */
  readonly tables: readonly string[];
  /** The loader's answer, taken by the connector before it opened any database. */
  readonly prepared: VectorAnswer;
  /** The project a build at open records. A rebuild records its request's project. */
  readonly project: string;
  /** The clock rebuild stamps are taken from. */
  readonly now: () => Date;
  /** The embedder. Without one, `vector` is `false`. */
  readonly embedder?: IndexEmbedder;
  /** The loader's process state, the module's own when left out; a test hands a fresh one. */
  readonly loaderState?: LoaderState;
}

/** The index half once open: the index, and the call that releases its connection. */
export interface SqliteHubIndex {
  readonly index: HubIndex;
  /** Closes the read connection; every call on the index is refused after. */
  readonly close: () => void;
}

/** A file's identity: the device and inode a rename changes. */
interface FileIdentity {
  readonly dev: number;
  readonly ino: number;
}

/** The read connection with the identities of the two files it holds. */
interface Attached {
  readonly database: Database;
  readonly store: FileIdentity;
  readonly index: FileIdentity;
}

/** The vector answer the half works under: whether it is on, and why not. */
interface VectorState {
  readonly vector: boolean;
  readonly why: string | null;
}

/** The identity of the file at `path`, or `null` when nothing is there. */
function identityOf(path: string): FileIdentity | null {
  const stats = statSync(path, { throwIfNoEntry: false });
  return stats === undefined
    ? null
    : { dev: stats.dev, ino: stats.ino };
}

/** Whether two identities name one file; `null` names none and matches nothing. */
function sameFile(left: FileIdentity | null, right: FileIdentity | null): boolean {
  return left !== null && right !== null && left.dev === right.dev && left.ino === right.ino;
}

/** Whether the engine behind `database` was compiled with `option`, as `sqlite_compileoption_used` answers. */
export function compiledWith(database: Database, option: string): boolean {
  const row = database
    .query<{ readonly used: number }, [string]>('SELECT sqlite_compileoption_used(?) AS used')
    .get(option);
  return row?.used === 1;
}

/** The catalogue tables the store at `main` holds whose rows carry an origin pair, in catalogue order. */
export function indexedTables(database: Database, catalogue: readonly string[]): readonly string[] {
  return Object.freeze(catalogue.filter((table) => {
    const columns = database
      .query<{ readonly name: string }, [string]>('SELECT name FROM pragma_table_info(?, \'main\')')
      .all(table)
      .map((column) => column.name);
    return ORIGIN_COLUMNS.every((column) => columns.includes(column));
  }));
}

/** A rebuild stamp: the clock, compact, then a short random tail so two rebuilds never share one. */
function rebuildStamp(now: () => Date): string {
  const clock = now()
    .toISOString()
    .replace(/[-:.]/g, '');
  return `${clock}-${randomUUID().slice(0, 8)}`;
}

/** The refusal of a call whose index file is gone. */
function indexGone(indexPath: string): Error {
  return new Error(`hub index: ${indexPath} is not there; rebuild the index (rafa-hub index rebuild)`);
}

/** The rebuild's answer as the port's frozen record, its why the half's own when vector search is off. */
function toRebuildResult(built: RebuildIndexResult, state: VectorState): IndexRebuildResult {
  const why = state.vector
    ? built.why
    : state.why;
  return Object.freeze({
    project: built.project,
    rows: built.rows,
    stamp: built.stamp,
    tables: Object.freeze(built.tables.map((table) => Object.freeze({ rows: table.rows, table: table.table }))),
    vector: built.vector,
    vectors: built.vectors,
    why,
  });
}

/**
 * Opens the index half over the store file: one read-only connection on
 * the store with the index file attached as {@link INDEX_SCHEMA}, the
 * index file built first when it is not there. Throws when the engine has
 * no FTS5 or the first build fails, with the connection closed. See the
 * module note.
 */
export async function openSqliteHubIndex(options: SqliteHubIndexOptions): Promise<SqliteHubIndex> {
  const { embedder, indexPath, loaderState, now, prepared, storePath, tables } = options;

  /** Opens the store read-only and loads `sqlite-vec` into it when the loader answered `true`. */
  const openStore = (): { readonly database: Database; readonly store: FileIdentity; readonly loaded: VectorAnswer } => {
    const store = identityOf(storePath);
    if (store === null) {
      throw new Error(`hub index: the store file ${storePath} is not there`);
    }
    const database = openDatabase(storePath, { readonly: true }, loaderState);
    const loaded = prepared.vector
      ? loadVector(database)
      : prepared;
    return { database, loaded, store };
  };

  /** Attaches the index file to `database`, answering the identity it read first. */
  const attachIndex = (database: Database): FileIdentity => {
    const index = identityOf(indexPath);
    if (index === null) {
      throw indexGone(indexPath);
    }
    database.run(`ATTACH DATABASE ? AS ${INDEX_SCHEMA}`, [indexPath]);
    return index;
  };

  const first = openStore();
  let state: VectorState;
  let capabilities: HubCapabilities;
  try {
    if (!compiledWith(first.database, FTS5_OPTION)) {
      throw new Error('hub index: this SQLite engine has no FTS5 compiled in, which every index table set needs');
    }
    state = embedder === undefined && first.loaded.vector
      ? { vector: false, why: NO_EMBEDDER }
      : { vector: first.loaded.vector, why: first.loaded.why };
    capabilities = Object.freeze({
      fts: true,
      graph: holdsRefLinks({ database: first.database, schema: 'main' }),
      projection: false,
      vector: state.vector,
    });
  } catch (error) {
    first.database.close();
    throw error;
  }

  /** The tables a rebuild reads, from a read connection of its own, so a rebuild needs no index attached. */
  const tablesNow = (): readonly string[] => {
    const reader = openDatabase(storePath, { readonly: true }, loaderState);
    try {
      return indexedTables(reader, tables);
    } finally {
      reader.close();
    }
  };

  /** Rebuilds the index file from the store's indexed tables. */
  const build = (project: string): Promise<RebuildIndexResult> => rebuildIndex({
    embedder: state.vector
      ? embedder
      : undefined,
    indexPath,
    loader: { state: loaderState },
    project,
    stamp: rebuildStamp(now),
    storePath,
    tables: tablesNow(),
  });

  let attached: Attached | null;
  try {
    if (identityOf(indexPath) === null) {
      await build(options.project);
    }
    attached = { database: first.database, index: attachIndex(first.database), store: first.store };
  } catch (error) {
    first.database.close();
    throw error;
  }
  let closed = false;

  /**
   * The read connection, opened and attached again when either file was
   * renamed over since. A reattach that fails leaves none attached, so
   * the next call tries again.
   */
  const current = (): Database => {
    if (closed) {
      throw new Error('hub index: the index is closed');
    }
    if (attached !== null && sameFile(attached.store, identityOf(storePath)) && sameFile(attached.index, identityOf(indexPath))) {
      return attached.database;
    }
    attached?.database.close();
    attached = null;
    const next = openStore();
    try {
      if (state.vector && !next.loaded.vector) {
        throw new Error(`hub index: sqlite-vec did not load on reattach: ${next.loaded.why ?? 'no reason was given'}`);
      }
      const reattached: Attached = { database: next.database, index: attachIndex(next.database), store: next.store };
      attached = reattached;
      return reattached.database;
    } catch (error) {
      next.database.close();
      throw error;
    }
  };

  const index: HubIndex = {
    capabilities: () => capabilities,
    links: async (request: IndexLinksRequest): Promise<IndexLinksResult> => walkLinks({ database: current(), schema: 'main' }, request),
    rebuild: async (request: IndexRebuildRequest): Promise<IndexRebuildResult> => {
      if (request.scope === 'vector' && !state.vector) {
        throw new IndexRebuildRefusal(
          `a vector rebuild needs vector search, which is off (${state.why ?? 'no reason was given'}); rebuild with scope 'fts'`,
        );
      }
      if (closed) {
        throw new Error('hub index: the index is closed');
      }
      return toRebuildResult(await build(request.project), state);
    },
    search: async (request: IndexSearchRequest): Promise<IndexSearchResult> => searchIndex({
      database: current(),
      embedder,
      schema: INDEX_SCHEMA,
      vector: state.vector,
      why: state.why,
    }, request),
  };

  return {
    close: () => {
      if (!closed) {
        closed = true;
        attached?.database.close();
        attached = null;
      }
    },
    index: Object.freeze(index),
  };
}
