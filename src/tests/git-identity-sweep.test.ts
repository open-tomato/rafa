import { join, relative } from 'node:path';

import { describe, expect, test } from 'bun:test';

const REPO_ROOT = join(import.meta.dir, '..', '..');
const SWEEP_ROOTS = ['src', 'packages'];
const SETTER = 'GIT_CONFIG_GLOBAL';
const HELPER = 'gitIdentityEnv';
const HOME_HELPER = 'scratchHomeEnv';
const SELF = relative(REPO_ROOT, import.meta.path);

/**
 * `HOME` named as an object key, unless its value is the process's own
 * `HOME`: that is the operator's home, not a scratch one. A shell string
 * such as `HOME='...' cmd` is not read; it runs under an environment its
 * parent already built.
 */
const HOME_KEY = /(^|[\s{,(])HOME\s*:(?!\s*process\.env\.HOME\b)/m;

/** A call that starts a process, so an environment object in the source can reach one. */
const SPAWN_CALL = /\b(spawn|spawnSync|execFile|execFileSync|execSync|createGhRunner)\(/;

/**
 * Sources exempt from the sweep, each with its reason. The helpers
 * themselves spell the variables; `cli-capture.test.ts` spawns one control
 * under `HOME` alone on purpose, to show what `scratchHomeEnv` prevents.
 */
const EXEMPT = new Set([
  SELF,
  'src/tests/git-identity.ts',
  'src/tests/scratch-home-env.ts',
  'packages/rafa-hub/src/testdata/scratch-home-env.ts',
  'src/tests/cli-capture.test.ts',
]);

/** True when the source names the isolating variable but never the identity helper. */
function setsConfigWithoutHelper(source: string): boolean {
  return source.includes(SETTER) && !source.includes(HELPER);
}

/** True when the source sets a scratch `HOME` for a spawned process with neither helper. */
function setsHomeWithoutHelper(source: string): boolean {
  return HOME_KEY.test(source)
    && SPAWN_CALL.test(source)
    && !source.includes(HOME_HELPER)
    && !source.includes(HELPER);
}

async function offendingFiles(offends: (source: string) => boolean): Promise<string[]> {
  const offenders: string[] = [];
  for (const root of SWEEP_ROOTS) {
    const glob = new Bun.Glob(`${root}/**/*.{ts,tsx,js,mjs}`);
    for await (const path of glob.scan({ cwd: REPO_ROOT })) {
      if (path.includes('node_modules/') || EXEMPT.has(path)) continue;
      const source = await Bun.file(join(REPO_ROOT, path)).text();
      if (offends(source)) offenders.push(path);
    }
  }
  return offenders.sort();
}

describe('git identity sweep', () => {
  test('no source sets GIT_CONFIG_GLOBAL without the git identity helper', async () => {
    expect(await offendingFiles(setsConfigWithoutHelper)).toEqual([]);
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

  test('no source sets a scratch HOME for a spawned process without a helper', async () => {
    expect(await offendingFiles(setsHomeWithoutHelper)).toEqual([]);
  });

  test('flags a planted source that spawns under a bare scratch HOME', () => {
    const planted = [
      'const run = Bun.spawnSync([\'git\', \'commit\'], {',
      '  env: { PATH: path, HOME: home },',
      '});',
      '',
    ].join('\n');

    expect(setsHomeWithoutHelper(planted)).toBe(true);
  });

  test('flags a planted HOME key that opens an object with a spawn elsewhere in the source', () => {
    const planted = 'const env = {\nHOME: home,\n};\nexecFileSync(\'git\', [], { env });\n';

    expect(setsHomeWithoutHelper(planted)).toBe(true);
  });

  test('accepts a planted source that spreads scratchHomeEnv for the spawn', () => {
    const planted = 'Bun.spawnSync([\'git\'], { env: { PATH: path, ...scratchHomeEnv(home) } });\n';

    expect(setsHomeWithoutHelper(planted)).toBe(false);
  });

  test('accepts a planted source that spreads gitIdentityEnv beside its HOME', () => {
    const planted = 'spawnSync(\'git\', [], { env: { HOME: home, ...gitIdentityEnv() } });\n';

    expect(setsHomeWithoutHelper(planted)).toBe(false);
  });

  test('ignores a HOME key in a source that spawns nothing', () => {
    expect(setsHomeWithoutHelper('const env = { HOME: \'/h\', PATH: \'/bin\' };\n')).toBe(false);
  });

  test('ignores a spawn that hands the process its own HOME through', () => {
    const planted = 'Bun.spawn([\'claude\'], { env: { ...process.env, HOME: process.env.HOME ?? home } });\n';

    expect(setsHomeWithoutHelper(planted)).toBe(false);
  });

  test('ignores a constant named HOME in a source that spawns', () => {
    expect(setsHomeWithoutHelper('const HOME = join(base, \'home\');\nBun.spawn([\'ls\']);\n')).toBe(false);
  });
});
