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

/** The first line of the message Bun writes for a failing `toBe`, where it writes one. */
const TO_BE_MESSAGE = 'expect(received).toBe(expected)';

/**
 * The version of the `bun` the suite spawns: the first on `PATH`, which
 * need not be the Bun running this file (a pinned Bun run by path, with
 * another on `PATH`, spawns that other).
 */
const SPAWNED_BUN_VERSION = Bun.spawnSync(['bun', '--version']).stdout.toString().trim();

/**
 * Whether Bun's JUnit `<failure>` carries a `message` attribute. Measured:
 * Bun 1.4.2 writes it, Bun 1.3.14 writes none, so the run's failure has no
 * `message` there. Rafa's own reading is the same on both: file and case,
 * plus the message when the report had one.
 */
const JUNIT_HAS_FAILURE_MESSAGE = Bun.semver.order(SPAWNED_BUN_VERSION, '1.4.0') >= 0;

/** `fail.test.ts`'s failure `name`, as the run reads it. */
function failed(name: string) {
  return JUNIT_HAS_FAILURE_MESSAGE
    ? { file: 'fail.test.ts', name, message: TO_BE_MESSAGE }
    : { file: 'fail.test.ts', name };
}

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
      // Rafa's parsed reading: a summary was found, with no error outside a test.
      expect(baselineResult.summary).not.toBeNull();
      expect(baselineResult.errors).toBe(0);
      expect(baselineResult.junit).toBe('read');
      expect(baselineResult.failures).toEqual([failed('breaks')]);

      const baseline = baselineOf(baselineResult, new Date('2026-09-30T00:00:00.000Z'), 'abc123');
      expect(baseline.failures).toEqual([failed('breaks')]);

      // A second, unchanged run against the recorded baseline: everything is known.
      const sameJunitFile = join(dir, '.rafa', 'runs', 'same.junit.xml');
      const sameResult = await runSuite({ cwd: dir, junitFile: sameJunitFile });
      const sameSplit = splitFailures(sameResult.failures, baseline);
      expect(sameSplit).toEqual({ fresh: [], known: [failed('breaks')] });

      // A new failing test alongside the known one: the split tells them apart.
      writeProject(dir, 2);
      const laterJunitFile = join(dir, '.rafa', 'runs', 'later.junit.xml');
      const laterResult = await runSuite({ cwd: dir, junitFile: laterJunitFile });

      expect(laterResult.exitCode).toBe(1);
      expect(laterResult.summary).not.toBeNull();
      expect(laterResult.errors).toBe(0);
      expect(laterResult.failures).toEqual([failed('breaks'), failed('also breaks')]);

      const split = splitFailures(laterResult.failures, baseline);
      expect(split).toEqual({
        fresh: [failed('also breaks')],
        known: [failed('breaks')],
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
