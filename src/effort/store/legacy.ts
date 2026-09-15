/**
 * Whether a project's effort store is still where rafa kept it before
 * phase 1: the reading `rafa doctor` warns by.
 *
 * Phase 1 moved the store from `.ralph/effort/` to `.rafa/effort/`
 * (`EFFORT_STORE_DIR` in `effort/store.ts`), and no backend reads the old
 * directory. So a project whose rows sit only there meets an empty store
 * on its first `effort collect` or `effort report` under this build, and
 * nothing says why. {@link readLegacyStore} answers which store files each
 * directory holds, and the warning to print, or null.
 *
 * ## A store is its files, not its directory
 *
 * Each directory is judged by the store files it holds
 * ({@link STORE_FILE_NAMES}): `effort.sqlite`, the file `sqliteStorePath`
 * names, then `sessions.ndjson` and `commits.ndjson`, the files
 * `effortStorePath` names for each row kind. `rafa init` writes an empty
 * `.rafa/effort/`, so a directory test would find a store in every
 * project `init` set up and never warn. A store file is a path that is a
 * regular file once a symlink is followed: a directory spelled
 * `effort.sqlite` holds no rows, and neither does a dangling link.
 *
 * The warning fires when `.ralph/effort/` holds at least one store file
 * and `.rafa/effort/` holds none. Once `.rafa/effort/` holds one, nothing
 * is said, whatever the old directory still holds: the store rafa reads
 * exists, and joining two stores is no move a warning can spell.
 *
 * ## The move it names
 *
 * The warning ends with a command moving everything under `.ralph/effort/`
 * into `.rafa/effort/`, every path absolute and single-quoted for `sh`, so
 * it runs from any directory and a root holding a space or a quote stays
 * one word. It moves the directory's contents rather than the store files
 * alone, so a `-journal` file an interrupted write left beside
 * `effort.sqlite` travels with it. It is to be run once no loop is
 * running, since a loop built before the move still writes the old
 * directory.
 *
 * ## What it touches
 *
 * Nothing is opened, read or written: each candidate path is `stat`ed. A
 * path answering `ENOENT`, or `ENOTDIR` because a directory on the way is
 * a file, holds no store file. Any other failure, such as a directory with
 * no search permission, throws, naming the path.
 */
import type { EffortRowKind } from '../store.js';

import { statSync } from 'node:fs';
import { basename, join } from 'node:path';

import { messageOf } from '../../config-sections.js';
import { EFFORT_STORE_DIR, effortStorePath } from '../store.js';

import { sqliteStorePath } from './sqlite.js';

/** Where the store sat before phase 1, under the project root: `.ralph/effort`. */
export const LEGACY_EFFORT_STORE_DIR = join('.ralph', 'effort');

/** Every NDJSON row kind, so a kind added to `EffortRowKind` fails to compile here until it is named. */
const NDJSON_KINDS: Readonly<Record<EffortRowKind, true>> = { sessions: true, commits: true };

/**
 * The names of the store's files, in the order a reading lists them: the
 * SQLite file, then one NDJSON file per row kind. Read off the backends'
 * own path functions, so each name is spelled once.
 */
export const STORE_FILE_NAMES: readonly string[] = Object.freeze([
  basename(sqliteStorePath('')),
  ...Object.keys(NDJSON_KINDS).map((kind) => basename(effortStorePath('', kind as EffortRowKind))),
]);

/** What {@link readLegacyStore} answers. */
export interface LegacyStoreReading {
  /** `<root>/.ralph/effort`. */
  readonly legacyDir: string;
  /** `<root>/.rafa/effort`, the directory both backends write. */
  readonly storeDir: string;
  /** The store files `legacyDir` holds, in {@link STORE_FILE_NAMES} order. */
  readonly legacyFiles: readonly string[];
  /** The store files `storeDir` holds, in the same order. */
  readonly storeFiles: readonly string[];
  /** The sentence to warn with, or null; see the module note. */
  readonly warning: string | null;
}

/** True for the codes a path answers when nothing is there; see the module note. */
function isAbsence(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false;
  return error.code === 'ENOENT' || error.code === 'ENOTDIR';
}

/** True when `path` is a regular file once a symlink is followed; see the module note. */
function isStoreFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch (error) {
    if (isAbsence(error)) return false;
    throw new Error(`${path}: cannot be checked (${messageOf(error)})`, { cause: error });
  }
}

/** The store files `dir` holds, in {@link STORE_FILE_NAMES} order. */
function storeFilesIn(dir: string): readonly string[] {
  return Object.freeze(STORE_FILE_NAMES.filter((name) => isStoreFile(join(dir, name))));
}

/** `path` single-quoted for `sh`: each `'` inside closes the quote, is escaped, and reopens it. */
export function shellQuoted(path: string): string {
  return `'${path.replaceAll('\'', '\'\\\'\'')}'`;
}

/** The warning for a store left under `legacyDir` alone; see the module note. */
function legacyWarning(legacyDir: string, storeDir: string, legacyFiles: readonly string[]): string {
  const move = `mkdir -p ${shellQuoted(storeDir)} && mv ${shellQuoted(legacyDir)}/* ${shellQuoted(storeDir)}/`;
  return `${legacyDir} holds an effort store (${legacyFiles.join(', ')}) and ${storeDir} holds none;`
    + ` rafa reads ${storeDir} alone, so its reports start from an empty store. Once no loop is running,`
    + ` move it: ${move}`;
}

/**
 * Which store files `<root>/.ralph/effort` and `<root>/.rafa/effort` hold,
 * and the warning to print when only the old directory holds any. Throws,
 * naming the path, for a path that cannot be checked. See the module note.
 */
export function readLegacyStore(root: string): LegacyStoreReading {
  const legacyDir = join(root, LEGACY_EFFORT_STORE_DIR);
  const storeDir = join(root, EFFORT_STORE_DIR);
  const legacyFiles = storeFilesIn(legacyDir);
  const storeFiles = storeFilesIn(storeDir);
  const warning = legacyFiles.length > 0 && storeFiles.length === 0
    ? legacyWarning(legacyDir, storeDir, legacyFiles)
    : null;
  return Object.freeze({ legacyDir, storeDir, legacyFiles, storeFiles, warning });
}
