/**
 * The `service` sync strategy's state file: the two cursors a device
 * keeps between contacts with the hub, and the `heldBack` mark of a
 * projected pull, kept beside the store it syncs.
 *
 * ## The two cursors
 *
 *   - **push**: the highest local `seq` of each merged table already
 *     pushed, the `cursor` core's `exportWirePayload` answered for the
 *     last push the hub took. The next push exports only the rows past it.
 *   - **pull**: the hub cursor the last pull answered and this store
 *     merged. The next pull asks the hub only for the rows past it.
 *
 * ## Held back
 *
 *   - **heldBack**: the pull cursor a store held before its first
 *     projected pull, the one that took rows cut down to this build's
 *     schema, with the time that pull was taken. The refill pulls from
 *     it again, so every row a projected pull cut arrives whole. It is
 *     set at the first projected contact only: a later projected
 *     contact leaves it where it is, since moving it forward would
 *     leave the rows the first contact cut out of the refill. It is
 *     cleared once the refill has merged.
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
 * and a version this module reads is read as holding no cursors, and so
 * is an entry any of whose cursors is not a map of whole numbers of 0 or
 * more, or whose `heldBack` is there but not a cursor with a time: starting
 * from zero is safe, and refusing would stop a device syncing over a
 * file that only saves it resending rows. A file that is there but
 * cannot be read, such as one whose permissions refuse the read,
 * throws the read's own error, since the write after it would fail
 * too. The file is rewritten whole by writing a new file beside it and
 * renaming that over it, so a reader never sees half a file. Two
 * processes writing it at once can lose one's update, which only moves
 * a cursor back and resends rows.
 *
 * ## Versions
 *
 * Version 2 added `heldBack`. A version 1 file is read down: its push
 * and pull cursors are kept and it holds no `heldBack`, and the next
 * write rewrites it as version 2. A build that reads only version 1
 * reads a version 2 file as holding no cursors, so it does one full
 * pull, which merges as a no-op since its store holds every row.
 */
import type { WireCursor } from '@open-tomato/rafa/store';

import { randomUUID } from 'node:crypto';
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** The state file's name, in the directory the store file sits in. */
export const SYNC_STATE_FILE_NAME = 'sync-service.json';

/** What every state file's `format` holds. */
export const SYNC_STATE_FORMAT = 'rafa-sync-service-state';

/** The state file version this module writes, and the newest it reads. */
export const SYNC_STATE_VERSION = 2;

/** The versions this module reads; every one but the newest is read down. */
const READ_VERSIONS: ReadonlySet<unknown> = new Set([1, SYNC_STATE_VERSION]);

/** Which cursor a write replaces. */
export type SyncDirection = 'push' | 'pull';

/** Where a store's refill pulls from; see the module note. */
export interface HeldBack {
  /** The pull cursor the store held before its first projected pull. */
  readonly cursor: WireCursor;
  /** When that pull was taken, as an ISO 8601 time. */
  readonly since: string;
}

