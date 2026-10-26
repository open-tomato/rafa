/**
 * Tests for `./scratch-home-env.js`: the variables it adds name no path
 * under the `HOME` it sets, and they carry the test git identity.
 * `cli-capture.test.ts` holds the spawned reading, a run leaving no
 * `.bun` directory under its scratch `HOME`.
 */
import { join, relative } from 'node:path';

import { describe, expect, it } from 'bun:test';

import { gitIdentityEnv } from './git-identity.js';
import { scratchHomeEnv } from './scratch-home-env.js';

describe('scratchHomeEnv', () => {
  it('sets HOME, names the install cache outside it, and turns the transpiler cache off', () => {
    const home = join('/scratch', 'case', 'home');

    const env = scratchHomeEnv(home);

    expect(env['HOME']).toBe(home);
    expect(env['BUN_RUNTIME_TRANSPILER_CACHE_PATH']).toBe('0');
    expect(relative(home, env['BUN_INSTALL_CACHE_DIR'] ?? '')).toBe('../home-bun-install-cache');
  });

  it('carries the test git identity, so a commit under the swapped HOME needs no ~/.gitconfig', () => {
    const env = scratchHomeEnv(join('/scratch', 'case', 'home'));

    expect(env).toMatchObject(gitIdentityEnv());
  });
});
