/**
 * The shipped-file reading of the publish rules, over manifests alone:
 * each `files` entry form and the reading with no `files`. Every case
 * that ships a file sits beside one that does not, so neither reading is
 * of a rule that answers the same for every path. The planted-tree cases
 * that read it through the graph check are in `graph-check.test.ts`.
 */
import { describe, expect, test } from 'bun:test';

import { isShipped, shippedImports } from './publish-rules';

/** Which of `files` ship under `manifest`. */
function shippedOf(manifest: Readonly<Record<string, unknown>>, files: readonly string[]): string[] {
  return files.filter((file) => isShipped(manifest, file));
}

describe('a files list', () => {
  test('an entry naming a file ships that file and no other', () => {
    expect(shippedOf({ files: ['index.ts'] }, ['index.ts', 'src/index.ts', 'index.ts.bak'])).toEqual(['index.ts']);
  });

  test('a folder entry ships everything under it, spelled bare, with a slash or with ./', () => {
    const files = ['src/index.ts', 'src/deep/a.ts', 'srcs/b.ts', 'scripts/dev.ts'];

    for (const entry of ['src', 'src/', './src']) {
      expect(shippedOf({ files: [entry] }, files)).toEqual(['src/index.ts', 'src/deep/a.ts']);
    }
  });

  test('a glob entry ships what it matches, a file or a folder holding it', () => {
    const files = ['a.js', 'src/a.js', 'src/a.ts', 'lib/x/a.ts'];

    expect(shippedOf({ files: ['*.js'] }, files)).toEqual(['a.js']);
    expect(shippedOf({ files: ['src/**/*.ts'] }, files)).toEqual(['src/a.ts']);
    expect(shippedOf({ files: ['lib/*'] }, files)).toEqual(['lib/x/a.ts']);
  });

  test('an empty list ships no code file, and a ! entry excludes nothing', () => {
    expect(shippedOf({ files: [] }, ['src/index.ts'])).toEqual([]);
    expect(shippedOf({ files: ['!src/x.ts'] }, ['src/y.ts'])).toEqual([]);
    expect(shippedOf({ files: ['src', '!src/x.ts'] }, ['src/x.ts'])).toEqual(['src/x.ts']);
  });
});

describe('no files list', () => {
  test('a test file by name or by folder, and a root tool config, do not ship', () => {
    const files = [
      'src/index.test.ts',
      'test/a.ts',
      'src/tests/b.ts',
      'src/__tests__/c.ts',
      'eslint.config.mjs',
      'vite.config.ts',
    ];

    expect(shippedOf({}, files)).toEqual([]);
  });

  test('control: every other code file ships, a tool config below the root and a test-like name included', () => {
    const files = ['index.ts', 'src/index.ts', 'src/config/eslint.config.mjs', 'src/testing.ts', 'src/latest.ts', 'scripts/dev.ts'];

    expect(shippedOf({}, files)).toEqual(files);
    expect(shippedOf({ files: 'src' }, files)).toEqual(files);
  });

  test('shippedImports keeps the shipped files\' entries, in their order', () => {
    const shipped = { file: 'src/a.ts', specifiers: ['@open-tomato/rafa'] };
    const imports = [
      { file: 'eslint.config.mjs', specifiers: ['@open-tomato/rafa-eslint-config'] },
      { file: 'src/a.test.ts', specifiers: ['@open-tomato/rafa-core'] },
      shipped,
    ];

    expect(shippedImports({}, imports)).toEqual([shipped]);
  });
});
