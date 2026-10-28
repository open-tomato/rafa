/**
 * Tests for the two readers of `packages/rafa-run/src/suite/scope.ts`, over planted files:
 * the preload files `bunfig.toml` names, and the project's test files.
 * The check resolver's cases are in `checks.test.ts`. Files go under a
 * fresh directory in `tmpdir`, removed after each case.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { listTestFiles, preloadFilesOf, readPreloadFiles } from './scope.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'suite-scope-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Writes `text` at `path` under the case's directory, creating its folders. */
function plant(path: string, text = ''): void {
  const full = join(dir, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text, 'utf8');
}

describe('preloadFilesOf', () => {
  it('reads a [test] preload list, repo-relative', () => {
    expect(preloadFilesOf('[test]\npreload = ["./test/setup.ts", "mocks.ts"]\n', '/p')).toEqual(['test/setup.ts', 'mocks.ts']);
  });

  it('reads a [test] preload string', () => {
    expect(preloadFilesOf('[test]\npreload = "./setup.ts"\n', '/p')).toEqual(['setup.ts']);
  });

  it('ignores a top-level preload, which bun test does not run', () => {
    expect(preloadFilesOf('preload = ["./top.ts"]\n', '/p')).toEqual([]);
  });

  it('takes an absolute entry under the root and drops one outside it', () => {
    const text = '[test]\npreload = ["/p/test/a.ts", "/elsewhere/b.ts", "../c.ts", 7]\n';
    expect(preloadFilesOf(text, '/p')).toEqual(['test/a.ts']);
  });

  it('answers none for a [test] table without preload', () => {
    expect(preloadFilesOf('[test]\ntimeout = 5000\n', '/p')).toEqual([]);
  });

  it('throws for text that does not parse', () => {
    // A value-less key: rejected by Bun 1.4.2 and 1.3.14 alike. `[test\n` is
    // not used because 1.3.14 leniently reads it as an empty [test] table.
    expect(() => preloadFilesOf('[test]\npreload = \n', '/p')).toThrow();
  });
});

describe('readPreloadFiles', () => {
  it('reads bunfig.toml at the root', () => {
    plant('bunfig.toml', '[test]\npreload = ["./test/setup.ts"]\n');
    expect(readPreloadFiles(dir)).toEqual({ state: 'read', files: ['test/setup.ts'] });
  });

  it('answers missing with no file', () => {
    expect(readPreloadFiles(dir)).toEqual({ state: 'missing', files: [] });
  });

  it('answers unreadable with the reason, never a throw', () => {
    // Value-less key, rejected on both Bun versions (1.3.14 accepts `[test\n`).
    plant('bunfig.toml', '[test]\npreload = \n');
    const reading = readPreloadFiles(dir);
    expect(reading.state).toBe('unreadable');
    expect(reading.files).toEqual([]);
    expect(reading.state === 'unreadable' && reading.reason.length > 0).toBe(true);
  });
});

describe('listTestFiles', () => {
  it('finds the names bun test runs, outside dot folders and node_modules', () => {
    for (const path of [
      'a.test.ts', 'b_test.ts', 'c.spec.ts', 'd_spec.ts', 'e.test.tsx', 'f.test.js', 'g.test.jsx',
      'h.test.mjs', 'i.test.cjs', 'j.test.mts', 'k.test.cts', 'sub/deep/n.test.ts',
      'testx.ts', 'plain.ts', 'test.ts', '.hidden/l.test.ts', 'node_modules/pkg/m.test.ts',
    ]) plant(path);
    expect(listTestFiles(dir)).toEqual([
      'a.test.ts', 'b_test.ts', 'c.spec.ts', 'd_spec.ts', 'e.test.tsx', 'f.test.js', 'g.test.jsx',
      'h.test.mjs', 'i.test.cjs', 'j.test.mts', 'k.test.cts', 'sub/deep/n.test.ts',
    ]);
  });

  it('does not follow a symbolic link', () => {
    plant('real/a.test.ts');
    symlinkSync(join(dir, 'real'), join(dir, 'linked'));
    expect(listTestFiles(dir)).toEqual(['real/a.test.ts']);
  });

  it('answers none for a project without tests', () => {
    plant('src/a.ts');
    expect(listTestFiles(dir)).toEqual([]);
  });
});
