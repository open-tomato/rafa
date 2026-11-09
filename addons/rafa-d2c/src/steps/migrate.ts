/**
 * `migrate`: move a flat baseline set (`<set>/__image_snapshots__/` with
 * an `ENVIRONMENT` file) into the key layout, and write its `set.json`.
 *
 * The playwright version and platform come from the old `ENVIRONMENT`,
 * because it records what drew the set; the project's current version
 * may differ. Without it, both `--playwright` and `--runner` are needed.
 * The old `ENVIRONMENT` and `MANIFEST.sha256` are removed only when the
 * store's git already holds them unchanged in a commit, so their content
 * stays in history; otherwise they are kept and the result says so.
 * Nothing is committed: the person makes the commit.
 */
import type { LoadedConfig } from '../config/load.js';
import type { ProcessRunner } from '../process.js';
import type { SetRecord } from '../store/set-record.js';

import { mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { readEnvironment } from '../store/environment.js';
import { exists, moveFolder, pngNames } from '../store/files.js';
import { setPaths, SNAPSHOTS_FOLDER } from '../store/key.js';
import { writeSetRecord } from '../store/set-record.js';

/** What a migration will do. */
export interface MigratePlan {
  readonly from: string;
  readonly to: string;
  readonly recordFile: string;
  readonly record: SetRecord;
  /** The old record files, removed once git holds them. */
  readonly removes: readonly string[];
}

/** What a migration did with the old record files. */
export interface MigrateResult {
  readonly removed: readonly string[];
  readonly kept: readonly string[];
}

/** The old record files a flat set may carry. */
const OLD_FILES = ['ENVIRONMENT', 'MANIFEST.sha256'] as const;

/** A runner key's kind and platform, or null when it is no key this version reads. */
function readRunnerKey(key: string): { kind: 'host' | 'container'; platform: string } | null {
  const host = /^host-(darwin|linux)-(arm64|amd64)$/.exec(key);
  if (host !== null) return { kind: 'host', platform: `${host[1]}-${host[2]}` };
  const container = /^container-[0-9a-f]{12}-(arm64|amd64)$/.exec(key);
  return container === null
    ? null
    : { kind: 'container', platform: `linux-${container[1]}` };
}

/** Plans the migration of the configured set, writing nothing. */
export async function planMigration(loaded: LoadedConfig, overrides: { playwright?: string; runner?: string }): Promise<MigratePlan> {
  const { store } = loaded.config.visual;
  if (store.kind === 'same-repo') throw new Error('migrate needs a store folder; same-repo arrives in a later cut');
  const setDir = join(store.dir, store.set);
  const from = join(setDir, SNAPSHOTS_FOLDER);
  if ((await pngNames(from)).length === 0) throw new Error(`no flat set to migrate at ${from}`);
  const environmentFile = join(setDir, 'ENVIRONMENT');
  const environment = (await exists(environmentFile))
    ? await readEnvironment(environmentFile)
    : null;
  if (environment === null && (overrides.playwright === undefined || overrides.runner === undefined)) {
    throw new Error(`${environmentFile} is missing, so what drew the set is unknown; name it with --playwright=<version> --runner=<key>`);
  }
  const runnerKey = overrides.runner ?? `host-${environment?.platform ?? ''}`;
  const runner = readRunnerKey(runnerKey);
  if (runner === null) throw new Error(`the runner key ${JSON.stringify(runnerKey)} is none this version reads (host-<darwin|linux>-<arm64|amd64>)`);
  const playwrightVersion = overrides.playwright ?? environment?.playwrightVersion ?? '';
  const paths = setPaths(store.dir, store.set, playwrightVersion, runnerKey);
  if (await exists(paths.keyDir)) throw new Error(`${paths.keyDir} already exists; the set is migrated at that key`);
  const removes = [];
  for (const name of OLD_FILES) if (await exists(join(setDir, name))) removes.push(join(setDir, name));
  const base: SetRecord = {
    set: store.set,
    playwrightVersion,
    runner: { ...runner, os: overrides.runner === undefined
      ? environment?.os ?? null
      : null },
    projectCommit: environment?.sourceCommit ?? null,
    projectDirty: false,
    promotedAt: null,
    files: (await pngNames(from)).length,
    lastRun: null,
  };
  const record = environment?.state == null
    ? base
    : { ...base, migratedFrom: { state: environment.state } };
  return { from, to: paths.snapshotsDir, recordFile: paths.recordFile, record, removes };
}

/** True when the store's git holds `file` unchanged in a commit. */
async function heldByGit(file: string, run: ProcessRunner): Promise<boolean> {
  const dir = dirname(file);
  const listed = await run(['git', '-C', dir, 'ls-files', '--error-unmatch', '--', file], { cwd: dir });
  if (listed.exitCode !== 0) return false;
  const unchanged = await run(['git', '-C', dir, 'diff', '--quiet', 'HEAD', '--', file], { cwd: dir });
  return unchanged.exitCode === 0;
}

/** Carries out a plan. */
export async function applyMigration(plan: MigratePlan, run: ProcessRunner): Promise<MigrateResult> {
  await mkdir(dirname(plan.to), { recursive: true });
  await moveFolder(plan.from, plan.to);
  await writeSetRecord(plan.recordFile, plan.record);
  const removed: string[] = [];
  const kept: string[] = [];
  for (const file of plan.removes) {
    if (await heldByGit(file, run)) {
      await rm(file);
      removed.push(file);
    } else {
      kept.push(file);
    }
  }
  return { removed, kept };
}
