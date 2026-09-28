/**
 * One effort store copied whole into a directory of its own, so branch
 * code can run over real data without touching the live store.
 *
 * `rafa effort copy` (`src/commands/effort/copy.ts`) is the one caller.
 * The copy holds the same file names a store directory holds, so
 * `RAFA_EFFORT_DIR=<the copy>` points both backends at it
 * (`location.ts`).
 *
 * ## How each file is copied
 *
 * - **`effort.sqlite`** through `VACUUM INTO`, run on a connection
 *   opened read-only. SQLite writes the target as one consistent
 *   snapshot, header included, so `PRAGMA user_version` and every table,
 *   `schema_migrations` among them, arrive as the store held them, and a
 *   connection reading the store meanwhile does not stop it. Measured on
 *   SQLite 3.53.2 under bun: the store's bytes are unchanged afterwards,
 *   even while another connection holds a read transaction. The open
 *   sets `PRAGMA busy_timeout` to `effort.busyTimeoutMs`
 *   (`settings.ts`), as a store open does, so a writer mid-transaction
 *   is waited for rather than failed at once.
 * - **The NDJSON files** by file copy, refusing to overwrite.
 *
 * Nothing here plans a schema or calls `bringForward`: the copy is a
 * read of the store, never an open that would adopt or migrate it. So a
 * development build may copy the live store.
 *
 * ## Refusals and failures
 *
 * {@link EffortCopyRefusal} is a copy that was never started, with no
 * directory or file made: no store file in the source directory, or a
 * target that is a file or a directory holding anything. {@link
 * EffortCopyFailure} is a read or a write that failed once started;
 * every file the copy wrote is removed, and so is every directory it
 * made, before it is thrown. A target that existed empty is left, empty.
 *
 * Both paths pass the test guard (`guardTestProcess`) before anything is
 * read or made, so a test copies stores under the temporary directory
 * only.
 */
import type { EffortRowKind } from '../store.js';

import { copyFileSync, constants, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { Database } from 'bun:sqlite';

import { effortStoreFileName } from '../store.js';

import { guardTestProcess } from './location.js';
import { activeStoreSettings } from './settings.js';
import { SQLITE_STORE_FILE_NAME } from './sqlite.js';

/**
 * Every NDJSON row kind, as a record so that a kind added to
 * `EffortRowKind` without a line here is a compile error.
 */
const NDJSON_KINDS: Readonly<Record<EffortRowKind, true>> = { sessions: true, commits: true };

/** The store files a directory can hold, the SQLite file first. */
export const EFFORT_COPY_FILE_NAMES: readonly string[] = [
  SQLITE_STORE_FILE_NAME,
  ...(Object.keys(NDJSON_KINDS) as EffortRowKind[]).map((kind) => effortStoreFileName(kind)),
];

/** A copy that was never started; nothing was made. */
export class EffortCopyRefusal extends Error {
  override readonly name = 'EffortCopyRefusal';
}

/** A read or a write that failed once the copy started; what it made is removed. */
export class EffortCopyFailure extends Error {
  override readonly name = 'EffortCopyFailure';
}

/** What one copy is handed. */
export interface EffortCopyRequest {
  /** The store directory copied from. */
  readonly source: string;
  /** The directory copied into: absent, or an empty directory. */
  readonly target: string;
}

/** What one copy did. */
export interface EffortCopyResult {
  /** The store directory copied from, resolved. */
  readonly source: string;
  /** The directory copied into, resolved. */
  readonly directory: string;
  /** The store files copied, by name, in {@link EFFORT_COPY_FILE_NAMES} order. */
  readonly files: readonly string[];
}

/** Refuses a target that is a file or a directory holding anything. */
function refuseUsedTarget(target: string): void {
  if (!existsSync(target)) return;
  let entries: string[];
  try {
    if (!statSync(target).isDirectory()) {
      throw new EffortCopyRefusal(`${target} is a file, not a directory; name an empty or absent directory with --to=<dir>.`);
    }
    entries = readdirSync(target);
  } catch (error) {
    if (error instanceof EffortCopyRefusal) throw error;
    throw new EffortCopyFailure(`${target} cannot be read: ${String(error)}`);
  }
  if (entries.length === 0) return;
  throw new EffortCopyRefusal(
    `${target} is not empty (${String(entries.length)} entries); nothing was copied.`
      + ' Name an empty or absent directory with --to=<dir>.',
  );
}

/** Writes `source`'s SQLite store to `target` as one snapshot, reading only. */
function vacuumInto(source: string, target: string): void {
  const db = new Database(source, { readonly: true });
  try {
    db.run(`PRAGMA busy_timeout = ${String(activeStoreSettings().busyTimeoutMs)}`);
    db.run('VACUUM INTO ?', [target]);
  } finally {
    db.close();
  }
}

/** Copies one store file by name, the SQLite file through {@link vacuumInto}. */
function copyOne(name: string, source: string, target: string): void {
  if (name === SQLITE_STORE_FILE_NAME) {
    vacuumInto(join(source, name), join(target, name));
    return;
  }
  copyFileSync(join(source, name), join(target, name), constants.COPYFILE_EXCL);
}

/**
 * Removes what a failed copy made: the first directory it made, or each
 * file it started when the target existed. A file is listed before its
 * copy starts, so a half-written one is removed too.
 */
function undo(target: string, written: readonly string[], madeDir: string | undefined): string {
  try {
    if (madeDir === undefined) {
      for (const name of written) rmSync(join(target, name), { force: true });
    } else {
      rmSync(madeDir, { recursive: true, force: true });
    }
    return '';
  } catch (error) {
    return ` Removing what it made failed too: ${String(error)}`;
  }
}

/**
 * Copies the store in `request.source` into `request.target`, answering
 * what it copied. Throws {@link EffortCopyRefusal} with nothing made, and
 * {@link EffortCopyFailure} with what it made removed; see the module
 * note.
 */
export function copyEffortStore(request: EffortCopyRequest): EffortCopyResult {
  const source = resolve(request.source);
  const target = resolve(request.target);
  guardTestProcess(source);
  guardTestProcess(target);

  const files = EFFORT_COPY_FILE_NAMES.filter((name) => existsSync(join(source, name)));
  if (files.length === 0) {
    throw new EffortCopyRefusal(`no effort store at ${source}: it holds none of ${EFFORT_COPY_FILE_NAMES.join(', ')}. Nothing to copy.`);
  }
  refuseUsedTarget(target);

  const written: string[] = [];
  let madeDir: string | undefined;
  try {
    madeDir = mkdirSync(target, { recursive: true });
    for (const name of files) {
      written.push(name);
      copyOne(name, source, target);
    }
  } catch (error) {
    const left = undo(target, written, madeDir);
    throw new EffortCopyFailure(`copying ${source} to ${target} failed: ${String(error)}.${left}`);
  }
  return Object.freeze({ source, directory: target, files: Object.freeze(files) });
}
