import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'bun:test';

import { hashFolder } from '../store/hash.js';
import { setPaths } from '../store/key.js';
import { fakeRunner, makeTestProject, TempDirs, TEST_HOST, writeIndex, writeReport, writeShots } from '../testing.js';

import { checkVisual } from './check.js';
import { placeVisual } from './place.js';
import { seedVisual } from './seed.js';

const temp = new TempDirs();
afterEach(() => temp.clean());

const KEY = 'host-darwin-arm64';
const SEAMS = { run: fakeRunner(), now: () => new Date('2026-11-08T14:25:00Z'), random: Math.random };

/** A project seeded from a set holding `set`; answers the project, its snapshot folder and the run id. */
async function seededProject(set: Readonly<Record<string, string>>) {
  const project = await makeTestProject(temp, { storeKind: 'local-dir' });
  const paths = setPaths(project.storeDir, 'packages-ui', '1.61.1', KEY);
  if (Object.keys(set).length > 0) await writeShots(paths.snapshotsDir, set);
  await writeIndex(project, [['Atoms/A', 'One', 'a'], ['Atoms/B', 'One', 'b']]);
  const report = await checkVisual(project.loaded, { run: SEAMS.run, host: TEST_HOST });
  const seed = await seedVisual(project.loaded, report, SEAMS);
  return { project, paths, snapshots: join(project.packageDir, 'visual', '__image_snapshots__'), seed };
}

/** The place options and seams for the test key. */
const OPTIONS = { runnerKey: KEY };
const PLACE_SEAMS = { now: SEAMS.now, host: TEST_HOST };

describe('placeVisual', () => {
  it('a seed run stages every file and prints the not-a-pass line', async () => {
    const { project, snapshots, seed } = await seededProject({});
    await writeShots(snapshots, { 'a--light.png': '1', 'a--dark.png': '2' });
    await writeReport(project, { added: 2, total: 2 }, [['Atoms/A', 'One', 'passed']]);
    const result = await placeVisual(project.loaded, OPTIONS, PLACE_SEAMS);

    expect(result.runId).toBe(seed.runId);
    expect(result.kind).toBe('seed');
    expect(result.line).toBe('seed run: 2 written, 0 compared — not a pass');
    expect(result.staged).toEqual(['a--dark.png', 'a--light.png']);
    expect((await readdir(join(seed.runDir, '__image_snapshots__'))).sort()).toEqual(['a--dark.png', 'a--light.png']);
  });

  it('an update run stages only new and changed files', async () => {
    const { project, snapshots, seed } = await seededProject({ 'a--light.png': '1', 'a--dark.png': '2' });
    await writeShots(snapshots, { 'a--dark.png': 'changed', 'b--light.png': 'new' });
    await writeReport(project, { matched: 1, updated: 1, added: 1, total: 3 }, [['Atoms/A', 'One', 'passed'], ['Atoms/B', 'One', 'passed']]);
    const result = await placeVisual(project.loaded, OPTIONS, PLACE_SEAMS);
    const staged = await Bun.file(join(seed.runDir, 'set.json')).json() as { files: number; lastRun: unknown; promotedAt: unknown };

    expect(result.kind).toBe('update');
    expect(result.staged).toEqual(['a--dark.png', 'b--light.png']);
    expect(result.line).toBe('update: 1 added, 1 updated, 2 staged');
    expect(staged.files).toBe(3);
    expect(staged.promotedAt).toBeNull();
    expect(staged.lastRun).toEqual({ kind: 'update', compared: 4, added: 1, updated: 1, failed: 0 });
  });

  it('a failed assert run stages nothing and names the update args', async () => {
    const { project, seed } = await seededProject({ 'a--light.png': '1', 'a--dark.png': '2' });
    await writeReport(project, { matched: 1, unmatched: 1, total: 2 }, [['Atoms/A', 'One', 'failed']]);
    const result = await placeVisual(project.loaded, OPTIONS, PLACE_SEAMS);

    expect(result.staged).toEqual([]);
    expect(result.line).toBe('assert: 1 shots differ, nothing staged; rerun with the update args to accept them');
    expect(await Bun.file(join(seed.runDir, '__image_snapshots__', 'a--light.png')).exists()).toBe(false);
  });

  it('a missing report refuses naming its path and stages nothing', async () => {
    const { project, seed } = await seededProject({ 'a--light.png': '1' });

    expect(placeVisual(project.loaded, OPTIONS, PLACE_SEAMS)).rejects.toThrow(join(project.packageDir, 'visual-report.json'));
    expect(await Bun.file(join(seed.runDir, 'placed.json')).exists()).toBe(false);
  });

  it('place never writes into the set folder', async () => {
    const { project, paths, snapshots } = await seededProject({ 'a--light.png': '1' });
    const before = await hashFolder(paths.snapshotsDir);
    await writeShots(snapshots, { 'a--light.png': 'changed' });
    await writeReport(project, { updated: 1, total: 1 }, [['Atoms/A', 'One', 'passed']]);
    await placeVisual(project.loaded, OPTIONS, PLACE_SEAMS);

    expect(await hashFolder(paths.snapshotsDir)).toEqual(before);
    expect(await Bun.file(paths.recordFile).exists()).toBe(false);
  });

  it('picks the newest unplaced run when no id is given', async () => {
    const { project, snapshots } = await seededProject({ 'a--light.png': '1' });
    const later = await seedVisual(project.loaded, await checkVisual(project.loaded, { run: SEAMS.run, host: TEST_HOST }), {
      ...SEAMS,
      now: () => new Date('2026-11-08T15:00:00Z'),
    });
    await writeShots(snapshots, { 'a--light.png': '1' });
    await writeReport(project, { matched: 1, total: 1 });

    expect((await placeVisual(project.loaded, OPTIONS, PLACE_SEAMS)).runId).toBe(later.runId);
    expect(placeVisual(project.loaded, { ...OPTIONS, runId: later.runId }, PLACE_SEAMS)).rejects.toThrow('already placed');
  });

  it('counts compared files from the snapshot counts when the index is missing, with a warning', async () => {
    const { project } = await seededProject({ 'a--light.png': '1' });
    await Bun.file(join(project.packageDir, 'storybook-static', 'index.json')).delete();
    await writeReport(project, { matched: 4, unmatched: 1, total: 5 });
    const result = await placeVisual(project.loaded, OPTIONS, PLACE_SEAMS);

    expect(result.counts.compared).toBe(5);
    expect(result.warnings.join('\n')).toContain('index.json');
  });
});
