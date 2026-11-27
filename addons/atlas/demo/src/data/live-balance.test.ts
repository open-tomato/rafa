import type { BalanceAnswers, BalanceMetric, LiveBalanceIndex } from './live-balance.js';
import type { MetricDefinition, QueryParams, QueryResult, Scalar } from '@open-tomato/atlas-data/contract';
import type { AtlasClient } from '@open-tomato/atlas-transport/client';

import { resolveWindow } from '@open-tomato/atlas-data/query';
import { describe, expect, it } from 'bun:test';

import { BALANCE_CATALOGUE } from './balance.js';
import {
  BALANCE_METRICS,
  BALANCE_WINDOW_DAYS,
  balanceAnswersOf,
  balanceWindowOf,
  baselineOf,
  DOCS_SHARE_DEFINITION,
  INDEX_WEEKS,
  liveBalanceOf,
  NONE_IN_12_WEEKS,
  periodOf,
} from './live-balance.js';
import { DAY_MS } from './live-read.js';

/** A build on Monday 2026-11-23, 09:00 UTC: its ISO week holds one day. */
const MONDAY_BUILD = '2026-11-23T09:00:00.000Z';

/** A build on Sunday 2026-11-22, 21:00 UTC: its ISO week is whole. */
const SUNDAY_BUILD = '2026-11-22T21:00:00.000Z';

/** The `YYYY-MM-DD` of the day `back` days before the day of `builtAt`. */
function dayBack(builtAt: string, back: number): string {
  const day = Date.parse(builtAt.slice(0, 10));
  return new Date(day - back * DAY_MS).toISOString()
    .slice(0, 10);
}

/** One answer of `columns` and `rows`, as the engine answers a day-grain query. */
function answerOf(columns: readonly string[], rows: readonly (readonly Scalar[])[]): QueryResult {
  return {
    columns: columns.map((key) => ({ key, label: key, type: 'string' })),
    rows,
    meta: { asOf: MONDAY_BUILD, partial: false, partialReasons: [], rowCount: rows.length, truncated: false, window: { from: null, to: null } },
  };
}

/** Every answer with its columns and no row: a replica holding none of the indices' events. */
const EMPTY_ANSWERS: BalanceAnswers = {
  changes: answerOf(['day', 'level', 'area', 'entries'], []),
  planCompletion: answerOf(['day', 'started', 'completed'], []),
  deploys: answerOf(['day', 'deploys'], []),
  outOfScope: answerOf(['day', 'entries'], []),
  sessions: answerOf(['day', 'work_type', 'status', 'sessions', 'minutes'], []),
  repeats: answerOf(['day', 'sessions'], []),
  regressions: answerOf(['day', 'bugs'], []),
  bugsByKind: answerOf(['day', 'kind', 'bugs'], []),
  ciVerdicts: answerOf(['day', 'verdict', 'readings'], []),
};

/** The empty answers with `key`'s answered by `rows`. */
function answersWith(overrides: Partial<Record<BalanceMetric, readonly (readonly Scalar[])[]>>): BalanceAnswers {
  const entries = (Object.keys(EMPTY_ANSWERS) as BalanceMetric[]).map((key) => {
    const rows = overrides[key];
    const empty = EMPTY_ANSWERS[key];
    return [key, rows === undefined
      ? empty
      : answerOf(empty.columns.map((column) => column.key), rows)] as const;
  });
  return Object.fromEntries(entries) as Record<BalanceMetric, QueryResult>;
}

/** The index `id` of `indices`; a missing one fails the test. */
function indexNamed(indices: readonly LiveBalanceIndex[], id: string): LiveBalanceIndex {
  const found = indices.find((index) => index.id === id);
  if (found === undefined) throw new Error(`no index ${id}`);
  return found;
}

/** One row per baseline week (periods 1 to 12), on the period's last day, from `rowOf`. */
function baselineRows(builtAt: string, rowOf: (day: string, week: number) => readonly Scalar[]): (readonly Scalar[])[] {
  return Array.from({ length: 12 }, (_, offset) => rowOf(dayBack(builtAt, (offset + 1) * 7), offset + 1));
}

