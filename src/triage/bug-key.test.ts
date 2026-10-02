/**
 * Tests for the key a bug is looked up by (`src/triage/bug-key.ts`).
 *
 * {@link BUN_CAPTURE} is the shape of bun 1.4.2's console output for two
 * failing cases in one test case's file, as `./test-failure.test.ts`
 * measured it: each failure's evidence above its `(fail)` line.
 */
import { describe, expect, it } from 'bun:test';

import { bugKeyOf, legacyBugKeyOf, strippedText } from './bug-key.js';

const TRACKER = '/repo/.rafa/plans/PLAN_TRACKER-demo.md';
const OTHER_TRACKER = '/elsewhere/.rafa/plans/PLAN_TRACKER-other.md';

/** One failing case as bun prints it, its error line `error`, its timing `ms`. */
function bunCapture(error: string, ms: string): string {
  return [
    'bun test v1.4.2 (744846f84)',
    '',
    'src/sub/a.test.ts:',
    '2 | describe(\'outer\', () => { it(\'adds\', () => { expect(1 + 1).toBe(3); }); });',
    '                                                               ^',
    `error: ${error}`,
    '',
    '      at <anonymous> (/tmp/x/src/sub/a.test.ts:2:60)',
    `(fail) outer > adds [${ms}]`,
  ].join('\n');
}

const BUN_CAPTURE = bunCapture('expect(received).toBe(expected)', '0.19ms');

describe('bugKeyOf, for a bug naming a test case', () => {
  it('keys one failure worded two ways once: bun\'s capture, and a `file > case` line with an absolute folder', () => {
    const fromBun = bugKeyOf(TRACKER, BUN_CAPTURE, 'a test fails');
    const reworded = bugKeyOf(
      OTHER_TRACKER,
      '/tmp/x/src/sub/a.test.ts > outer > adds\nexpect(received).toBe(expected)',
      'The adds case is red on main',
    );

    expect(fromBun).toBe('a.test.ts > outer > adds: expect(received).toBe(expected)');
    expect(reworded).toBe(fromBun);
  });

  it('keys one failure the same whatever its numbers, hashes and folders', () => {
    const first = bugKeyOf(TRACKER, '/tmp/x/src/sub/a.test.ts > outer > adds\nerror: boom 42 in /tmp/x/cache/1a2b3c4d.json');
    const second = bugKeyOf(OTHER_TRACKER, 'src/sub/a.test.ts > outer > adds\nerror: boom 7 in /var/y/cache/9f8e7d6c5b.json');

    expect(first).toBe('a.test.ts > outer > adds: boom in .json');
    expect(second).toBe(first);
  });

  it('keys two failures in one test case apart, by their evidence lines', () => {
    const toBe = bugKeyOf(TRACKER, BUN_CAPTURE);
    const toEqual = bugKeyOf(TRACKER, bunCapture('expect(received).toEqual(expected)', '0.21ms'));

    expect(toEqual).toBe('a.test.ts > outer > adds: expect(received).toEqual(expected)');
    expect(toEqual).not.toBe(toBe);
  });

  it('holds no tracker file: two plans meeting one red test key it once', () => {
    const key = bugKeyOf(TRACKER, BUN_CAPTURE);

    expect(bugKeyOf(OTHER_TRACKER, BUN_CAPTURE)).toBe(key);
    expect(key).not.toContain('PLAN_TRACKER');
  });

  it('keeps the numbers of a case name: two cases differing by one are two keys', () => {
    expect(bugKeyOf(TRACKER, 'src/a.test.ts > parses 2 lines\nboom'))
      .toBe('a.test.ts > parses 2 lines: boom');
    expect(bugKeyOf(TRACKER, 'src/a.test.ts > parses 3 lines\nboom'))
      .toBe('a.test.ts > parses 3 lines: boom');
  });

  it('reads the case from `what` when the artifact names none, and keys on file and case alone with no evidence', () => {
    expect(bugKeyOf(TRACKER, 'expect(received).toBe(expected)', 'src/a.test.ts > outer > adds'))
      .toBe('a.test.ts > outer > adds: expect(received).toBe(expected)');
    expect(bugKeyOf(TRACKER, '(fail) outer > adds [0.19ms]'))
      .toBe('outer > adds');
    expect(bugKeyOf(TRACKER, 'src/a.test.ts:\n(fail) outer > adds [0.19ms]'))
      .toBe('a.test.ts > outer > adds');
  });
});

describe('bugKeyOf, for every other bug', () => {
  it('keys on the tracker file\'s base name and the stripped artifact', () => {
    const key = bugKeyOf(TRACKER, 'src/triage/a.ts:12:5  error   no-unused-vars at 1a2b3c4d');

    expect(key).toBe('PLAN_TRACKER-demo.md: a.ts:: error no-unused-vars at');
    expect(bugKeyOf(TRACKER, 'a.ts:3:1 error no-unused-vars at 9f8e7d6')).toBe(key);
  });

  it('control: one artifact under two tracker files is two keys', () => {
    expect(bugKeyOf(OTHER_TRACKER, 'TypeError: x is undefined'))
      .not.toBe(bugKeyOf(TRACKER, 'TypeError: x is undefined'));
  });

  it('control: a test file named with no case is no test failure, and keeps its tracker file', () => {
    expect(bugKeyOf(TRACKER, 'src/a.test.ts:246 fails'))
      .toBe('PLAN_TRACKER-demo.md: a.test.ts: fails');
  });

  it('keys an artifact stripping empties on itself, on one line', () => {
    expect(bugKeyOf(TRACKER, '  4  2 ')).toBe('PLAN_TRACKER-demo.md: 4 2');
  });
});

describe('strippedText', () => {
  it('takes out a commit hash whole, before its digits, from 7 to 40 hex characters', () => {
    expect(strippedText('at abc1234 then')).toBe('at then');
    expect(strippedText(`at ${'a1'.repeat(20)} then`)).toBe('at then');
    expect(strippedText('at abc12 then')).toBe('at abc then');
  });

  it('control: a word of 41 hex characters is not a hash, and only its digits go', () => {
    expect(strippedText(`at ${'a1'.repeat(20)}a then`)).toBe(`at ${'a'.repeat(21)} then`);
  });

  it('takes out every folder prefix, and keeps the quote or bracket around a path', () => {
    expect(strippedText('read (/tmp/x/src/a.ts) and \'src/b.ts\'')).toBe('read (a.ts) and \'b.ts\'');
  });

  it('makes every run of whitespace one space, trimmed', () => {
    expect(strippedText('  one\n\ttwo   three ')).toBe('one two three');
  });
});

describe('legacyBugKeyOf', () => {
  it('is the key before #486: the tracker file\'s base name and the artifact on one line, unstripped', () => {
    expect(legacyBugKeyOf(TRACKER, 'src/a.ts:12\n  error at 1a2b3c4d'))
      .toBe('PLAN_TRACKER-demo.md: src/a.ts:12 error at 1a2b3c4d');
  });
});
