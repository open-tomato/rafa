import { join, relative } from 'node:path';

import { describe, expect, test } from 'bun:test';

const REPO_ROOT = join(import.meta.dir, '..', '..');
const SWEEP_ROOTS = ['src', 'packages'];
const SETTER = 'GIT_CONFIG_GLOBAL';
const HELPER = 'gitIdentityEnv';
const SELF = relative(REPO_ROOT, import.meta.path);
const EXEMPT = new Set([SELF, 'src/tests/git-identity.ts']);

/** True when the source names the isolating variable but never the identity helper. */
function setsConfigWithoutHelper(source: string): boolean {
  return source.includes(SETTER) && !source.includes(HELPER);
}

async function offendingFiles(): Promise<string[]> {
  const offenders: string[] = [];
  for (const root of SWEEP_ROOTS) {
    const glob = new Bun.Glob(`${root}/**/*.{ts,tsx,js,mjs}`);
    for await (const path of glob.scan({ cwd: REPO_ROOT })) {
      if (path.includes('node_modules/') || EXEMPT.has(path)) continue;
      const source = await Bun.file(join(REPO_ROOT, path)).text();
      if (setsConfigWithoutHelper(source)) offenders.push(path);
    }
  }
  return offenders.sort();
}

describe('git identity sweep', () => {
  test('no source sets GIT_CONFIG_GLOBAL without the git identity helper', async () => {
    expect(await offendingFiles()).toEqual([]);
  });

  test('flags a planted source that sets GIT_CONFIG_GLOBAL without the helper', () => {
    const planted = 'const env = { ...process.env, GIT_CONFIG_GLOBAL: \'/dev/null\' };\n';

    expect(setsConfigWithoutHelper(planted)).toBe(true);
  });

  test('accepts a planted source that spreads the helper beside it', () => {
    const planted =
      'const env = { GIT_CONFIG_GLOBAL: \'/dev/null\', ...gitIdentityEnv() };\n';

    expect(setsConfigWithoutHelper(planted)).toBe(false);
  });

  test('ignores a source that never mentions the variable', () => {
    expect(setsConfigWithoutHelper('export const a = 1;\n')).toBe(false);
  });
});
