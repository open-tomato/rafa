/**
 * The privacy sweep over `addons/rafa-d2c/`: no file git tracks, or would
 * track, names a private host, a home path, a private repository or the
 * maintainer's local baselines folder. The terms are sha256 hashes; see
 * `src/tests/privacy-sweep.ts` for how to add one without spelling it.
 *
 * `loki` stays off this list: it is also a public visual-testing tool,
 * and the add-on's detection names it.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, setDefaultTimeout } from 'bun:test';

import { BASE_BANNED, bannedHashOf, sweepFiles, sweepFolder } from '../../src/tests/privacy-sweep.js';
import { SWEEP_TIMEOUT } from '../../src/tests/sweep-timeout.js';

setDefaultTimeout(SWEEP_TIMEOUT);

/** The base list, plus the folder the maintainer keeps baselines in. */
const BANNED: ReadonlyMap<string, string> = new Map([
  ...BASE_BANNED,
  ['cfba93e0d3708364c2cb6eec0106b0d5a382c903ecb2ea499edefb66d45fb43a', 'the local baselines folder'],
]);

describe('the rafa-d2c privacy sweep', () => {
  it('control: finds a planted term in a file it reads', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'd2c-sweep-'));
    try {
      const file = join(dir, 'planted.md');
      await writeFile(file, 'store: /x/example-planted/y\n');
      const planted = new Map([[bannedHashOf('example-planted'), 'the planted term']]);

      expect(await sweepFiles(dir, ['planted.md'], planted)).toEqual([{ file: 'planted.md', label: 'the planted term' }]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('finds no banned term in any file under addons/rafa-d2c/', async () => {
    expect(await sweepFolder('addons/rafa-d2c', BANNED)).toEqual([]);
  });
});
