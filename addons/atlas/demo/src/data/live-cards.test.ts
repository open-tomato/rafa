/**
 * Tests for the three card mappers of `live-cards.ts`: each over the
 * fixture rows (`testdata/live-client.fixture.ts`), over an empty answer,
 * and the task pile's age buckets at exactly 7 and 28 days, each held
 * against a millisecond either side.
 */
import type { QueryResult, Scalar } from '@open-tomato/atlas-data/contract';

import { describe, expect, it } from 'bun:test';

import { NO_AREA } from './areas.js';
import { ageBucketOf, OTHER_AREA, scopeCreepOf, taskPileOf, workDoneOf } from './live-cards.js';
import { AGE_BUCKETS } from './mock.js';
import { resultOf, STUB_SCOPE_CREEP, STUB_TASK_PILE, STUB_WORK_DONE } from './testdata/live-client.fixture.js';

const DAY_MS = 86_400_000;

/** The build time the fixture's answers carry as `meta.asOf`. */
const BUILT_AT = Date.parse('2026-11-22T09:00:00.000Z');

const OPEN = { from: null, to: null } as const;

const UNDER_A_WEEK = 'under a week';
const ONE_TO_FOUR = '1 to 4 weeks';
const OVER_FOUR = 'over 4 weeks';

/** `result` with `asOf` as its build time. */
function builtAt(result: QueryResult, asOf: string | null): QueryResult {
  return { ...result, meta: { ...result.meta, asOf } };
}

/** A task pile answer of one bug opened `ageMs` before the build time. */
function bugAged(ageMs: number): QueryResult {
  return resultOf(['issue_type', 'created_at', 'issues'], [['bug', new Date(BUILT_AT - ageMs).toISOString(), 1]], OPEN);
}

/** The one age bucket a task pile of a single issue draws. */
function bucketOf(pile: QueryResult): string | undefined {
  return taskPileOf(pile)[0]?.children[0]?.label;
}

/** A work done answer of `rows` (level, area, entries). */
function workDone(rows: readonly (readonly Scalar[])[]): QueryResult {
  return resultOf(['level', 'area', 'entries'], rows);
}

describe('scopeCreepOf', () => {
  it('counts the entries per window week, 0 for a week with none, the last week\'s and the window\'s weekly average', () => {
    // 10 entries over the 28 days of the fixture's window: 2.5 a week.
    expect(scopeCreepOf(STUB_SCOPE_CREEP)).toEqual({ perWeek: [0, 6, 0, 4], lastWeek: 4, average: 2.5 });
  });

  it('averages over the window\'s days, not its ISO weeks: a 7-day window over two weeks reads its total', () => {
    const result = resultOf(['week', 'entries'], [['2026-11-16', 3], ['2026-11-23', 2]], { from: '2026-11-18T00:00:00.000Z', to: '2026-11-25T00:00:00.000Z' });

    expect(scopeCreepOf(result)).toEqual({ perWeek: [3, 2], lastWeek: 2, average: 5 });
  });

  it('answers 0 for every week of an empty answer, and no week for an empty open one', () => {
    expect(scopeCreepOf(resultOf(['week', 'entries'], []))).toEqual({ perWeek: [0, 0, 0, 0], lastWeek: 0, average: 0 });
    expect(scopeCreepOf(resultOf(['week', 'entries'], [], OPEN))).toEqual({ perWeek: [], lastWeek: 0, average: 0 });
  });

  it('refuses an answer without its entries column', () => {
    expect(() => scopeCreepOf(resultOf(['week'], []))).toThrow('atlas: the answer holds no entries column');
  });
});

