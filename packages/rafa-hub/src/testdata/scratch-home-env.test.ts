/**
 * Tests for `./scratch-home-env.js`: the variables it adds name no path
 * under the `HOME` it sets.
 */
import { join, relative } from 'node:path';

import { describe, expect, it } from 'bun:test';

import { scratchHomeEnv } from './scratch-home-env.js';

describe('scratchHomeEnv', () => {
  it('sets HOME, names the install cache outside it, and turns the transpiler cache off', () => {
    const home = join('/scratch', 'device', 'home');

    const env = scratchHomeEnv(home);

    expect(env['HOME']).toBe(home);
    expect(env['BUN_RUNTIME_TRANSPILER_CACHE_PATH']).toBe('0');
    expect(relative(home, env['BUN_INSTALL_CACHE_DIR'] ?? '')).toBe('../home-bun-install-cache');
  });
});
