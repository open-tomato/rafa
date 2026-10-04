/**
 * Tests for the suite scope (`src/suite/scope.ts`): the ranking of a
 * task step's scope, the test files of a stage step, the full-suite
 * triggers with `bunfig.toml`'s preload files, and the two readers over
 * planted files. Files go under a fresh directory in `tmpdir`, removed
 * after each case.
 */
import type { FullSuiteTriggers, StageScopeInput, TaskScopeInput } from './scope.js';

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { TESTS_DEFAULTS } from '../config-schema-tests.js';

import {
  integrationFiles,
  listTestFiles,
  preloadFilesOf,
  readPreloadFiles,
  stageStepScope,
  taskStepScope,
  touchedFolders,
  triggeredPaths,
} from './scope.js';

const TRIGGERS: FullSuiteTriggers = {
  globs: TESTS_DEFAULTS.testsFullSuiteTriggers,
  preload: ['test/setup.ts'],
};

const TEST_FILES = [
  'scripts/tool.test.ts',
  'src/a/one.test.ts',
  'src/a/deep/two.test.ts',
  'src/b/three.test.ts',
  'src/board/four.test.ts',
  'src/board/run-cli.test.ts',
  'src/tests/flow-integration.test.ts',
  'src/tests/loop-spawned.test.ts',
];

/** A task input with the defaults above and `overrides` over them. */
function task(overrides: Partial<TaskScopeInput>): TaskScopeInput {
  return {
    declared: 'affected',
    diff: ['src/a/one.ts'],
    triggers: TRIGGERS,
    owns: ['src/a', 'src/b'],
    testFiles: TEST_FILES,
    ...overrides,
  };
}

/** A stage input with the defaults above and `overrides` over them. */
function stage(overrides: Partial<StageScopeInput>): StageScopeInput {
  return {
    diff: ['src/a/one.ts'],
    owns: ['src/a', 'src/b'],
    integration: TESTS_DEFAULTS.testsIntegration,
    testFiles: TEST_FILES,
    ...overrides,
  };
}

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

describe('triggeredPaths', () => {
  it('matches the default globs at the root and not below it', () => {
    const diff = ['tsconfig.base.json', 'sub/tsconfig.json', 'bun.lock', 'src/package.json', 'package.json'];
    expect(triggeredPaths(diff, TRIGGERS)).toEqual(['bun.lock', 'package.json', 'tsconfig.base.json']);
  });

  it('matches a preload file as a path, after a leading ./', () => {
    expect(triggeredPaths(['./test/setup.ts', 'test/other.ts'], TRIGGERS)).toEqual(['test/setup.ts']);
  });

  it('reads a preload name holding glob characters as itself', () => {
    const triggers = { globs: [], preload: ['test/set[up].ts'] };
    expect(triggeredPaths(['test/setu.ts', 'test/set[up].ts'], triggers)).toEqual(['test/set[up].ts']);
  });

  it('matches nothing for an empty trigger list', () => {
    expect(triggeredPaths(['bunfig.toml'], { globs: [], preload: [] })).toEqual([]);
  });
});

describe('taskStepScope', () => {
  it('runs the affected files by default', () => {
    expect(taskStepScope(task({}))).toEqual({ scope: 'affected', declared: 'affected', reason: 'declared', triggeredBy: [] });
  });

  it('runs the full suite for tests=full, listing any trigger too', () => {
    expect(taskStepScope(task({ declared: 'full', diff: ['bunfig.toml'] }))).toEqual({
      scope: 'full',
      declared: 'full',
      reason: 'declared',
      triggeredBy: ['bunfig.toml'],
    });
  });

  it('runs the full suite when an affected task touches a trigger', () => {
    expect(taskStepScope(task({ diff: ['src/a/one.ts', 'bunfig.toml'] }))).toEqual({
      scope: 'full',
      declared: 'affected',
      reason: 'trigger',
      triggeredBy: ['bunfig.toml'],
    });
  });

  it('runs the full suite when a module task touches a preload file', () => {
    const scope = taskStepScope(task({ declared: 'module', diff: ['test/setup.ts'] }));
    expect(scope).toMatchObject({ scope: 'full', reason: 'trigger', triggeredBy: ['test/setup.ts'] });
  });

  it('runs the tests of the touched Owns: folders for tests=module', () => {
    const scope = taskStepScope(task({ declared: 'module', diff: ['src/a/deep/x.ts', 'README.md'] }));
    expect(scope).toEqual({
      scope: 'module',
      declared: 'module',
      folders: ['src/a'],
      paths: ['src/a/deep/two.test.ts', 'src/a/one.test.ts'],
      triggeredBy: [],
    });
  });

  it('falls back to affected for tests=module when the plan has no Owns: folder', () => {
    const fallback = { scope: 'affected', declared: 'module', reason: 'fallback', triggeredBy: [] };
    expect(taskStepScope(task({ declared: 'module', owns: null }))).toEqual(fallback);
    expect(taskStepScope(task({ declared: 'module', owns: [] }))).toEqual(fallback);
    expect(taskStepScope(task({ declared: 'module', owns: ['./'] }))).toEqual(fallback);
  });

  it('keeps tests=full and a trigger full when the plan has no Owns: folder', () => {
    const declared = taskStepScope(task({ declared: 'full', owns: null }));
    expect(declared).toEqual({ scope: 'full', declared: 'full', reason: 'declared', triggeredBy: [] });
    const triggered = taskStepScope(task({ declared: 'module', owns: null, diff: ['src/a/one.ts', 'package.json'] }));
    expect(triggered).toEqual({ scope: 'full', declared: 'module', reason: 'trigger', triggeredBy: ['package.json'] });
  });

  it('falls back to affected when no touched Owns: folder holds a test file', () => {
    const outside = taskStepScope(task({ declared: 'module', diff: ['docs/x.md'] }));
    expect(outside).toEqual({ scope: 'affected', declared: 'module', reason: 'no-module-tests', triggeredBy: [] });
    const empty = taskStepScope(task({ declared: 'module', owns: ['src/c'], diff: ['src/c/x.ts'] }));
    expect(empty).toMatchObject({ scope: 'affected', reason: 'no-module-tests' });
  });

  it('never reads an affected task\'s Owns:', () => {
    expect(taskStepScope(task({ owns: null }))).toMatchObject({ scope: 'affected', reason: 'declared' });
  });
});

