/**
 * `buildAtlas`: the one-pass replica builder, over the buckets built so
 * far.
 *
 * 1. `ingestEffort` snapshots the effort store under the project root
 *    with `vacuumInto` and fills `task_facts`, `finding_facts`,
 *    `bug_facts`, `change_facts` and `ci_facts`, stamping `local.tasks`,
 *    `local.findings`, `local.bugs`, `local.changes` and `local.ci`. The
 *    `module` column names the folders `DEFAULT_MODULE_GLOBS` finds under
 *    the root (`discoverModules`).
 * 2. `ingestGit` reads the root's first-parent history (D12) into
 *    `commit_facts`, with the `v*` release tags (D13), and the stretch
 *    merges into `stretch_marks`, stamping `local.commits` and
 *    `local.marks`; git runs in the project root through the options'
 *    runner. When git gives no history for the root, both are stamped
 *    missing and the build goes on.
 * 3. `ingestBoard` reads the board cache at `<root>/.rafa/cache/board.json`
 *    once (D14) into `issue_facts` and today's counts by stage into
 *    `board_snapshot`, stamping `local.issues` and `local.board` with the
 *    cache's watermark; no `gh` call is made. With no cache both are
 *    stamped missing and the build goes on.
 * 4. `deriveBuild` (`derive.ts`) gives each session its work type
 *    (D4), derives `daily_rollup` from the buckets and the snapshot's
 *    preflight runs, `plan_facts` from them and the plan folder
 *    (`readPlans`), each commit's plan and each plan's epic, stamping
 *    `local.daily` and `local.plans`.
 *
 * All four run inside one `writeReplica`, so the replica at
 * `<root>/.rafa/atlas/atlas.sqlite` is replaced whole by one rename, and
 * a failed step leaves the earlier replica as it was.
 *
 * The options take the project root and its plan folder; the project
 * config (`loadAtlasConfig`) and the `offline` switch join them once a
 * source reads them.
 */
import type { GitRunner } from '../ingest/git.js';
import type { SnapshotEnvironment } from '../ingest/snapshot.js';
import type { SourceStamp } from '@open-tomato/atlas-data/replica';

import { basename, join } from 'node:path';

import { writeReplica } from '@open-tomato/atlas-data/replica';

import { DEFAULT_MODULE_GLOBS, discoverModules } from '../ingest/attribute.js';
import { ingestBoard } from '../ingest/board.js';
import { ingestEffort } from '../ingest/effort.js';
import { createGitRunner, ingestGit } from '../ingest/git.js';
import { DEFAULT_PLAN_DIR } from '../ingest/plans.js';

import { deriveBuild } from './derive.js';

/** The live store file a build reads, so a caller (the demo server) checks for it as the build finds it. */
export { effortStorePathOf } from '../ingest/snapshot.js';

/** The replica file under the project root. */
export const REPLICA_FILE: string = join('.rafa', 'atlas', 'atlas.sqlite');

/** What one build is handed. */
export interface BuildOptions {
  /** The project root: the main checkout, which holds the store and the replica. */
  readonly projectRoot: string;
  /** The plan folder, absolute; defaults to core's default `plan.dir` under the root. */
  readonly planDir?: string;
  /** Read for `RAFA_EFFORT_DIR`; defaults to `process.env`. */
  readonly env?: SnapshotEnvironment;
  /** The build clock, for the snapshot and the replica stamps; defaults to the system clock. */
  readonly now?: () => Date;
  /** Stamped as the replica's `project_label`; defaults to the root's folder name. */
  readonly projectLabel?: string;
  /** Git over the project root; defaults to `createGitRunner(projectRoot)`. */
  readonly git?: GitRunner;
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
      modules: discoverModules(options.projectRoot, DEFAULT_MODULE_GLOBS),
      ...(options.env === undefined
        ? {}
        : { env: options.env }),
      ...(options.now === undefined
        ? {}
        : { now: options.now }),
    });
    const git = ingestGit(build, {
      runner: options.git ?? createGitRunner(options.projectRoot),
      ...(options.now === undefined
        ? {}
        : { now: options.now }),
    });
    const board = ingestBoard(build, {
      root: options.projectRoot,
      ...(options.now === undefined
        ? {}
        : { now: options.now }),
    });
    const derived = deriveBuild(build, {
      planDir: options.planDir ?? join(options.projectRoot, DEFAULT_PLAN_DIR),
      snapshotPath: effort.snapshot.snapshotPath,
      stamps: [...effort.stamps, ...git.stamps, ...board.stamps],
      gitRead: git.read,
      boardRead: board.read,
    });
    return [...effort.stamps, ...git.stamps, ...board.stamps, ...derived.stamps];
  });
  return { replicaPath, buildId: result.buildId, tables: result.tables, sources: result.value };
}
