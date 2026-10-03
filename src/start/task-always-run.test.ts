/**
 * The `tests.alwaysRun` reader and the fold of `start/task-always-run.ts`,
 * over a scripted git and handmade suite results. Nothing here spawns
 * git or `bun test`; the step's own use of both is covered through its
 * seams in `suite-step.test.ts`.
 */
import type { GitResult, GitRunner } from '../pr/index.js';
import type { SuiteFailure, SuiteResult } from '../suite/run.js';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '../adapters/output/active.js';
import { sinkOutput } from '../tests/output-sinks.js';

import { FOLDED_COMMAND_JOINER, foldResults, readTaskAlwaysRun, withAlwaysRun } from './task-always-run.js';

const STOP = 130;
const SWEEP = 'src/tests/one.sweep.test.ts';
const TRACKED = ['src/a.ts', 'src/a.test.ts', SWEEP, 'packages/x/b.sweep.test.ts'];
const FAILED: SuiteFailure = { file: 'src/a.test.ts', name: 'a > broke' };
const SWEPT: SuiteFailure = { file: SWEEP, name: 'sweep > found a leak' };

let warnings: string[];

beforeEach(() => {
  warnings = [];
  setActiveOutput(sinkOutput({ warn: (message) => warnings.push(message) }));
});

afterEach(() => {
  setActiveOutput(null);
});

/** A git answering `ls-files -z` with `answer`, recording each call. */
function lsFiles(answer: GitResult, calls: string[] = []): GitRunner {
  return (args) => {
    calls.push(args.join(' '));
    return args.join(' ') === 'ls-files -z'
      ? answer
      : { ok: false, stdout: '', stderr: 'unscripted' };
  };
}

/** `paths` as `git ls-files -z` prints them. */
function tracked(paths: readonly string[]): GitResult {
  return { ok: true, stdout: paths.map((path) => `${path}\0`).join(''), stderr: '' };
}

/** A green result over `command`, unless told otherwise. */
function result(command: string, overrides: Partial<SuiteResult> = {}): SuiteResult {
  return {
    command: ['bun', 'test', command],
    exitCode: 0,
    summary: `Ran 1 test across 1 file. [${command}]`,
    failures: [],
    errors: 0,
    junit: 'read',
    ...overrides,
  };
}

describe('readTaskAlwaysRun', () => {
  it('answers the tracked files the default glob matches, and none of the others', () => {
    expect(readTaskAlwaysRun(lsFiles(tracked(TRACKED)), ['src/**/*.sweep.test.ts'])).toEqual([SWEEP]);
  });

  it('answers none for [] without asking git', () => {
    const calls: string[] = [];
    expect(readTaskAlwaysRun(lsFiles(tracked(TRACKED), calls), [])).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('answers none, saying nothing, for a glob matching no tracked file', () => {
    // Control: the same git answers a file for a glob that matches one.
    expect(readTaskAlwaysRun(lsFiles(tracked(TRACKED)), ['src/tests/*.sweep.test.ts'])).toEqual([SWEEP]);
    expect(readTaskAlwaysRun(lsFiles(tracked(TRACKED)), ['e2e/*.sweep.test.ts'])).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('answers none, with a warning naming the task step, when git does not answer', () => {
    const files = readTaskAlwaysRun(lsFiles({ ok: false, stdout: '', stderr: 'not a git repository' }), ['src/**/*.sweep.test.ts']);
    expect(files).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('not a git repository');
    expect(warnings[0]).toContain('the task step runs no tests.alwaysRun file');
  });
});

describe('withAlwaysRun', () => {
  it('appends each added path the list does not hold, comparing them as bun test reads them', () => {
    expect(withAlwaysRun(['src/b/b.test.ts', `./${SWEEP}`], [SWEEP, 'src/two.sweep.test.ts'])).toEqual([
      'src/b/b.test.ts',
      `./${SWEEP}`,
      'src/two.sweep.test.ts',
    ]);
  });

  it('answers the list as it was for no added path', () => {
    expect(withAlwaysRun(['src/b/b.test.ts'], [])).toEqual(['src/b/b.test.ts']);
  });
});

describe('foldResults', () => {
  it('holds both commands, both summaries, and the failures and errors of both', () => {
    const folded = foldResults(
      result('changed', { exitCode: 1, failures: [FAILED], errors: 1 }),
      result('sweep', { exitCode: 1, failures: [SWEPT], errors: 2 }),
      STOP,
    );
    expect(folded.command).toEqual(['bun', 'test', 'changed', FOLDED_COMMAND_JOINER, 'bun', 'test', 'sweep']);
    expect(folded.summary).toBe('Ran 1 test across 1 file. [changed] ; Ran 1 test across 1 file. [sweep]');
    expect(folded.failures).toEqual([FAILED, SWEPT]);
    expect(folded.errors).toBe(3);
    expect(folded.exitCode).toBe(1);
  });

  it('holds a failure both runs name once: a changed sweep runs in both', () => {
    const folded = foldResults(result('changed', { exitCode: 1, failures: [SWEPT] }), result('sweep', { exitCode: 1, failures: [SWEPT] }), STOP);
    expect(folded.failures).toEqual([SWEPT]);
  });

  it('answers the second run\'s nonzero exit when the first is green, and 0 when both are', () => {
    expect(foldResults(result('changed'), result('sweep', { exitCode: 1, failures: [SWEPT] }), STOP).exitCode).toBe(1);
    expect(foldResults(result('changed'), result('sweep'), STOP).exitCode).toBe(0);
  });

  it('answers the stop code when either run ended on it', () => {
    expect(foldResults(result('changed', { exitCode: 1 }), result('sweep', { exitCode: STOP, summary: null }), STOP).exitCode).toBe(STOP);
    expect(foldResults(result('changed', { exitCode: STOP, summary: null }), result('sweep'), STOP).exitCode).toBe(STOP);
  });

  it('drops the summary and answers that run\'s exit when a run exited nonzero with no summary line', () => {
    const folded = foldResults(result('changed', { exitCode: 1 }), result('sweep', { exitCode: 2, summary: null, errors: null, junit: 'missing' }), STOP);
    expect(folded.summary).toBeNull();
    expect(folded.exitCode).toBe(2);
    expect(folded.errors).toBe(0);
  });

  it('keeps a summary beside a run that found no test file, which is no unreported run', () => {
    const empty = result('changed', { exitCode: 1, summary: null, errors: null, junit: 'missing', noTestFiles: true });
    const folded = foldResults(empty, result('sweep'), STOP);
    expect(folded.summary).toBe('Ran 1 test across 1 file. [sweep]');
    expect(folded.noTestFiles).toBeUndefined();
    expect(foldResults(empty, empty, STOP).noTestFiles).toBe(true);
  });

  it('reads the JUnit files as unreadable when either was, else read when either was', () => {
    const missing = result('changed', { junit: 'missing' });
    expect(foldResults(missing, result('sweep'), STOP).junit).toBe('read');
    expect(foldResults(missing, missing, STOP).junit).toBe('missing');
    expect(foldResults(result('changed'), result('sweep', { junit: 'unreadable' }), STOP).junit).toBe('unreadable');
  });

  it('answers null errors only when neither run printed a summary to read them from', () => {
    const silent = { summary: null, errors: null, exitCode: STOP };
    expect(foldResults(result('changed', silent), result('sweep', silent), STOP).errors).toBeNull();
  });
});
