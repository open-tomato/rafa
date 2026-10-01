/**
 * Integration test for `./run.ts` and `./baseline.ts` together: a real
 * `bun test` over a scratch project holding one passing and one failing
 * test file, read through `runSuite`'s default spawner (no stand-in), then
 * split against a recorded baseline through `splitFailures`.
 *
 * Every other test of these two modules runs through a stand-in spawner
 * planting a recorded JUnit fixture; this is the one case that spawns the
 * real `bun test` end to end, so a change to the argv, the JUnit reporter,
 * or the summary line's shape is caught here even if a fixture goes stale.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'bun:test';

import { baselineOf, splitFailures } from './baseline.js';
import { runSuite } from './run.js';

const PASSING_TEST = [
  'import { expect, test } from \'bun:test\';',
  '',
  'test(\'adds\', () => {',
  '  expect(1 + 1).toBe(2);',
  '});',
  '',
].join('\n');

/** `fail.test.ts` holding one failing test, and a second when `withSecond`. */
function failingTest(withSecond: boolean): string {
  const lines = [
    'import { expect, test } from \'bun:test\';',
    '',
    'test(\'breaks\', () => {',
    '  expect(1 + 1).toBe(3);',
    '});',
  ];
  if (withSecond) {
    lines.push(
      '',
      'test(\'also breaks\', () => {',
      '  expect(2 + 2).toBe(5);',
      '});',
    );
  }
  lines.push('');
  return lines.join('\n');
}

/** A scratch bun project at `dir` with a pass, and a fail with `failureCount` failing tests. */
function writeProject(dir: string, failureCount: 1 | 2): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'pass.test.ts'), PASSING_TEST);
  writeFileSync(join(dir, 'fail.test.ts'), failingTest(failureCount === 2));
}

describe('runSuite and baseline over a real bun test', () => {
  it('exits red with the summary line and failures a later baseline split tells apart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rafa-suite-integration-'));
    try {
      writeProject(dir, 1);
      const junitFile = join(dir, '.rafa', 'runs', 'baseline.junit.xml');
      const baselineResult = await runSuite({ cwd: dir, junitFile });

      expect(baselineResult.exitCode).toBe(1);
      expect(baselineResult.summary).toMatch(/^Ran 2 tests across 2 files\./);
      expect(baselineResult.junit).toBe('read');
      expect(baselineResult.failures).toEqual([{ file: 'fail.test.ts', name: 'breaks' }]);

      const baseline = baselineOf(baselineResult, new Date('2026-09-30T00:00:00.000Z'), 'abc123');

      // A second, unchanged run against the recorded baseline: everything is known.
      const sameJunitFile = join(dir, '.rafa', 'runs', 'same.junit.xml');
      const sameResult = await runSuite({ cwd: dir, junitFile: sameJunitFile });
      const sameSplit = splitFailures(sameResult.failures, baseline);
      expect(sameSplit).toEqual({ fresh: [], known: [{ file: 'fail.test.ts', name: 'breaks' }] });

      // A new failing test alongside the known one: the split tells them apart.
      writeProject(dir, 2);
      const laterJunitFile = join(dir, '.rafa', 'runs', 'later.junit.xml');
      const laterResult = await runSuite({ cwd: dir, junitFile: laterJunitFile });

      expect(laterResult.exitCode).toBe(1);
      expect(laterResult.summary).toMatch(/^Ran 3 tests across 2 files\./);
      expect(laterResult.failures).toEqual([
        { file: 'fail.test.ts', name: 'breaks' },
        { file: 'fail.test.ts', name: 'also breaks' },
      ]);

      const split = splitFailures(laterResult.failures, baseline);
      expect(split).toEqual({
        fresh: [{ file: 'fail.test.ts', name: 'also breaks' }],
        known: [{ file: 'fail.test.ts', name: 'breaks' }],
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
