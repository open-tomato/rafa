import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { BASELINE_PATH, main } from './test-index';
import { parseRecord } from './test-index-record';
import {
  git,
  IDENTITY,
  plant,
  plantScratch,
  RECORD_MODE,
  runGuard,
  runScript,
  SCRATCH_FILES,
  SCRATCH_MAP,
  SCRATCH_TABLE,
} from './test-index-scratch';

/** Each case spawns bun over a scratch repository; the default timeout is too short once other files ran. */
const SPAWN_TIMEOUT_MS = 60_000;

const UNIT_TEST = 'src/a/one.test.ts';
const UNPLACED = 'src/stray/one.test.ts';
const FIRST = 'src/deep/one.test.ts';
const SECOND = 'src/a/again.test.ts';
const MISSING_REKEYED = '0'.repeat(40);

/** The scratch table with the moved test listed under `@scratch/far` and not under `@scratch/cli`. */
const FAR_TABLE = `${JSON.stringify({
  packages: [
    { files: ['src/a/fresh.test.ts', 'src/deep/x.ts', 'src/rafa.ts'], name: '@scratch/cli' },
    { files: ['src/far/y.ts', SECOND], name: '@scratch/far' },
  ],
  unassigned: [],
}, null, 2)}\n`;

/** The moved test as it reads once the table lists it under `@scratch/far`: nothing beyond that unit. */
const FAR_TEST = 'import { y } from \'../far/y.js\';\n';

/** The re-key mode of the script over `root`, its record and map passed relative to it. */
function runRekey(root: string, ...flags: readonly string[]): { exitCode: number; stderr: string; stdout: string } {
  return runScript(root, [`--rekey=${BASELINE_PATH}`, `--map=${SCRATCH_MAP}`, ...flags]);
}

