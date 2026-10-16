import { join } from 'node:path';

import { describe, expect, it } from 'bun:test';

import { readCutMap } from './cut-map';
import { listTrackedFiles } from './files';
import { readMembers } from './package-entries';
import { readTestKindGlobs, testKind, type TestKind } from './test-kinds';

/** The repository root, two folders above this file. */
const ROOT = join(import.meta.dir, '..', '..');

describe('the survey readers over the live tree', () => {
  const tracked = listTrackedFiles(ROOT);

  it('leaves no tracked test file in scope unplaced by the cut table', () => {
    const map = readCutMap(ROOT, 'docs/survey/cut-table.json');

    expect(tracked.test.length).toBeGreaterThan(0);
    expect(map.unplaced(tracked.test)).toEqual([]);
  });

  it('classifies the tracked test files, with at least one use-case and one unit test', () => {
    const globs = readTestKindGlobs(ROOT);
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
