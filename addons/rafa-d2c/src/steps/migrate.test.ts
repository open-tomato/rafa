import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'bun:test';

import { spawnProcess } from '../process.js';
import { setPaths } from '../store/key.js';
import { readSetRecord } from '../store/set-record.js';
import { initGitStore, makeTestProject, TempDirs, writeShots } from '../testing.js';

import { applyMigration, planMigration } from './migrate.js';

const temp = new TempDirs();
afterEach(() => temp.clean());

const OLD = 'source_commit: 1a2b3c4 (main)\nos: macOS 25.1.0 arm64\nplaywright-core: 1.60.0\nstate: NOT green. 2 stories moved.\n';

/** A store holding the old flat layout of the test set. */
async function flatStore(options: { environment?: boolean; storeKind?: 'local-dir' | 'side-repo' } = {}) {
  const project = await makeTestProject(temp, { storeKind: options.storeKind ?? 'local-dir' });
  const setDir = join(project.storeDir, 'packages-ui');
  await writeShots(join(setDir, '__image_snapshots__'), { 'a--light.png': '1', 'a--dark.png': '2' });
  if (options.environment !== false) await Bun.write(join(setDir, 'ENVIRONMENT'), OLD);
  await Bun.write(join(setDir, 'MANIFEST.sha256'), 'hashes\n');
  return { project, setDir };
}

describe('planMigration', () => {
  it('plans the move to <playwright>/<key>/__image_snapshots__', async () => {
    const { project, setDir } = await flatStore();
    const plan = await planMigration(project.loaded, {});

    expect(plan.from).toBe(join(setDir, '__image_snapshots__'));
    expect(plan.to).toBe(setPaths(project.storeDir, 'packages-ui', '1.60.0', 'host-darwin-arm64').snapshotsDir);
    expect(plan.removes).toEqual([join(setDir, 'ENVIRONMENT'), join(setDir, 'MANIFEST.sha256')]);
  });

  it('writes the record with migratedFrom.state verbatim and lastRun null', async () => {
    const { project } = await flatStore();
    const plan = await planMigration(project.loaded, {});

    expect(plan.record).toEqual({
      set: 'packages-ui',
      playwrightVersion: '1.60.0',
      runner: { kind: 'host', platform: 'darwin-arm64', os: 'macOS 25.1.0' },
      projectCommit: '1a2b3c4',
      projectDirty: false,
      promotedAt: null,
      files: 2,
      lastRun: null,
      migratedFrom: { state: 'NOT green. 2 stories moved.' },
    });
  });

  it('a dry run writes nothing', async () => {
    const { project, setDir } = await flatStore();
    await planMigration(project.loaded, {});

    expect((await readdir(setDir)).sort()).toEqual(['ENVIRONMENT', 'MANIFEST.sha256', '__image_snapshots__']);
  });

  it('refuses with no ENVIRONMENT, naming --playwright and --runner', async () => {
    const { project } = await flatStore({ environment: false });
    const failure = planMigration(project.loaded, {});

    expect(failure).rejects.toThrow('--playwright');
    expect(failure).rejects.toThrow('--runner');
  });

  it('flags override ENVIRONMENT', async () => {
    const { project } = await flatStore();
    const plan = await planMigration(project.loaded, { playwright: '1.61.1', runner: 'host-linux-amd64' });

    expect(plan.to).toBe(setPaths(project.storeDir, 'packages-ui', '1.61.1', 'host-linux-amd64').snapshotsDir);
    expect(plan.record.runner.platform).toBe('linux-amd64');
  });

  it('refuses a runner key it cannot read', async () => {
    const { project } = await flatStore();

    expect(planMigration(project.loaded, { runner: 'my-laptop' })).rejects.toThrow('my-laptop');
  });

  it('refuses when there is no flat set to move', async () => {
    const project = await makeTestProject(temp, { storeKind: 'local-dir' });

    expect(planMigration(project.loaded, {})).rejects.toThrow('no flat set');
  });
});

describe('applyMigration', () => {
  it('moves the set and writes its record; keeps old files git does not hold', async () => {
    const { project, setDir } = await flatStore();
    const plan = await planMigration(project.loaded, {});
    const result = await applyMigration(plan, spawnProcess);
    const paths = setPaths(project.storeDir, 'packages-ui', '1.60.0', 'host-darwin-arm64');

    expect((await readdir(paths.snapshotsDir)).sort()).toEqual(['a--dark.png', 'a--light.png']);
    expect(await readSetRecord(paths.recordFile)).toEqual(plan.record);
    expect(result.removed).toEqual([]);
    expect(result.kept).toEqual(plan.removes);
    expect(await Bun.file(join(setDir, 'ENVIRONMENT')).exists()).toBe(true);
  });

  it('removes old files a git store already holds in a commit', async () => {
    const { project, setDir } = await flatStore({ storeKind: 'side-repo' });
    initGitStore(project.storeDir);
    Bun.spawnSync(['git', 'add', '.'], { cwd: project.storeDir });
    Bun.spawnSync(['git', 'commit', '-q', '-m', 'flat set'], { cwd: project.storeDir });
    const result = await applyMigration(await planMigration(project.loaded, {}), spawnProcess);

    expect(result.removed).toEqual([join(setDir, 'ENVIRONMENT'), join(setDir, 'MANIFEST.sha256')]);
    expect(await Bun.file(join(setDir, 'ENVIRONMENT')).exists()).toBe(false);
  });
});
