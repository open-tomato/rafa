import type { CheckReport } from './check.js';

import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'bun:test';

import { hashFolder } from '../store/hash.js';
import { setPaths } from '../store/key.js';
import { fakeRunner, makeTestProject, TempDirs, TEST_HOST, writeShots } from '../testing.js';

import { checkVisual } from './check.js';
import { readSeedRecord, seedVisual } from './seed.js';

const temp = new TempDirs();
afterEach(() => temp.clean());

const KEY = 'host-darwin-arm64';
const NOW = (): Date => new Date('2026-11-08T14:25:00Z');

/** A git that answers a commit and a clean tree. */
const GIT = fakeRunner([[['git', 'rev-parse', '--short', 'HEAD'], { stdout: 'abc1234\n' }], [['git', 'status', '--porcelain'], { stdout: '' }]]);

/** A project, its set holding `set`, the package's snapshot folder holding `current`, and its check report. */
async function seeded(set: Readonly<Record<string, string>>, current: Readonly<Record<string, string>> = {}) {
  const project = await makeTestProject(temp, { storeKind: 'local-dir' });
  if (Object.keys(set).length > 0) await writeShots(setPaths(project.storeDir, 'packages-ui', '1.61.1', KEY).snapshotsDir, set);
  const snapshots = join(project.packageDir, 'visual', '__image_snapshots__');
  if (Object.keys(current).length > 0) await writeShots(snapshots, current);
  const report: CheckReport = await checkVisual(project.loaded, { run: GIT, host: TEST_HOST });
  return { project, snapshots, report };
}

describe('seedVisual', () => {
  it('copies the set into the package\'s snapshot folder', async () => {
    const { project, snapshots, report } = await seeded({ 'a--light.png': '1', 'a--dark.png': '2' });
    const result = await seedVisual(project.loaded, report, { run: GIT, now: NOW, random: () => 0.5 });

    expect(result.seeded).toBe(2);
    expect([...(await hashFolder(snapshots)).keys()]).toEqual(['a--dark.png', 'a--light.png']);
    expect(result.runDir).toBe(join(project.storeDir, '.staging', 'packages-ui', KEY, result.runId));
  });

  it('moves what was there into previous/ and deletes nothing', async () => {
    const { project, report } = await seeded({ 'a--light.png': '1' }, { 'old--light.png': 'x', 'a--light.png': 'stale' });
    const result = await seedVisual(project.loaded, report, { run: GIT, now: NOW, random: () => 0.5 });

    expect(result.previousMoved).toBe(2);
    expect((await readdir(join(result.runDir, 'previous'))).sort()).toEqual(['a--light.png', 'old--light.png']);
  });

  it('moves an earlier run\'s report into the run folder, so place reads only this run\'s', async () => {
    const { project, report } = await seeded({ 'a--light.png': '1' });
    await Bun.write(join(project.packageDir, 'visual-report.json'), '{"old":true}');
    const result = await seedVisual(project.loaded, report, { run: GIT, now: NOW, random: () => 0.5 });

    expect(await Bun.file(join(project.packageDir, 'visual-report.json')).exists()).toBe(false);
    expect(await Bun.file(join(result.runDir, 'previous-report.json')).text()).toBe('{"old":true}');
  });

  it('works in the checkout the command runs in, not the one the config lives in', async () => {
    const { project, snapshots, report } = await seeded({ 'a--light.png': '1' }, { 'main--light.png': 'main' });
    const work = await temp.make('d2c-worktree-');
    const workSnapshots = join(work, 'packages', 'ui', 'visual', '__image_snapshots__');
    await writeShots(workSnapshots, { 'branch--light.png': 'branch' });
    const result = await seedVisual({ ...project.loaded, workRoot: work }, report, { run: GIT, now: NOW, random: () => 0.5 });

    expect(await readdir(join(result.runDir, 'previous'))).toEqual(['branch--light.png']);
    expect((await readdir(workSnapshots)).sort()).toEqual(['a--light.png']);
    expect(await readdir(snapshots)).toEqual(['main--light.png']);
  });

  it('with no set leaves an empty snapshot folder and records seededFrom null', async () => {
    const { project, snapshots, report } = await seeded({});
    const result = await seedVisual(project.loaded, report, { run: GIT, now: NOW, random: () => 0.5 });
    const record = await readSeedRecord(result.runDir);

    expect(await readdir(snapshots)).toEqual([]);
    expect(record.seededFrom).toBeNull();
    expect(record.hashes).toEqual({});
  });

  it('seeded.json holds a hash per seeded file and the project commit', async () => {
    const { project, report } = await seeded({ 'a--light.png': '1' });
    const result = await seedVisual(project.loaded, report, { run: GIT, now: NOW, random: () => 0.5 });
    const record = await readSeedRecord(result.runDir);

    expect(Object.keys(record.hashes)).toEqual(['a--light.png']);
    expect(record).toMatchObject({ runId: result.runId, set: 'packages-ui', playwrightVersion: '1.61.1', runnerKey: KEY, projectCommit: 'abc1234', projectDirty: false });
  });

  it('a second seed moves the first seed\'s copy into its own run folder', async () => {
    const { project, snapshots, report } = await seeded({ 'a--light.png': '1', 'b--light.png': '2' });
    const first = await seedVisual(project.loaded, report, { run: GIT, now: NOW, random: () => 0.1 });
    const second = await seedVisual(project.loaded, report, { run: GIT, now: NOW, random: () => 0.9 });

    expect(second.runId).not.toBe(first.runId);
    expect((await readdir(join(second.runDir, 'previous'))).sort()).toEqual(['a--light.png', 'b--light.png']);
    expect((await hashFolder(snapshots)).size).toBe(2);
  });

  it('refuses a report with no runner key', async () => {
    const { project, report } = await seeded({});

    expect(seedVisual(project.loaded, { ...report, runnerKey: null }, { run: GIT, now: NOW, random: () => 0.5 })).rejects.toThrow('check');
  });
});
