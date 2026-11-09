/**
 * `place`: after the suite, read what kind of run it was, and stage the
 * new and changed PNGs in the run's folder. Nothing under the set itself
 * is written; `promote` is the person's step.
 *
 * A file is staged when its hash differs from the one seeded for this
 * run, or when it was not seeded. An assert run changes no baseline, so
 * it stages nothing, whatever its result. The run's folder gets
 * `__image_snapshots__/` with the staged files, a staged `set.json`, and
 * `placed.json`, which marks the run placed.
 */
import type { LoadedConfig } from '../config/load.js';
import type { HostFacts } from '../host.js';
import type { SeedRecord } from './seed.js';
import type { RunCounts, SetRecord } from '../store/set-record.js';

import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { copyNamed, exists } from '../store/files.js';
import { hashFolder } from '../store/hash.js';
import { RECORD_FILE, SNAPSHOTS_FOLDER, STAGING_FOLDER, stagingDir } from '../store/key.js';
import { writeSetRecord } from '../store/set-record.js';
import { comparedFiles, readJestReport, readStoryIndex, runKindOf, runLine } from '../suite/storybook-jest.js';

import { readSeedRecord, SEED_FILE, snapshotsOf } from './seed.js';

/** What one place did. */
export interface PlaceResult {
  readonly runId: string;
  readonly runDir: string;
  readonly kind: RunCounts['kind'];
  readonly line: string;
  readonly staged: readonly string[];
  readonly counts: RunCounts;
  readonly warnings: readonly string[];
}

/** Which run to place. */
export interface PlaceOptions {
  readonly runnerKey: string;
  /** The run id; the newest unplaced run when absent. */
  readonly runId?: string;
}

/** What `place` reads beside the files. */
export interface PlaceSeams {
  readonly now: () => Date;
  readonly host: HostFacts;
}

/** The file that marks a run placed. */
export const PLACED_FILE = 'placed.json';

/** What `placed.json` holds. */
export interface PlacedRecord {
  readonly kind: RunCounts['kind'];
  readonly counts: RunCounts;
  readonly staged: readonly string[];
}

/** The run folders of one set and key, newest first. */
async function runFolders(dir: string, set: string, runnerKey: string): Promise<readonly string[]> {
  const parent = join(dir, STAGING_FOLDER, set, runnerKey);
  try {
    const entries = await readdir(parent, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
      .sort((a, b) => b.localeCompare(a));
  } catch {
    return [];
  }
}

/**
 * The run folder a step acts on: the named run, or the newest one whose
 * folder holds `want` and not `skip`. Throws naming what is missing.
 */
export async function pickRun(dir: string, set: string, runnerKey: string, runId: string | undefined, want: string, skip: string, verb: string): Promise<string> {
  if (runId !== undefined) {
    const runDir = stagingDir(dir, set, runnerKey, runId);
    if (!(await exists(join(runDir, want)))) throw new Error(`run ${runId} has no ${want}; nothing to ${verb}`);
    if (await exists(join(runDir, skip))) throw new Error(`run ${runId} is already ${skip === PLACED_FILE
      ? 'placed'
      : 'promoted'}`);
    return runDir;
  }
  for (const name of await runFolders(dir, set, runnerKey)) {
    const runDir = stagingDir(dir, set, runnerKey, name);
    if ((await exists(join(runDir, want))) && !(await exists(join(runDir, skip)))) return runDir;
  }
  throw new Error(`no run of ${set} @ ${runnerKey} is waiting to ${verb}`);
}

/** The platform part of a runner key: `darwin-arm64` from `host-darwin-arm64`. */
export function platformOfKey(runnerKey: string): string {
  return runnerKey.replace(/^[a-z]+-/, '');
}

/** The files the run compared, from the index when it reads, else from the counts with a warning. */
async function comparedCount(loaded: LoadedConfig, reading: Awaited<ReturnType<typeof readJestReport>>, warnings: string[]): Promise<number> {
  const { suite } = loaded.config.visual;
  const indexFile = join(loaded.workRoot, suite.package, suite.index);
  try {
    return comparedFiles(reading, await readStoryIndex(indexFile)).compared.length;
  } catch (error) {
    warnings.push(`the story index did not read (${error instanceof Error
      ? error.message
      : String(error)}); compared counts come from the report's totals`);
    return reading.counts.matched + reading.counts.unmatched;
  }
}

/** The staged set record. */
function stagedRecord(seed: SeedRecord, counts: RunCounts, files: number, host: HostFacts): SetRecord {
  return {
    set: seed.set,
    playwrightVersion: seed.playwrightVersion,
    runner: { kind: 'host', platform: platformOfKey(seed.runnerKey), os: host.os },
    projectCommit: seed.projectCommit,
    projectDirty: seed.projectDirty,
    promotedAt: null,
    files,
    lastRun: counts,
  };
}

/** Places one run: reads the report, stages new and changed PNGs, and marks the run placed. */
export async function placeVisual(loaded: LoadedConfig, options: PlaceOptions, seams: PlaceSeams): Promise<PlaceResult> {
  const { store, suite } = loaded.config.visual;
  if (store.kind === 'same-repo') throw new Error('place needs a store folder; same-repo arrives in a later cut');
  const runDir = await pickRun(store.dir, store.set, options.runnerKey, options.runId, SEED_FILE, PLACED_FILE, 'place');
  const seed = await readSeedRecord(runDir);
  const reading = await readJestReport(join(loaded.workRoot, suite.package, suite.report));
  const warnings: string[] = [];
  const seededNames = Object.keys(seed.hashes);
  const kind = runKindOf(reading.counts, seededNames.length);
  const counts: RunCounts = {
    kind,
    compared: kind === 'seed'
      ? 0
      : await comparedCount(loaded, reading, warnings),
    added: reading.counts.added,
    updated: reading.counts.updated,
    failed: reading.counts.unmatched,
  };

  const snapshots = snapshotsOf(loaded);
  const current = await hashFolder(snapshots);
  const staged = kind === 'assert'
    ? []
    : [...current.entries()].filter(([name, hash]) => seed.hashes[name] !== hash).map(([name]) => name);
  await copyNamed(snapshots, join(runDir, SNAPSHOTS_FOLDER), staged);
  const files = new Set([...seededNames, ...staged]).size;
  await writeSetRecord(join(runDir, RECORD_FILE), stagedRecord(seed, counts, files, seams.host));
  const placed: PlacedRecord = { kind, counts, staged };
  await Bun.write(join(runDir, PLACED_FILE), `${JSON.stringify({ ...placed, placedAt: seams.now().toISOString() }, null, 2)}\n`);
  return { runId: seed.runId, runDir, kind, line: runLine(kind, reading.counts, staged.length), staged, counts, warnings };
}
