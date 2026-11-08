/**
 * `seed`: put the store's set where the suite reads its snapshots, so
 * the suite compares against the set and nothing else.
 *
 * Each run gets its own folder under the store's `.staging/`, named by a
 * run id. What the package's snapshot folder held is moved there, into
 * `previous/`, never deleted; then the set's PNGs are copied in, and
 * `seeded.json` remembers what was seeded and each file's hash, which is
 * what `place` and `promote` compare against.
 */
import type { LoadedConfig } from '../config/load.js';
import type { ProcessRunner } from '../process.js';
import type { CheckReport } from './check.js';
import type { SetRecord } from '../store/set-record.js';

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { copyNamed, exists, moveFolder, pngNames } from '../store/files.js';
import { hashFolder } from '../store/hash.js';
import { newRunId, setPaths, stagingDir } from '../store/key.js';

/** The record a seed leaves in its run folder. */
export interface SeedRecord {
  readonly runId: string;
  readonly set: string;
  readonly playwrightVersion: string;
  readonly runnerKey: string;
  /** The set's record when it was seeded, or null when there was no set. */
  readonly seededFrom: SetRecord | null;
  /** Each seeded file's sha256, by name. */
  readonly hashes: Readonly<Record<string, string>>;
  readonly projectCommit: string | null;
  readonly projectDirty: boolean;
}

/** What one seed did. */
export interface SeedResult {
  readonly runId: string;
  readonly runDir: string;
  readonly seeded: number;
  readonly previousMoved: number;
}

/** What `seed` may run. */
export interface SeedSeams {
  readonly run: ProcessRunner;
  readonly now: () => Date;
  readonly random: () => number;
}

/** The seed record's file in a run folder. */
export const SEED_FILE = 'seeded.json';

/** The folder in a run folder that holds what the snapshot folder held before the seed. */
export const PREVIOUS_FOLDER = 'previous';

/** The project's short commit and whether its tree is dirty, or null and false outside git. */
export async function projectState(root: string, run: ProcessRunner): Promise<{ commit: string | null; dirty: boolean }> {
  const head = await run(['git', 'rev-parse', '--short', 'HEAD'], { cwd: root });
  if (head.exitCode !== 0) return { commit: null, dirty: false };
  const status = await run(['git', 'status', '--porcelain'], { cwd: root });
  return { commit: head.stdout.trim(), dirty: status.stdout.trim() !== '' };
}

/** Reads a run folder's seed record. Throws naming the folder when there is none. */
export async function readSeedRecord(runDir: string): Promise<SeedRecord> {
  const file = Bun.file(join(runDir, SEED_FILE));
  if (!(await file.exists())) throw new Error(`${runDir} holds no ${SEED_FILE}; it is no seeded run`);
  return (await file.json()) as SeedRecord;
}

/** The package's snapshot folder. */
export function snapshotsOf(loaded: LoadedConfig): string {
  const { suite } = loaded.config.visual;
  return join(loaded.workRoot, suite.package, suite.snapshots);
}

/** Seeds the package's snapshot folder from the set at the report's key. Throws when the report names no key. */
export async function seedVisual(loaded: LoadedConfig, report: CheckReport, seams: SeedSeams): Promise<SeedResult> {
  const { store } = loaded.config.visual;
  const { runnerKey, playwrightVersion } = report;
  if (runnerKey === null || playwrightVersion === null || store.kind === 'same-repo') {
    throw new Error('seed needs a runner key, a playwright version and a store folder; run check first');
  }
  const runId = newRunId(seams.now(), seams.random);
  const runDir = stagingDir(store.dir, store.set, runnerKey, runId);
  await mkdir(runDir, { recursive: true });

  const snapshots = snapshotsOf(loaded);
  const previous = join(runDir, PREVIOUS_FOLDER);
  const previousMoved = (await exists(snapshots))
    ? (await pngNames(snapshots)).length
    : 0;
  if (await exists(snapshots)) await moveFolder(snapshots, previous);

  const paths = setPaths(store.dir, store.set, playwrightVersion, runnerKey);
  const seeded = await copyNamed(paths.snapshotsDir, snapshots, await pngNames(paths.snapshotsDir));
  const state = await projectState(loaded.workRoot, seams.run);
  const record: SeedRecord = {
    runId,
    set: store.set,
    playwrightVersion,
    runnerKey,
    seededFrom: seeded === 0
      ? null
      : report.set,
    hashes: Object.fromEntries(await hashFolder(snapshots)),
    projectCommit: state.commit,
    projectDirty: state.dirty,
  };
  await Bun.write(join(runDir, SEED_FILE), `${JSON.stringify(record, null, 2)}\n`);
  return { runId, runDir, seeded, previousMoved };
}
