import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'bun:test';

import { makeTestProject, TempDirs, testContext, writeConfigFile, writeShots } from '../testing.js';

import { migrateCommand } from './migrate.js';

const temp = new TempDirs();
afterEach(() => temp.clean());

/** A local-dir project whose store holds a flat set with an old ENVIRONMENT. */
async function flatProject() {
  const project = await makeTestProject(temp, { storeKind: 'local-dir' });
  await writeConfigFile(project);
  const setDir = join(project.storeDir, 'packages-ui');
  await writeShots(join(setDir, '__image_snapshots__'), { 'a--light.png': '1' });
  await Bun.write(join(setDir, 'ENVIRONMENT'), 'os: macOS 25.1.0 arm64\nplaywright-core: 1.60.0\n');
  return { project, setDir };
}

describe('the migrate command', () => {
  it('--dry-run prints the move and writes nothing', async () => {
    const { project, setDir } = await flatProject();
    const { context, printed } = testContext(project.root, { flags: { 'dry-run': true } });
    await migrateCommand.run(context);

    expect(printed.info[0]).toBe(`would move ${join(setDir, '__image_snapshots__')} to ${join(setDir, '1.60.0', 'host-darwin-arm64', '__image_snapshots__')}`);
    expect(printed.info.at(-1)).toBe('dry run: nothing was written');
    expect((await readdir(setDir)).sort()).toEqual(['ENVIRONMENT', '__image_snapshots__']);
  });

  it('moves the set and leaves the commit to the person', async () => {
    const { project, setDir } = await flatProject();
    const { context, printed } = testContext(project.root);
    await migrateCommand.run(context);

    expect(await Bun.file(join(setDir, '1.60.0', 'host-darwin-arm64', 'set.json')).exists()).toBe(true);
    expect(printed.warn.join('\n')).toContain('kept');
    expect(printed.info.at(-1)).toContain('commit');
  });

  it('refuses a bare --runner', async () => {
    const { project } = await flatProject();
    const { context } = testContext(project.root, { flags: { runner: true } });

    expect(migrateCommand.run(context)).rejects.toThrow('--runner');
  });
});
