/**
 * Tests for the check resolver (`packages/rafa-run/src/suite/checks.ts`): the matchers
 * (full-suite triggers with `bunfig.toml`'s preload files, touched
 * `Owns:` folders, and the unit, contract and integration files), and
 * the ranking `resolveChecks` folds one check-point entry into: the
 * task step's answers over `[affected]` with each `tests=` value, the
 * stage step's over `[related, integration]`, and each of the six names
 * alone and mixed. Pure: nothing is planted on disk.
 */
import type { CheckInput, CheckRun, FullSuiteTriggers } from '@open-tomato/rafa-run/suite/checks';

import { describe, expect, it } from 'bun:test';

import {
  contractFiles,
  integrationFiles,
  resolveChecks,
  touchedFolders,
  triggeredPaths,
  unitFiles,
} from '@open-tomato/rafa-run/suite/checks';

import { templateEntry } from '../../../config/templates.js';

/**
 * The `escalation` template's `tests` lists, which a project adopting it
 * reads; the section's own defaults for them are empty.
 */
const ESCALATION_TESTS = templateEntry('escalation')?.tests;

const PRELOAD = ['test/setup.ts'];

const TRIGGERS: FullSuiteTriggers = {
  globs: ESCALATION_TESTS?.fullSuiteTriggers ?? [],
  preload: PRELOAD,
};

const INTEGRATION = ESCALATION_TESTS?.integration ?? [];

const CONTRACT = ESCALATION_TESTS?.contract ?? [];

const TEST_FILES = [
  'scripts/tool.test.ts',
  'src/a/one.test.ts',
  'src/a/deep/two.test.ts',
  'src/b/three.test.ts',
  'src/board/four.test.ts',
  'src/board/run-cli.test.ts',
  'src/c/port.contract.test.ts',
  'src/tests/flow-integration.test.ts',
  'src/tests/loop-spawned.test.ts',
];

/** The integration tier of {@link TEST_FILES}, sorted. */
const INTEGRATION_FILES = ['src/board/run-cli.test.ts', 'src/tests/flow-integration.test.ts', 'src/tests/loop-spawned.test.ts'];

/** An input with the defaults above and `overrides` over them. */
function input(overrides: Partial<CheckInput>): CheckInput {
  return {
    names: ['affected'],
    declared: null,
    diff: ['src/a/one.ts'],
    owns: ['src/a', 'src/b'],
    testFiles: TEST_FILES,
    preload: PRELOAD,
    fullSuiteTriggers: TRIGGERS.globs,
    contract: CONTRACT,
    integration: INTEGRATION,
    ...overrides,
  };
}

