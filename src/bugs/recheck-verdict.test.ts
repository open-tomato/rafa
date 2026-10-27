import type { JudgedReference, RunOutcome } from './recheck-verdict.js';
import type { JunitCase, SuiteResult } from '@open-tomato/rafa/suite/run';

import { describe, expect, it } from 'bun:test';

import { runOutcomeOf, verdictOf } from './recheck-verdict.js';

/** The file every reference below names. */
const FILE = 'src/x/x.test.ts';

/** A reference to {@link FILE} with `pattern`. */
function reference(pattern: string | null, file = FILE): JudgedReference {
  return { file, pattern };
}

/** A case of `file` named `name` with `outcome`. */
function testCase(name: string, outcome: JunitCase['outcome'], file = FILE): JunitCase {
  return { file, name, outcome };
}

/** A clean run's result, with `overrides` laid over it. */
function result(overrides: Partial<SuiteResult> = {}): SuiteResult {
  return {
    command: ['bun', 'test', `./${FILE}`],
    exitCode: 0,
    summary: 'Ran 1 test across 1 file. [5.00ms]',
    failures: [],
    errors: 0,
    junit: 'read',
    unhandled: [],
    outputTail: [],
    fileOrder: [[FILE]],
    cases: [],
    ...overrides,
  };
}

describe('runOutcomeOf', () => {
  it('reads a run killed at its deadline as failed, whatever its cases say', () => {
    const run = result({ timedOut: true, exitCode: 143, junit: 'missing', cases: [] });

    expect(runOutcomeOf(run, reference('a case'))).toBe('failed');
    expect(runOutcomeOf({ ...run, timedOut: false }, reference('a case'))).toBe('stale');
  });

  it('reads a matched case that failed as failed', () => {
    const run = result({
      exitCode: 1,
      cases: [testCase('a case', 'failed'), testCase('other case', 'skipped')],
    });

    expect(runOutcomeOf(run, reference('a case'))).toBe('failed');
  });

  it('reads a matched case that passed as passed, the skipped ones left out', () => {
    const run = result({ cases: [testCase('a case', 'passed'), testCase('other case', 'skipped')] });

    expect(runOutcomeOf(run, reference('a case'))).toBe('passed');
  });

  it('reads an empty matched set as stale', () => {
    const run = result({ cases: [testCase('a case', 'skipped'), testCase('other case', 'skipped')] });

    expect(runOutcomeOf(run, reference('a renamed case'))).toBe('stale');
  });

  it('reads a file-level run with one failure among passes as failed', () => {
    const run = result({
      exitCode: 1,
      cases: [testCase('one', 'passed'), testCase('two', 'failed'), testCase('three', 'passed')],
    });

    expect(runOutcomeOf(run, reference(null))).toBe('failed');
  });

  it('reads a file-level run whose cases all passed as passed', () => {
    const run = result({ cases: [testCase('one', 'passed'), testCase('two', 'passed')] });

    expect(runOutcomeOf(run, reference(null))).toBe('passed');
  });

  it('judges only the referenced file, read with or without a leading ./', () => {
    const run = result({
      exitCode: 1,
      cases: [testCase('one', 'passed'), testCase('one', 'failed', 'src/y/y.test.ts')],
    });

    expect(runOutcomeOf(run, reference(null, `./${FILE}`))).toBe('stale');
    expect(runOutcomeOf({ ...run, exitCode: 0 }, reference(null, `./${FILE}`))).toBe('passed');
  });

  it('reads a run whose cases name no testcase of the file as stale', () => {
    const run = result({ cases: [testCase('one', 'passed', 'src/y/y.test.ts')] });

    expect(runOutcomeOf(run, reference(null))).toBe('stale');
  });

  it('reads a missing JUnit file and a run with no test file as stale', () => {
    expect(runOutcomeOf(result({ junit: 'missing', cases: [] }), reference(null))).toBe('stale');
    const none = result({ exitCode: 1, noTestFiles: true, cases: [testCase('one', 'passed')] });
    expect(runOutcomeOf(none, reference(null))).toBe('stale');
  });

  it('reads a nonzero exit with an unhandled block naming the file as failed', () => {
    const run = result({
      exitCode: 1,
      errors: 1,
      unhandled: [{ file: FILE, firstLine: 'error: boom' }],
    });

    expect(runOutcomeOf(run, reference(null))).toBe('failed');
    expect(runOutcomeOf(run, reference('a case'))).toBe('failed');
  });

  it('reads a nonzero exit with nothing judged as stale', () => {
    const elsewhere = result({
      exitCode: 1,
      unhandled: [{ file: 'src/y/y.test.ts', firstLine: 'error: boom' }, { file: null, firstLine: null }],
      cases: [testCase('a case', 'passed')],
    });

    expect(runOutcomeOf(elsewhere, reference('a case'))).toBe('stale');
    expect(runOutcomeOf(result({ exitCode: 1 }), reference(null))).toBe('stale');
  });
});

describe('verdictOf', () => {
  it.each<[readonly RunOutcome[], ReturnType<typeof verdictOf>]>([
    [['failed'], { verdict: 'reproduces' }],
    [['failed', 'passed', 'stale'], { verdict: 'reproduces' }],
    [['passed', 'passed', 'passed', 'passed', 'passed', 'passed'], { verdict: 'gone' }],
    [['passed'], { verdict: 'gone' }],
    [['passed', 'failed', 'passed', 'failed', 'passed', 'failed'], { verdict: 'flaky', failedRuns: 3 }],
    [['passed', 'passed', 'failed'], { verdict: 'flaky', failedRuns: 1 }],
    [['passed', 'passed', 'stale'], { verdict: 'stale' }],
    [['passed', 'failed', 'stale'], { verdict: 'stale' }],
    [['stale', 'failed'], { verdict: 'stale' }],
    [[], { verdict: 'stale' }],
  ])('reads %p as %p', (outcomes, expected) => {
    expect(verdictOf(outcomes)).toEqual(expected);
  });
});
