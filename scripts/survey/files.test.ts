import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import {
  classifyFile,
  coverageLine,
  isInScope,
  listTrackedFiles,
  splitTrackedFiles,
} from './files';

const TRACKED = [
  'packages/hub/src/store/memory.ts',
  'packages/hub/src/store/memory.test.ts',
  'packages/hub/src/testdata/stand-in.ts',
  'src/alpha/a.ts',
  'src/alpha/a.test.ts',
  'src/beta/gh-fake.ts',
  'src/tests/cli-capture.ts',
];

/** Runs git in the scratch repository and fails the test on a non-zero exit. */
function git(root: string, args: readonly string[]): void {
  const result = Bun.spawnSync(['git', ...args], { cwd: root, stderr: 'pipe', stdout: 'pipe' });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} exited ${result.exitCode}: ${result.stderr.toString()}`);
  }
}

function plant(root: string, path: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), 'export const value = 1;\n');
}

describe('listTrackedFiles over a scratch repository', () => {
  let root = '';

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'survey-files-'));
    git(root, ['init', '--quiet']);
    for (const path of [...TRACKED, 'src/alpha/notes.json', 'scripts/tool.ts']) {
      plant(root, path);
    }
    git(root, ['add', '--', ...TRACKED, 'src/alpha/notes.json', 'scripts/tool.ts']);
    plant(root, 'src/alpha/untracked.ts');
  });

  afterAll(() => {
    rmSync(root, { force: true, recursive: true });
  });

  it('lists each tracked code file in scope, split by kind', () => {
    const files = listTrackedFiles(root);
    expect(files.all).toEqual([...TRACKED].sort());
    expect(files.source).toEqual(['packages/hub/src/store/memory.ts', 'src/alpha/a.ts']);
    expect(files.test).toEqual(['packages/hub/src/store/memory.test.ts', 'src/alpha/a.test.ts']);
    expect(files.testSupport).toEqual([
      'packages/hub/src/testdata/stand-in.ts',
      'src/beta/gh-fake.ts',
      'src/tests/cli-capture.ts',
    ]);
  });

  // The control: the untracked file is on disk under src/, so a reader
  // that globbed the tree instead of asking git would list it.
  it('leaves out a file in scope that git does not track', () => {
    const onDisk = new Bun.Glob('src/**/*.ts').scanSync({ cwd: root });
    expect([...onDisk]).toContain('src/alpha/untracked.ts');
    expect(listTrackedFiles(root).all).not.toContain('src/alpha/untracked.ts');
  });

  it('names a tracked file the caller did not read in the coverage line', () => {
    const tracked = listTrackedFiles(root).all;
    const read = tracked.filter((path) => path !== 'src/beta/gh-fake.ts');
    expect(coverageLine(read, tracked)).toBe(
      'Coverage: 6 of 7 tracked files read (src/ and packages/*/src/). Not read: `src/beta/gh-fake.ts`.',
    );
  });

  it('throws when the folder is no git repository', () => {
    const bare = mkdtempSync(join(tmpdir(), 'survey-files-bare-'));
    try {
      expect(() => listTrackedFiles(bare)).toThrow('git ls-files failed');
    } finally {
      rmSync(bare, { force: true, recursive: true });
    }
  });
});

describe('coverageLine', () => {
  it('names no file when every tracked file was read', () => {
    expect(coverageLine(['b.ts', 'a.ts'], ['a.ts', 'b.ts'])).toBe(
      'Coverage: 2 of 2 tracked files read (src/ and packages/*/src/).',
    );
  });

  it('counts a read file git does not track as no coverage', () => {
    expect(coverageLine(['a.ts', 'stray.ts'], ['a.ts', 'b.ts'])).toBe(
      'Coverage: 1 of 2 tracked files read (src/ and packages/*/src/). Not read: `b.ts`.',
    );
  });

  it('names every unread file in sorted order', () => {
    expect(coverageLine([], ['c.ts', 'a.ts'])).toBe(
      'Coverage: 0 of 2 tracked files read (src/ and packages/*/src/). Not read: `a.ts`, `c.ts`.',
    );
  });
});

describe('scope and kinds', () => {
  it('keeps code under src/ and packages/*/src/ only', () => {
    expect(isInScope('src/a.ts')).toBe(true);
    expect(isInScope('src/eslint-stand-in.mjs')).toBe(true);
    expect(isInScope('packages/hub/src/a.ts')).toBe(true);
    expect(isInScope('packages/hub/scripts/a.ts')).toBe(false);
    expect(isInScope('scripts/a.ts')).toBe(false);
    expect(isInScope('src/data.json')).toBe(false);
  });

  it('counts the top-level src/fixtures/ as source and a nested fixtures/ as support', () => {
    expect(classifyFile('src/fixtures/scrub.ts')).toBe('source');
    expect(classifyFile('src/tools/ts-symbols/fixtures/proj/src/main.ts')).toBe('test-support');
  });

  it('reads a fake by its stem and not by a word that only contains it', () => {
    expect(classifyFile('src/pr/gh-fake-shapes.ts')).toBe('test-support');
    expect(classifyFile('src/adapters/tracker/github-fake.ts')).toBe('test-support');
    expect(classifyFile('src/pr/fakery.ts')).toBe('source');
  });

  it('counts a sweep test as a test', () => {
    expect(classifyFile('src/tests/repo-hygiene.sweep.test.ts')).toBe('test');
  });

  it('drops duplicates and sorts every list', () => {
    const files = splitTrackedFiles(['src/b.ts', 'src/a.ts', 'src/b.ts']);
    expect(files.all).toEqual(['src/a.ts', 'src/b.ts']);
    expect(files.source).toEqual(['src/a.ts', 'src/b.ts']);
  });
});
