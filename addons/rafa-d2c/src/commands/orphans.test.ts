import { afterEach, describe, expect, it } from 'bun:test';

import { hostRunnerKey, setPaths } from '../store/key.js';
import { makeTestProject, TempDirs, testContext, writeConfigFile, writeIndex, writeShots } from '../testing.js';

import { orphansCommand } from './orphans.js';

const temp = new TempDirs();
afterEach(() => temp.clean());

describe('the orphans command', () => {
  it('prints the count, then one file per line', async () => {
    const project = await makeTestProject(temp, { storeKind: 'local-dir' });
    await writeConfigFile(project);
    const key = hostRunnerKey(process.platform, process.arch);
    await writeShots(setPaths(project.storeDir, 'packages-ui', '1.61.1', key).snapshotsDir, { 'a--light.png': '1', 'gone--light.png': '2' });
    await writeIndex(project, [['Atoms/A', 'One', 'a']]);
    const { context, printed } = testContext(project.root);
    await orphansCommand.run(context);

    expect(printed.info).toEqual(['1 of 2 files belong to no story in packages/ui/storybook-static/index.json', 'gone--light.png']);
  });
});
