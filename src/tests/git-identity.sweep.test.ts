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
 * The roots the `TMPDIR` sweep reads. The hub's spawned suites under
 * `packages/` spread their own copy of the helper and are not read here.
 */
const TMPDIR_SWEEP_ROOTS = ['src'];

/** A spread of the scratch `HOME` helper into an object literal. */
const HOME_SPREAD = `...${HOME_HELPER}(`;

/** `TMPDIR` named as an object key. */
const TMPDIR_KEY = /(^|[\s{,])TMPDIR\s*:/;

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

/**
 * The keys of the object literal that holds the spread at `spreadAt`,
 * written before it: the text back to the literal's opening brace, with
 * any nested braces and what they hold left out.
 */
function keysBeforeSpread(source: string, spreadAt: number): string {
  let depth = 0;
  let keys = '';
  for (let index = spreadAt - 1; index >= 0; index -= 1) {
    const char = source[index];
    if (char === '}') depth += 1;
    else if (char === '{' && depth === 0) return keys;
    else if (char === '{') depth -= 1;
    else if (depth === 0) keys = `${char}${keys}`;
  }
  return keys;
}

/**
 * True when an object literal spreads `scratchHomeEnv(` with no `TMPDIR`
 * key before the spread, so the spawned child would fall back to `/tmp`
 * instead of the test process's own `tmpdir()`.
 */
function spreadsHomeWithoutTmpdir(source: string): boolean {
  for (let at = source.indexOf(HOME_SPREAD); at !== -1; at = source.indexOf(HOME_SPREAD, at + 1)) {
    if (!TMPDIR_KEY.test(keysBeforeSpread(source, at))) return true;
  }
  return false;
}

/**
 * The functions whose `git` seam is optional and falls back to
 * `createGitRunner`, which spawns git under the host's own environment and
 * so under the host's identity. Of them only `addRunWorktree` can reach a
 * command that needs one: its catch-up runs `git merge --no-edit`.
 */
const OPTIONAL_GIT_SEAM_CALLS = ['addRunWorktree'];

/** A `git` key in an object literal, written `git:` or as the shorthand `git,`. */
const GIT_SEAM_KEY = /(^|[\s{,])git\s*[:,}]/;

/** The text of a call's arguments from just after its `(`, up to the matching `)`. */
function argumentsAt(source: string, openAt: number): string {
  let depth = 0;
  for (let index = openAt; index < source.length; index += 1) {
    const char = source[index];
    if (char === '(' || char === '{' || char === '[') depth += 1;
    else if (char === ')' || char === '}' || char === ']') {
      if (depth === 0) return source.slice(openAt, index);
      depth -= 1;
    }
  }
  return source.slice(openAt);
}

/** The top-level arguments of a call, split at commas outside any bracket. */
function splitArguments(args: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of args) {
    if (char === '(' || char === '{' || char === '[') depth += 1;
    else if (char === ')' || char === '}' || char === ']') depth -= 1;
    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else current += char;
  }
  if (current.trim() !== '') parts.push(current);
  return parts;
}

/**
 * True when the source sets `GIT_CONFIG_GLOBAL` and calls a function with an
 * optional `git` seam without passing one: no second argument, or an object
 * literal that names no `git`. A second argument that is not an object
 * literal (a seams variable) is not read; what it holds is built elsewhere.
 * Its declaration and an import of the name are not calls and are not read.
 */
function callsOptionalGitSeamWithoutIt(source: string): boolean {
  if (!source.includes(SETTER)) return false;
  for (const name of OPTIONAL_GIT_SEAM_CALLS) {
    const call = new RegExp(`(?<![\\w.])${name}\\(`, 'g');
    for (const match of source.matchAll(call)) {
      const before = source.slice(Math.max(0, match.index - 10), match.index);
      if (/function\s+$/.test(before)) continue;
      const parts = splitArguments(argumentsAt(source, match.index + match[0].length));
      const seams = parts[1]?.trim();
      if (seams === undefined) return true;
      if (seams.startsWith('{') && !GIT_SEAM_KEY.test(seams)) return true;
    }
  }
  return false;
}

