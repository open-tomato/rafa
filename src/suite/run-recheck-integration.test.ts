/**
 * Integration test for `./run.ts` and `./deadline-spawn.ts` together, as
 * `rafa bug recheck` drives them: a real `bun test` over a scratch project,
 * through `runSuite` with no stand-in spawner.
 *
 *   - a two-case file run with `testNamePattern` naming one case reads that
 *     case `passed` and the other `skipped` in `cases`;
 *   - a file whose test sleeps is killed by `createDeadlineSpawner`, with
 *     `timedOut: true`;
 *   - a reference to a file that is not there reads `junit: 'missing'`, with
 *     no case.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { createDeadlineSpawner } from './deadline-spawn.js';
import { runSuite } from './run.js';

/** A deadline short enough to keep the test quick, long enough that a sleeping test is still running. */
const DEADLINE_MS = 3000;

/** How long the sleeping test would sleep, and its own timeout, both past the deadline. */
const SLEEP_MS = 60_000;

describe('runSuite over a scratch project, as a recheck drives it', () => {
  let project: string;
  let junitFile: string;

  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), 'rafa-recheck-'));
    junitFile = join(project, '.out', 'run.junit.xml');
    writeFileSync(
      join(project, 'two.test.ts'),
      [
        'import { expect, test } from \'bun:test\';',
        'test(\'first case\', () => { expect(1).toBe(1); });',
        'test(\'second case\', () => { expect(1).toBe(1); });',
        '',
      ].join('\n'),
    );
    writeFileSync(
      join(project, 'sleepy.test.ts'),
      [
        'import { test } from \'bun:test\';',
        `test('sleeps', async () => { await Bun.sleep(${SLEEP_MS}); }, ${SLEEP_MS * 2});`,
        '',
      ].join('\n'),
    );
  });

  afterEach(() => {
    rmSync(project, { recursive: true, force: true });
  });

  it('reads the case the pattern names passed and the other skipped', async () => {
    const result = await runSuite({
      cwd: project,
      paths: ['two.test.ts'],
      testNamePattern: 'first case',
      junitFile,
    });

    expect(result.exitCode).toBe(0);
    expect(result.junit).toBe('read');
    expect(result.failures).toEqual([]);
    const outcomes = Object.fromEntries((result.cases ?? []).map((c) => [c.name, c.outcome]));
    expect(outcomes).toEqual({ 'first case': 'passed', 'second case': 'skipped' });
  });

  it('kills a test that sleeps past the deadline and reports timedOut', async () => {
    const result = await runSuite({
      cwd: project,
      paths: ['sleepy.test.ts'],
      junitFile,
      spawn: createDeadlineSpawner(DEADLINE_MS),
    });

    expect(result.timedOut).toBe(true);
    expect(result.exitCode).not.toBe(0);
  });

  it('reads junit missing and no case for a file that is not there', async () => {
    const result = await runSuite({
      cwd: project,
      paths: ['gone.test.ts'],
      junitFile,
      spawn: createDeadlineSpawner(DEADLINE_MS),
    });

    expect(result.junit).toBe('missing');
    expect(result.cases).toEqual([]);
    expect(result.timedOut).toBe(false);
  });
});
