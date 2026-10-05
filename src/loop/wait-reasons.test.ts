/**
 * Tests for the wait reasons (`loop/wait-reasons.ts`): the reasons and
 * exit-code table, the `--until` parse, and the match of one event, one
 * record reading and one awake span to a reason.
 *
 * The refused parses come first, each naming its entry; every refusal
 * sits beside an accepted control of the same shape, so a parse that
 * refused everything fails a control. The matching tests follow, each
 * match beside the same input with the reason left out of `--until`, so
 * a matcher that ignored `--until` fails.
 */
import type { WaitReason } from './wait-reasons.js';

import { describe, expect, it } from 'bun:test';

import {
  DEFAULT_WAIT_UNTIL,
  WAIT_NO_SESSION_EXIT,
  WAIT_REASONS,
  WAIT_TIMEOUT_EXIT,
  WaitUntilError,
  matchEvent,
  matchQuiet,
  matchRecord,
  parseWaitUntil,
  waitExitCode,
} from './wait-reasons.js';

/** The error `parseWaitUntil(raw)` throws, or null when it throws none. */
function refusalOf(raw: string): WaitUntilError | null {
  try {
    parseWaitUntil(raw);
    return null;
  } catch (error) {
    if (error instanceof WaitUntilError) return error;
    throw error;
  }
}

describe('parseWaitUntil refuses', () => {
  it.each([
    ['an unknown reason', 'pr,merged', 'merged'],
    ['a reason in the wrong case', 'PR', 'PR'],
    ['the event name task-blocked in place of the reason blocked', 'task-blocked', 'task-blocked'],
    ['the timeout, which is not a reason', 'timeout', 'timeout'],
  ])('%s, naming the entry', (_label, raw, entry) => {
    const refusal = refusalOf(raw);

    expect(refusal?.entry).toBe(entry);
    expect(refusal?.message).toContain(`'${entry}'`);
    expect(refusal?.message).toContain('unknown reason');
  });

  it.each([
    ['a whole value left empty', ''],
    ['an entry between two commas', 'pr,,halt'],
    ['a trailing comma', 'pr,'],
    ['a leading comma', ',pr'],
    ['an entry of spaces alone', 'pr, ,halt'],
  ])('%s, as an empty entry', (_label, raw) => {
    const refusal = refusalOf(raw);

    expect(refusal).not.toBeNull();
    expect(refusal?.entry.trim()).toBe('');
    expect(refusal?.message).toContain('empty entry');
  });

  it('a bare quiet, which needs minutes', () => {
    const refusal = refusalOf('pr,quiet');

    expect(refusal?.entry).toBe('quiet');
    expect(refusal?.message).toContain('quiet:<minutes>');
  });

  it.each([
    ['no minutes', 'quiet:'],
    ['zero', 'quiet:0'],
    ['a negative number', 'quiet:-5'],
    ['a fraction', 'quiet:1.5'],
    ['a word', 'quiet:ten'],
    ['an exponent', 'quiet:1e3'],
    ['a leading zero', 'quiet:05'],
    ['a sign', 'quiet:+5'],
    ['a number past the safe range', 'quiet:99999999999999999999'],
  ])('quiet with %s, naming the entry', (_label, raw) => {
    const refusal = refusalOf(raw);

    expect(refusal?.entry).toBe(raw);
    expect(refusal?.message).toContain('positive whole number of minutes');
  });

  it('a second quiet entry, naming the second', () => {
    const refusal = refusalOf('quiet:5,pr,quiet:10');

    expect(refusal?.entry).toBe('quiet:10');
    expect(refusal?.message).toContain('quiet asked for twice');
  });

  it('naming the first entry refused when several are', () => {
    expect(refusalOf('pr,nope,also-nope')?.entry).toBe('nope');
  });

  it('control: each refused shape accepted once written well', () => {
    expect(refusalOf('pr,halt')).toBeNull();
    expect(refusalOf('blocked')).toBeNull();
    expect(refusalOf('quiet:5')).toBeNull();
    expect(refusalOf('quiet:10,pr')).toBeNull();
  });
});

