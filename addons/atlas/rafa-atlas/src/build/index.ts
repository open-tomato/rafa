/**
 * `buildAtlas`: the one-pass replica builder, over the two buckets built
 * so far.
 *
 * 1. `ingestEffort` snapshots the effort store under the project root
 *    with `vacuumInto` and fills `task_facts`, stamping `local.tasks`.
 * 2. `rollupDaily` derives `daily_rollup` from those rows, stamping
 *    `local.daily`.
 *
 * Both run inside one `writeReplica`, so the replica at
 * `<root>/.rafa/atlas/atlas.sqlite` is replaced whole by one rename, and
 * a failed step leaves the earlier replica as it was. The other four
 * buckets of the PoC are created empty by the DDL and read 0 rows in the
 * summary until their ingest lands.
 *
 * The options take the project root itself; the project config
 * (`loadAtlasConfig`) and the `offline` switch join them once a source
 * reads them.
 */
import type { SnapshotEnvironment } from '../ingest/snapshot.js';
import type { SourceStamp } from '@open-tomato/atlas-data/replica';

import { basename, join } from 'node:path';

import { writeReplica } from '@open-tomato/atlas-data/replica';

import { ingestEffort } from '../ingest/effort.js';

import { rollupDaily } from './daily.js';

/** The replica file under the project root. */
export const REPLICA_FILE: string = join('.rafa', 'atlas', 'atlas.sqlite');

/** What one build is handed. */
export interface BuildOptions {
  /** The project root: the main checkout, which holds the store and the replica. */
  readonly projectRoot: string;
  /** Read for `RAFA_EFFORT_DIR`; defaults to `process.env`. */
  readonly env?: SnapshotEnvironment;
  /** The build clock, for the snapshot and the replica stamps; defaults to the system clock. */
  readonly now?: () => Date;
  /** Stamped as the replica's `project_label`; defaults to the root's folder name. */
  readonly projectLabel?: string;
}

/** What one build wrote. */
export interface BuildSummary {
  readonly replicaPath: string;
  readonly buildId: string;
  /** The rows each bucket holds in the replica just swapped in. */
  readonly tables: Readonly<Record<string, number>>;
  /** The `atlas_sources` rows stamped, in build order. */
  readonly sources: readonly SourceStamp[];
}

/** The replica file under `projectRoot`, whether or not it exists yet. */
export function replicaPathOf(projectRoot: string): string {
  return join(projectRoot, REPLICA_FILE);
}

/** Build the replica under `options.projectRoot`; see the module note for the steps. */
export async function buildAtlas(options: BuildOptions): Promise<BuildSummary> {
  const replicaPath = replicaPathOf(options.projectRoot);
  const result = await writeReplica({
    replicaPath,
    projectLabel: options.projectLabel ?? basename(options.projectRoot),
    ...(options.now === undefined
      ? {}
      : { now: options.now }),
  }, (build) => {
    const effort = ingestEffort(build, {
      root: options.projectRoot,
      ...(options.env === undefined
        ? {}
        : { env: options.env }),
      ...(options.now === undefined
        ? {}
        : { now: options.now }),
    });
    const daily = rollupDaily(build, effort.stamp);
    return [effort.stamp, daily];
  });
  return { replicaPath, buildId: result.buildId, tables: result.tables, sources: result.value };
}