async function offendingFiles(
  offends: (source: string) => boolean,
  roots: readonly string[] = SWEEP_ROOTS,
): Promise<string[]> {
  const offenders: string[] = [];
  for (const root of roots) {
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

describe('optional git seam sweep', () => {
  test('no source that sets GIT_CONFIG_GLOBAL calls an optional-seam function without its git seam', async () => {
    expect(await offendingFiles(callsOptionalGitSeamWithoutIt)).toEqual([]);
  });

  test('flags a planted call that omits the seam', () => {
    const planted = [
      'const env = { GIT_CONFIG_GLOBAL: \'/dev/null\', ...gitIdentityEnv() };',
      'const outcome = addRunWorktree({ projectRoot: project, worktreeDir, planStub: stub, base });',
      '',
    ].join('\n');

    expect(callsOptionalGitSeamWithoutIt(planted)).toBe(true);
  });

  test('flags a planted call whose seams object names no git', () => {
    const planted = 'const env = { GIT_CONFIG_GLOBAL: \'/dev/null\' };\naddRunWorktree(request(), { other: 1 });\n';

    expect(callsOptionalGitSeamWithoutIt(planted)).toBe(true);
  });

  test('accepts a planted call that passes { git: ... }', () => {
    const planted = [
      'const env = { GIT_CONFIG_GLOBAL: \'/dev/null\', ...gitIdentityEnv() };',
      'const outcome = addRunWorktree({ projectRoot: project, planStub: stub }, { git: isolatedGitRunner });',
      '',
    ].join('\n');

    expect(callsOptionalGitSeamWithoutIt(planted)).toBe(false);
  });

  test('ignores a planted call in a source that never sets GIT_CONFIG_GLOBAL', () => {
    const planted = 'const outcome = addRunWorktree({ projectRoot: project, planStub: stub });\n';

    expect(callsOptionalGitSeamWithoutIt(planted)).toBe(false);
  });
});

describe('scratch HOME TMPDIR sweep', () => {
  test('no source under src/ spreads scratchHomeEnv without a TMPDIR key before it', async () => {
    expect(await offendingFiles(spreadsHomeWithoutTmpdir, TMPDIR_SWEEP_ROOTS)).toEqual([]);
  });

  test('flags a planted spread with no TMPDIR key in its object', () => {
    const planted = 'Bun.spawnSync([\'git\'], { cwd, env: { PATH: path, ...scratchHomeEnv(home) } });\n';

    expect(spreadsHomeWithoutTmpdir(planted)).toBe(true);
  });

  test('flags a planted spread whose TMPDIR key comes after it', () => {
    const planted = 'const env = { PATH: path, ...scratchHomeEnv(home), TMPDIR: tmpdir() };\n';

    expect(spreadsHomeWithoutTmpdir(planted)).toBe(true);
  });

  test('flags a planted spread whose only TMPDIR sits in a nested object before it', () => {
    const planted = 'const env = { extra: { TMPDIR: tmp }, ...scratchHomeEnv(home) };\n';

    expect(spreadsHomeWithoutTmpdir(planted)).toBe(true);
  });

  test('flags the second spread in a source whose first spread names TMPDIR', () => {
    const planted = [
      'const a = { TMPDIR: tmpdir(), ...scratchHomeEnv(home) };',
      'const b = { PATH: path, ...scratchHomeEnv(home) };',
      '',
    ].join('\n');

    expect(spreadsHomeWithoutTmpdir(planted)).toBe(true);
  });

  test('accepts a planted spread with TMPDIR first in its object', () => {
    const planted = 'Bun.spawnSync([\'git\'], { cwd, env: { TMPDIR: tmpdir(), ...scratchHomeEnv(home), PATH: path } });\n';

    expect(spreadsHomeWithoutTmpdir(planted)).toBe(false);
  });

  test('accepts a planted TMPDIR key on its own line before a nested object and the spread', () => {
    const planted = 'const env = {\n  TMPDIR: tmpdir(),\n  extra: { a: 1 },\n  ...scratchHomeEnv(home),\n};\n';

    expect(spreadsHomeWithoutTmpdir(planted)).toBe(false);
  });

  test('ignores a source that calls scratchHomeEnv without spreading it', () => {
    expect(spreadsHomeWithoutTmpdir('const env = scratchHomeEnv(home);\n')).toBe(false);
  });
});
