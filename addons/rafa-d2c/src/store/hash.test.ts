import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'bun:test';

import { TempDirs } from '../testing.js';

import { hashFolder } from './hash.js';

const temp = new TempDirs();
afterEach(() => temp.clean());

describe('hashFolder', () => {
  it('hashes each PNG by its name and ignores other files', async () => {
    const dir = await temp.make();
    await writeFile(join(dir, 'a--light.png'), 'one');
    await writeFile(join(dir, 'notes.txt'), 'two');
    await mkdir(join(dir, 'nested'));

    expect([...(await hashFolder(dir)).entries()]).toEqual([
      ['a--light.png', '7692c3ad3540bb803c020b3aee66cd8887123234ea0c6e7143c0add73ff431ed'],
    ]);
  });

  it('answers an empty map for a missing folder', async () => {
    expect((await hashFolder(join(await temp.make(), 'missing'))).size).toBe(0);
  });
});
