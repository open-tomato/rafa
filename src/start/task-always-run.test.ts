/**
 * The `tests.alwaysRun` reader and the fold of `start/task-always-run.ts`,
 * over a scripted git and handmade suite results. Nothing here spawns
 * git or `bun test`; the step's own use of both is covered through its
 * seams in `suite-step.test.ts`.
 */
import type { GitResult, GitRunner } from '../pr/index.js';
import type { SuiteFailure, SuiteResult } from '../suite/run.js';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '../core/output/index.js';
import { sinkOutput } from '../tests/output-sinks.js';

import { failedOutsideAnyCase } from './suite-outside-case.js';
import { FOLDED_COMMAND_JOINER, foldResults, readTaskAlwaysRun, withAlwaysRun } from './task-always-run.js';

const STOP = 130;
const SWEEP = 'src/tests/one.sweep.test.ts';
const TRACKED = ['src/a.ts', 'src/a.test.ts', SWEEP, 'packages/x/b.sweep.test.ts'];
const FAILED: SuiteFailure = { file: 'src/a.test.ts', name: 'a > broke' };
const SWEPT: SuiteFailure = { file: SWEEP, name: 'sweep > found a leak' };
/** What a run Bun found no test file for holds beside its command: exit code 1, no summary line, the mark. */
const MARKED: Partial<SuiteResult> = { exitCode: 1, summary: null, errors: null, junit: 'missing', noTestFiles: true };

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
    unhandled: [],
    outputTail: [],
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

  it('names the stage step in that warning when the stage step\'s fallback reads them', () => {
    const files = readTaskAlwaysRun(lsFiles({ ok: false, stdout: '', stderr: 'not a git repository' }), ['src/**/*.sweep.test.ts'], 'stage');
    expect(files).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('the stage step runs no tests.alwaysRun file');
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
  it('holds the errors outside any test of both runs, the first run\'s first', () => {
    const thrown = { file: 'src/a.test.ts', firstLine: 'error: boom' };
    const swept = { file: 'src/x.sweep.test.ts', firstLine: null };
    const folded = foldResults(result('changed', { unhandled: [thrown] }), result('sweep', { unhandled: [swept] }), STOP);
    expect(folded.unhandled).toEqual([thrown, swept]);
  });

  it('holds the output tail of both runs, the first run\'s first, and none when neither held one', () => {
    const folded = foldResults(result('changed', { outputTail: ['error: boom', ' 1 fail'] }), result('sweep', { outputTail: [' 1 pass'] }), STOP);
    expect(folded.outputTail).toEqual(['error: boom', ' 1 fail', ' 1 pass']);
    expect(foldResults(result('changed'), result('sweep'), STOP).outputTail).toEqual([]);
  });

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

  it('keeps each run\'s file order as its own list, the first run\'s first, and an empty one for a run that holds none', () => {
    const folded = foldResults(result('changed', { fileOrder: [['src/a.test.ts', 'src/b.test.ts']] }), result('sweep', { fileOrder: [['src/x.sweep.test.ts']] }), STOP);
    expect(folded.fileOrder).toEqual([['src/a.test.ts', 'src/b.test.ts'], ['src/x.sweep.test.ts']]);
    // A result built by no run holds no order: its place is kept, so the second run's list stays the second.
    expect(foldResults(result('changed'), result('sweep', { fileOrder: [['src/x.sweep.test.ts']] }), STOP).fileOrder).toEqual([[], ['src/x.sweep.test.ts']]);
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
    const empty = result('changed', MARKED);
    const folded = foldResults(empty, result('sweep'), STOP);
    expect(folded.summary).toBe('Ran 1 test across 1 file. [sweep]');
    expect(folded.exitCode).toBe(0);
    expect(folded.noTestFiles).toBeUndefined();
    expect(foldResults(empty, empty, STOP).noTestFiles).toBe(true);
  });

  it('reads the JUnit files as unreadable when either was, else read when either was', () => {
    const missing = result('changed', { junit: 'missing' });
    expect(foldResults(missing, result('sweep'), STOP).junit).toBe('read');
    expect(foldResults(missing, missing, STOP).junit).toBe('missing');
    expect(foldResults(result('changed'), result('sweep', { junit: 'unreadable' }), STOP).junit).toBe('unreadable');
  });

  describe('a run marked noTestFiles', () => {
    it('reads a marked run beside a passing one as no failure outside any test case (#1054)', () => {
      const folded = foldResults(result('changed', { exitCode: 1, noTestFiles: true }), result('sweep'), STOP);
      // Control: the marked run's exit code, were it the folded one with no mark, is what the reading is true for.
      expect(failedOutsideAnyCase({ exitCode: 1, failures: folded.failures, noTestFiles: folded.noTestFiles })).toBe(true);
      expect(failedOutsideAnyCase(folded)).toBe(false);
    });

    it('folds marked with passing to green: exit code 0, the second\'s summary, no mark', () => {
      const folded = foldResults(result('changed', MARKED), result('sweep'), STOP);
      expect(folded.exitCode).toBe(0);
      expect(folded.summary).toBe('Ran 1 test across 1 file. [sweep]');
      expect(folded.failures).toEqual([]);
      expect(folded.noTestFiles).toBeUndefined();
    });

    it('folds passing with marked to green: exit code 0, the first\'s summary, no mark', () => {
      const folded = foldResults(result('changed'), result('sweep', MARKED), STOP);
      expect(folded.exitCode).toBe(0);
      expect(folded.summary).toBe('Ran 1 test across 1 file. [changed]');
      expect(folded.failures).toEqual([]);
      expect(folded.noTestFiles).toBeUndefined();
      expect(failedOutsideAnyCase(folded)).toBe(false);
    });

    it('folds marked with a run listing a failure to red on the second: its exit code and failures, no mark', () => {
      const folded = foldResults(result('changed', MARKED), result('sweep', { exitCode: 3, failures: [SWEPT], errors: 1 }), STOP);
      expect(folded.exitCode).toBe(3);
      expect(folded.failures).toEqual([SWEPT]);
      expect(folded.summary).toBe('Ran 1 test across 1 file. [sweep]');
      expect(folded.noTestFiles).toBeUndefined();
      expect(failedOutsideAnyCase(folded)).toBe(false);
    });

    it('folds marked with a run exiting nonzero with no failure to that run\'s exit code, read as outside any case', () => {
      const folded = foldResults(result('changed', MARKED), result('sweep', { exitCode: 3, errors: 2 }), STOP);
      expect(folded.exitCode).toBe(3);
      expect(folded.failures).toEqual([]);
      expect(folded.noTestFiles).toBeUndefined();
      expect(failedOutsideAnyCase(folded)).toBe(true);
    });

    it('keeps the exit code of an unmarked run with no summary line beside a marked one, with the summary dropped', () => {
      const silent = result('sweep', { exitCode: 2, summary: null, errors: null, junit: 'missing' });
      const folded = foldResults(result('changed', MARKED), silent, STOP);
      expect(folded.exitCode).toBe(2);
      expect(folded.summary).toBeNull();
      expect(folded.noTestFiles).toBeUndefined();
    });

    it('folds both marked to marked, on the first run\'s exit code as before', () => {
      const folded = foldResults(result('changed', MARKED), result('sweep', { ...MARKED, exitCode: 4 }), STOP);
      expect(folded.noTestFiles).toBe(true);
      expect(folded.exitCode).toBe(1);
      expect(folded.summary).toBeNull();
      expect(failedOutsideAnyCase(folded)).toBe(false);
    });

    it('answers the stop code for a marked run beside a stop, on either side', () => {
      const stopped = { exitCode: STOP, summary: null, errors: null };
      // Control: beside a passing run the same marked run folds to 0, so the stop code is the stop's.
      expect(foldResults(result('changed', MARKED), result('sweep'), STOP).exitCode).toBe(0);
      expect(foldResults(result('changed', MARKED), result('sweep', stopped), STOP).exitCode).toBe(STOP);
      expect(foldResults(result('changed', stopped), result('sweep', MARKED), STOP).exitCode).toBe(STOP);
      expect(foldResults(result('changed', { ...MARKED, exitCode: STOP }), result('sweep'), STOP).exitCode).toBe(STOP);
    });

    it('keeps the marked run\'s place in the command, the output tail and the file order', () => {
      const line = 'error: 0 test files matching **{.test,.spec}.ts';
      const folded = foldResults(result('changed', { ...MARKED, outputTail: [line], fileOrder: [[]] }), result('sweep', { outputTail: [' 1 pass'], fileOrder: [[SWEEP]] }), STOP);
      expect(folded.command).toEqual(['bun', 'test', 'changed', FOLDED_COMMAND_JOINER, 'bun', 'test', 'sweep']);
      expect(folded.outputTail).toEqual([line, ' 1 pass']);
      expect(folded.fileOrder).toEqual([[], [SWEEP]]);
    });
  });

  it('answers null errors only when neither run printed a summary to read them from', () => {
    const silent = { summary: null, errors: null, exitCode: STOP };
    expect(foldResults(result('changed', silent), result('sweep', silent), STOP).errors).toBeNull();
  });
});