describe('parseWaitUntil accepts', () => {
  it('nothing given as the default set: pr, no-pr, halt, error, exit', () => {
    const until = parseWaitUntil(undefined);

    expect(until).toBe(DEFAULT_WAIT_UNTIL);
    expect(until.reasons).toEqual(['pr', 'no-pr', 'halt', 'error', 'exit']);
    expect(until.quietMinutes).toBeNull();
  });

  it('a default set holding neither blocked nor quiet', () => {
    expect(DEFAULT_WAIT_UNTIL.reasons).not.toContain('blocked');
    expect(DEFAULT_WAIT_UNTIL.reasons).not.toContain('quiet');
  });

  it('a comma list, answered in table order', () => {
    expect(parseWaitUntil('exit,blocked,pr').reasons).toEqual(['pr', 'blocked', 'exit']);
  });

  it('every reason at once', () => {
    const until = parseWaitUntil('pr,no-pr,halt,error,blocked,exit,quiet:30');

    expect(until.reasons).toEqual(WAIT_REASONS.map((row) => row.reason));
    expect(until.quietMinutes).toBe(30);
  });

  it('quiet:<minutes> as the reason quiet and its minutes', () => {
    const until = parseWaitUntil('quiet:15');

    expect(until.reasons).toEqual(['quiet']);
    expect(until.quietMinutes).toBe(15);
  });

  it('spaces around entries, trimmed', () => {
    expect(parseWaitUntil(' pr , halt ').reasons).toEqual(['pr', 'halt']);
  });

  it('a reason named twice, counted once', () => {
    expect(parseWaitUntil('pr,pr,halt').reasons).toEqual(['pr', 'halt']);
  });
});

describe('the reasons table', () => {
  it('holds the spec\'s reasons and exit codes', () => {
    const exits = Object.fromEntries(WAIT_REASONS.map((row) => [row.reason, row.exit]));

    expect(exits).toEqual({ pr: 0, 'no-pr': 10, halt: 11, error: 12, blocked: 13, exit: 14, quiet: 15 });
    expect(WAIT_TIMEOUT_EXIT).toBe(16);
    expect(WAIT_NO_SESSION_EXIT).toBe(2);
  });

  it('gives every exit code to one outcome alone', () => {
    const codes = [...WAIT_REASONS.map((row) => row.exit), WAIT_TIMEOUT_EXIT, WAIT_NO_SESSION_EXIT];

    expect(new Set(codes).size).toBe(codes.length);
  });

  it('answers each reason\'s exit code from the table', () => {
    for (const row of WAIT_REASONS) expect(waitExitCode(row.reason)).toBe(row.exit);
  });
});

describe('matchEvent', () => {
  const everyReason = parseWaitUntil('pr,no-pr,halt,error,blocked,exit,quiet:5');

  it.each([
    ['pr', 'pr'],
    ['no-pr', 'no-pr'],
    ['halt', 'halt'],
    ['error', 'error'],
    ['task-blocked', 'blocked'],
  ] satisfies Array<[string, WaitReason]>)('matches event %s to %s when asked for', (name, reason) => {
    expect(matchEvent({ name }, everyReason)).toBe(reason);
  });

  it.each([
    ['pr', 'halt'],
    ['no-pr', 'pr'],
    ['halt', 'pr'],
    ['error', 'pr'],
    ['task-blocked', 'pr,no-pr,halt,error,exit'],
  ])('matches nothing on event %s when --until=%s leaves its reason out', (name, until) => {
    expect(matchEvent({ name }, parseWaitUntil(until))).toBeNull();
  });

  it('leaves task-blocked unmatched under the default set', () => {
    expect(matchEvent({ name: 'task-blocked' }, DEFAULT_WAIT_UNTIL)).toBeNull();
  });

  it.each(['task-start', 'task-done', 'wrap-up', 'inherited', 'blocked', 'exit', 'quiet'])(
    'matches nothing on event %s, which no reason names',
    (name) => {
      expect(matchEvent({ name }, everyReason)).toBeNull();
    },
  );
});

describe('matchRecord', () => {
  it.each([
    ['a dead pid on a record stored running', { state: 'running', pidAlive: false }],
    ['a record reading stopped', { state: 'stopped', pidAlive: true }],
    ['a record reading done', { state: 'done', pidAlive: true }],
    ['a dead pid on a record reading done', { state: 'done', pidAlive: false }],
  ] as const)('matches exit on %s', (_label, reading) => {
    expect(matchRecord(reading, DEFAULT_WAIT_UNTIL)).toBe('exit');
  });

  it.each([
    ['running', { state: 'running', pidAlive: true }],
    ['paused', { state: 'paused', pidAlive: true }],
  ] as const)('matches nothing on a live run reading %s', (_label, reading) => {
    expect(matchRecord(reading, DEFAULT_WAIT_UNTIL)).toBeNull();
  });

  it('matches nothing on an ended run when --until leaves exit out', () => {
    expect(matchRecord({ state: 'done', pidAlive: false }, parseWaitUntil('pr'))).toBeNull();
  });
});

describe('matchQuiet', () => {
  const quietTen = parseWaitUntil('pr,quiet:10');

  it('matches quiet once the awake minutes reach the span', () => {
    expect(matchQuiet(10, quietTen)).toBe('quiet');
    expect(matchQuiet(42.5, quietTen)).toBe('quiet');
  });

  it('matches nothing short of the span', () => {
    expect(matchQuiet(9.99, quietTen)).toBeNull();
  });

  it('matches nothing when --until leaves quiet out, however long the wait', () => {
    expect(matchQuiet(1_000_000, DEFAULT_WAIT_UNTIL)).toBeNull();
  });
});
