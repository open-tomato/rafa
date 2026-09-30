/**
 * Tests for the suite baseline (`src/suite/baseline.ts`): its path beside
 * the tracker, its write and read round trip, the readings of a missing
 * or malformed file, and the split of failures into new and known.
 * Files go under a fresh directory in `tmpdir`, removed after each case.
 */
import type { SuiteResult } from './run.js';

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import {
  BASELINE_VERSION,
  baselineOf,
  baselinePathFor,
  readBaseline,
  splitFailures,
  writeBaseline,
} from './baseline.js';

const RESULT: SuiteResult = {
  command: ['bun', 'test', '--reporter=junit', '--reporter-outfile=/tmp/x.xml'],
  exitCode: 1,
  summary: 'Ran 3 tests across 2 files. [12.00ms]',
  failures: [
    { file: 'a.test.ts', name: 'outer > fails' },
    { file: 'sub/b.test.ts', name: 'breaks' },
  ],
  errors: 0,
  junit: 'read',
};

const RECORDED_AT = new Date('2026-09-30T10:00:00.000Z');

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'suite-baseline-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('baselinePathFor', () => {
  it('names the baseline beside a tracker, from its stub', () => {
    expect(baselinePathFor('/p/.rafa/plans/PLAN_TRACKER-foo-bar.md')).toBe('/p/.rafa/plans/SUITE_BASELINE-foo-bar.json');
  });

  it('names the same file from the plan itself', () => {
    expect(baselinePathFor('/p/plans/PLAN-foo.md')).toBe(baselinePathFor('/p/plans/PLAN_TRACKER-foo.md'));
  });

  it('names a stubless baseline for a bare tracker', () => {
    expect(baselinePathFor('/p/PLAN_TRACKER.md')).toBe('/p/SUITE_BASELINE.json');
  });

  it('refuses a name that is neither a plan nor a tracker', () => {
    expect(() => baselinePathFor('/p/NOTES-foo.md')).toThrow(RangeError);
    expect(() => baselinePathFor('/p/PLAN-foo.txt')).toThrow(RangeError);
  });
});

describe('baselineOf', () => {
  it('copies the result and stamps version, time and commit', () => {
    const baseline = baselineOf(RESULT, RECORDED_AT, 'abc123');

    expect(baseline).toEqual({
      ...RESULT,
      version: BASELINE_VERSION,
      recordedAt: '2026-09-30T10:00:00.000Z',
      commit: 'abc123',
    });
    expect(baseline.failures).not.toBe(RESULT.failures);
    expect(baseline.command).not.toBe(RESULT.command);
  });
});

