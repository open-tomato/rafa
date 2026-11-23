/**
 * `takeEffortSnapshot`: the one read of the live effort store, a
 * `vacuumInto` copy at `<root>/.rafa/atlas/snapshot/effort.sqlite`, which
 * the ingest opens read-only in its place.
 *
 * The live store is touched by core's `vacuumInto` alone
 * (`packages/rafa/src/effort/store/copy.ts`): it opens the store
 * read-only, runs `VACUUM INTO` and never plans a schema or calls
 * `bringForward`, so a dev build may copy a store of any version and the
 * store's bytes stay as they were. Nothing here goes through
 * `withSqliteStore`, which can adopt or migrate a store.
 *
 * The store is found as every store reader finds it: `effortStoreDir`
 * answers `RAFA_EFFORT_DIR` when it is set and `<root>/.rafa/effort/`
 * otherwise. The snapshot is always written under the project root, so a
 * run with `RAFA_EFFORT_DIR` reads the copy it names and still writes
 * beside the replica.
 *
 * `VACUUM INTO` refuses a target that exists, so the copy lands in a
 * `.part-<id>` file beside the snapshot path and is renamed over it: an
 * earlier snapshot is replaced whole, and a failed copy removes its part
 * file and leaves the earlier snapshot as it was.
 *
 * Both paths pass core's test guard (`guardTestProcess`) before anything
 * is read or made, so a test snapshots stores under `tmpdir()` only.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { vacuumInto } from '@open-tomato/rafa-core/store/copy';
import { effortStoreDir, guardTestProcess } from '@open-tomato/rafa-core/store/location';
import { SQLITE_STORE_FILE_NAME } from '@open-tomato/rafa-core/store/sqlite';

/** The snapshot's folder under the project root. */
export const SNAPSHOT_DIR: string = join('.rafa', 'atlas', 'snapshot');

/** The hex digits of the part file's random suffix. */
const PART_SUFFIX_LENGTH = 8;

/** An environment, as `process.env` holds one. */
export type SnapshotEnvironment = Readonly<Record<string, string | undefined>>;

/** What one snapshot is handed. */
export interface EffortSnapshotOptions {
  /** The project root: the main checkout, which holds the store and the replica. */
  readonly root: string;
  /** Read for `RAFA_EFFORT_DIR`; defaults to `process.env`. */
  readonly env?: SnapshotEnvironment;
  /** The snapshot clock; defaults to the system clock. */
  readonly now?: () => Date;
}

/** What one snapshot did. */
export interface EffortSnapshot {
  /** The live store file copied from. */
  readonly sourcePath: string;
  /** The copy, `<root>/.rafa/atlas/snapshot/effort.sqlite`. */
  readonly snapshotPath: string;
  /** When the copy was taken, ISO-8601 UTC. */
  readonly takenAt: string;
}

/** The snapshot file under `root`, whether or not it exists yet. */
export function snapshotPathOf(root: string): string {
  return join(root, SNAPSHOT_DIR, SQLITE_STORE_FILE_NAME);
}

/** The live store file under `root`, `RAFA_EFFORT_DIR` applied; throws as `effortStoreDir` does. */
export function effortStorePathOf(root: string, env: SnapshotEnvironment = process.env): string {
  return join(effortStoreDir(root, env), SQLITE_STORE_FILE_NAME);
}

/**
 * Copy the live store under `options.root` to its snapshot path with
 * `vacuumInto`. Throws, having made nothing, when no store file is there;
 * see the module note for the rest.
 */
export function takeEffortSnapshot(options: EffortSnapshotOptions): EffortSnapshot {
  const sourcePath = effortStorePathOf(options.root, options.env);
  const snapshotPath = snapshotPathOf(options.root);
  guardTestProcess(sourcePath);
  guardTestProcess(snapshotPath);
  if (!existsSync(sourcePath)) {
    throw new Error(`atlas: no effort store at ${sourcePath}; set ATLAS_PROJECT_ROOT to the main checkout`);
  }

  const takenAt = (options.now ?? (() => new Date()))().toISOString();
  const suffix = randomUUID()
    .replace(/-/g, '')
    .slice(0, PART_SUFFIX_LENGTH);
  const partPath = `${snapshotPath}.part-${suffix}`;
  mkdirSync(dirname(snapshotPath), { recursive: true });
  try {
    vacuumInto(sourcePath, partPath);
    renameSync(partPath, snapshotPath);
  } catch (error: unknown) {
    rmSync(partPath, { force: true });
    throw error;
  }
  return { sourcePath, snapshotPath, takenAt };
}
