/**
 * Meta sweep: a test that reads the repository tree at run time must carry
 * the `.sweep.test.ts` suffix.
 *
 * `bun test --changed=<base>` follows the import graph, so a test that
 * imports no project file is never selected by a changed file. The suffix
 * is how `tests.alwaysRun` (default `src/**\/*.sweep.test.ts`) finds those
 * tests and runs them beside the scoped ones. A content sweep without the
 * suffix would silently never run in a scoped check.
 *
 * Two kinds of source read the repository tree:
 *
 * - a `git ls-files` call, spelled as the `'ls-files'` argument. A source
 *   that builds a scratch repository (`mkdtemp`, `tmpdir`, `scratch`) lists
 *   that repository, not this one, and a source that only names `ls-files`
 *   inside a stand-in runner is likewise left out through the same marker
 *   or the missing `git` spawn;
 * - a walk of the root: a glob scan, `readdirSync` or `readdir` whose
 *   directory is the repository root constant (`REPO_ROOT`, `repoRoot`).
 *
 * The detectors read source text, so each answer has a planted-source
 * control below.
 */
import { execFileSync } from 'node:child_process';
import { join, relative } from 'node:path';

import { describe, expect, test } from 'bun:test';

const REPO_ROOT = join(import.meta.dir, '..', '..');
const SWEEP_SUFFIX = '.sweep.test.ts';
const TEST_SUFFIX = '.test.ts';
const SELF = relative(REPO_ROOT, import.meta.path);

/** The `ls-files` argument of a git call, as a string literal. */
const LS_FILES_ARG = /['"`]ls-files['"`]/;

/** A process that starts git, so the literal above is a real call and not a stand-in's check. */
const GIT_SPAWN = /\b(execFileSync|execSync|spawnSync|spawn|execFile)\(\s*['"`]git['"`]/;

/** Marks a source that works on a scratch repository of its own. */
const SCRATCH_MARKER = /\b(mkdtemp\w*|tmpdir|scratch\w*)\b/i;

/** A glob scan or a directory read whose base is the repository root constant. */
const ROOT_WALK = /(\bcwd:\s*(REPO_ROOT|repoRoot)\b|\b(readdirSync|readdir|walk\w*)\(\s*(REPO_ROOT|repoRoot)\b)/;

/** True when the source lists this repository's tracked files with `git ls-files`. */
function callsLsFiles(source: string): boolean {
  return LS_FILES_ARG.test(source) && GIT_SPAWN.test(source) && !SCRATCH_MARKER.test(source);
}

/** True when the source walks the repository root. */
function walksRoot(source: string): boolean {
  return ROOT_WALK.test(source);
}

/** True when the source reads the repository tree at run time. */
function readsRepositoryTree(source: string): boolean {
  return callsLsFiles(source) || walksRoot(source);
}

/** True when a repo-relative path names a test file that lacks the sweep suffix. */
function lacksSweepSuffix(path: string): boolean {
  return path.endsWith(TEST_SUFFIX) && !path.endsWith(SWEEP_SUFFIX);
}

/** Tracked test files that read the tree and lack the suffix, repo-relative and sorted. */
async function unsuffixedSweeps(listing: readonly string[]): Promise<string[]> {
  const offenders: string[] = [];
  for (const path of listing) {
    if (path === SELF || !lacksSweepSuffix(path)) continue;
    const source = await Bun.file(join(REPO_ROOT, path)).text();
    if (readsRepositoryTree(source)) offenders.push(path);
  }
  return offenders.sort();
}

function trackedFiles(): string[] {
  return execFileSync('git', ['ls-files', '-z', '--', '*.test.ts'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  })
    .split('\0')
    .filter((path) => path !== '');
}

describe('sweep suffix', () => {
  test('every tracked test that reads the repository tree ends in .sweep.test.ts', async () => {
    const offenders = await unsuffixedSweeps(trackedFiles());

    expect(
      offenders,
      `rename with git mv to the ${SWEEP_SUFFIX} suffix: ${offenders.join(', ')}`,
    ).toEqual([]);
  });

  test('the listing holds test files, so an empty answer is not an empty read', () => {
    const listing = trackedFiles();

    expect(listing.length).toBeGreaterThan(0);
    // This file is untracked until the loop commits it, so name a committed sweep.
    expect(listing).toContain('src/tests/git-identity.sweep.test.ts');
  });
});

describe('git ls-files detector', () => {
  test('flags a planted source that lists the repository with git ls-files', () => {
    const planted = 'const out = execFileSync(\'git\', [\'ls-files\'], { cwd: REPO_ROOT });\n';

    expect(callsLsFiles(planted)).toBe(true);
  });

  test('ignores a planted source that lists a scratch repository', () => {
    const planted = [
      'const dir = mkdtempSync(join(tmpdir(), \'x-\'));',
      'execFileSync(\'git\', [\'ls-files\'], { cwd: dir });',
    ].join('\n');

    expect(callsLsFiles(planted)).toBe(false);
  });

  test('ignores a planted source whose stand-in runner only checks for ls-files', () => {
    const planted = 'if (args[0] === \'ls-files\') listings.push(args.join(\' \'));\n';

    expect(callsLsFiles(planted)).toBe(false);
  });

  test('ignores a planted source that never names ls-files', () => {
    expect(callsLsFiles('execFileSync(\'git\', [\'status\']);\n')).toBe(false);
  });
});

describe('root walk detector', () => {
  test('flags a planted glob scan rooted at the repository', () => {
    const planted = 'for await (const p of new Bun.Glob(\'**/*.ts\').scan({ cwd: REPO_ROOT })) {}\n';

    expect(walksRoot(planted)).toBe(true);
  });

  test('flags a planted readdirSync of the repository root', () => {
    expect(walksRoot('const names = readdirSync(REPO_ROOT);\n')).toBe(true);
  });

  test('ignores a planted read of a subdirectory', () => {
    expect(walksRoot('const names = readdirSync(join(REPO_ROOT, \'src\'));\n')).toBe(false);
  });

  test('ignores a planted scan of a scratch directory', () => {
    expect(walksRoot('new Bun.Glob(\'*.md\').scanSync({ cwd: dir });\n')).toBe(false);
  });
});

describe('suffix check', () => {
  test('flags a planted test path without the sweep suffix', () => {
    expect(lacksSweepSuffix('src/tests/foo.test.ts')).toBe(true);
  });

  test('accepts a planted test path with the sweep suffix', () => {
    expect(lacksSweepSuffix('src/tests/foo.sweep.test.ts')).toBe(false);
  });

  test('ignores a path that is not a test file', () => {
    expect(lacksSweepSuffix('src/tests/helper.ts')).toBe(false);
  });

  test('names a planted unsuffixed tree reader through the whole chain', () => {
    const planted = 'execFileSync(\'git\', [\'ls-files\'], { cwd: REPO_ROOT });\n';

    expect(
      readsRepositoryTree(planted) && lacksSweepSuffix('src/a/planted.test.ts'),
    ).toBe(true);
  });
});
