/**
 * The `service` sync strategy's state file: the two cursors a device
 * keeps between contacts with the hub, kept beside the store it syncs.
 *
 * ## The two cursors
 *
 *   - **push**: the highest local `seq` of each merged table already
 *     pushed, the `cursor` core's `exportWirePayload` answered for the
 *     last push the hub took. The next push exports only the rows past it.
 *   - **pull**: the hub cursor the last pull answered and this store
 *     merged. The next pull asks the hub only for the rows past it.
 *
 * ## Keyed by origin
 *
 * The file holds the cursors under the store's origin, the `store_id`
 * of its `store_meta` row, which its rows carry as `origin_store`. A
 * push cursor counts one store file's local `seq`s, so it holds only
 * for the store that wrote it. Core mints a new origin whenever a store
 * could be another file than it was (a copy, a restored backup, a
 * merged file swapped in), and a new origin finds no cursors here and
 * starts both from zero. That is always safe: the hub skips a row
 * whose origin pair it holds, and `mergeStore` skips one this store
 * holds, so starting again resends rows and never loses one.
 *
 * Each entry also names the hub it was kept for, and an entry naming
 * another `hub.url` is read as none: a new hub has none of the rows the
 * old one took, and its cursors count another store's `seq`s.
 *
 * Writing a cursor keeps only the entry of the origin written, so the
 * file never grows with the origins a store has left behind: no store
 * goes back to an origin it has left.
 *
 * ## Reading and writing
 *
 * A file that is not there, is not JSON, or does not hold this format
 * and version is read as holding no cursors, and so is an entry any of
 * whose cursors is not a map of whole numbers of 0 or more: starting
 * from zero is safe, and refusing would stop a device syncing over a
 * file that only saves it resending rows. A file that is there but
 * cannot be read, such as one whose permissions refuse the read,
 * throws the read's own error, since the write after it would fail
 * too. The file is rewritten whole by writing a new file beside it and
 * renaming that over it, so a reader never sees half a file. Two
 * processes writing it at once can lose one's update, which only moves
 * a cursor back and resends rows.
 */
import type { WireCursor } from '@open-tomato/rafa/store';

import { randomUUID } from 'node:crypto';
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** The state file's name, in the directory the store file sits in. */
export const SYNC_STATE_FILE_NAME = 'sync-service.json';

/** What every state file's `format` holds. */
export const SYNC_STATE_FORMAT = 'rafa-sync-service-state';

/** The state file version this module writes and reads. */
export const SYNC_STATE_VERSION = 1;

/** Which cursor a write replaces. */
export type SyncDirection = 'push' | 'pull';

/** Both cursors of one store; see the module note. */
export interface SyncCursors {
  readonly push: WireCursor;
  readonly pull: WireCursor;
}

/** One store's entry as the file holds it. */
interface StateEntry extends SyncCursors {
  /** The `hub.url` the cursors were kept for. */
  readonly hub: string;
}

/** What a store with no usable entry starts from. */
const NO_CURSORS: SyncCursors = Object.freeze({ push: Object.freeze({}), pull: Object.freeze({}) });

/** The state file for the store file at `storePath`. */
export function syncStatePath(storePath: string): string {
  return join(dirname(storePath), SYNC_STATE_FILE_NAME);
}

/** Whether `value` is a plain JSON object. */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `value` as a cursor, or undefined when any entry is not a whole number of 0 or more. */
function cursorOf(value: unknown): WireCursor | undefined {
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value);
  const valid = entries.every(([, seq]) => typeof seq === 'number' && Number.isSafeInteger(seq) && seq >= 0);
  return valid
    ? Object.freeze(Object.fromEntries(entries) as Record<string, number>)
    : undefined;
}

/** `value` as an entry, or undefined when it is none. */
function entryOf(value: unknown): StateEntry | undefined {
  if (!isRecord(value) || typeof value.hub !== 'string') return undefined;
  const push = cursorOf(value.push);
  const pull = cursorOf(value.pull);
  return push === undefined || pull === undefined
    ? undefined
    : { hub: value.hub, push, pull };
}

/** The file's `stores`, or an empty map when the file is missing or not this format. */
function readStores(statePath: string): Readonly<Record<string, unknown>> {
  let text: string;
  try {
    text = readFileSync(statePath, 'utf8');
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') return {};
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {};
  }
  if (!isRecord(parsed) || parsed.format !== SYNC_STATE_FORMAT || parsed.version !== SYNC_STATE_VERSION) return {};
  return isRecord(parsed.stores)
    ? parsed.stores
    : {};
}

/** The entry `origin` holds for `hub`, or undefined when it holds none. */
function readEntry(statePath: string, origin: string, hub: string): StateEntry | undefined {
  const stores = readStores(statePath);
  const entry = Object.hasOwn(stores, origin)
    ? entryOf(stores[origin])
    : undefined;
  return entry?.hub === hub
    ? entry
    : undefined;
}

/**
 * The cursors the file at `statePath` keeps for the store whose origin
 * is `origin`, kept for the hub at `hub`; both empty when it keeps none.
 */
export function readSyncCursors(statePath: string, origin: string, hub: string): SyncCursors {
  const entry = readEntry(statePath, origin, hub);
  return entry === undefined
    ? NO_CURSORS
    : Object.freeze({ push: entry.push, pull: entry.pull });
}

/**
 * Replaces `direction`'s cursor of `origin`'s entry for `hub` with
 * `cursor`, keeping the other cursor when the entry was kept for the
 * same hub, and dropping every other origin's entry. See the module note.
 */
export function writeSyncCursor(
  statePath: string,
  origin: string,
  hub: string,
  direction: SyncDirection,
  cursor: WireCursor,
): void {
  const kept = readEntry(statePath, origin, hub) ?? NO_CURSORS;
  const entry: StateEntry = {
    hub,
    push: direction === 'push'
      ? cursor
      : kept.push,
    pull: direction === 'pull'
      ? cursor
      : kept.pull,
  };
  const text = `${JSON.stringify({ format: SYNC_STATE_FORMAT, version: SYNC_STATE_VERSION, stores: { [origin]: entry } }, null, 2)}\n`;
  const written = `${statePath}.${randomUUID()}.tmp`;
  try {
    writeFileSync(written, text, 'utf8');
    renameSync(written, statePath);
  } catch (error) {
    rmSync(written, { force: true });
    throw error;
  }
}
