/**
 * The failed-case reader over captured `gh run view <id> --log-failed`
 * text. The two files under `./testdata/` are excerpts, line for line,
 * of captures `gh` 2.102.0 wrote on 2026-10-07:
 *
 *   - `three-cases.log-failed.txt`, from run 37190089292: three failed
 *     cases in one file group, and bun's closing list repeating them.
 *     Its first line, which opened with a BOM, is left out because the
 *     pre-commit control-byte gate refuses the byte; the BOM case below
 *     writes it as an escape instead.
 *   - `summary-repeat.log-failed.txt`, from run 37565187144: one failed
 *     case, a later file whose `(pass)` case names hold `(fail)`, and
 *     the closing list.
 */
import { describe, expect, it } from 'bun:test';

import { readFailedCases, TEST_FILE_HEADER } from './failed-cases.js';

const THREE_CASES = await Bun.file(new URL('./testdata/three-cases.log-failed.txt', import.meta.url)).text();
const SUMMARY_REPEAT = await Bun.file(new URL('./testdata/summary-repeat.log-failed.txt', import.meta.url)).text();

const GATE_FILE = 'src/tests/task-gate-spawned.test.ts';
const GATE_CASES = [
  'rafa loop start over a one-task fixture plan whose task commits a tracked file naming the old plan directory'
    + ' > goes red at the task\'s own step on the sweep, which the changed-file selection never reaches',
  'rafa loop start over a one-task fixture plan whose task commits a JSON file indented by one space'
    + ' > goes red at the task\'s step on the lint, with every test green',
  'rafa loop start over a one-task fixture plan whose task commits clean files'
    + ' > stays green at the task\'s step, lint included',
];

const WORKTREE_FILE = 'src/tests/worktree-shared-store-integration.test.ts';
const WORKTREE_CASE = 'two rafa loop start --as-worktree runs, spawned at once over one project'
  + ' > write both task reports to the one shared store, which rafa effort report rolls up together';

/** One `--log-failed` line in the measured shape. */
function logLine(text: string): string {
  return `verify\tUNKNOWN STEP\t2026-10-07T03:09:38.0522605Z ${text}`;
}

/** A capture of `texts`, one line each, ending with a newline as `gh` writes it. */
function capture(...texts: string[]): string {
  return `${texts.map((text) => logLine(text)).join('\n')}\n`;
}

describe('readFailedCases over captured logs', () => {
  it('reads three cases under their file, once each, though bun lists them again at the end', () => {
    expect(readFailedCases(THREE_CASES)).toEqual([{ file: GATE_FILE, cases: GATE_CASES }]);
  });

  it('holds the repeat it removes: each case is on two (fail) lines of the capture', () => {
    for (const name of GATE_CASES) {
      const lines = THREE_CASES.split('\n').filter((line) => line.includes(`(fail) ${name}`));
      expect(lines).toHaveLength(2);
    }
  });

  it('reads one case under its file, and not a (pass) case whose name holds (fail)', () => {
    expect(SUMMARY_REPEAT).toContain('(pass) testFailureOf > reads a lone (fail) line');
    expect(readFailedCases(SUMMARY_REPEAT)).toEqual([{ file: WORKTREE_FILE, cases: [WORKTREE_CASE] }]);
  });
});

describe('readFailedCases', () => {
  it('reads an empty capture, and one with no (fail) line, as no case', () => {
    expect(readFailedCases('')).toEqual([]);
    expect(readFailedCases(capture('##[group]src/a.test.ts:', '(pass) a > b [0.10ms]', '##[endgroup]'))).toEqual([]);
  });

  it('groups cases by file in the order each file was first read', () => {
    const log = capture(
      '##[group]src/b.test.ts:',
      '(fail) b > one [1.00ms]',
      '##[endgroup]',
      '##[group]src/a.test.ts:',
      '(fail) a > one [2.00ms]',
      '##[endgroup]',
      '##[group]src/b.test.ts:',
      '(fail) b > two [3.00ms]',
      '##[endgroup]',
    );
    expect(readFailedCases(log)).toEqual([
      { file: 'src/b.test.ts', cases: ['b > one', 'b > two'] },
      { file: 'src/a.test.ts', cases: ['a > one'] },
    ]);
  });

  it('keeps one case name failing in two files under each', () => {
    const log = capture(
      '##[group]src/a.test.ts:',
      '(fail) parse > drops [1.00ms]',
      '##[endgroup]',
      '##[group]src/b.test.ts:',
      '(fail) parse > drops [1.00ms]',
      '##[endgroup]',
    );
    expect(readFailedCases(log)).toEqual([
      { file: 'src/a.test.ts', cases: ['parse > drops'] },
      { file: 'src/b.test.ts', cases: ['parse > drops'] },
    ]);
  });

  it('keeps a summary case no file group named, under the file null', () => {
    const log = capture('1 tests failed:', '(fail) lost > case [4.00ms]');
    expect(readFailedCases(log)).toEqual([{ file: null, cases: ['lost > case'] }]);
  });

  it('ends an open file group at bun\'s closing list, so a case only it names is given no file', () => {
    const log = capture(
      '##[group]src/a.test.ts:',
      '(fail) a > b [1.00ms]',
      '2 tests failed:',
      '(fail) a > b [1.00ms]',
      '(fail) lost > case [4.00ms]',
    );
    expect(readFailedCases(log)).toEqual([
      { file: 'src/a.test.ts', cases: ['a > b'] },
      { file: null, cases: ['lost > case'] },
    ]);
  });

  it('reads a case with no timing, and one bun named (unnamed)', () => {
    const log = capture('##[group]src/a.test.ts:', '(fail) a > b', '(fail) (unnamed) [0.12ms]', '##[endgroup]');
    expect(readFailedCases(log)).toEqual([{ file: 'src/a.test.ts', cases: ['a > b', '(unnamed)'] }]);
  });

  it('takes a step group as no file, so a case under it is not given the last file read', () => {
    const log = capture(
      '##[group]src/a.test.ts:',
      '##[endgroup]',
      '##[group]Run bun test',
      '(fail) a > b [1.00ms]',
    );
    expect(readFailedCases(log)).toEqual([{ file: null, cases: ['a > b'] }]);
  });

  it('reads through a BOM, colour and a line outside the column shape', () => {
    const log = [
      'verify\tUNKNOWN STEP\t\uFEFF2026-10-04T08:48:04.6952517Z ##[group]src/a.test.ts:',
      logLine('^[[31m(fail) a > red [1.00ms]^[[0m'),
      '(fail) a > bare [1.00ms]',
    ].join('\n');
    expect(readFailedCases(log)).toEqual([{ file: 'src/a.test.ts', cases: ['a > red', 'a > bare'] }]);
  });
});

describe('TEST_FILE_HEADER', () => {
  it('names a test file group and no other', () => {
    expect(TEST_FILE_HEADER.exec('##[group]src/ci/runs.test.ts:')?.[1]).toBe('src/ci/runs.test.ts');
    expect(TEST_FILE_HEADER.exec('##[group]a.spec.tsx:')?.[1]).toBe('a.spec.tsx');
    expect(TEST_FILE_HEADER.test('##[group]Fetching the repository')).toBe(false);
    expect(TEST_FILE_HEADER.test('##[group]Run bun test src/ci/runs.test.ts:')).toBe(false);
    expect(TEST_FILE_HEADER.test('##[group]src/ci/runs.ts:')).toBe(false);
  });
});