describe('balanceWindowOf and periodOf: the fixed 91 days', () => {
  it('asks the 91 whole days ending with the build\'s day, whatever its hour', () => {
    expect(BALANCE_WINDOW_DAYS).toBe(91);
    expect(balanceWindowOf(MONDAY_BUILD)).toEqual({ to: '2026-11-23', last: '91d' });
    expect(balanceWindowOf('2026-11-23T23:59:59.000Z')).toEqual({ to: '2026-11-23', last: '91d' });
  });

  it('is read by the engine as 13 periods of 7 days, the build\'s day the last one', () => {
    const resolved = resolveWindow(balanceWindowOf(MONDAY_BUILD), new Date(MONDAY_BUILD));
    const buildDay = Date.parse('2026-11-23');

    expect(resolved).toEqual({ from: new Date('2026-08-25T00:00:00.000Z'), to: new Date('2026-11-24T00:00:00.000Z') });
    expect(periodOf(resolved.from?.getTime() ?? 0, buildDay)).toBe(12);
    expect(periodOf((resolved.to?.getTime() ?? 0) - 1, buildDay)).toBe(0);
    expect(periodOf((resolved.from?.getTime() ?? 0) - DAY_MS, buildDay)).toBeNull();
    expect(periodOf(resolved.to?.getTime() ?? 0, buildDay)).toBeNull();
  });

  it('refuses a build time that names no instant', () => {
    expect(() => balanceWindowOf('not a time')).toThrow('atlas: "not a time" is not a day');
  });
});

describe('balanceAnswersOf: each metric asked at day grain over the fixed window', () => {
  it('asks the nine metrics the indices read, their own params at day grain, over the same 91 days', async () => {
    const queries: { id: string; params: QueryParams }[] = [];
    const definitionOf = (id: string): MetricDefinition => ({
      id,
      title: id,
      lenses: ['developer'],
      description: `stub definition of ${id}`,
      sourceId: `stub.${id}`,
      params: {
        grain: 'week',
        filters: [{ field: 'stub_field', op: 'eq', value: id }],
        groupBy: ['stub_group'],
        measures: [{ field: 'stub_measure', agg: 'count', as: 'stub' }],
        orderBy: [{ key: 'week', dir: 'asc' }],
      },
      formula: { kind: 'none' },
      chart: 'line',
      feasibility: 'direct',
    });
    const unused = (): never => {
      throw new Error('the balance asked a route it does not use');
    };
    const client: AtlasClient = {
      listSources: unused,
      describeSource: unused,
      listMetrics: unused,
      runMetric: unused,
      describeMetric: (id) => Promise.resolve(definitionOf(id)),
      query: (id, params) => {
        queries.push({ id, params });
        return Promise.resolve(answerOf(['day'], []));
      },
    };

    const answers = await balanceAnswersOf(client, MONDAY_BUILD);

    expect(Object.keys(answers)).toEqual(Object.keys(BALANCE_METRICS));
    expect(queries.map((query) => query.id)).toEqual(Object.values(BALANCE_METRICS).map((id) => `stub.${id}`));
    for (const { id, params } of queries) {
      const metricId = id.slice('stub.'.length);
      expect(params).toEqual({
        grain: 'day',
        window: { to: '2026-11-23', last: '91d' },
        filters: [{ field: 'stub_field', op: 'eq', value: metricId }],
        groupBy: ['stub_group'],
        measures: [{ field: 'stub_measure', agg: 'count', as: 'stub' }],
        orderBy: [{ key: 'day', dir: 'asc' }],
      });
    }
  });
});

