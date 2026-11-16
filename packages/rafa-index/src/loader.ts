/**
 * The extension loader: whether `sqlite-vec` is loaded into the index's
 * SQLite, answered as a {@link VectorAnswer} and never thrown.
 *
 * ## The two platforms
 *
 * On Linux, Bun's SQLite is linked into Bun and loads extensions, so the
 * loader calls `loadExtension(getLoadablePath())` on the database it is
 * handed, the path being the one `sqlite-vec` resolves for its platform
 * package. Windows takes the same path.
 *
 * On macOS (`process.platform === 'darwin'`) Bun opens Apple's SQLite,
 * which is built with extension loading off. A SQLite library that loads
 * them has to be named through `Database.setCustomSQLite(library)`, and
 * Bun takes it only before SQLite itself is loaded, which the first
 * `new Database()` of the process does. So {@link prepareSqlite} runs
 * before the module's first open, and answers `vector: false` with the
 * why when no library was named, when the call throws or answers
 * `false`, or when the module already opened a database in the process.
 * {@link openWithVector} runs the two steps in that order.
 *
 * ## Process state
 *
 * Whether the module opened a database, and which library it set, is
 * state of the process: SQLite loads once per process. It lives in one
 * {@link LoaderState} the module keeps, which every open through
 * {@link openDatabase} marks. A test hands a fresh state of its own
 * ({@link createLoaderState}) so no other test file's opens reach its
 * answer; the case that reads the module's own state runs in a spawned
 * `bun` child, whose process opened nothing before it.
 *
 * ## What is injectable
 *
 * The platform, `setCustomSQLite` and the database whose `loadExtension`
 * is called. Bun's `setCustomSQLite` does nothing on Linux, so a test of
 * the macOS answers hands a stand-in in its place.
 */
import type { DatabaseOptions } from 'bun:sqlite';

import { Database } from 'bun:sqlite';
import { getLoadablePath } from 'sqlite-vec';

/** The loader's answer: whether vector search is on, and why not when it is off. */
export interface VectorAnswer {
  readonly vector: boolean;
  readonly why: string | null;
}

/** A database the extension is loaded into: Bun's `Database`, or a stand-in. */
export interface ExtensionHost {
  readonly loadExtension?: (extension: string, entryPoint?: string) => void;
}

/** What the process did to SQLite: whether the module opened a database, and the library it set. */
export interface LoaderState {
  opened: boolean;
  library: string | null;
}

/** The inputs of {@link prepareSqlite}, each defaulting to the process's own. */
export interface PrepareOptions {
  /** The platform, `process.platform` when left out. */
  readonly platform?: string;
  /** The SQLite library macOS needs; none named answers `vector: false`. */
  readonly library?: string | null;
  /** The call that names the library, Bun's `Database.setCustomSQLite` when left out. */
  readonly setCustomSQLite?: (library: string) => boolean;
  /** The process state read and marked, the module's own when left out. */
  readonly state?: LoaderState;
}

/** The inputs of {@link openWithVector}: {@link PrepareOptions} and Bun's open options. */
export interface OpenWithVectorOptions extends PrepareOptions {
  readonly open?: DatabaseOptions;
}

/** A database {@link openWithVector} opened, with the loader's answer for it. */
export interface OpenedDatabase extends VectorAnswer {
  readonly database: Database;
}

/** The answer when nothing stands in the way of vector search. */
const VECTOR_ON: VectorAnswer = Object.freeze({ vector: true, why: null });

/** The platform whose SQLite needs a custom library before extensions load. */
const MACOS = 'darwin';

/** A fresh {@link LoaderState}: no database opened, no library set. */
export function createLoaderState(): LoaderState {
  return { library: null, opened: false };
}

/** The module's own state, the process's. */
const PROCESS_STATE: LoaderState = createLoaderState();

/** An answer with vector search off, for the reason given. */
function vectorOff(why: string): VectorAnswer {
  return Object.freeze({ vector: false, why });
}

/** The first line of a thrown value's message, so a why stays one line. */
function firstLine(error: unknown): string {
  const message = error instanceof Error
    ? error.message
    : String(error);
  return message.split('\n')[0]?.trim() ?? '';
}

/** Bun's own `setCustomSQLite`, the default of {@link PrepareOptions.setCustomSQLite}. */
function bunSetCustomSQLite(library: string): boolean {
  return Database.setCustomSQLite(library);
}

/**
 * Name macOS's SQLite library before the module's first open. Off macOS
 * there is nothing to name and the answer is `vector: true`. A library
 * the state already set answers `vector: true` again, as Bun takes the
 * same path twice; any other call after an open answers `vector: false`.
 */
export function prepareSqlite(options: PrepareOptions = {}): VectorAnswer {
  const platform = options.platform ?? process.platform;
  if (platform !== MACOS) {
    return VECTOR_ON;
  }
  const library = options.library ?? null;
  if (library === null || library === '') {
    return vectorOff('no SQLite library is named, and macOS\'s own SQLite loads no extension');
  }
  const state = options.state ?? PROCESS_STATE;
  if (state.library === library) {
    return VECTOR_ON;
  }
  if (state.opened) {
    return vectorOff('a database was opened in this process before Database.setCustomSQLite could name the library');
  }
  const setCustomSQLite = options.setCustomSQLite ?? bunSetCustomSQLite;
  try {
    if (!setCustomSQLite(library)) {
      return vectorOff(`Database.setCustomSQLite(${library}) loaded no library`);
    }
  } catch (error) {
    return vectorOff(`Database.setCustomSQLite(${library}) threw: ${firstLine(error)}`);
  }
  state.library = library;
  return VECTOR_ON;
}

/**
 * Open a database through the module, marking the state so a later
 * {@link prepareSqlite} knows. Options left out are left out of the call:
 * Bun refuses an empty options object (`bad parameter or other API
 * misuse`), where no object opens read-write and creates the file.
 */
export function openDatabase(filename: string, options?: DatabaseOptions, state: LoaderState = PROCESS_STATE): Database {
  state.opened = true;
  return options === undefined
    ? new Database(filename)
    : new Database(filename, options);
}

/** Load `sqlite-vec` into the database handed: `loadExtension(getLoadablePath())`. */
export function loadVector(database: ExtensionHost): VectorAnswer {
  if (typeof database.loadExtension !== 'function') {
    return vectorOff('this SQLite engine has no loadExtension');
  }
  try {
    database.loadExtension(getLoadablePath());
  } catch (error) {
    return vectorOff(`loading sqlite-vec threw: ${firstLine(error)}`);
  }
  return VECTOR_ON;
}

/**
 * Prepare SQLite, open the database, then load `sqlite-vec` into it,
 * in that order. A failed preparation opens the database anyway and
 * answers its why, so the index still serves full text.
 */
export function openWithVector(filename: string, options: OpenWithVectorOptions = {}): OpenedDatabase {
  const prepared = prepareSqlite(options);
  const database = openDatabase(filename, options.open, options.state);
  const answer = prepared.vector
    ? loadVector(database)
    : prepared;
  return { database, vector: answer.vector, why: answer.why };
}
