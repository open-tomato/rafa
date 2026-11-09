import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'bun:test';

import { TempDirs } from '../testing.js';

import { readEnvironment } from './environment.js';

const temp = new TempDirs();
afterEach(() => temp.clean());

/** An ENVIRONMENT file with the field names of the old format and made-up values. */
const OLD = `copied_at: 2026-01-02T03:04:05Z
source: a checkout, packages/ui/visual/__image_snapshots__ (untracked)
source_commit: 1a2b3c4 (main)
os: macOS 25.1.0 arm64
playwright-core: 1.60.0
files: 4 (2 light, 2 dark)
state: NOT green. 2 stories moved.
`;

describe('readEnvironment', () => {
  it('reads the playwright version, platform, OS label, commit and state', async () => {
    const file = join(await temp.make(), 'ENVIRONMENT');
    await Bun.write(file, OLD);

    expect(await readEnvironment(file)).toEqual({
      playwrightVersion: '1.60.0',
      platform: 'darwin-arm64',
      os: 'macOS 25.1.0',
      sourceCommit: '1a2b3c4',
      state: 'NOT green. 2 stories moved.',
    });
  });

  it('reads a linux host on x86_64 as amd64', async () => {
    const file = join(await temp.make(), 'ENVIRONMENT');
    await Bun.write(file, 'os: Ubuntu 24.04.1 LTS x86_64\nplaywright-core: 1.61.1\n');

    expect(await readEnvironment(file)).toMatchObject({ platform: 'linux-amd64', os: 'Ubuntu 24.04.1 LTS', sourceCommit: null, state: null });
  });

  it('refuses a file without the playwright version, naming the key', async () => {
    const file = join(await temp.make(), 'ENVIRONMENT');
    await Bun.write(file, 'os: macOS 25.1.0 arm64\n');

    expect(readEnvironment(file)).rejects.toThrow('playwright-core');
  });
});