describe('touchedFolders', () => {
  it('counts a path in the deepest Owns: folder holding it', () => {
    expect(touchedFolders(['src/board/x.ts', 'src/y.ts'], ['src', 'src/board'])).toEqual(['src', 'src/board']);
    expect(touchedFolders(['src/board/x.ts'], ['src', 'src/board'])).toEqual(['src/board']);
  });

  it('never counts a sibling sharing the folder\'s prefix', () => {
    expect(touchedFolders(['src/board/x.ts'], ['src/b'])).toEqual([]);
  });

  it('normalises folders and paths before comparing them', () => {
    expect(touchedFolders(['./src/b/x.ts'], ['./src/b/'])).toEqual(['src/b']);
  });

  it('counts a changed folder path as itself', () => {
    expect(touchedFolders(['src/b'], ['src/b'])).toEqual(['src/b']);
  });
});

describe('integrationFiles', () => {
  it('matches each default spelling in any folder and at the root', () => {
    const files = [...TEST_FILES, 'root.integration.test.ts', 'src/plain.test.ts'];
    expect(integrationFiles(TESTS_DEFAULTS.testsIntegration, files)).toEqual([
      'root.integration.test.ts',
      'src/board/run-cli.test.ts',
      'src/tests/flow-integration.test.ts',
      'src/tests/loop-spawned.test.ts',
    ]);
  });

  it('matches nothing for an empty list', () => {
    expect(integrationFiles([], TEST_FILES)).toEqual([]);
  });
});

describe('stageStepScope', () => {
  it('falls back to affected when the plan has no Owns: folder', () => {
    expect(stageStepScope(stage({ owns: null }))).toEqual({ scope: 'affected', reason: 'fallback' });
    expect(stageStepScope(stage({ owns: [] }))).toEqual({ scope: 'affected', reason: 'fallback' });
    expect(stageStepScope(stage({ owns: ['./'] }))).toEqual({ scope: 'affected', reason: 'fallback' });
  });

  it('falls back to affected without Owns: even for a diff touching a trigger', () => {
    expect(stageStepScope(stage({ owns: null, diff: ['bunfig.toml'] }))).toEqual({ scope: 'affected', reason: 'fallback' });
  });

  it('runs the touched folder\'s tests and the integration tier, not the other folder\'s', () => {
    const scope = stageStepScope(stage({}));
    expect(scope).toEqual({
      scope: 'paths',
      folders: ['src/a'],
      integration: ['src/board/run-cli.test.ts', 'src/tests/flow-integration.test.ts', 'src/tests/loop-spawned.test.ts'],
      paths: [
        'src/a/deep/two.test.ts',
        'src/a/one.test.ts',
        'src/board/run-cli.test.ts',
        'src/tests/flow-integration.test.ts',
        'src/tests/loop-spawned.test.ts',
      ],
    });
    expect(scope.scope === 'paths' && scope.paths).not.toContain('src/b/three.test.ts');
  });

  it('never runs a sibling folder\'s tests that share the touched folder\'s prefix', () => {
    const scope = stageStepScope(stage({ diff: ['src/b/x.ts'], integration: [] }));
    expect(scope).toEqual({ scope: 'paths', folders: ['src/b'], integration: [], paths: ['src/b/three.test.ts'] });
  });

  it('lists a file both under a touched folder and in the tier once', () => {
    const scope = stageStepScope(stage({ owns: ['src/board'], diff: ['src/board/x.ts'] }));
    expect(scope.scope === 'paths' && scope.paths).toEqual([
      'src/board/four.test.ts',
      'src/board/run-cli.test.ts',
      'src/tests/flow-integration.test.ts',
      'src/tests/loop-spawned.test.ts',
    ]);
  });

  it('adds nothing for a path outside every Owns: folder, and does not widen for a trigger', () => {
    const scope = stageStepScope(stage({ diff: ['scripts/tool.ts', 'bunfig.toml'], integration: [] }));
    expect(scope).toEqual({ scope: 'paths', folders: [], integration: [], paths: [] });
  });
});

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
