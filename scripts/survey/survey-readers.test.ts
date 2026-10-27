import { join } from 'node:path';

import { describe, expect, it } from 'bun:test';

import { templateEntry } from '../../src/config/templates';

import { readCutMap } from './cut-map';
import { listTrackedFiles } from './files';
import { readMembers } from './package-entries';
import { testKind, type TestKind } from './test-kinds';

/** The repository root, two folders above this file. */
const ROOT = join(import.meta.dir, '..', '..');

/**
 * The eleven test files stream A's stretch 10 added, which the cut table
 * lists nowhere. Since pass 4d eight sit in release's package and three
 * are parked under `src/tests/release-coupled/`, which the cut table
 * reads as core's `src/tests/` folder, `@open-tomato/rafa`; see
 * {@link PARKED_STRETCH_10_RELEASE_TESTS}.
 */
const STRETCH_10_RELEASE_TESTS = [
  'src/tests/release-coupled/commands/release/list.test.ts',
  'src/tests/release-coupled/commands/release/settle-workspace.test.ts',
  'packages/rafa-release/src/commands/release/status-packages.test.ts',
  'packages/rafa-release/src/commands/release/tag-follow-ups.test.ts',
  'packages/rafa-release/src/commands/release/tag-units.test.ts',
  'src/tests/release-coupled/commands/release/tag-workspace.test.ts',
  'packages/rafa-release/src/release/package-base-version.test.ts',
  'packages/rafa-release/src/release/release-move.test.ts',
  'packages/rafa-release/src/release/settle-groups.test.ts',
  'packages/rafa-release/src/release/status-readings.test.ts',
  'packages/rafa-release/src/release/workspace-packages.test.ts',
];

/** The three of {@link STRETCH_10_RELEASE_TESTS} pass 4d parked, placed in core by the `src/tests/` folder. */
const PARKED_STRETCH_10_RELEASE_TESTS: ReadonlySet<string> = new Set([
  'src/tests/release-coupled/commands/release/list.test.ts',
  'src/tests/release-coupled/commands/release/settle-workspace.test.ts',
  'src/tests/release-coupled/commands/release/tag-workspace.test.ts',
]);

describe('the survey readers over the live tree', () => {
  const tracked = listTrackedFiles(ROOT);

  it('leaves no tracked test file in scope unplaced by the cut table', () => {
    const map = readCutMap(ROOT, 'docs/survey/cut-table.json');

    expect(tracked.test.length).toBeGreaterThan(0);
    expect(map.unplaced(tracked.test)).toEqual([]);
  });

  it('places the test files stream A added by their folder and leaves a stray folder unplaced', () => {
    const map = readCutMap(ROOT, 'docs/survey/cut-table.json');
    const stray = 'src/nowhere/new-file.test.ts';

    for (const path of STRETCH_10_RELEASE_TESTS) {
      const unit = PARKED_STRETCH_10_RELEASE_TESTS.has(path)
        ? '@open-tomato/rafa'
        : 'rafa-release';
      expect(map.unitOf(path)).toBe(unit);
    }
    expect(map.unitOf('packages/rafa-inventory/src/schema/new-file.test.ts')).toBe('rafa-inventory');
    expect(map.unitOf(stray)).toBeUndefined();
    expect(map.unplaced([...STRETCH_10_RELEASE_TESTS, stray])).toEqual([stray]);
  });

  it('places a test in a new subfolder by the walk and one by its own directory, and leaves a mixed directory unplaced', () => {
    const map = readCutMap(ROOT, 'docs/survey/cut-table.json');
    const errors = 'src/tests/core-coupled/errors/rafa-codes.test.ts';
    const board = 'src/commands/board/new-file.test.ts';
    // The files of `scripts/survey/cut-names.ts` put `src/commands/`'s own
    // files in four units, and no row names the folder.
    const commands = 'src/commands/new-file.test.ts';
    const nowhere = 'src/nowhere/x.test.ts';

    expect(map.unitOf(errors)).toBe('@open-tomato/rafa');
    expect(map.unitOf(board)).toBe('rafa-board');
    expect(map.unitOf(commands)).toBeUndefined();
    expect(map.unitOf(nowhere)).toBeUndefined();
    expect(map.unplaced([errors, board, commands, nowhere])).toEqual([commands, nowhere]);
  });

  it('classifies the tracked test files, with at least one use-case and one unit test', () => {
    // The escalation template's lists: a checkout holds no .rafa/config.yaml
    // to name it, and the section's own defaults are empty.
    const escalation = templateEntry('escalation')?.tests;
    const globs = { contract: escalation?.contract ?? [], integration: escalation?.integration ?? [] };
    const counts: Record<TestKind, number> = { contract: 0, 'use-case': 0, unit: 0 };
    for (const file of tracked.test) {
      counts[testKind(file, globs)] += 1;
    }

    console.log(`test kinds over ${tracked.test.length} tracked test files:`, JSON.stringify(counts));
    expect(counts['use-case']).toBeGreaterThanOrEqual(1);
    expect(counts.unit).toBeGreaterThanOrEqual(1);
    expect(counts.contract + counts['use-case'] + counts.unit).toBe(tracked.test.length);
  });

  it('lists core with ./store/* among its exports keys and the hub with none', () => {
    const members = readMembers(ROOT);
    const core = members.find((member) => member.name === '@open-tomato/rafa-core');
    const hub = members.find((member) => member.name === '@open-tomato/rafa-hub');

    expect(core?.exports).toContain('./store/*');
    expect(hub).toBeDefined();
    expect(hub?.exports).toEqual([]);
  });
});
