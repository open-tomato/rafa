import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'bun:test';

import { setPaths } from '../store/key.js';
import { makeTestProject, TempDirs, writeIndex, writeShots } from '../testing.js';

import { listOrphans } from './orphans.js';

const temp = new TempDirs();
afterEach(() => temp.clean());

const KEY = { playwrightVersion: '1.61.1', runnerKey: 'host-darwin-arm64' };

describe('listOrphans', () => {
  it('lists files whose story id the index lacks', async () => {
    const project = await makeTestProject(temp, { storeKind: 'local-dir' });
    await writeShots(setPaths(project.storeDir, 'packages-ui', KEY.playwrightVersion, KEY.runnerKey).snapshotsDir, {
      'a--light.png': '1',
      'gone--light.png': '2',
      'gone--dark.png': '3',
    });
    await writeIndex(project, [['Atoms/A', 'One', 'a']]);

    expect(await listOrphans(project.loaded, KEY)).toEqual({ orphans: ['gone--dark.png', 'gone--light.png'], total: 3 });
  });

  it('a missing index refuses naming its path and the build that writes it', async () => {
    const project = await makeTestProject(temp, { storeKind: 'local-dir' });

    const failure = listOrphans(project.loaded, KEY);
    expect(failure).rejects.toThrow(join(project.packageDir, 'storybook-static', 'index.json'));
    expect(failure).rejects.toThrow('storybook build');
  });

  it('a missing set answers zero of zero', async () => {
    const project = await makeTestProject(temp, { storeKind: 'local-dir' });
    await writeIndex(project, [['Atoms/A', 'One', 'a']]);

    expect(await listOrphans(project.loaded, KEY)).toEqual({ orphans: [], total: 0 });
  });
});