describe('liveBalanceOf: the baseline rules', () => {
  it('divides this week by the median of the 12 weeks before, a spike week left without pull', () => {
    const deploys = [
      ...baselineRows(MONDAY_BUILD, (day, week) => [day, week === 6
        ? 20
        : 2]),
      [dayBack(MONDAY_BUILD, 1), 3],
    ];

    const releases = indexNamed(liveBalanceOf(answersWith({ deploys }), MONDAY_BUILD), 'releases');

    expect(releases.current).toBe(3);
    expect(releases.baseline).toEqual({ rule: 'median', value: 2 });
    expect(releases.value).toBe(1.5);
  });

  it('control: the mean of the same weeks would give another value, so the median is the one read', () => {
    const weeks = [2, 2, 2, 2, 2, 20, 2, 2, 2, 2, 2, 2];
    const mean = weeks.reduce((sum, value) => sum + value, 0) / weeks.length;

    expect(baselineOf(weeks)).toEqual({ rule: 'median', value: 2 });
    expect(mean).toBe(3.5);
  });

  it('falls back to the mean of the 12 weeks when their median is 0, as a share non-zero in 2 of them', () => {
    const bugsByKind = [
      ...baselineRows(MONDAY_BUILD, (day) => [day, 'bug', 10]),
      [dayBack(MONDAY_BUILD, 0), 'bug', 10],
    ];
    const regressions = [
      [dayBack(MONDAY_BUILD, 14), 2],
      [dayBack(MONDAY_BUILD, 42), 2],
      [dayBack(MONDAY_BUILD, 0), 1],
    ];

    const share = indexNamed(liveBalanceOf(answersWith({ bugsByKind, regressions }), MONDAY_BUILD), 'regressions');

    expect(share.current).toBe(0.1);
    expect(share.baseline.rule).toBe('mean');
    expect(share.baseline.value).toBeCloseTo(0.4 / 12, 10);
    expect(share.value).toBe(3);
  });

  it('reads none in 12 weeks and draws at 0 for an index with no event in 12 weeks, whatever this week holds', () => {
    const ciVerdicts = [
      ...baselineRows(MONDAY_BUILD, (day) => [day, 'green', 5]),
      [dayBack(MONDAY_BUILD, 0), 'red', 4],
      [dayBack(MONDAY_BUILD, 0), 'green', 1],
    ];

    const red = indexNamed(liveBalanceOf(answersWith({ ciVerdicts }), MONDAY_BUILD), 'red-ci');

    expect(NONE_IN_12_WEEKS).toBe('none in 12 weeks');
    expect(red.current).toBe(0.8);
    expect(red.baseline).toEqual({ rule: 'none', value: 0 });
    expect(red.value).toBe(0);
  });

  it('reads every index as none in 12 weeks over a replica with no event, in catalogue order with its switches', () => {
    const indices = liveBalanceOf(EMPTY_ANSWERS, MONDAY_BUILD);

    expect(indices.map((index) => [index.id, index.on])).toEqual(BALANCE_CATALOGUE.map((index) => [index.id, index.on]));
    expect(indices.every((index) => index.baseline.rule === 'none' && index.value === 0 && index.current === 0)).toBe(true);
  });
});

describe('liveBalanceOf: a build time on a Monday', () => {
  /** One release tag in each baseline week, and three in the 7 days ending Monday: Tuesday, Sunday and Monday. */
  const deploys = [
    ...baselineRows(MONDAY_BUILD, (day) => [day, 1]),
    ['2026-11-17', 1],
    ['2026-11-22', 1],
    ['2026-11-23', 1],
  ];

  it('counts the 7 days ending with the build\'s Monday as this week, not the Monday alone', () => {
    const releases = indexNamed(liveBalanceOf(answersWith({ deploys }), MONDAY_BUILD), 'releases');

    expect(releases.current).toBe(3);
    expect(releases.baseline).toEqual({ rule: 'median', value: 1 });
    expect(releases.value).toBe(3);
  });

  it('control: the ISO week of that Monday holds one of the three tags, the dip a week bucket would show', () => {
    const isoWeek = deploys.filter(([day]) => typeof day === 'string' && day >= '2026-11-23');

    expect(isoWeek).toEqual([['2026-11-23', 1]]);
  });

  it('puts the Monday before the build\'s week in the first baseline week, and a Sunday build\'s own week in this week', () => {
    const mondayBuild = Date.parse('2026-11-23');
    const sundayBuild = Date.parse(SUNDAY_BUILD.slice(0, 10));

    expect(periodOf(Date.parse('2026-11-17'), mondayBuild)).toBe(0);
    expect(periodOf(Date.parse('2026-11-16'), mondayBuild)).toBe(1);
    expect(periodOf(Date.parse('2026-11-16'), sundayBuild)).toBe(0);
    expect(periodOf(Date.parse('2026-11-15'), sundayBuild)).toBe(1);
  });
});

