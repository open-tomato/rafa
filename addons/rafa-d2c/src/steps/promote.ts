/**
 * `promote`: the person's step. A placed run's staged PNGs go into the
 * set, its record is written, and in a git store one commit records the
 * change: `baselines(<set>): <runner key> from <project commit>`.
 * Nothing is pushed; that stays the person's `git push` in the store.
 *
 * Two runs can seed from one set and both promote. When the set changed
 * since this run's seed, the files both runs touched are listed as a
 * warning, and the promotion goes on: the person ran the verb.
 */
import type { LoadedConfig } from '../config/load.js';
import type { ProcessRunner } from '../process.js';
import type { PlacedRecord } from './place.js';

import { join } from 'node:path';

import { copyNamed, isRepositoryTop, notOwnRepository, pngNames } from '../store/files.js';
import { hashFolder } from '../store/hash.js';
import { RECORD_FILE, setPaths, SNAPSHOTS_FOLDER, STAGING_FOLDER } from '../store/key.js';
import { readSetRecord, writeSetRecord } from '../store/set-record.js';

import { PLACED_FILE, pickRun } from './place.js';
import { readSeedRecord } from './seed.js';

/** What one promote did. */
export interface PromoteResult {
  readonly runId: string;
  readonly promoted: number;
  /** The store commit's short hash, or null for a store that is no git repository. */
  readonly commit: string | null;
  /** Staged files the set changed since this run's seed. */
  readonly overlap: readonly string[];
}

/** Which run to promote. */
export interface PromoteOptions {
  readonly runnerKey: string;
  readonly runId?: string;
}

/** What `promote` may run. */
export interface PromoteSeams {
  readonly run: ProcessRunner;
  readonly now: () => Date;
}

/** The file that marks a run promoted. */
export const PROMOTED_FILE = 'promoted.json';

/** The line the store's `.gitignore` carries so staging never reaches a commit. */
const STAGING_IGNORE = `${STAGING_FOLDER}/`;

/** The names whose hash differs between two maps, either way. */
function changedNames(now: ReadonlyMap<string, string>, then: Readonly<Record<string, string>>): Set<string> {
  const names = new Set([...now.keys(), ...Object.keys(then)]);
  return new Set([...names].filter((name) => now.get(name) !== then[name]));
}

/** Adds the staging line to the store's `.gitignore` when it is missing. */
async function ignoreStaging(dir: string): Promise<void> {
  const file = Bun.file(join(dir, '.gitignore'));
  const text = (await file.exists())
    ? await file.text()
    : '';
  if (text.split('\n').includes(STAGING_IGNORE)) return;
  await Bun.write(file, `${text}${text === '' || text.endsWith('\n')
    ? ''
    : '\n'}${STAGING_IGNORE}\n`);
}

/** Runs one git command in the store, throwing git's own words when it fails. */
async function git(run: ProcessRunner, dir: string, args: readonly string[]): Promise<string> {
  const result = await run(['git', '-C', dir, ...args], { cwd: dir });
  if (result.exitCode !== 0) throw new Error(`git ${args[0] ?? ''} in the store failed: ${result.stderr.trim() || `exit code ${result.exitCode}`}`);
  return result.stdout.trim();
}

/** Commits the set and the staging ignore line in the store; answers the commit's short hash. */
async function commitSet(run: ProcessRunner, dir: string, set: string, message: string): Promise<string> {
  await ignoreStaging(dir);
  await git(run, dir, ['add', '--', set, '.gitignore']);
  await git(run, dir, ['commit', '-q', '-m', message]);
  return git(run, dir, ['rev-parse', '--short', 'HEAD']);
}

/** Promotes one placed run into the set. */
export async function promoteVisual(loaded: LoadedConfig, options: PromoteOptions, seams: PromoteSeams): Promise<PromoteResult> {
  const { store } = loaded.config.visual;
  if (store.kind === 'same-repo') throw new Error('promote needs a store folder; same-repo arrives in a later cut');
  if (store.kind === 'side-repo' && !(await isRepositoryTop(store.dir))) throw new Error(notOwnRepository(store.dir));
  const runDir = await pickRun(store.dir, store.set, options.runnerKey, options.runId, PLACED_FILE, PROMOTED_FILE, 'promote');
  const seed = await readSeedRecord(runDir);
  const placed = (await Bun.file(join(runDir, PLACED_FILE)).json()) as PlacedRecord;
  if (placed.staged.length === 0) {
    throw new Error(`run ${seed.runId} staged nothing (${placed.kind} run); an assert run changes no baseline, so rerun with the update args to accept changes`);
  }
  const paths = setPaths(store.dir, store.set, seed.playwrightVersion, seed.runnerKey);
  const moved = changedNames(await hashFolder(paths.snapshotsDir), seed.hashes);
  const overlap = placed.staged.filter((name) => moved.has(name));

  const promoted = await copyNamed(join(runDir, SNAPSHOTS_FOLDER), paths.snapshotsDir, placed.staged);
  const staged = await readSetRecord(join(runDir, RECORD_FILE));
  if (staged === null) throw new Error(`run ${seed.runId} has no staged ${RECORD_FILE}; place it again`);
  await writeSetRecord(paths.recordFile, { ...staged, promotedAt: seams.now().toISOString(), files: (await pngNames(paths.snapshotsDir)).length });
  const commit = store.kind === 'side-repo'
    ? await commitSet(seams.run, store.dir, store.set, `baselines(${store.set}): ${seed.runnerKey} from ${seed.projectCommit ?? 'no recorded commit'}`)
    : null;
  // Marked only once the commit exists, so a failed commit leaves the run waiting for the next promote.
  await Bun.write(join(runDir, PROMOTED_FILE), `${JSON.stringify({ promotedAt: seams.now().toISOString(), promoted, overlap }, null, 2)}\n`);
  return { runId: seed.runId, promoted, commit, overlap };
}
