import type { ProcessRunner } from '../process.js';

import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'bun:test';

import { spawnProcess } from '../process.js';
import { hashFolder } from '../store/hash.js';
import { setPaths } from '../store/key.js';
import { readSetRecord } from '../store/set-record.js';
import { gitOut, initGitStore, makeTestProject, TempDirs, TEST_HOST, writeIndex, writeReport, writeShots } from '../testing.js';

import { checkVisual } from './check.js';
import { placeVisual } from './place.js';
import { promoteVisual } from './promote.js';
import { seedVisual } from './seed.js';

const temp = new TempDirs();
afterEach(() => temp.clean());

const KEY = 'host-darwin-arm64';
const NOW = (): Date => new Date('2026-11-08T14:25:00Z');

/** A real git, recording every argv. */
function recordingGit(seen: string[][]): ProcessRunner {
  return (argv, options) => {
    seen.push([...argv]);
    return spawnProcess(argv, options);
  };
}

/** A side-repo project whose set holds `set`, with its store a git repository. */
async function gitProject(set: Readonly<Record<string, string>>) {
  const project = await makeTestProject(temp);
  initGitStore(project.storeDir);
  const paths = setPaths(project.storeDir, 'packages-ui', '1.61.1', KEY);
  if (Object.keys(set).length > 0) await writeShots(paths.snapshotsDir, set);
  await writeIndex(project, [['Atoms/A', 'One', 'a']]);
  return { project, paths, snapshots: join(project.packageDir, 'visual', '__image_snapshots__') };
}

/** Seeds a run, lets `shots` stand for what the suite wrote, and places it. */
async function seedAndPlace(project: Awaited<ReturnType<typeof gitProject>>['project'], snapshots: string, shots: Readonly<Record<string, string>>, minute: number) {
  const run = spawnProcess;
  const report = await checkVisual(project.loaded, { run, host: TEST_HOST });
  const seed = await seedVisual(project.loaded, report, { run, now: () => new Date(`2026-11-08T14:${String(minute).padStart(2, '0')}:00Z`), random: Math.random });
  await writeShots(snapshots, shots);
  await writeReport(project, { updated: Object.keys(shots).length, total: Object.keys(shots).length });
  await placeVisual(project.loaded, { runnerKey: KEY, runId: seed.runId }, { now: NOW, host: TEST_HOST });
  return seed;
}

