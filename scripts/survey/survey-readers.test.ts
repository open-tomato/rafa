import { join } from 'node:path';

import { describe, expect, it } from 'bun:test';

import { templateEntry } from '../../src/config/templates';

import { readCutMap } from './cut-map';
import { listTrackedFiles } from './files';
import { readMembers } from './package-entries';
import { testKind, type TestKind } from './test-kinds';

/** The repository root, two folders above this file. */
const ROOT = join(import.meta.dir, '..', '..');

/** The eleven test files stream A's stretch 10 added, which the cut table lists nowhere. */
const STRETCH_10_RELEASE_TESTS = [
  'src/commands/release/list.test.ts',
  'src/commands/release/settle-workspace.test.ts',
  'src/commands/release/status-packages.test.ts',
  'src/commands/release/tag-follow-ups.test.ts',
  'src/commands/release/tag-units.test.ts',
  'src/commands/release/tag-workspace.test.ts',
  'src/release/package-base-version.test.ts',
  'src/release/release-move.test.ts',
  'src/release/settle-groups.test.ts',
  'src/release/status-readings.test.ts',
  'src/release/workspace-packages.test.ts',
];

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
      expect(map.unitOf(path)).toBe('rafa-release');
    }
    expect(map.unitOf('src/schema/new-file.test.ts')).toBe('rafa-inventory');
    expect(map.unitOf(stray)).toBeUndefined();
    expect(map.unplaced([...STRETCH_10_RELEASE_TESTS, stray])).toEqual([stray]);
  });

  it('places a test in a new subfolder by the walk and a mixed subtree by its own directory', () => {
    const map = readCutMap(ROOT, 'docs/survey/cut-table.json');
    const errors = 'src/tests/core-coupled/errors/rafa-codes.test.ts';
    const commands = 'src/commands/new-file.test.ts';
    const nowhere = 'src/nowhere/x.test.ts';

    expect(map.unitOf(errors)).toBe('@open-tomato/rafa');
    expect(map.unitOf(commands)).toBe('@open-tomato/rafa');
    expect(map.unitOf(nowhere)).toBeUndefined();
    expect(map.unplaced([errors, commands, nowhere])).toEqual([nowhere]);
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
