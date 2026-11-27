/**
 * Tests for reading the test a reported bug names
 * (`packages/rafa/src/triage/test-failure.ts`).
 *
 * {@link BUN_CAPTURE} is bun 1.4.2's console output for two failing cases
 * in one file, as it printed them, with the temporary directory written
 * as `/tmp/x`: each failure's evidence above its `(fail)` line.
 */
import { describe, expect, it } from 'bun:test';

import { failedCaseNamesIn, testFailureOf } from './test-failure.js';

/**
 * The spec's one-second bound on a crafted `(fail)` line: the old
 * pattern, its three whitespace runs able to share one long run, took
 * about 1.9 s at 1,500 spaces and 119 s at 6,000, growing with the cube,
 * and was killed at 120 s on {@link CRAFTED_SPACES}.
 */
const REDOS_BOUND_MS = 1000;

/** Spaces after `(fail)` in the crafted line, about the 50,000 characters of the plan's slow shape. */
const CRAFTED_SPACES = 50_000;

/**
 * The crafted line: `(fail)`, a long space run, then a name a carriage
 * return breaks, which no case name may hold, so the line is no case and
 * the old pattern tried every split of the run before saying so.
 */
const CRAFTED_FAIL_LINE = `(fail)${' '.repeat(CRAFTED_SPACES)}x\ry`;

/**
 * The crafted `file > case` line: a test file, ` > `, a name, a long
 * space run, then a carriage return, which no case name may hold, so the
 * line is no case and the old `FILE_CASE_LINE` pattern, its lazy name and
 * trailing whitespace run able to share the run, rescanned it once per
 * character before saying so: this file's timing case took 6,216 ms on it.
 */
const CRAFTED_FILE_CASE_LINE = `src/a.test.ts > a${' '.repeat(CRAFTED_SPACES)}b\rc`;

const BUN_CAPTURE = [
  'bun test v1.4.2 (744846f84)',
  '',
  'src/sub/a.test.ts:',
  '1 | import { describe, expect, it } from \'bun:test\';',
  '2 | describe(\'outer\', () => { it(\'adds\', () => { expect(1 + 1).toBe(3); }); });',
  '                                                               ^',
  'error: expect(received).toBe(expected)',
  '',
  'Expected: 3',
  'Received: 2',
  '',
  '      at <anonymous> (/tmp/x/src/sub/a.test.ts:2:60)',
  '(fail) outer > adds [0.19ms]',
  '1 | import { describe, expect, it } from \'bun:test\';',
  '2 | describe(\'outer\', () => { it(\'throws\', () => { throw new Error(\'boom 42\'); }); });',
  '                                                     ^',
  'error: boom 42',
  '      at <anonymous> (/tmp/x/src/sub/a.test.ts:2:119)',
  '(fail) outer > throws [0.03ms]',
].join('\n');

