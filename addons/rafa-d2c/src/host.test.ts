import { describe, expect, it } from 'bun:test';

import { readHostFacts } from './host.js';
import { fakeRunner } from './testing.js';

describe('readHostFacts', () => {
  it('labels macOS from sw_vers', async () => {
    const run = fakeRunner([[['sw_vers', '-productVersion'], { stdout: '26.6.2\n' }]]);

    expect(await readHostFacts(run, { platform: 'darwin', arch: 'arm64', osRelease: () => Promise.resolve(null) }))
      .toEqual({ platform: 'darwin', arch: 'arm64', os: 'macOS 26.6.2' });
  });

  it('labels linux from os-release', async () => {
    const osRelease = (): Promise<string | null> => Promise.resolve('NAME="Ubuntu"\nPRETTY_NAME="Ubuntu 24.04.1 LTS"\n');

    expect(await readHostFacts(fakeRunner(), { platform: 'linux', arch: 'x64', osRelease }))
      .toEqual({ platform: 'linux', arch: 'x64', os: 'Ubuntu 24.04.1 LTS' });
  });

  it('answers a null label when nothing says', async () => {
    const run = fakeRunner([[['sw_vers'], { exitCode: 127 }]]);

    expect((await readHostFacts(run, { platform: 'darwin', arch: 'arm64', osRelease: () => Promise.resolve(null) })).os).toBeNull();
  });
});
