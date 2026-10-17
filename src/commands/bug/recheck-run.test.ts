import type { RecheckBugOptions, RecheckSuiteRunner } from './recheck-run.js';
import type { RunOutcome } from '../../bugs/recheck-verdict.js';
import type { SuiteResult, SuiteRunOptions } from '../../suite/run.js';

import { describe, expect, test } from 'bun:test';

import { recheckBug, recheckJunitFile } from './recheck-run.js';

const FILE = 'src/a.test.ts';
const CASE = 'a case';

/** What a planted run answers: one of the three outcomes, or a run killed at its deadline. */
type Planted = RunOutcome | 'timedOut';

/** A `SuiteResult` that `runOutcomeOf` reads as `planted`. */
function resultOf(planted: Planted): SuiteResult {
  const base = {
    command: [],
    summary: null,
    failures: [],
    errors: null,
    junit: 'read' as const,
    unhandled: [],
    outputTail: [],
  };
  if (planted === 'timedOut') return { ...base, exitCode: 137, junit: 'missing', timedOut: true };
  if (planted === 'stale') return { ...base, exitCode: 1, junit: 'missing' };
  const outcome = planted === 'passed'
    ? 'passed'
    : 'failed';
  return {
    ...base,
    exitCode: planted === 'passed'
      ? 0
      : 1,
    cases: [{ file: FILE, name: CASE, outcome }],
  };
}

/** A runner answering `planted` in order, and the options of every call. */
function plantedRunner(planted: readonly Planted[]): { readonly run: RecheckSuiteRunner; readonly calls: SuiteRunOptions[] } {
  const calls: SuiteRunOptions[] = [];
  const run: RecheckSuiteRunner = (options) => {
    const next = planted[calls.length];
    calls.push(options);
    if (next === undefined) throw new Error(`planted runner called ${calls.length} times, ${planted.length} planted`);
    return Promise.resolve(resultOf(next));
  };
  return { run, calls };
}

function options(run: RecheckSuiteRunner, overrides: Partial<RecheckBugOptions> = {}): RecheckBugOptions {
  return {
    path: FILE,
    pattern: null,
    checkout: '/repo',
    env: { PATH: '/bin' },
    runs: 3,
    timeoutMs: 1000,
    junitDir: '/tmp/junit',
    runSuite: run,
    ...overrides,
  };
}

describe('recheckBug', () => {
  test('a passing reference runs 1 + runs times and is gone', async () => {
    const { run, calls } = plantedRunner(['passed', 'passed', 'passed', 'passed']);
    expect(await recheckBug(options(run))).toEqual({ verdict: 'gone', runs: 4, failedRuns: null, timedOutRuns: 0 });
    expect(calls).toHaveLength(4);
  });

  test('a first failure stops after one run as reproduces', async () => {
    const { run, calls } = plantedRunner(['failed', 'passed', 'passed', 'passed']);
    expect(await recheckBug(options(run))).toEqual({ verdict: 'reproduces', runs: 1, failedRuns: null, timedOutRuns: 0 });
    expect(calls).toHaveLength(1);
  });

  test('alternate failures after a first pass are flaky with the count', async () => {
    const { run, calls } = plantedRunner(['passed', 'failed', 'passed', 'failed']);
    expect(await recheckBug(options(run))).toEqual({ verdict: 'flaky', runs: 4, failedRuns: 2, timedOutRuns: 0 });
    expect(calls).toHaveLength(4);
  });

  test('a first stale stops after one run as stale', async () => {
    const { run, calls } = plantedRunner(['stale', 'passed', 'passed', 'passed']);
    expect(await recheckBug(options(run))).toEqual({ verdict: 'stale', runs: 1, failedRuns: null, timedOutRuns: 0 });
    expect(calls).toHaveLength(1);
  });

  test('a timed-out first run counts as a failed run', async () => {
    const { run, calls } = plantedRunner(['timedOut', 'passed']);
    expect(await recheckBug(options(run))).toEqual({ verdict: 'reproduces', runs: 1, failedRuns: null, timedOutRuns: 1 });
    expect(calls).toHaveLength(1);
  });

  test('a timed-out later run counts among the failed runs of a flaky bug', async () => {
    const { run } = plantedRunner(['passed', 'passed', 'timedOut', 'passed']);
    expect(await recheckBug(options(run))).toEqual({ verdict: 'flaky', runs: 4, failedRuns: 1, timedOutRuns: 1 });
  });

  test('each run gets a JUnit file of its own under the directory', async () => {
    const { run, calls } = plantedRunner(['passed', 'passed', 'passed']);
    await recheckBug(options(run, { runs: 2 }));
    const files = calls.map((call) => call.junitFile);
    expect(files).toEqual([1, 2, 3].map((index) => recheckJunitFile('/tmp/junit', index)));
    expect(new Set(files).size).toBe(3);
    expect(files.every((file) => file.startsWith('/tmp/junit/'))).toBe(true);
  });

  test('each run is the file in the checkout, the pattern, the environment as handed in and a deadline spawner', async () => {
    const { run, calls } = plantedRunner(['passed', 'passed']);
    const env = { PATH: '/bin', KEPT: 'x' };
    await recheckBug(options(run, { runs: 1, pattern: CASE, env }));
    for (const call of calls) {
      expect(call.cwd).toBe('/repo');
      expect(call.paths).toEqual([FILE]);
      expect(call.testNamePattern).toBe(CASE);
      expect(call.env).toEqual(env);
      expect(typeof call.spawn).toBe('function');
    }
  });

  test('a reference with no pattern hands no testNamePattern', async () => {
    const { run, calls } = plantedRunner(['failed']);
    await recheckBug(options(run));
    expect(calls[0]).not.toHaveProperty('testNamePattern');
  });

  test('runs of 0 runs once', async () => {
    const { run, calls } = plantedRunner(['passed']);
    expect(await recheckBug(options(run, { runs: 0 }))).toEqual({ verdict: 'gone', runs: 1, failedRuns: null, timedOutRuns: 0 });
    expect(calls).toHaveLength(1);
  });

  test('a runs that is no whole number from 0, or a deadline that is not positive, is refused before any run', async () => {
    const { run, calls } = plantedRunner(['passed']);
    await expect(recheckBug(options(run, { runs: -1 }))).rejects.toThrow(RangeError);
    await expect(recheckBug(options(run, { runs: 1.5 }))).rejects.toThrow(RangeError);
    await expect(recheckBug(options(run, { timeoutMs: 0 }))).rejects.toThrow(RangeError);
    expect(calls).toHaveLength(0);
  });
});