describe('liveBalanceOf: each index\'s reading', () => {
  it('has a reading for every index of the catalogue', () => {
    expect(Object.keys(INDEX_WEEKS).sort()).toEqual(BALANCE_CATALOGUE.map((index) => index.id).sort());
  });

  it('counts the docs share over the areas tidied to docs, and says the stale docs wait on the replica', () => {
    const changes = [
      ...baselineRows(MONDAY_BUILD, (day) => [day, 'patch', 'docs', 1]),
      ...baselineRows(MONDAY_BUILD, (day) => [day, 'patch', 'effort', 3]),
      [dayBack(MONDAY_BUILD, 0), 'none', 'Documentation', 1],
      [dayBack(MONDAY_BUILD, 1), 'none', ' docs ', 1],
      [dayBack(MONDAY_BUILD, 2), 'patch', null, 2],
    ];

    const docs = indexNamed(liveBalanceOf(answersWith({ changes }), MONDAY_BUILD), 'docs-share');

    expect(docs.current).toBe(0.5);
    expect(docs.baseline).toEqual({ rule: 'median', value: 0.25 });
    expect(docs.value).toBe(2);
    expect(docs.definition).toBe(DOCS_SHARE_DEFINITION);
    expect(docs.definition).toContain('stale docs cleared wait on the replica');
  });

  it('reads features from major and minor entries, bugs per 100 sessions, blocked and repeated, and chore minutes', () => {
    const changes = [
      ...baselineRows(MONDAY_BUILD, (day) => [day, 'minor', 'cli', 2]),
      [dayBack(MONDAY_BUILD, 0), 'major', 'cli', 1],
      [dayBack(MONDAY_BUILD, 0), 'minor', 'cli', 2],
      [dayBack(MONDAY_BUILD, 0), 'patch', 'cli', 5],
    ];
    const sessions = [
      ...baselineRows(MONDAY_BUILD, (day) => [day, 'chore', 'done', 10, 100]),
      ...baselineRows(MONDAY_BUILD, (day) => [day, 'feature', 'blocked', 10, 100]),
      [dayBack(MONDAY_BUILD, 0), 'chore', 'done', 20, 300],
      [dayBack(MONDAY_BUILD, 0), 'fix', 'done', 20, 100],
    ];
    const outOfScope = [...baselineRows(MONDAY_BUILD, (day) => [day, 4]), [dayBack(MONDAY_BUILD, 0), 8]];
    const repeats = [[dayBack(MONDAY_BUILD, 0), 4]];
    const planCompletion = [...baselineRows(MONDAY_BUILD, (day) => [day, 4, 2]), [dayBack(MONDAY_BUILD, 0), 2, 2]];

    const indices = liveBalanceOf(answersWith({ changes, sessions, outOfScope, repeats, planCompletion }), MONDAY_BUILD);

    expect(indexNamed(indices, 'feat-rate')).toMatchObject({ current: 3, baseline: { rule: 'median', value: 2 }, value: 1.5 });
    expect(indexNamed(indices, 'bug-intake')).toMatchObject({ current: 20, baseline: { rule: 'median', value: 20 }, value: 1 });
    expect(indexNamed(indices, 'blocked')).toMatchObject({ current: 0.1, baseline: { rule: 'median', value: 0.5 }, value: 0.2 });
    expect(indexNamed(indices, 'refactor-share')).toMatchObject({ current: 0.75, baseline: { rule: 'median', value: 0.5 }, value: 1.5 });
    expect(indexNamed(indices, 'plan-done')).toMatchObject({ current: 1, baseline: { rule: 'median', value: 0.5 }, value: 2 });
  });

  it('refuses an answer without a column an index reads', () => {
    const broken: BalanceAnswers = { ...EMPTY_ANSWERS, deploys: answerOf(['day'], []) };

    expect(() => liveBalanceOf(broken, MONDAY_BUILD)).toThrow('atlas: the answer holds no deploys column');
  });
});