describe('the re-key mode over a scratch repository', () => {
  let root = '';
  let recordedCommit = '';

  /** The record's bytes as they stand. */
  function recordText(): string {
    return readFileSync(join(root, BASELINE_PATH), 'utf8');
  }

  function headOf(): string {
    return git(root, ['rev-parse', 'HEAD']).trim();
  }

  /** Moves a test file with `git mv`, making the folder, and commits it. */
  function moveAndCommit(from: string, to: string): void {
    mkdirSync(dirname(join(root, to)), { recursive: true });
    git(root, ['mv', from, to]);
    git(root, [...IDENTITY, 'commit', '--quiet', '-m', `move ${from} to ${to}`]);
  }

  beforeAll(async () => {
    root = plantScratch('survey-test-index-rekey-mode-');
    git(root, [...IDENTITY, 'commit', '--quiet', '-m', 'plant']);
    recordedCommit = headOf();
    await main(root, RECORD_MODE);
  }, SPAWN_TIMEOUT_MS);

  afterAll(() => {
    rmSync(root, { force: true, recursive: true });
  });

  it('refuses a tracked file in scope that differs from HEAD, naming it, and leaves the record as it was', () => {
    const before = recordText();
    plant(root, UNIT_TEST, `${SCRATCH_FILES[UNIT_TEST]}// edited\n`);
    const run = runRekey(root);
    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(`1 tracked file(s) in scope differ from ${recordedCommit}: ${UNIT_TEST}`);
    expect(recordText()).toBe(before);
    plant(root, UNIT_TEST, SCRATCH_FILES[UNIT_TEST] ?? '');
    expect(git(root, ['status', '--porcelain', '--', 'src'])).toBe('');
  }, SPAWN_TIMEOUT_MS);

  it('exits 1 on a rename to a path the map places in no unit, names it, and leaves the record as it was', () => {
    const before = recordText();
    moveAndCommit(UNIT_TEST, UNPLACED);
    const run = runRekey(root);
    expect(run.exitCode).toBe(1);
    expect(run.stdout).toContain(`  ${UNIT_TEST} -> ${UNPLACED}`);
    expect(run.stdout).toContain('test-index: 1 rename to a path the map places in no unit:');
    expect(run.stdout).toContain('test-index: nothing written (1 rename placed in no unit)');
    expect(recordText()).toBe(before);
  }, SPAWN_TIMEOUT_MS);

  it('reports one entry to move on a dry run and leaves the bytes unchanged', () => {
    moveAndCommit(UNPLACED, FIRST);
    const before = recordText();
    const run = runRekey(root, '--dry-run');
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain(`renames read from the record's commit ${recordedCommit} to ${headOf()}`);
    expect(run.stdout).toContain('test-index: 1 entry to move, 0 unindexed paths to move, 0 units read again');
    expect(run.stdout).toContain('test-index: nothing written (--dry-run)');
    expect(recordText()).toBe(before);
  }, SPAWN_TIMEOUT_MS);

  it('writes the entry under its new path, with rekeyed the new head and the map\'s hash, and the guard then exits 0', () => {
    const head = headOf();
    const run = runRekey(root);
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain(`test-index: wrote ${BASELINE_PATH}`);
    const parsed = JSON.parse(recordText()) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual(['unit', 'map', 'commit', 'rekeyed', 'binReach', 'tests', 'unsorted', 'unindexed']);
    expect(parsed.commit).toBe(recordedCommit);
    expect(parsed.rekeyed).toBe(head);
    const sha256 = new Bun.CryptoHasher('sha256').update(SCRATCH_TABLE)
      .digest('hex');
    expect(parsed.map).toEqual({ path: SCRATCH_MAP, sha256 });
    const record = parseRecord(recordText());
    expect([...record.tests.keys()]).toEqual([FIRST]);
    expect(record.tests.get(FIRST)?.package).toBe('@scratch/cli');

    const guard = runGuard(root, BASELINE_PATH);
    expect(guard.exitCode).toBe(0);
  }, SPAWN_TIMEOUT_MS);

  it('reports 0 entries to move on a second dry run', () => {
    const before = recordText();
    const run = runRekey(root, '--dry-run');
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain(`renames read from the record's rekeyed ${headOf()} to ${headOf()}`);
    expect(run.stdout).toContain('test-index: 0 entries to move, 0 unindexed paths to move, 0 units read again');
    expect(recordText()).toBe(before);
  }, SPAWN_TIMEOUT_MS);

  it('follows a second rename from rekeyed to the last path', () => {
    const rekeyed = headOf();
    moveAndCommit(FIRST, SECOND);
    const head = headOf();
    const run = runRekey(root);
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain(`renames read from the record's rekeyed ${rekeyed} to ${head}`);
    expect(run.stdout).toContain('test-index: 1 entry to move, 0 unindexed paths to move, 0 units read again');
    const record = parseRecord(recordText());
    expect([...record.tests.keys()]).toEqual([SECOND]);
    expect(record.rekeyed).toBe(head);
    expect(record.commit).toBe(recordedCommit);
    expect(runGuard(root, BASELINE_PATH).exitCode).toBe(0);
  }, SPAWN_TIMEOUT_MS);

  it('reads the unit again after a table edit, which the guard refuses until the re-key', () => {
    // The test now reads only `far`, so that is the unit it meets its rule in once the table lists it there.
    plant(root, SECOND, FAR_TEST);
    git(root, [...IDENTITY, 'commit', '--quiet', '-a', '-m', 'the test reads far']);
    plant(root, SCRATCH_MAP, FAR_TABLE);
    const refused = runGuard(root, BASELINE_PATH);
    expect(refused.exitCode).toBe(1);

    const run = runRekey(root);
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain('test-index: 0 entries to move, 0 unindexed paths to move, 1 unit read again');
    expect(run.stdout).toContain(`  ${SECOND}: @scratch/cli -> @scratch/far`);
    const entry = parseRecord(recordText()).tests.get(SECOND);
    expect(entry?.package).toBe('@scratch/far');
    expect(entry?.packages).toEqual(['@scratch/cli', '@scratch/far']);
    const sha256 = new Bun.CryptoHasher('sha256').update(FAR_TABLE)
      .digest('hex');
    expect(parseRecord(recordText()).map.sha256).toBe(sha256);
    expect(runGuard(root, BASELINE_PATH).exitCode).toBe(0);
  }, SPAWN_TIMEOUT_MS);

  it('falls back to commit, and says so, when the repository lacks the record\'s rekeyed', () => {
    const head = headOf();
    plant(root, BASELINE_PATH, recordText().replace(`"rekeyed": "${head}"`, `"rekeyed": "${MISSING_REKEYED}"`));
    const before = recordText();
    expect(before).toContain(MISSING_REKEYED);
    const run = runRekey(root, '--dry-run');
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain(`renames read from the record's commit ${recordedCommit} to ${head}; `
      + `the record's rekeyed ${MISSING_REKEYED} is no commit of this repository`);
    // Since `commit` the test was rewritten past git's rename similarity, so no rename is left to apply or skip.
    expect(run.stdout).toContain('test-index: 0 entries to move, 0 unindexed paths to move, 0 units read again');
    expect(run.stdout).not.toContain('skipped');
    expect(recordText()).toBe(before);

    expect(runRekey(root).exitCode).toBe(0);
    expect(parseRecord(recordText()).rekeyed).toBe(head);
    expect(runGuard(root, BASELINE_PATH).exitCode).toBe(0);
  }, SPAWN_TIMEOUT_MS);
});
