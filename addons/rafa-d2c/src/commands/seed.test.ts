import { afterEach, describe, expect, it } from 'bun:test';

import { setPaths, hostRunnerKey } from '../store/key.js';
import { makeTestProject, TempDirs, testContext, writeConfigFile, writeShots } from '../testing.js';

import { seedCommand } from './seed.js';

const temp = new TempDirs();
afterEach(() => temp.clean());

describe('the seed command', () => {
  it('checks, seeds and names the run', async () => {
    const project = await makeTestProject(temp, { storeKind: 'local-dir' });
    await writeConfigFile(project);
    const key = hostRunnerKey(process.platform, process.arch);
    await writeShots(setPaths(project.storeDir, 'packages-ui', '1.61.1', key).snapshotsDir, { 'a--light.png': '1' });
    const { context, printed } = testContext(project.root);
    await seedCommand.run(context);

    expect(printed.error).toEqual([]);
    expect(printed.info.at(-1)).toMatch(/^seeded 1 file into packages\/ui\/visual\/__image_snapshots__ \(run \d{8}T\d{6}Z-[0-9a-f]{4}\)$/);
  });

  it('stops on a gap before touching the snapshot folder', async () => {
    const project = await makeTestProject(temp, { storeKind: 'local-dir', runner: { kind: 'container' } });
    await writeConfigFile(project);
    const { context, printed } = testContext(project.root);

    expect(seedCommand.run(context)).rejects.toThrow('check');
    expect(printed.info.join('\n')).not.toContain('seeded');
  });
});
