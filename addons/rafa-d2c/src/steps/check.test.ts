import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'bun:test';

import { setPaths } from '../store/key.js';
import { writeSetRecord } from '../store/set-record.js';
import { fakeRunner, makeTestProject, TEMP_RECORD, TempDirs, TEST_HOST, writeShots } from '../testing.js';

import { checkVisual } from './check.js';

const temp = new TempDirs();
afterEach(() => temp.clean());

const KEY = 'host-darwin-arm64';

/** A ready side-repo: git answers yes, lfs is installed, `.gitattributes` tracks PNGs, origin answers. */
const READY = fakeRunner();

describe('checkVisual', () => {
  it('a ready side-repo with a set prints the assert line', async () => {
    const project = await makeTestProject(temp);
    const paths = setPaths(project.storeDir, 'packages-ui', '1.61.1', KEY);
    await writeShots(paths.snapshotsDir, { 'a--light.png': '1', 'a--dark.png': '2' });
    await writeSetRecord(paths.recordFile, { ...TEMP_RECORD, files: 2, projectCommit: 'd77c39d' });
    await Bun.write(join(project.storeDir, '.gitattributes'), '*.png filter=lfs diff=lfs merge=lfs -text\n');
    const report = await checkVisual(project.loaded, { run: READY, host: TEST_HOST });

    expect(report.gaps).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report.willSeed).toBe(false);
    expect(report.runnerKey).toBe(KEY);
    expect(report.playwrightVersion).toBe('1.61.1');
    expect(report.runLine).toBe(`assert against packages-ui @ ${KEY} (2 files, from d77c39d)`);
  });

  it('no set prints the will-seed line and names the nearest key', async () => {
    const project = await makeTestProject(temp);
    await mkdir(setPaths(project.storeDir, 'packages-ui', '1.60.0', KEY).snapshotsDir, { recursive: true });
    await mkdir(setPaths(project.storeDir, 'packages-ui', '1.61.1', 'host-linux-amd64').snapshotsDir, { recursive: true });
    const report = await checkVisual(project.loaded, { run: READY, host: TEST_HOST });

    expect(report.willSeed).toBe(true);
    expect(report.runLine).toBe(`no set for ${KEY}; this run will seed (nearest: 1.60.0/${KEY})`);
  });

  it('a missing set is not a gap', async () => {
    const project = await makeTestProject(temp);
    const report = await checkVisual(project.loaded, { run: READY, host: TEST_HOST });

    expect(report.gaps).toEqual([]);
    expect(report.runLine).toBe(`no set for ${KEY}; this run will seed`);
  });

  it('git-lfs missing is a gap naming the fix', async () => {
    const project = await makeTestProject(temp);
    const run = fakeRunner([[['git', 'lfs', 'version'], { exitCode: 1 }]]);
    const report = await checkVisual(project.loaded, { run, host: TEST_HOST });

    expect(report.gaps).toHaveLength(1);
    expect(report.gaps[0]).toContain('git lfs install');
  });

  it('an unreachable remote is a gap', async () => {
    const project = await makeTestProject(temp);
    const run = fakeRunner([
      [['git', '-C', project.storeDir, 'remote', 'get-url', 'origin'], { stdout: 'git@example.com:baselines.git\n' }],
      [['git', '-C', project.storeDir, 'ls-remote'], { exitCode: 128, stderr: 'fatal: could not read from remote\n' }],
    ]);
    const report = await checkVisual(project.loaded, { run, host: TEST_HOST });

    expect(report.gaps).toEqual(['the store\'s origin remote does not answer: fatal: could not read from remote']);
  });

  it('a store with no origin warns, and is no gap', async () => {
    const project = await makeTestProject(temp);
    const run = fakeRunner([[['git', '-C', project.storeDir, 'remote', 'get-url', 'origin'], { exitCode: 2 }]]);
    const report = await checkVisual(project.loaded, { run, host: TEST_HOST });

    expect(report.gaps).toEqual([]);
    expect(report.warnings.join('\n')).toContain('no origin remote');
  });

  it('same-repo is a gap', async () => {
    const project = await makeTestProject(temp, { storeKind: 'same-repo' });
    const report = await checkVisual(project.loaded, { run: READY, host: TEST_HOST });

    expect(report.gaps.join('\n')).toContain('same-repo');
  });

  it('the container runner is a gap and a remote runner a note', async () => {
    const container = await makeTestProject(temp, { runner: { kind: 'container' } });
    const remote = await makeTestProject(temp, { runner: { kind: 'remote', host: 'builder', workdir: '/w', command: 'c' } });

    expect((await checkVisual(container.loaded, { run: READY, host: TEST_HOST })).gaps.join('\n')).toContain('cut 2');
    const report = await checkVisual(remote.loaded, { run: READY, host: TEST_HOST });
    expect(report.gaps).toEqual([]);
    expect(report.notes.join('\n')).toContain('remote runner');
  });

  it('every gap is reported in one pass', async () => {
    const project = await makeTestProject(temp);
    await Bun.write(join(project.root, 'node_modules', 'playwright-core', 'package.json'), '{}');
    const run = fakeRunner([[['git', 'lfs', 'version'], { exitCode: 1 }]]);
    const report = await checkVisual(project.loaded, { run, host: TEST_HOST });

    expect(report.gaps).toHaveLength(2);
  });

  it('an OS that differs from the set\'s is a warning, not a gap', async () => {
    const project = await makeTestProject(temp);
    const paths = setPaths(project.storeDir, 'packages-ui', '1.61.1', KEY);
    await writeShots(paths.snapshotsDir, { 'a--light.png': '1' });
    await writeSetRecord(paths.recordFile, { ...TEMP_RECORD, runner: { ...TEMP_RECORD.runner, os: 'macOS 26.5' } });
    const report = await checkVisual(project.loaded, { run: READY, host: TEST_HOST });

    expect(report.gaps).toEqual([]);
    expect(report.warnings.join('\n')).toContain('macOS 26.5');
    expect(report.warnings.join('\n')).toContain('macOS 26.6.2');
  });

  it('a store folder that does not exist is a gap', async () => {
    const project = await makeTestProject(temp);
    await temp.clean();
    const report = await checkVisual(project.loaded, { run: READY, host: TEST_HOST });

    expect(report.gaps.join('\n')).toContain('does not exist');
  });
});
