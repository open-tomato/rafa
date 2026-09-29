/**
 * Two devices' effort stores of one project, and their merge run from
 * either side, for the tests of readers that answer rows in order.
 *
 * Each device is a project root of its own under a case's directory,
 * holding `.rafa/effort/effort.sqlite`. The store is made and minted by
 * a writing open of `withSqliteStore`, handed the project and the new
 * store id the case names, so its `store_meta` row records the facts
 * that open observes on this machine and the store's own writers keep
 * that origin and stamp it on every row. A store under `tmpdir()`
 * outside a repository is otherwise never minted and stamps no origin.
 * Nothing here opens a `Database` of its own.
 *
 * {@link copyDevice} is the second device of scenario 1 of #322: a copy
 * of the first device's file, which its first writing open detects as a
 * copy and re-mints under an origin of its own, so both hold the rows
 * written before the copy under the first origin.
 *
 * {@link mergeBothWays} copies both devices' files into two fresh
 * project roots and runs `mergeStore` in each, once with the first
 * device's store as this store and once with the second's, as an
 * installed runtime with no live loop and no git read. The devices'
 * own files are only read.
 */
import type { RuntimeIdentity } from '../runtime/identity.js';

import { copyFileSync, mkdirSync, mkdtempSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { mergeStore } from '../effort/store/merge-store.js';
import { sqliteStorePath, withSqliteStore } from '../effort/store/sqlite.js';

/** The project both devices' `store_meta` rows name. */
const PROJECT = 'root-commit-merged-stores';

/** When the planted origins were minted. */
const MINTED_AT = '2026-09-29T08:00:00.000Z';

/** An installed runtime, which may swap a merged store in anywhere. */
const INSTALLED: RuntimeIdentity = { kind: 'installed', entry: '/home/u/.rafa/runtime/0.26.0/cli.js' };

/** One device: its project root and its store's origin. */
export interface Device {
  /** The project root, which the store's readers and writers are handed. */
  readonly root: string;
  /** The origin its `store_meta` row records. */
  readonly origin: string;
}

/** The two merged stores, by which device's store ran the merge. */
export interface MergedBothWays {
  /** A project root holding the first device's store with the second's merged into it. */
  readonly firstRanIt: string;
  /** A project root holding the second device's store with the first's merged into it. */
  readonly secondRanIt: string;
}

/** A fresh directory under `scope`, its path real. */
function freshDir(scope: string, name: string): string {
  return realpathSync(mkdtempSync(join(scope, `${name}-`)));
}

/**
 * Opens the store at `path` for a write that inserts nothing, making it
 * when `create` says so, so the open mints `origin` for it. Throws when
 * the open kept another origin, which a case built on it could not tell.
 */
function mintAs(path: string, origin: string, create: boolean): void {
  const seams = {
    readProject: () => ({ rootCommit: PROJECT, remote: null }),
    newStoreId: () => origin,
    now: () => new Date(MINTED_AT),
  };
  const recorded = withSqliteStore(path, 'write', create, (db) => db
    .query<{ store_id: string }, []>('SELECT store_id FROM store_meta WHERE id = 1')
    .get()?.store_id, seams);
  if (recorded !== origin) throw new Error(`store at ${path} records ${String(recorded)}, not ${origin}`);
}

/** A device of its own under `scope`, its store made, brought forward and minted as `origin`. */
export function freshDevice(scope: string, origin: string): Device {
  const root = freshDir(scope, origin);
  mintAs(sqliteStorePath(root), origin, true);
  return { root, origin };
}

/** A second device holding a copy of `from`'s store, re-minted as `origin`. */
export function copyDevice(scope: string, from: Device, origin: string): Device {
  const root = freshDir(scope, origin);
  const path = sqliteStorePath(root);
  mkdirSync(dirname(path), { recursive: true });
  copyFileSync(sqliteStorePath(from.root), path);
  mintAs(path, origin, false);
  return { root, origin };
}

/** A project root under `scope` holding a copy of `device`'s store, with `other`'s merged into it. */
function mergedInto(scope: string, device: Device, other: Device): string {
  const root = freshDir(scope, `merged-into-${device.origin}`);
  const path = sqliteStorePath(root);
  mkdirSync(dirname(path), { recursive: true });
  copyFileSync(sqliteStorePath(device.root), path);
  const result = mergeStore({
    path,
    otherPath: sqliteStorePath(other.root),
    backend: 'sqlite',
    dryRun: false,
    stamp: '20260929T120000Z',
    now: () => new Date('2026-09-29T12:00:00.000Z'),
    readProject: () => ({ rootCommit: null, remote: null }),
    identity: INSTALLED,
    isAlive: () => false,
  });
  if (result.status !== 'merged') throw new Error(`merge into ${device.origin} answered ${result.status}`);
  return root;
}

/** `first` and `second` merged twice under `scope`, once from each side. */
export function mergeBothWays(scope: string, first: Device, second: Device): MergedBothWays {
  return {
    firstRanIt: mergedInto(scope, first, second),
    secondRanIt: mergedInto(scope, second, first),
  };
}