describe('promoteVisual', () => {
  it('promotes staged files and commits with the spec\'s message', async () => {
    const { project, paths, snapshots } = await gitProject({ 'a--light.png': '1', 'a--dark.png': '2' });
    const seed = await seedAndPlace(project, snapshots, { 'a--light.png': 'new' }, 10);
    const result = await promoteVisual(project.loaded, { runnerKey: KEY }, { run: spawnProcess, now: NOW });

    expect(result.runId).toBe(seed.runId);
    expect(result.promoted).toBe(1);
    expect(await Bun.file(join(paths.snapshotsDir, 'a--light.png')).text()).toBe('new');
    expect(gitOut(project.storeDir, 'log', '-1', '--format=%s')).toBe(`baselines(packages-ui): ${KEY} from no recorded commit`);
    expect(result.commit).toBe(gitOut(project.storeDir, 'rev-parse', '--short', 'HEAD'));
    const record = await readSetRecord(paths.recordFile);
    expect(record).toMatchObject({ promotedAt: '2026-11-08T14:25:00.000Z', files: 2 });
    expect(gitOut(project.storeDir, 'status', '--porcelain')).toBe('');
  });

  it('refuses a store folder inside another repository and commits nothing there', async () => {
    const project = await makeTestProject(temp);
    initGitStore(project.storeDir);
    const nested = join(project.storeDir, 'nested');
    const { visual } = project.loaded.config;
    const loaded = { ...project.loaded, config: { visual: { ...visual, store: { kind: 'side-repo' as const, dir: nested, set: 'packages-ui' } } } };
    const inner = { ...project, storeDir: nested, loaded };
    await writeIndex(inner, [['Atoms/A', 'One', 'a']]);
    await seedAndPlace(inner, join(project.packageDir, 'visual', '__image_snapshots__'), { 'a--light.png': 'new' }, 10);

    await expect(promoteVisual(loaded, { runnerKey: KEY }, { run: spawnProcess, now: NOW })).rejects.toThrow('is not the top of its own git repository');
    expect(await Bun.file(join(setPaths(nested, 'packages-ui', '1.61.1', KEY).snapshotsDir, 'a--light.png')).exists()).toBe(false);
    expect(Bun.spawnSync(['git', 'rev-parse', 'HEAD'], { cwd: project.storeDir }).exitCode).not.toBe(0);
  });

  it('a failed commit leaves the run waiting, so promote can run again', async () => {
    const { project, snapshots } = await gitProject({ 'a--light.png': '1' });
    const seed = await seedAndPlace(project, snapshots, { 'a--light.png': 'new' }, 10);
    const failingCommit: ProcessRunner = (argv, options) => argv[3] === 'commit'
      ? Promise.resolve({ exitCode: 1, stdout: '', stderr: 'Author identity unknown' })
      : spawnProcess(argv, options);

    await expect(promoteVisual(project.loaded, { runnerKey: KEY }, { run: failingCommit, now: NOW })).rejects.toThrow('Author identity unknown');
    const again = await promoteVisual(project.loaded, { runnerKey: KEY }, { run: spawnProcess, now: NOW });
    expect(again.runId).toBe(seed.runId);
    expect(again.commit).toBe(gitOut(project.storeDir, 'rev-parse', '--short', 'HEAD'));
  });

  it('refuses a run with nothing staged', async () => {
    const { project, snapshots } = await gitProject({ 'a--light.png': '1' });
    await seedAndPlace(project, snapshots, { 'a--light.png': '1' }, 10);

    expect(promoteVisual(project.loaded, { runnerKey: KEY }, { run: spawnProcess, now: NOW })).rejects.toThrow('staged nothing');
  });

  it('warns and lists files both runs touched when the set moved since seed', async () => {
    const { project, snapshots } = await gitProject({ 'a--light.png': '1', 'a--dark.png': '2', 'b--light.png': '3' });
    const first = await seedAndPlace(project, snapshots, { 'a--light.png': 'one', 'a--dark.png': '2', 'b--light.png': '3' }, 10);
    const second = await seedAndPlace(project, snapshots, { 'a--light.png': 'two', 'a--dark.png': '2', 'b--light.png': 'other' }, 20);
    await promoteVisual(project.loaded, { runnerKey: KEY, runId: first.runId }, { run: spawnProcess, now: NOW });
    const result = await promoteVisual(project.loaded, { runnerKey: KEY, runId: second.runId }, { run: spawnProcess, now: NOW });

    expect(result.overlap).toEqual(['a--light.png']);
    expect(result.promoted).toBe(2);
  });

  it('never runs git push', async () => {
    const { project, snapshots } = await gitProject({ 'a--light.png': '1' });
    await seedAndPlace(project, snapshots, { 'a--light.png': 'new' }, 10);
    const seen: string[][] = [];
    await promoteVisual(project.loaded, { runnerKey: KEY }, { run: recordingGit(seen), now: NOW });

    expect(seen.some((argv) => argv.includes('push'))).toBe(false);
    expect(seen.some((argv) => argv.includes('commit'))).toBe(true);
  });

  it('adds .staging/ to the store\'s .gitignore once', async () => {
    const { project, snapshots } = await gitProject({ 'a--light.png': '1' });
    await seedAndPlace(project, snapshots, { 'a--light.png': 'new' }, 10);
    await promoteVisual(project.loaded, { runnerKey: KEY }, { run: spawnProcess, now: NOW });
    await seedAndPlace(project, snapshots, { 'a--light.png': 'newer' }, 20);
    await promoteVisual(project.loaded, { runnerKey: KEY }, { run: spawnProcess, now: NOW });

    expect(await Bun.file(join(project.storeDir, '.gitignore')).text()).toBe('.staging/\n');
    expect(gitOut(project.storeDir, 'ls-files', '.staging')).toBe('');
  });

  it('a local-dir store promotes with no commit', async () => {
    const project = await makeTestProject(temp, { storeKind: 'local-dir' });
    await writeShots(setPaths(project.storeDir, 'packages-ui', '1.61.1', KEY).snapshotsDir, { 'a--light.png': '1' });
    await seedAndPlace(project, join(project.packageDir, 'visual', '__image_snapshots__'), { 'a--light.png': 'new' }, 10);
    const result = await promoteVisual(project.loaded, { runnerKey: KEY }, { run: spawnProcess, now: NOW });

    expect(result.commit).toBeNull();
    expect((await hashFolder(setPaths(project.storeDir, 'packages-ui', '1.61.1', KEY).snapshotsDir)).size).toBe(1);
  });
});