describe('triggeredPaths', () => {
  it('matches the template\'s globs at the root and not below it', () => {
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
  it('matches each spelling of the template in any folder and at the root', () => {
    const files = [...TEST_FILES, 'root.integration.test.ts', 'src/plain.test.ts'];
    expect(integrationFiles(INTEGRATION, files)).toEqual(['root.integration.test.ts', ...INTEGRATION_FILES]);
  });

  it('matches nothing for an empty list', () => {
    expect(integrationFiles([], TEST_FILES)).toEqual([]);
  });
});

describe('contractFiles', () => {
  it('matches the template\'s spelling in any folder and at the root', () => {
    expect(contractFiles(CONTRACT, [...TEST_FILES, 'root.contract.test.ts'])).toEqual(['root.contract.test.ts', 'src/c/port.contract.test.ts']);
  });

  it('matches nothing for an empty list', () => {
    expect(contractFiles([], TEST_FILES)).toEqual([]);
  });
});

describe('unitFiles', () => {
  it('answers every test file neither list matches', () => {
    expect(unitFiles(CONTRACT, INTEGRATION, TEST_FILES)).toEqual([
      'scripts/tool.test.ts',
      'src/a/deep/two.test.ts',
      'src/a/one.test.ts',
      'src/b/three.test.ts',
      'src/board/four.test.ts',
    ]);
  });

  it('answers every test file when both lists are empty', () => {
    expect(unitFiles([], [], TEST_FILES)).toHaveLength(TEST_FILES.length);
  });
});

describe('resolveChecks over a task step\'s [affected]', () => {
  it('runs the affected files with no tests= value or tests=affected', () => {
    expect(resolveChecks(input({}))).toEqual({ kind: 'affected', reason: 'declared' });
    expect(resolveChecks(input({ declared: 'affected' }))).toEqual({ kind: 'affected', reason: 'declared' });
  });

  it('runs the full suite for tests=full, listing any trigger too', () => {
    expect(resolveChecks(input({ declared: 'full', diff: ['bunfig.toml'] }))).toEqual({
      kind: 'full',
      reason: 'declared',
      triggeredBy: ['bunfig.toml'],
    });
  });

  it('runs the full suite when an affected task touches a trigger', () => {
    expect(resolveChecks(input({ diff: ['src/a/one.ts', 'bunfig.toml'] }))).toEqual({
      kind: 'full',
      reason: 'trigger',
      triggeredBy: ['bunfig.toml'],
    });
  });

  it('runs the full suite when a module task touches a preload file', () => {
    const run = resolveChecks(input({ declared: 'module', diff: ['test/setup.ts'] }));
    expect(run).toEqual({ kind: 'full', reason: 'trigger', triggeredBy: ['test/setup.ts'] });
  });

  it('runs the tests of the touched Owns: folders for tests=module', () => {
    const run = resolveChecks(input({ declared: 'module', diff: ['src/a/deep/x.ts', 'README.md'] }));
    expect(run).toEqual({ kind: 'paths', paths: ['src/a/deep/two.test.ts', 'src/a/one.test.ts'], affectedToo: false });
  });

  it('falls back to affected for tests=module when the plan has no Owns: folder', () => {
    const fallback: CheckRun = { kind: 'affected', reason: 'fallback' };
    expect(resolveChecks(input({ declared: 'module', owns: null }))).toEqual(fallback);
    expect(resolveChecks(input({ declared: 'module', owns: [] }))).toEqual(fallback);
    expect(resolveChecks(input({ declared: 'module', owns: ['./'] }))).toEqual(fallback);
  });

  it('keeps tests=full and a trigger full when the plan has no Owns: folder', () => {
    const declared = resolveChecks(input({ declared: 'full', owns: null }));
    expect(declared).toEqual({ kind: 'full', reason: 'declared', triggeredBy: [] });
    const triggered = resolveChecks(input({ declared: 'module', owns: null, diff: ['src/a/one.ts', 'package.json'] }));
    expect(triggered).toEqual({ kind: 'full', reason: 'trigger', triggeredBy: ['package.json'] });
  });

  it('falls back to affected for tests=module when no touched Owns: folder holds a test file', () => {
    const outside = resolveChecks(input({ declared: 'module', diff: ['docs/x.md'] }));
    expect(outside).toEqual({ kind: 'affected', reason: 'no-module-tests' });
    const empty = resolveChecks(input({ declared: 'module', owns: ['src/c'], diff: ['src/c/x.ts'], testFiles: ['src/a/one.test.ts'] }));
    expect(empty).toEqual({ kind: 'affected', reason: 'no-module-tests' });
  });

  it('never reads an affected task\'s Owns:', () => {
    expect(resolveChecks(input({ owns: null }))).toEqual({ kind: 'affected', reason: 'declared' });
  });
});

describe('resolveChecks over a stage step\'s [related, integration]', () => {
  /** A stage input: no `tests=` value, the stage's entry. */
  const stage = (overrides: Partial<CheckInput>): CheckInput => input({ names: ['related', 'integration'], ...overrides });

  it('answers the integration tier beside an affected run when the plan has no Owns: folder', () => {
    const fallback: CheckRun = { kind: 'paths', paths: INTEGRATION_FILES, affectedToo: true };
    expect(resolveChecks(stage({ owns: null }))).toEqual(fallback);
    expect(resolveChecks(stage({ owns: [] }))).toEqual(fallback);
    expect(resolveChecks(stage({ owns: ['./'] }))).toEqual(fallback);
  });

  it('never widens a related fallback for a diff touching a trigger', () => {
    expect(resolveChecks(stage({ names: ['related'], owns: null, diff: ['bunfig.toml'] }))).toEqual({ kind: 'affected', reason: 'fallback' });
  });

  it('runs the touched folder\'s tests and the integration tier, not the other folder\'s', () => {
    const run = resolveChecks(stage({}));
    expect(run).toEqual({
      kind: 'paths',
      paths: ['src/a/deep/two.test.ts', 'src/a/one.test.ts', ...INTEGRATION_FILES],
      affectedToo: false,
    });
    expect(run.kind === 'paths' && run.paths).not.toContain('src/b/three.test.ts');
  });

  it('never runs a sibling folder\'s tests that share the touched folder\'s prefix', () => {
    const run = resolveChecks(stage({ diff: ['src/b/x.ts'], integration: [] }));
    expect(run).toEqual({ kind: 'paths', paths: ['src/b/three.test.ts'], affectedToo: false });
  });

  it('lists a file both under a touched folder and in the tier once', () => {
    const run = resolveChecks(stage({ owns: ['src/board'], diff: ['src/board/x.ts'] }));
    expect(run).toEqual({
      kind: 'paths',
      paths: ['src/board/four.test.ts', ...INTEGRATION_FILES],
      affectedToo: false,
    });
  });

  it('adds nothing for a path outside every Owns: folder, and does not widen for a trigger', () => {
    const run = resolveChecks(stage({ diff: ['scripts/tool.ts', 'bunfig.toml'], integration: [] }));
    expect(run).toEqual({ kind: 'paths', paths: [], affectedToo: false });
  });
});

describe('resolveChecks over one entry', () => {
  it('runs nothing for an empty entry', () => {
    expect(resolveChecks(input({ names: [], diff: ['bunfig.toml'] }))).toEqual({ kind: 'none', reason: 'no-check' });
  });

  it('keeps an empty entry none under tests=full and tests=module', () => {
    expect(resolveChecks(input({ names: [], declared: 'full' }))).toEqual({ kind: 'none', reason: 'no-check' });
    expect(resolveChecks(input({ names: [], declared: 'module' }))).toEqual({ kind: 'none', reason: 'no-check' });
  });

  it('reads [affected] as full under a tests=full line', () => {
    expect(resolveChecks(input({ names: ['affected'], declared: 'full' }))).toEqual({ kind: 'full', reason: 'declared', triggeredBy: [] });
  });

  it('answers affected alone as bun test --changed', () => {
    expect(resolveChecks(input({ names: ['affected'] }))).toEqual({ kind: 'affected', reason: 'declared' });
  });

  it('answers related alone as the touched folders\' files', () => {
    expect(resolveChecks(input({ names: ['related'] }))).toEqual({
      kind: 'paths',
      paths: ['src/a/deep/two.test.ts', 'src/a/one.test.ts'],
      affectedToo: false,
    });
  });

  it('answers related alone as affected, reason fallback, without Owns: folders', () => {
    expect(resolveChecks(input({ names: ['related'], owns: null }))).toEqual({ kind: 'affected', reason: 'fallback' });
  });

  it('answers unit alone as every file neither list matches', () => {
    expect(resolveChecks(input({ names: ['unit'] }))).toEqual({
      kind: 'paths',
      paths: unitFiles(CONTRACT, INTEGRATION, TEST_FILES),
      affectedToo: false,
    });
  });

  it('answers contract alone as the contract files', () => {
    expect(resolveChecks(input({ names: ['contract'] }))).toEqual({ kind: 'paths', paths: ['src/c/port.contract.test.ts'], affectedToo: false });
  });

  it('answers integration alone as the integration files', () => {
    expect(resolveChecks(input({ names: ['integration'] }))).toEqual({ kind: 'paths', paths: INTEGRATION_FILES, affectedToo: false });
  });

  it('answers full alone as one path-less run', () => {
    expect(resolveChecks(input({ names: ['full'] }))).toEqual({ kind: 'full', reason: 'declared', triggeredBy: [] });
  });

  it('lets full swallow every other name', () => {
    const names = ['affected', 'related', 'unit', 'contract', 'integration', 'full'] as const;
    expect(resolveChecks(input({ names, diff: ['src/a/one.ts', 'bunfig.toml'] }))).toEqual({
      kind: 'full',
      reason: 'declared',
      triggeredBy: ['bunfig.toml'],
    });
  });

  it('lists a file both related and integration name once', () => {
    const run = resolveChecks(input({ names: ['related', 'integration'], owns: ['src/board'], diff: ['src/board/run-cli.ts'] }));
    expect(run.kind === 'paths' && run.paths.filter((path) => path === 'src/board/run-cli.test.ts')).toEqual(['src/board/run-cli.test.ts']);
  });

  it('joins related, contract and integration in one sorted list', () => {
    expect(resolveChecks(input({ names: ['integration', 'contract', 'related'] }))).toEqual({
      kind: 'paths',
      paths: [
        'src/a/deep/two.test.ts',
        'src/a/one.test.ts',
        'src/board/run-cli.test.ts',
        'src/c/port.contract.test.ts',
        'src/tests/flow-integration.test.ts',
        'src/tests/loop-spawned.test.ts',
      ],
      affectedToo: false,
    });
  });

  it('marks affected beside a path list as affectedToo', () => {
    expect(resolveChecks(input({ names: ['affected', 'contract'] }))).toEqual({ kind: 'paths', paths: ['src/c/port.contract.test.ts'], affectedToo: true });
  });

  it('widens affected beside a path list to full on a trigger', () => {
    expect(resolveChecks(input({ names: ['affected', 'contract'], diff: ['package.json'] }))).toEqual({
      kind: 'full',
      reason: 'trigger',
      triggeredBy: ['package.json'],
    });
  });

  it('never widens a path list without affected for a trigger', () => {
    expect(resolveChecks(input({ names: ['contract'], diff: ['package.json'] }))).toMatchObject({ kind: 'paths' });
  });

  it('reads affected as related under tests=module and keeps an empty related list for a stage', () => {
    expect(resolveChecks(input({ names: ['affected', 'integration'], declared: 'module' }))).toEqual({
      kind: 'paths',
      paths: ['src/a/deep/two.test.ts', 'src/a/one.test.ts', ...INTEGRATION_FILES],
      affectedToo: false,
    });
    expect(resolveChecks(input({ names: ['related'], diff: ['docs/x.md'] }))).toEqual({ kind: 'paths', paths: [], affectedToo: false });
  });
});
