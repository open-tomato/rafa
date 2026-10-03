/**
 * Tests for reading the test a reported bug names
 * (`src/triage/test-failure.ts`).
 *
 * {@link BUN_CAPTURE} is bun 1.4.2's console output for two failing cases
 * in one file, as it printed them, with the temporary directory written
 * as `/tmp/x`: each failure's evidence above its `(fail)` line.
 */
import { describe, expect, it } from 'bun:test';

import { testFailureOf } from './test-failure.js';

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
      artifact: 'src/triage/triage.test.ts > triageReport > files one bug\nExpected: 1\nReceived: 2',
    })).toEqual({
      file: 'src/triage/triage.test.ts',
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
});
