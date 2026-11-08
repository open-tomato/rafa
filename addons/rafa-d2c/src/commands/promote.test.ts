import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'bun:test';

import { hostRunnerKey, setPaths } from '../store/key.js';
import { initGitStore, makeTestProject, TempDirs, testContext, writeConfigFile, writeReport, writeShots } from '../testing.js';

import { placeCommand } from './place.js';
import { promoteCommand } from './promote.js';
import { seedCommand } from './seed.js';

const temp = new TempDirs();
afterEach(() => temp.clean());

describe('the promote command', () => {
  it('promotes, names the commit and hands the push to the person', async () => {
    const project = await makeTestProject(temp);
    initGitStore(project.storeDir);
    await writeConfigFile(project);
    const key = hostRunnerKey(process.platform, process.arch);
    await writeShots(setPaths(project.storeDir, 'packages-ui', '1.61.1', key).snapshotsDir, { 'a--light.png': '1' });
    await seedCommand.run(testContext(project.root).context);
    await writeShots(join(project.packageDir, 'visual', '__image_snapshots__'), { 'a--light.png': 'new' });
    await writeReport(project, { updated: 1, total: 1 });
    await placeCommand.run(testContext(project.root).context);
    const { context, printed } = testContext(project.root);
    await promoteCommand.run(context);

    expect(printed.info).toContain(`promoted 1 file into packages-ui @ ${key}`);
    expect(printed.info.at(-1)).toBe(`committed in the store; push it yourself when ready: git -C ${project.storeDir} push`);
  });

  it('refuses when no run waits', async () => {
    const project = await makeTestProject(temp, { storeKind: 'local-dir' });
    await writeConfigFile(project);
    const { context } = testContext(project.root);

    expect(promoteCommand.run(context)).rejects.toThrow('waiting to promote');
  });
});
