/**
 * This device's store id: the `store_meta.store_id` of the project's
 * effort store, the id every claim commit this device makes names in
 * its `Rafa-Claim-Store` trailer (`./record.ts`).
 *
 * ## Read through the store's own open
 *
 * The id is read by `readStoreMeta` (`src/effort/store/store-meta.ts`)
 * inside `withSqliteStore` for a `read`, the path every store reader
 * takes, so the open runs the test guard, the busy timeout and
 * `bringForward` as any other does. A read open never mints, so asking
 * for the id writes nothing, and a store whose id is unminted stays
 * unminted. A store file that does not exist is not opened at all,
 * since an open with SQLite's create flag would make it. No `Database`
 * is opened here: `store-sources.sweep.test.ts` refuses one outside its
 * allow-list.
 *
 * ## When there is no id
 *
 * {@link readDeviceStoreId} answers the id, or one of three causes with
 * a reason a command can print as it stands:
 *
 * | Cause | When | The reason names |
 * |---|---|---|
 * | `ndjson` | the config reads `store: ndjson` | `rafa effort move --to=sqlite` |
 * | `unminted` | the SQLite store exists and holds no `store_meta` row | `rafa effort move --to=sqlite` |
 * | `absent` | the SQLite store file does not exist yet | its first write |
 *
 * The config decides the backend, never the files on disk: a project
 * reading `store: ndjson` answers `ndjson` even beside a minted SQLite
 * file, since that file is not the store its runs write to.
 *
 * Measured on 2026-09-30 with a scratch project under `tmpdir()`:
 * `rafa effort move --to=sqlite` over an existing unminted store in a
 * repository with a commit minted its id, since its append opens the
 * store for a write even when it moves no row. Over a project whose
 * NDJSON files held no rows and whose SQLite file did not exist, the
 * same move set `store: sqlite` and created no file, so no id. That is
 * why `absent` does not name the move: it would not help, and the store
 * is made, and its id minted, by its first write that adds a row.
 */
import type { RafaConfig } from '../config.js';

import { existsSync } from 'node:fs';

import { MOVE_TO_SQLITE } from '../effort/store/merge-store.js';
import { sqliteStorePath, withSqliteStore } from '../effort/store/sqlite.js';
import { readStoreMeta } from '../effort/store/store-meta.js';

/** Why this device has no store id to claim under. */
export type NoStoreIdCause = 'ndjson' | 'absent' | 'unminted';

/** What {@link readDeviceStoreId} answers. */
export type DeviceStoreId =
  /** The store's minted id. */
  | { readonly ok: true; readonly storeId: string }
  /** No id, with the cause and a reason to print. */
  | { readonly ok: false; readonly cause: NoStoreIdCause; readonly reason: string };

/** The start every reason shares: what a missing id costs. */
const NO_CLAIMANT = 'no claim can name this device';

/** The reason for a `store: ndjson` project. */
function ndjsonReason(): string {
  return 'this project\'s effort store is NDJSON (store: ndjson), which records no store id,'
    + ` so ${NO_CLAIMANT}. Next safe step: ${MOVE_TO_SQLITE}`;
}

/** The reason for a SQLite store at `path` that holds no minted id. */
function unmintedReason(path: string): string {
  return `the effort store at ${path} has no store id minted yet, so ${NO_CLAIMANT}.`
    + ` Next safe step: ${MOVE_TO_SQLITE}, whose write mints one`;
}

/** The reason for a SQLite store at `path` that does not exist yet. */
function absentReason(path: string): string {
  return `there is no effort store at ${path} yet, so no store id and ${NO_CLAIMANT};`
    + ' its id is minted by the store\'s first write that adds a row';
}

/**
 * This device's store id, read from the effort store of the project at
 * `repoRoot` that `config.store` names, or the cause and reason it has
 * none. Opens the store only for a read, and only when its file exists,
 * so it creates and mints nothing. Throws what the store's open throws
 * for a store it refuses to read. See the module note.
 */
export function readDeviceStoreId(repoRoot: string, config: Pick<RafaConfig, 'store'>): DeviceStoreId {
  if (config.store === 'ndjson') return { ok: false, cause: 'ndjson', reason: ndjsonReason() };

  const path = sqliteStorePath(repoRoot);
  if (!existsSync(path)) return { ok: false, cause: 'absent', reason: absentReason(path) };

  const meta = withSqliteStore(path, 'read', false, (db) => readStoreMeta(db));
  return meta === null
    ? { ok: false, cause: 'unminted', reason: unmintedReason(path) }
    : { ok: true, storeId: meta.storeId };
}