describe('testFailureOf', () => {
  it('reads bun\'s (fail) line: the case without its timing, the file header above it, the error line above it', () => {
    expect(testFailureOf({ what: 'a test fails', artifact: BUN_CAPTURE })).toEqual({
      file: 'src/sub/a.test.ts',
      name: 'outer > adds',
      evidence: 'expect(received).toBe(expected)',
    });
  });

  it('reads a second failure\'s evidence from the lines between the first case line and its own', () => {
    const second = BUN_CAPTURE.split('\n').slice(13)
      .join('\n');
    expect(testFailureOf({ what: 'a test fails', artifact: `(fail) outer > adds\n${second}` })?.evidence)
      .toBe('boom 42');
  });

  it('reads a lone (fail) line with the test file named in the what', () => {
    expect(testFailureOf({
      what: 'src/commands/status.test.ts fails at HEAD without this diff',
      artifact: '(fail) the exit codes of rafa status > exits 0 over the real reader',
    })).toEqual({
      file: 'src/commands/status.test.ts',
      name: 'the exit codes of rafa status > exits 0 over the real reader',
      evidence: null,
    });
  });

  it('reads an error quoted after the case line when none is above it', () => {
    expect(testFailureOf({ what: 'red', artifact: '(fail) a > b [1.00ms]\nerror: boom' })?.evidence).toBe('boom');
  });

  it('reads a file > case wording: the file on the line, the case after it', () => {
    expect(testFailureOf({
      what: 'a red test',
      artifact: 'packages/rafa-pr/src/triage/triage.test.ts > triageReport > files one bug\nExpected: 1\nReceived: 2',
    })).toEqual({
      file: 'packages/rafa-pr/src/triage/triage.test.ts',
      name: 'triageReport > files one bug',
      evidence: 'Expected: 1',
    });
  });

  it('reads a file > case wording in the what when the artifact names no case', () => {
    expect(testFailureOf({
      what: 'triage.test.ts > triageReport > files one bug',
      artifact: 'error: expect(received).toBe(expected)',
    })).toEqual({
      file: 'triage.test.ts',
      name: 'triageReport > files one bug',
      evidence: 'expect(received).toBe(expected)',
    });
  });

  it('answers a path with a folder and one without as written', () => {
    const withFolder = testFailureOf({ what: 'red', artifact: 'src/a/b.test.ts > c > d' });
    const bare = testFailureOf({ what: 'red', artifact: 'b.test.ts > c > d' });
    expect(withFolder?.file).toBe('src/a/b.test.ts');
    expect(bare?.file).toBe('b.test.ts');
    expect(bare?.name).toBe(withFolder?.name);
  });

  it('reads each file > case line\'s name as the shortest one its whitespace leaves, and none holding a line break', () => {
    const lines = [
      '  src/a.test.ts\t>  \t b c  ',
      'src/a.test.ts >    ',
      'src/a.test.ts > a\u2028',
      'src/a.test.ts >  \u2028x',
      'src/a.test.ts > a > b [1ms]',
    ];
    const names = lines.map((artifact) => testFailureOf({ what: 'red', artifact })?.name);
    const broken = ['src/a.test.ts > a\rb', 'src/a.test.ts >a', 'src/a.test.ts> a', 'src/a.test.ts > \u2028'];

    expect(names).toEqual(['b c', ' ', 'a', 'x', 'a > b [1ms]']);
    expect(broken.map((artifact) => testFailureOf({ what: 'red', artifact }))).toEqual([null, null, null, null]);
  });

  it('reads no case off a file > case line with a long space run before a line break, and the next line\'s case, within REDOS_BOUND_MS', () => {
    const bug = { what: 'a test fails', artifact: `src/a.test.ts:\n${CRAFTED_FILE_CASE_LINE}\n(fail) a > b [1ms]` };

    const started = performance.now();
    const failure = testFailureOf(bug);
    const elapsed = performance.now() - started;

    expect(elapsed).toBeLessThan(REDOS_BOUND_MS);
    expect(failure).toEqual({ file: 'src/a.test.ts', name: 'a > b', evidence: CRAFTED_FILE_CASE_LINE });
  });

  it('reads the last test file above the case line when no file header is above it', () => {
    const artifact = 'at <anonymous> (src/a.test.ts:1:1)\nat <anonymous> (src/b.test.ts:2:2)\n(fail) c > d';
    expect(testFailureOf({ what: 'src/what.test.ts', artifact })?.file).toBe('src/b.test.ts');
  });

  it('answers a null file for a case named with no test file anywhere', () => {
    expect(testFailureOf({ what: 'a red test', artifact: '(fail) a > b' })?.file).toBeNull();
  });

  it('answers null for an artifact naming no test: a type error, a test file with no case, a sentence with >', () => {
    const artifacts = [
      'src/utils/declaration.ts(484,9): error TS2367: This comparison appears to be unintentional.',
      'src/start/checkout-guard-worktree-integration.test.ts:246',
      'the release stage over a scratch repository > exits 0 with no --fix',
    ];
    for (const artifact of artifacts) {
      expect(testFailureOf({ what: 'a bug', artifact })).toBeNull();
    }
  });

  it('answers null for a bug with no artifact and a what naming no case', () => {
    expect(testFailureOf({ what: 'src/a.test.ts is slow', artifact: null })).toBeNull();
  });

  it('reads no case off a long whitespace run before a broken name, and the next line\'s case, within REDOS_BOUND_MS', () => {
    const bug = { what: 'a test fails', artifact: `src/a.test.ts:\n${CRAFTED_FAIL_LINE}\n(fail) a > b [1ms]` };

    const started = performance.now();
    const failure = testFailureOf(bug);
    const elapsed = performance.now() - started;

    expect(elapsed).toBeLessThan(REDOS_BOUND_MS);
    expect(failure).toEqual({ file: 'src/a.test.ts', name: 'a > b', evidence: CRAFTED_FAIL_LINE });
  });
});

describe('failedCaseNamesIn', () => {
  it('answers every (fail) line\'s case name in order, without its timing', () => {
    expect(failedCaseNamesIn(BUN_CAPTURE)).toEqual(['outer > adds', 'outer > throws']);
  });

  it('reads a (fail) line with no timing and one timed in seconds', () => {
    expect(failedCaseNamesIn('(fail) a > b\r\n(fail) c > d [1.50s]')).toEqual(['a > b', 'c > d']);
  });

  it('reads each (fail) line\'s name as the shortest one its whitespace and timing leave', () => {
    const lines = [
      '  (fail)\ta > b [2.5ms]  ',
      '(fail) a  [1ms] ',
      '(fail) a [1ms] [2ms]',
      '(fail) [1ms]',
      '(fail)  \t[1ms]',
      '(fail)   ',
      '(fail) \u2028 ',
      '(fail)  \u2028x',
      '(fail) a [1ms]\u2028',
      '(fail) a\u2028 [1ms]',
    ];

    expect(failedCaseNamesIn(lines.join('\n'))).toEqual(['a > b', 'a', 'a [1ms]', '[1ms]', '[1ms]', ' ', ' ', 'x', 'a', 'a']);
  });

  it('reads no case off a line whose name would hold a line break, or that is no (fail) line', () => {
    expect(failedCaseNamesIn(['(fail) a\u2028b', '(fail) a\rb', '(fail)a', '(fail) ', '(fail) \u2028', 'x (fail) a'].join('\n')))
      .toEqual([]);
  });

  it('reads no case off a long whitespace run before a broken name, and the next line\'s case, within REDOS_BOUND_MS', () => {
    const started = performance.now();
    const names = failedCaseNamesIn(`src/a.test.ts:\n${CRAFTED_FAIL_LINE}\n(fail) a > b [1ms]\n`);
    const elapsed = performance.now() - started;

    expect(elapsed).toBeLessThan(REDOS_BOUND_MS);
    expect(names).toEqual(['a > b']);
  });

  it('answers nothing for a capture with no (fail) line, and skips pass and file > case lines', () => {
    expect(failedCaseNamesIn('')).toEqual([]);
    expect(failedCaseNamesIn('(pass) a > b [0.10ms]\nsrc/a.test.ts > c')).toEqual([]);
  });
});