/** Both cursors of one store, and its `heldBack` when set; see the module note. */
export interface SyncCursors {
  readonly push: WireCursor;
  readonly pull: WireCursor;
  readonly heldBack?: HeldBack;
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

/** `value` as a `heldBack`, or undefined when it is not a cursor with a time. */
function heldBackOf(value: unknown): HeldBack | undefined {
  if (!isRecord(value) || typeof value.since !== 'string' || Number.isNaN(Date.parse(value.since))) return undefined;
  const cursor = cursorOf(value.cursor);
  return cursor === undefined
    ? undefined
    : Object.freeze({ cursor, since: value.since });
}

/**
 * `value` as an entry of a file at `version`, or undefined when it is
 * none. A version 1 entry is read down with no `heldBack`, since that
 * version had none.
 */
function entryOf(value: unknown, version: unknown): StateEntry | undefined {
  if (!isRecord(value) || typeof value.hub !== 'string') return undefined;
  const push = cursorOf(value.push);
  const pull = cursorOf(value.pull);
  if (push === undefined || pull === undefined) return undefined;
  if (version === 1 || value.heldBack === undefined) return { hub: value.hub, push, pull };
  const heldBack = heldBackOf(value.heldBack);
  return heldBack === undefined
    ? undefined
    : { hub: value.hub, push, pull, heldBack };
}

/** A file's `stores` and the version it was written at. */
interface ReadStores {
  readonly version: unknown;
  readonly stores: Readonly<Record<string, unknown>>;
}

/** What a file holding no usable stores reads as. */
const NO_STORES: ReadStores = Object.freeze({ version: SYNC_STATE_VERSION, stores: Object.freeze({}) });

/** The file's `stores`, or an empty map when the file is missing or not a format and version this module reads. */
function readStores(statePath: string): ReadStores {
  let text: string;
  try {
    text = readFileSync(statePath, 'utf8');
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') return NO_STORES;
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return NO_STORES;
  }
  if (!isRecord(parsed) || parsed.format !== SYNC_STATE_FORMAT || !READ_VERSIONS.has(parsed.version)) return NO_STORES;
  return isRecord(parsed.stores)
    ? { version: parsed.version, stores: parsed.stores }
    : NO_STORES;
}

/** The entry `origin` holds for `hub`, or undefined when it holds none. */
function readEntry(statePath: string, origin: string, hub: string): StateEntry | undefined {
  const { version, stores } = readStores(statePath);
  const entry = Object.hasOwn(stores, origin)
    ? entryOf(stores[origin], version)
    : undefined;
  return entry?.hub === hub
    ? entry
    : undefined;
}

/**
 * The cursors the file at `statePath` keeps for the store whose origin
 * is `origin`, kept for the hub at `hub`, with its `heldBack` when set;
 * both cursors empty when it keeps none.
 */
export function readSyncCursors(statePath: string, origin: string, hub: string): SyncCursors {
  const entry = readEntry(statePath, origin, hub);
  if (entry === undefined) return NO_CURSORS;
  return Object.freeze(entry.heldBack === undefined
    ? { push: entry.push, pull: entry.pull }
    : { push: entry.push, pull: entry.pull, heldBack: entry.heldBack });
}

/** Rewrites the file at `statePath` to hold only `origin`'s `entry`. */
function writeEntry(statePath: string, origin: string, entry: StateEntry): void {
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

/**
 * Replaces `direction`'s cursor of `origin`'s entry for `hub` with
 * `cursor`, keeping the other cursor and `heldBack` when the entry was
 * kept for the same hub, and dropping every other origin's entry. See
 * the module note.
 */
export function writeSyncCursor(
  statePath: string,
  origin: string,
  hub: string,
  direction: SyncDirection,
  cursor: WireCursor,
): void {
  const kept = readEntry(statePath, origin, hub) ?? NO_CURSORS;
  writeEntry(statePath, origin, {
    hub,
    push: direction === 'push'
      ? cursor
      : kept.push,
    pull: direction === 'pull'
      ? cursor
      : kept.pull,
    ...(kept.heldBack === undefined
      ? {}
      : { heldBack: kept.heldBack }),
  });
}

/**
 * Sets `origin`'s `heldBack` for `hub` to `heldBack` when the entry
 * holds none, and answers the `heldBack` the entry holds afterwards: a
 * `heldBack` already set is kept, since only the first projected
 * contact sets it. See the module note.
 */
export function keepHeldBack(statePath: string, origin: string, hub: string, heldBack: HeldBack): HeldBack {
  const kept = readEntry(statePath, origin, hub);
  if (kept?.heldBack !== undefined) return kept.heldBack;
  writeEntry(statePath, origin, { hub, push: kept?.push ?? NO_CURSORS.push, pull: kept?.pull ?? NO_CURSORS.pull, heldBack });
  return heldBack;
}

/**
 * Clears `origin`'s `heldBack` for `hub`, keeping both cursors; a no-op
 * when the entry holds none. The refill calls it once it has merged.
 */
export function clearHeldBack(statePath: string, origin: string, hub: string): void {
  const kept = readEntry(statePath, origin, hub);
  if (kept?.heldBack === undefined) return;
  writeEntry(statePath, origin, { hub, push: kept.push, pull: kept.pull });
}