describe('writeBaseline and readBaseline', () => {
  it('round-trips a baseline, creating its directory', () => {
    const path = join(dir, 'nested', 'SUITE_BASELINE-foo.json');
    const baseline = baselineOf(RESULT, RECORDED_AT, null);

    writeBaseline(path, baseline);

    expect(readBaseline(path)).toEqual({ state: 'read', baseline });
    expect(readFileSync(path, 'utf8').endsWith('}\n')).toBe(true);
    expect(readdirSync(join(dir, 'nested'))).toEqual(['SUITE_BASELINE-foo.json']);
  });

  it('overwrites an earlier baseline', () => {
    const path = join(dir, 'SUITE_BASELINE.json');
    writeBaseline(path, baselineOf(RESULT, RECORDED_AT, 'old'));
    const green = baselineOf({ ...RESULT, exitCode: 0, failures: [] }, RECORDED_AT, 'new');

    writeBaseline(path, green);

    expect(readBaseline(path)).toEqual({ state: 'read', baseline: green });
  });

  it('reads a missing file as missing', () => {
    const path = join(dir, 'SUITE_BASELINE.json');

    expect(readBaseline(path)).toEqual({ state: 'missing' });
    expect(existsSync(path)).toBe(false);
  });

  it('reads a file that is not JSON as unreadable', () => {
    const path = join(dir, 'SUITE_BASELINE.json');
    writeFileSync(path, '{ half', 'utf8');

    expect(readBaseline(path)).toEqual({ state: 'unreadable', reason: 'not JSON' });
  });

  it('reads a JSON array as unreadable', () => {
    const path = join(dir, 'SUITE_BASELINE.json');
    writeFileSync(path, '[]', 'utf8');

    expect(readBaseline(path)).toEqual({ state: 'unreadable', reason: 'not a JSON object' });
  });

  it('reads another version as unreadable', () => {
    const path = join(dir, 'SUITE_BASELINE.json');
    writeFileSync(path, JSON.stringify({ ...baselineOf(RESULT, RECORDED_AT, null), version: 2 }), 'utf8');

    expect(readBaseline(path)).toEqual({ state: 'unreadable', reason: 'version 2, expected 1' });
  });

  it('names the first malformed field', () => {
    const path = join(dir, 'SUITE_BASELINE.json');
    const whole = baselineOf(RESULT, RECORDED_AT, null);
    const cases: readonly (readonly [string, unknown])[] = [
      ['failures', [{ file: 'a.test.ts' }]],
      ['junit', 'maybe'],
      ['exitCode', 1.5],
      ['command', 'bun test'],
      ['errors', '0'],
    ];

    for (const [field, value] of cases) {
      writeFileSync(path, JSON.stringify({ ...whole, [field]: value }), 'utf8');
      expect(readBaseline(path)).toEqual({ state: 'unreadable', reason: `field ${field} is missing or malformed` });
    }
  });

  it('reads a baseline written without failures field as unreadable', () => {
    const path = join(dir, 'SUITE_BASELINE.json');
    const rest = Object.fromEntries(Object.entries(baselineOf(RESULT, RECORDED_AT, null)).filter(([key]) => key !== 'failures'));
    writeFileSync(path, JSON.stringify(rest), 'utf8');

    expect(readBaseline(path)).toEqual({ state: 'unreadable', reason: 'field failures is missing or malformed' });
  });
});

describe('splitFailures', () => {
  it('splits failures into new and known, in the result order', () => {
    const baseline = baselineOf(RESULT, RECORDED_AT, null);
    const later = [
      { file: 'c.test.ts', name: 'regresses' },
      { file: 'sub/b.test.ts', name: 'breaks' },
      { file: 'a.test.ts', name: 'outer > fails' },
    ];

    expect(splitFailures(later, baseline)).toEqual({
      fresh: [{ file: 'c.test.ts', name: 'regresses' }],
      known: [
        { file: 'sub/b.test.ts', name: 'breaks' },
        { file: 'a.test.ts', name: 'outer > fails' },
      ],
    });
  });

  it('matches on file and full name together, never on either alone', () => {
    const baseline = baselineOf(RESULT, RECORDED_AT, null);
    const later = [
      { file: 'other.test.ts', name: 'outer > fails' },
      { file: 'a.test.ts', name: 'fails' },
      { file: 'a.test.ts', name: 'inner > outer > fails' },
    ];

    expect(splitFailures(later, baseline)).toEqual({ fresh: later, known: [] });
  });

  it('keeps apart pairs whose joined text would collide', () => {
    const baseline = { failures: [{ file: 'a', name: 'b c' }] };

    expect(splitFailures([{ file: 'a b', name: 'c' }], baseline).known).toEqual([]);
  });

  it('reads every failure as new with no baseline', () => {
    expect(splitFailures(RESULT.failures, null)).toEqual({ fresh: RESULT.failures, known: [] });
  });

  it('reads every failure as new against a baseline naming none', () => {
    const unread = baselineOf({ ...RESULT, failures: [], junit: 'missing' }, RECORDED_AT, null);

    expect(splitFailures(RESULT.failures, unread)).toEqual({ fresh: RESULT.failures, known: [] });
  });

  it('answers nothing for a green result', () => {
    expect(splitFailures([], baselineOf(RESULT, RECORDED_AT, null))).toEqual({ fresh: [], known: [] });
  });
});