describe('taskPileOf', () => {
  it('rings the fixture\'s issues by type, the largest first, then by age to the build time, a bucket with none left out', () => {
    expect(taskPileOf(STUB_TASK_PILE)).toEqual([
      {
        id: 'bug',
        label: 'bug',
        group: 'bug',
        children: [
          { id: `bug/${UNDER_A_WEEK}`, label: UNDER_A_WEEK, value: 1, group: 'bug' },
          { id: `bug/${OVER_FOUR}`, label: OVER_FOUR, value: 2, group: 'bug' },
        ],
      },
      { id: 'chore', label: 'chore', group: 'chore', children: [{ id: `chore/${UNDER_A_WEEK}`, label: UNDER_A_WEEK, value: 1, group: 'chore' }] },
      { id: 'spec', label: 'spec', group: 'spec', children: [{ id: `spec/${ONE_TO_FOUR}`, label: ONE_TO_FOUR, value: 1, group: 'spec' }] },
    ]);
  });

  it('answers no branch for an empty answer', () => {
    expect(taskPileOf(resultOf(['issue_type', 'created_at', 'issues'], [], OPEN))).toEqual([]);
  });

  it('puts an issue exactly 7 days old in 1 to 4 weeks, and one a millisecond younger under a week (control)', () => {
    expect(bucketOf(bugAged(7 * DAY_MS))).toBe(ONE_TO_FOUR);
    expect(bucketOf(bugAged(7 * DAY_MS - 1))).toBe(UNDER_A_WEEK);
  });

  it('keeps an issue exactly 28 days old in 1 to 4 weeks, and puts one a millisecond older over 4 weeks (control)', () => {
    expect(bucketOf(bugAged(28 * DAY_MS))).toBe(ONE_TO_FOUR);
    expect(bucketOf(bugAged(28 * DAY_MS + 1))).toBe(OVER_FOUR);
  });

  it('reads the build time from the answer\'s asOf: the same issue a week later is a bucket older', () => {
    const later = builtAt(bugAged(DAY_MS), new Date(BUILT_AT + 7 * DAY_MS).toISOString());

    expect(bucketOf(bugAged(DAY_MS))).toBe(UNDER_A_WEEK);
    expect(bucketOf(later)).toBe(ONE_TO_FOUR);
  });

  it('answers no branch with no build time to measure to, and skips an issue with no open time', () => {
    const noOpenTime = resultOf(['issue_type', 'created_at', 'issues'], [['bug', null, 1], ['spec', '2026-11-20T09:00:00.000Z', 1]], OPEN);

    expect(taskPileOf(builtAt(STUB_TASK_PILE, null))).toEqual([]);
    expect(taskPileOf(noOpenTime).map((branch) => branch.id)).toEqual(['spec']);
  });

  it('buckets a day count as the mock does: under 7, 7 to 28, past 28', () => {
    expect(AGE_BUCKETS).toEqual([UNDER_A_WEEK, ONE_TO_FOUR, OVER_FOUR]);
    expect([0, 6.9, 7, 28, 28.1, 400].map(ageBucketOf)).toEqual([UNDER_A_WEEK, UNDER_A_WEEK, ONE_TO_FOUR, ONE_TO_FOUR, OVER_FOUR, OVER_FOUR]);
  });
});

describe('workDoneOf', () => {
  it('rings the fixture\'s entries by D4 kind, then by tidied area, two spellings of docs merged and a NULL area as no area', () => {
    expect(workDoneOf(STUB_WORK_DONE)).toEqual([
      {
        id: 'features',
        label: 'features',
        group: 'features',
        children: [
          { id: 'features/tests', label: 'tests', value: 4, group: 'features' },
          { id: 'features/docs', label: 'docs', value: 3, group: 'features' },
        ],
      },
      {
        id: 'fixes',
        label: 'fixed bugs',
        group: 'fixes',
        children: [
          { id: 'fixes/loop', label: 'loop', value: 3, group: 'fixes' },
          { id: `fixes/${NO_AREA}`, label: NO_AREA, value: 2, group: 'fixes' },
        ],
      },
      { id: 'chores', label: 'chores', group: 'chores', children: [{ id: 'chores/board', label: 'board', value: 1, group: 'chores' }] },
    ]);
  });

  it('answers no branch for an empty answer', () => {
    expect(workDoneOf(workDone([]))).toEqual([]);
  });

  it('shows the five largest areas of a kind by name, then other for the rest, then no area', () => {
    const rows = [['a', 7], ['b', 6], ['c', 5], ['d', 4], ['e', 3], ['f', 2], ['g', 1], [null, 9]].map(([area, entries]) => ['patch', area ?? null, entries ?? 0]);

    expect(workDoneOf(workDone(rows))[0]?.children.map((child) => [child.label, child.value])).toEqual([
      ['a', 7], ['b', 6], ['c', 5], ['d', 4], ['e', 3], [OTHER_AREA, 3], [NO_AREA, 9],
    ]);
  });

  it('control: names every area of a kind with five or fewer, and draws no other slice', () => {
    const rows = ['a', 'b', 'c', 'd', 'e'].map((area) => ['none', area, 1]);

    expect(workDoneOf(workDone(rows))[0]?.children.map((child) => child.label)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('folds an area spelled other into the other slice, never as a sixth name', () => {
    const rows = [['minor', ' Other ', 2], ['minor', 'tests', 1]];

    expect(workDoneOf(workDone(rows))[0]?.children.map((child) => [child.label, child.value])).toEqual([['tests', 1], [OTHER_AREA, 2]]);
  });

  it('counts major and minor as features, and leaves a level D4 does not name out', () => {
    const rows = [['major', 'loop', 1], ['minor', 'loop', 2], ['breaking', 'loop', 5], [null, 'loop', 5]];

    expect(workDoneOf(workDone(rows))).toEqual([
      { id: 'features', label: 'features', group: 'features', children: [{ id: 'features/loop', label: 'loop', value: 3, group: 'features' }] },
    ]);
  });
});
