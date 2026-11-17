import type { TestProject } from '../testing.js';

import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'bun:test';

import { spawnProcess } from '../process.js';
import { setPaths } from '../store/key.js';
import { makeTestProject, TempDirs, TEST_HOST, writeIndex, writeShots } from '../testing.js';

import { runVisual } from './run.js';

const temp = new TempDirs();
afterEach(() => temp.clean());

const KEY = 'host-darwin-arm64';
const FAKE_SUITE = join(import.meta.dir, '..', 'testdata', 'fake-suite.ts');
const SEAMS = { run: spawnProcess, host: TEST_HOST, now: () => new Date('2026-11-08T14:25:00Z'), random: Math.random, quiet: true };

/** A project whose suite is the fake suite, told what to do. */
async function fakeSuiteProject(spec: { shots?: Record<string, string>; counts?: Record<string, number>; writeReport?: boolean; exitCode?: number }, runner?: TestProject['loaded']['config']['visual']['runner']) {
  const project = await makeTestProject(temp, { storeKind: 'local-dir', command: `${process.execPath} ${FAKE_SUITE}`, ...(runner === undefined
    ? {}
    : { runner }) });
  await Bun.write(join(project.packageDir, 'fake-suite.json'), JSON.stringify({ shots: {}, counts: {}, writeReport: true, exitCode: 0, ...spec }));
  await writeIndex(project, [['Atoms/A', 'One', 'a']]);
  return project;
}

describe('runVisual', () => {
  it('a run with no set seeds, places and prints the not-a-pass line', async () => {
    const project = await fakeSuiteProject({ shots: { 'a--light.png': '1', 'a--dark.png': '2' }, counts: { added: 2, total: 2 } });
    const result = await runVisual(project.loaded, [], SEAMS);

    expect(result.check.willSeed).toBe(true);
    expect(result.suiteExit).toBe(0);
    expect(result.place?.line).toBe('seed run: 2 written, 0 compared — not a pass');
    expect(result.place?.staged).toEqual(['a--dark.png', 'a--light.png']);
  });

  it('a run against a set with a differing shot stages nothing and reports the suite\'s exit', async () => {
    const project = await fakeSuiteProject({ shots: { 'a--light.png': 'changed' }, counts: { matched: 1, unmatched: 1, total: 2 }, exitCode: 1 });
    await writeShots(setPaths(project.storeDir, 'packages-ui', '1.61.1', KEY).snapshotsDir, { 'a--light.png': '1', 'a--dark.png': '2' });
    const result = await runVisual(project.loaded, [], SEAMS);

    expect(result.suiteExit).toBe(1);
    expect(result.place?.staged).toEqual([]);
    expect(result.place?.kind).toBe('assert');
  });

  it('args after -- reach the suite', async () => {
    const project = await fakeSuiteProject({ counts: { matched: 0 } });
    await runVisual(project.loaded, ['--update', '--ci'], SEAMS);

    expect(await Bun.file(join(project.packageDir, 'fake-suite-argv.json')).json()).toEqual(['--update', '--ci']);
  });

  it('place runs after a failing suite', async () => {
    const project = await fakeSuiteProject({ shots: { 'a--light.png': '1' }, counts: { added: 1, total: 1 }, exitCode: 3 });
    const result = await runVisual(project.loaded, [], SEAMS);

    expect(result.suiteExit).toBe(3);
    expect(result.place).not.toBeNull();
  });

  it('a suite that writes no report fails place and names it', async () => {
    const project = await fakeSuiteProject({ writeReport: false, exitCode: 1 });
    const result = await runVisual(project.loaded, [], SEAMS);

    expect(result.place).toBeNull();
    expect(result.placeError).toContain(join(project.packageDir, 'visual-report.json'));
  });

  it('a report left by an earlier run is not read when the suite writes none', async () => {
    const project = await fakeSuiteProject({ shots: { 'a--light.png': '1' }, writeReport: false, exitCode: 127 });
    await Bun.write(join(project.packageDir, 'visual-report.json'), JSON.stringify({ snapshot: { matched: 0, added: 1, updated: 0, unmatched: 0, total: 1 }, testResults: [] }));
    const result = await runVisual(project.loaded, [], SEAMS);

    expect(result.suiteExit).toBe(127);
    expect(result.place).toBeNull();
    expect(result.placeError).toContain(join(project.packageDir, 'visual-report.json'));
  });

  it('a gap stops the run before seed', async () => {
    const project = await fakeSuiteProject({}, { kind: 'container' });
    await writeShots(join(project.packageDir, 'visual', '__image_snapshots__'), { 'mine--light.png': 'x' });
    const result = await runVisual(project.loaded, [], SEAMS);

    expect(result.check.gaps.length).toBeGreaterThan(0);
    expect(result.seed).toBeNull();
    expect(await Bun.file(join(project.packageDir, 'visual', '__image_snapshots__', 'mine--light.png')).exists()).toBe(true);
  });

  it('refuses a remote runner before seeding', async () => {
    const project = await fakeSuiteProject({}, { kind: 'remote', host: 'builder', workdir: '/w', command: 'c' });

    expect(runVisual(project.loaded, [], SEAMS)).rejects.toThrow('remote');
  });
});
