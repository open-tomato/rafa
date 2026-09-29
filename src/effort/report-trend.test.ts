/**
 * Tests for the trend report (`report-trend.ts`), driven through
 * `summariseTrend` over planted session rows.
 *
 * Most cases read one fixed store of seven sessions in three loops, laid
 * out around a newest session that ends on 2026-09-20. With `days: 3` and
 * `recentDays: 2` the recent window is the 19th and 20th and the baseline
 * the 16th to the 18th, so the sessions on those boundaries show which side
 * each lands on:
 *
 * ```text
 * id  loop     starts (UTC)     minutes  window
 * o   plan-a   09-15 23:59      5        neither (a minute before the baseline)
 * b1  plan-a   09-16 00:00      10       baseline (its first instant)
 * b2  plan-a   09-17 10:00      20       baseline
 * b4  plan-b   09-17 12:00      50       baseline
 * b3  plan-b   09-18 23:59      30       baseline (a minute before the recent window)
 * r1  feat/x   09-19 00:00      20       recent (its first instant)
 * r2  feat/x   09-20 10:00      40       recent, the anchor: it ends 10:40
 * ```
 *
 * Each session's output tokens are its minutes times 100, its cache-read
 * tokens its minutes times 1000, and its turns its minutes over 10.
 */
import type { TrendOptions, TrendSessionRow } from './report-trend.js';

import { describe, expect, it } from 'bun:test';

import { DRIFT_METRICS, dominantKey, summariseTrend, TREND_METRICS } from './report-trend.js';
import { emptyUsageTotals } from './session-log.js';

const MS_PER_MINUTE = 60_000;

/** The windows described in the file note. */
const WINDOWS: TrendOptions = { days: 3, recentDays: 2, loops: null, by: null };

/** An instant on a day of September 2026, UTC. */
function at(day: number, clock: string): string {
  return `2026-09-${String(day).padStart(2, '0')}T${clock}:00.000Z`;
}

/** A task session of `minutes` starting at `start`, with `extra` laid over it. */
function task(sessionId: string, start: string, minutes: number, extra: Partial<TrendSessionRow> = {}): TrendSessionRow {
  return {
    sessionId,
    planStub: null,
    branch: null,
    kind: 'task',
    assistantRecordCount: minutes / 10,
    firstTimestamp: start,
    lastTimestamp: new Date(Date.parse(start) + minutes * MS_PER_MINUTE).toISOString(),
    entrypointCounts: {},
    modelCounts: {},
    usage: { ...emptyUsageTotals(), outputTokens: minutes * 100, cacheReadInputTokens: minutes * 1000 },
    ...extra,
  };
}

/** The store the file note lays out. */
function fixedStore(): TrendSessionRow[] {
  return [
    task('o', at(15, '23:59'), 5, { planStub: 'plan-a' }),
    task('b1', at(16, '00:00'), 10, { planStub: 'plan-a' }),
    task('b2', at(17, '10:00'), 20, { planStub: 'plan-a' }),
    task('b4', at(17, '12:00'), 50, { planStub: 'plan-b' }),
    task('b3', at(18, '23:59'), 30, { planStub: 'plan-b' }),
    task('r1', at(19, '00:00'), 20, { branch: 'feat/x' }),
    task('r2', at(20, '10:00'), 40, { branch: 'feat/x' }),
  ];
}

const NO_OUTCOMES = new Map<string, string>();
const NO_AGENTS = new Map<string, string>();

describe('dominantKey', () => {
  it('answers the key with the largest count', () => {
    expect(dominantKey({ a: 1, b: 2 })).toBe('b');
  });

  it('breaks a tie on the smaller key, whatever the order they were counted in', () => {
    expect(dominantKey({ b: 1, a: 1 })).toBe('a');
    expect(dominantKey({ a: 1, b: 1 })).toBe('a');
  });

  it('answers null for no counts', () => {
    expect(dominantKey({})).toBeNull();
    expect(dominantKey(undefined)).toBeNull();
  });
});

describe('summariseTrend, which rows it reads', () => {
  it('reads only task rows holding both timestamps that parse', () => {
    const rows = [
      task('kept', at(20, '10:00'), 10),
      task('wrap', at(20, '11:00'), 10, { kind: 'wrap-up' }),
      task('no-last', at(20, '12:00'), 10, { lastTimestamp: null }),
      task('no-first', at(20, '13:00'), 10, { firstTimestamp: null }),
      task('garbled', at(20, '14:00'), 10, { firstTimestamp: 'not a date' }),
    ];

    const report = summariseTrend(rows, NO_OUTCOMES, NO_AGENTS, WINDOWS);

    expect(report.taskSessions).toBe(1);
    expect(report.trend.recent?.sessions).toBe(1);
    expect(report.loops.rows.map((row) => row.tasks)).toEqual([1]);
  });

  it('reads no session of another kind into the anchor', () => {
    const rows = [task('kept', at(20, '10:00'), 10), task('later', at(25, '10:00'), 10, { kind: 'search' })];

    expect(summariseTrend(rows, NO_OUTCOMES, NO_AGENTS, WINDOWS).trend.anchor).toBe(at(20, '10:10'));
  });
});

describe('summariseTrend, the windows', () => {
  it('anchors on the newest session\'s last record and ends the recent window on its UTC day', () => {
    const { trend } = summariseTrend(fixedStore(), NO_OUTCOMES, NO_AGENTS, WINDOWS);

    expect(trend.anchor).toBe(at(20, '10:40'));
    expect(trend.recent).toEqual({ from: '2026-09-19', to: '2026-09-20', sessions: 2 });
    expect(trend.baseline).toEqual({ from: '2026-09-16', to: '2026-09-18', sessions: 4 });
  });

  it('anchors on the greatest last record, not the last row or the latest start', () => {
    const rows = [
      task('long', at(20, '01:00'), 600),
      task('later-start', at(20, '02:00'), 5),
    ];

    expect(summariseTrend(rows, NO_OUTCOMES, NO_AGENTS, WINDOWS).trend.anchor).toBe(at(20, '11:00'));
  });

  it('puts a session starting at the first instant of a window in it and one a minute earlier in the window before', () => {
    const { trend } = summariseTrend(fixedStore(), NO_OUTCOMES, NO_AGENTS, WINDOWS);

    // r1 starts 09-19 00:00: recent. b3 starts 09-18 23:59: baseline.
    // b1 starts 09-16 00:00: baseline. o starts 09-15 23:59: neither.
    expect(trend.recent?.sessions).toBe(2);
    expect(trend.baseline?.sessions).toBe(4);
    expect(trend.days.map((day) => day.day)).toEqual(['2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20']);
  });

  it('reads recentDays 1 as the anchor\'s day alone', () => {
    const { trend } = summariseTrend(fixedStore(), NO_OUTCOMES, NO_AGENTS, { ...WINDOWS, recentDays: 1 });

    expect(trend.recent).toEqual({ from: '2026-09-20', to: '2026-09-20', sessions: 1 });
    // b2, b4, b3 and r1 start on the 17th to the 19th.
    expect(trend.baseline).toEqual({ from: '2026-09-17', to: '2026-09-19', sessions: 4 });
  });
});

describe('summariseTrend, the metrics', () => {
  it('answers the four metrics in order, each with its baseline and recent p50 and p90 and the change of the median', () => {
    const { metrics } = summariseTrend(fixedStore(), NO_OUTCOMES, NO_AGENTS, WINDOWS).trend;

    expect(metrics.map((metric) => metric.name)).toEqual([...TREND_METRICS]);
    // Baseline minutes 10, 20, 30, 50: p50 is the third by nearest rank, p90 the fourth.
    // Recent minutes 20, 40: both quantiles are the second.
    expect(metrics[0]).toEqual({
      name: 'minutes',
      baselineP50: 30,
      recentP50: 40,
      changePct: 33.333,
      baselineP90: 50,
      recentP90: 40,
    });
    expect(metrics[1]).toEqual({
      name: 'outputTokens',
      baselineP50: 3000,
      recentP50: 4000,
      changePct: 33.333,
      baselineP90: 5000,
      recentP90: 4000,
    });
    expect(metrics[2]?.baselineP50).toBe(30_000);
    expect(metrics[3]).toMatchObject({ name: 'turns', baselineP50: 3, recentP50: 4 });
  });

  it('answers a negative change when the recent median is lower', () => {
    const rows = [
      task('b', at(16, '10:00'), 40),
      task('r', at(20, '10:00'), 30),
    ];

    const minutes = summariseTrend(rows, NO_OUTCOMES, NO_AGENTS, WINDOWS).trend.metrics[0];

    expect(minutes?.changePct).toBe(-25);
  });

  it('answers a null change when the baseline median is 0, and null figures when a window is empty', () => {
    const zeroTurns = [
      task('b', at(16, '10:00'), 10, { assistantRecordCount: 0 }),
      task('r', at(20, '10:00'), 10),
    ];
    const noBaseline = [task('r', at(20, '10:00'), 10)];

    const turns = summariseTrend(zeroTurns, NO_OUTCOMES, NO_AGENTS, WINDOWS).trend.metrics[3];
    const minutes = summariseTrend(noBaseline, NO_OUTCOMES, NO_AGENTS, WINDOWS).trend.metrics[0];

    expect(turns).toMatchObject({ baselineP50: 0, recentP50: 1, changePct: null });
    expect(minutes).toEqual({
      name: 'minutes',
      baselineP50: null,
      recentP50: 10,
      changePct: null,
      baselineP90: null,
      recentP90: 10,
    });
  });
});

describe('summariseTrend, the not-done share', () => {
  it('is the share of reported sessions whose outcome is not done, per window', () => {
    const outcomes = new Map([['b1', 'done'], ['b2', 'blocked'], ['b3', 'done'], ['r1', 'done']]);

    const { notDoneShare } = summariseTrend(fixedStore(), outcomes, NO_AGENTS, WINDOWS).trend;

    // Baseline: three reported, one blocked. Recent: r1 alone reported, done.
    // b4 and r2 have no report and count in neither figure.
    expect(notDoneShare).toEqual({ baseline: 0.333, recent: 0 });
  });

  it('is null in a window where no session reported', () => {
    const outcomes = new Map([['r2', 'failed']]);

    const { notDoneShare } = summariseTrend(fixedStore(), outcomes, NO_AGENTS, WINDOWS).trend;

    expect(notDoneShare).toEqual({ baseline: null, recent: 1 });
    expect(summariseTrend(fixedStore(), NO_OUTCOMES, NO_AGENTS, WINDOWS).trend.notDoneShare).toEqual({
      baseline: null,
      recent: null,
    });
  });
});

describe('summariseTrend, the day rows', () => {
  it('answers one row per UTC day of both windows, oldest first, summarising that day\'s sessions', () => {
    const { days } = summariseTrend(fixedStore(), NO_OUTCOMES, NO_AGENTS, WINDOWS).trend;

    expect(days).toHaveLength(5);
    // The 17th holds b2 (20 min, plan-a) and b4 (50 min, plan-b).
    expect(days[1]).toEqual({
      day: '2026-09-17',
      sessions: 2,
      minutesP50: 50,
      minutesP90: 50,
      minutesMax: 50,
      outputTokensP50: 5000,
      workHours: 1.167,
      loops: 2,
    });
    // The 16th holds b1 alone.
    expect(days[0]).toMatchObject({ day: '2026-09-16', sessions: 1, minutesMax: 10, workHours: 0.167, loops: 1 });
  });

  it('counts a loop once for a day holding two of its sessions', () => {
    const rows = [
      task('a', at(20, '08:00'), 10, { planStub: 'p' }),
      task('b', at(20, '09:00'), 10, { planStub: 'p' }),
    ];

    expect(summariseTrend(rows, NO_OUTCOMES, NO_AGENTS, WINDOWS).trend.days[0]).toMatchObject({ sessions: 2, loops: 1 });
  });

  it('files a session under the day it started, not the day it ended', () => {
    const rows = [task('overnight', at(19, '23:30'), 60), task('later', at(20, '10:00'), 10)];

    const { days } = summariseTrend(rows, NO_OUTCOMES, NO_AGENTS, WINDOWS).trend;

    expect(days.map((day) => [day.day, day.sessions])).toEqual([['2026-09-19', 1], ['2026-09-20', 1]]);
  });
});

describe('summariseTrend, the outliers', () => {
  /** Nine ten-minute and one twelve-minute baseline session: median 10, MAD 0, so the line is 10. */
  function baselineOf(count: number): TrendSessionRow[] {
    return Array.from({ length: count }, (_, index) => task(
      index === count - 1
        ? 'b-12'
        : `b-${index}`,
      at(15, `${String(index).padStart(2, '0')}:00`),
      index === count - 1
        ? 12
        : 10,
    ));
  }

  function outlierStore(baselineCount = 10): TrendSessionRow[] {
    return [
      ...baselineOf(baselineCount),
      task('r-11', at(19, '10:00'), 11, { planStub: 'loop-1', taskText: 'a little over' }),
      task('r-60', at(19, '12:00'), 60, { planStub: 'loop-1', taskText: 'the long one' }),
      task('r-10', at(19, '15:00'), 10),
      task('r-30', at(20, '10:00'), 30, { branch: 'feat/y' }),
    ];
  }

  it('lists recent sessions strictly over the baseline\'s line, longest first, with their report outcome and text', () => {
    const outcomes = new Map([['r-60', 'blocked']]);

    const { outliers } = summariseTrend(outlierStore(), outcomes, NO_AGENTS, { ...WINDOWS, days: 5 }).trend;

    expect(outliers.limitMinutes).toBe(10);
    expect(outliers.sessions.map((session) => session.sessionId)).toEqual(['r-60', 'r-30', 'r-11']);
    expect(outliers.sessions[0]).toEqual({
      sessionId: 'r-60',
      loop: 'loop-1',
      firstTimestamp: at(19, '12:00'),
      minutes: 60,
      outputTokens: 6000,
      outcome: 'blocked',
      taskText: 'the long one',
    });
    expect(outliers.sessions[1]).toMatchObject({ loop: 'feat/y', outcome: null, taskText: null });
  });

  it('answers a null limit and no sessions when the baseline is under ten sessions, however long the recent ones ran', () => {
    const nine = summariseTrend(outlierStore(9), NO_OUTCOMES, NO_AGENTS, { ...WINDOWS, days: 5 }).trend;
    const ten = summariseTrend(outlierStore(10), NO_OUTCOMES, NO_AGENTS, { ...WINDOWS, days: 5 }).trend;

    expect(nine.baseline?.sessions).toBe(9);
    expect(nine.outliers).toEqual({ limitMinutes: null, sessions: [] });
    expect(ten.outliers.limitMinutes).toBe(10);
  });

  it('answers a null limit and no sessions when the baseline is empty', () => {
    const rows = [task('only', at(20, '10:00'), 99)];

    expect(summariseTrend(rows, NO_OUTCOMES, NO_AGENTS, WINDOWS).trend.outliers).toEqual({
      limitMinutes: null,
      sessions: [],
    });
  });

  it('does not list a baseline session over its own line', () => {
    const { outliers } = summariseTrend(outlierStore(), NO_OUTCOMES, NO_AGENTS, { ...WINDOWS, days: 5 }).trend;

    expect(outliers.sessions.map((session) => session.sessionId)).not.toContain('b-12');
  });
});

describe('summariseTrend, the loop rows', () => {
  it('groups by plan stub, else branch, and lists the loops of the window newest first', () => {
    const { loops } = summariseTrend(fixedStore(), NO_OUTCOMES, NO_AGENTS, WINDOWS);

    // The loop window is 3 days ending on the 20th, from 09-18 00:00: plan-a's
    // last record is on the 17th, so it is out.
    expect(loops.days).toBe(3);
    expect(loops.loops).toBeNull();
    expect(loops.rows.map((row) => [row.key, row.kind, row.tasks])).toEqual([
      ['feat/x', 'branch', 2],
      ['plan-b', 'plan', 2],
    ]);
  });

  it('takes the newest n loops whatever their age with loops: n, and names no window', () => {
    const three = summariseTrend(fixedStore(), NO_OUTCOMES, NO_AGENTS, { ...WINDOWS, loops: 3 }).loops;
    const one = summariseTrend(fixedStore(), NO_OUTCOMES, NO_AGENTS, { ...WINDOWS, loops: 1 }).loops;

    expect(three.rows.map((row) => row.key)).toEqual(['feat/x', 'plan-b', 'plan-a']);
    expect(three.days).toBeNull();
    expect(three.loops).toBe(3);
    expect(one.rows.map((row) => row.key)).toEqual(['feat/x']);
  });

  it('takes every loop when loops asks for more than there are', () => {
    const { loops } = summariseTrend(fixedStore(), NO_OUTCOMES, NO_AGENTS, { ...WINDOWS, loops: 50 });

    expect(loops.rows).toHaveLength(3);
  });

  it('keeps a loop whose last record is on the first day of the loop window', () => {
    const rows = [
      task('old', at(18, '00:00'), 10, { planStub: 'edge' }),
      task('new', at(20, '10:00'), 10, { planStub: 'now' }),
    ];
    const outside = [task('old', at(17, '23:00'), 10, { planStub: 'edge' }), rows[1] as TrendSessionRow];

    expect(summariseTrend(rows, NO_OUTCOMES, NO_AGENTS, WINDOWS).loops.rows.map((row) => row.key)).toEqual(['now', 'edge']);
    // Ends 23:10 on the 17th, before 09-18 00:00.
    expect(summariseTrend(outside, NO_OUTCOMES, NO_AGENTS, WINDOWS).loops.rows.map((row) => row.key)).toEqual(['now']);
  });

  it('keeps a plan and a branch of one name as two loops', () => {
    const rows = [
      task('a', at(20, '08:00'), 10, { planStub: 'same' }),
      task('b', at(20, '09:00'), 10, { branch: 'same' }),
    ];

    const { rows: loopRows } = summariseTrend(rows, NO_OUTCOMES, NO_AGENTS, WINDOWS).loops;

    expect(loopRows.map((row) => [row.key, row.kind])).toEqual([['same', 'branch'], ['same', 'plan']]);
  });

  it('orders rows by first timestamp descending', () => {
    const rows = [
      task('a', at(20, '08:00'), 10, { planStub: 'first' }),
      task('b', at(20, '11:00'), 10, { planStub: 'third' }),
      task('c', at(20, '09:00'), 10, { planStub: 'second' }),
    ];

    const { rows: loopRows } = summariseTrend(rows, NO_OUTCOMES, NO_AGENTS, WINDOWS).loops;

    expect(loopRows.map((row) => row.key)).toEqual(['third', 'second', 'first']);
  });

  it('answers each loop\'s first and last record, wall and work minutes, and task counts', () => {
    const feat = summariseTrend(fixedStore(), NO_OUTCOMES, NO_AGENTS, { ...WINDOWS, loops: 3 }).loops.rows[0];

    // r1 09-19 00:00 to r2 09-20 10:40 is 34 h 40 min; the two sessions ran 20 + 40 min.
    expect(feat).toMatchObject({
      key: 'feat/x',
      firstTimestamp: at(19, '00:00'),
      lastTimestamp: at(20, '10:40'),
      wallMinutes: 2080,
      workMinutes: 60,
      tasks: 2,
    });
    expect(feat?.perTask.minutes).toEqual({ min: 20, max: 40, avg: 30, p50: 40 });
    expect(feat?.perTask.outputTokens).toEqual({ min: 2000, max: 4000, avg: 3000, p50: 4000 });
    expect(feat?.perTask.turns).toEqual({ min: 2, max: 4, avg: 3, p50: 4 });
  });

  it('separates wall-clock minutes, gap included, from work minutes', () => {
    const rows = [
      task('a', at(20, '10:00'), 30, { planStub: 'gappy' }),
      task('b', at(20, '12:00'), 15, { planStub: 'gappy' }),
    ];

    const [row] = summariseTrend(rows, NO_OUTCOMES, NO_AGENTS, WINDOWS).loops.rows;

    // 10:00 to 12:15 is 135 minutes; the sessions ran 30 + 15.
    expect(row).toMatchObject({ wallMinutes: 135, workMinutes: 45, tasks: 2 });
  });

  it('takes a loop\'s last record from the session that ended last, not the one that started last', () => {
    const rows = [
      task('long', at(20, '08:00'), 300, { planStub: 'p' }),
      task('short', at(20, '09:00'), 10, { planStub: 'p' }),
    ];

    const [row] = summariseTrend(rows, NO_OUTCOMES, NO_AGENTS, WINDOWS).loops.rows;

    expect(row?.lastTimestamp).toBe(at(20, '13:00'));
    expect(row?.wallMinutes).toBe(300);
  });

  it('counts not-done and unreported tasks apart', () => {
    const rows = [
      task('a', at(20, '08:00'), 10, { planStub: 'p' }),
      task('b', at(20, '09:00'), 10, { planStub: 'p' }),
      task('c', at(20, '10:00'), 10, { planStub: 'p' }),
      task('d', at(20, '11:00'), 10, { planStub: 'p' }),
    ];
    const outcomes = new Map([['a', 'done'], ['b', 'blocked'], ['c', 'failed']]);

    const [row] = summariseTrend(rows, outcomes, NO_AGENTS, WINDOWS).loops.rows;

    expect(row).toMatchObject({ tasks: 4, notDone: 2, unreported: 1 });
  });

  it('counts models, efforts and agents by each session\'s dominant value, with (none) for a session without one', () => {
    const rows = [
      task('a', at(20, '08:00'), 10, { planStub: 'p', modelCounts: { opus: 3, haiku: 1 }, effortCounts: { high: 2 } }),
      task('b', at(20, '09:00'), 10, { planStub: 'p', modelCounts: { opus: 1 }, effortCounts: { low: 1, high: 1 } }),
      task('c', at(20, '10:00'), 10, { planStub: 'p', modelCounts: { haiku: 2 } }),
      task('d', at(20, '11:00'), 10, { planStub: 'p' }),
    ];
    const agents = new Map([['a', 'coder'], ['b', 'coder'], ['c', 'reviewer']]);

    const [row] = summariseTrend(rows, NO_OUTCOMES, agents, WINDOWS).loops.rows;

    expect(row?.models).toEqual({ opus: 2, haiku: 1, '(none)': 1 });
    // b ties high and low, and the smaller key, high, wins.
    expect(row?.efforts).toEqual({ high: 2, '(none)': 2 });
    expect(row?.agents).toEqual({ coder: 2, reviewer: 1, '(none)': 1 });
  });

  it('carries no sub-rows without --by', () => {
    const [row] = summariseTrend(fixedStore(), NO_OUTCOMES, NO_AGENTS, WINDOWS).loops.rows;

    expect(row?.groups).toBeNull();
    expect(summariseTrend(fixedStore(), NO_OUTCOMES, NO_AGENTS, WINDOWS).loops.by).toBeNull();
  });
});

describe('summariseTrend, the --by sub-rows', () => {
  function splitStore(): TrendSessionRow[] {
    return [
      task('s1', at(20, '08:00'), 10, { planStub: 'p', effortCounts: { low: 1 } }),
      task('s2', at(20, '09:00'), 20, { planStub: 'p', effortCounts: { low: 2, high: 1 } }),
      task('s3', at(20, '10:00'), 30, { planStub: 'p', effortCounts: { high: 1 } }),
      task('s4', at(20, '11:00'), 40, { planStub: 'p', effortCounts: { high: 1 } }),
      task('s5', at(20, '12:00'), 50, { planStub: 'p' }),
    ];
  }

  it('splits each loop by effort, most tasks first, a session without one under (none)', () => {
    const { loops } = summariseTrend(splitStore(), NO_OUTCOMES, NO_AGENTS, { ...WINDOWS, by: 'effort' });

    expect(loops.by).toBe('effort');
    const groups = loops.rows[0]?.groups;
    expect(groups?.map((group) => [group.key, group.tasks, group.workMinutes])).toEqual([
      ['high', 2, 70],
      ['low', 2, 30],
      ['(none)', 1, 50],
    ]);
  });

  it('gives a sub-row its own per-task spread', () => {
    const { loops } = summariseTrend(splitStore(), NO_OUTCOMES, NO_AGENTS, { ...WINDOWS, by: 'effort' });

    const low = loops.rows[0]?.groups?.find((group) => group.key === 'low');

    expect(low?.perTask.minutes).toEqual({ min: 10, max: 20, avg: 15, p50: 20 });
  });

  it('splits by dispatched agent, breaking a tie on the key', () => {
    const agents = new Map([['s1', 'reviewer'], ['s2', 'coder'], ['s3', 'coder'], ['s4', 'reviewer']]);

    const { loops } = summariseTrend(splitStore(), NO_OUTCOMES, agents, { ...WINDOWS, by: 'agent' });

    expect(loops.rows[0]?.groups?.map((group) => [group.key, group.tasks])).toEqual([
      ['coder', 2],
      ['reviewer', 2],
      ['(none)', 1],
    ]);
  });

  it('splits by dominant model', () => {
    const rows = [
      task('a', at(20, '08:00'), 10, { planStub: 'p', modelCounts: { opus: 1 } }),
      task('b', at(20, '09:00'), 10, { planStub: 'p', modelCounts: { haiku: 1 } }),
      task('c', at(20, '10:00'), 10, { planStub: 'p', modelCounts: { haiku: 1 } }),
    ];

    const groups = summariseTrend(rows, NO_OUTCOMES, NO_AGENTS, { ...WINDOWS, by: 'model' }).loops.rows[0]?.groups;

    expect(groups?.map((group) => [group.key, group.tasks])).toEqual([['haiku', 2], ['opus', 1]]);
  });
});

describe('summariseTrend, the drift', () => {
  /** Five loops, one session each, one a day, whose minutes are `minutes` in start order. */
  function fiveLoops(minutes: readonly number[]): TrendSessionRow[] {
    return minutes.map((value, index) => task(`s${index}`, at(10 + index, '10:00'), value, { planStub: `loop-${index}` }));
  }

  it('answers one reading per drift metric, in order', () => {
    const { drift } = summariseTrend(fiveLoops([10, 20, 30, 40, 50]), NO_OUTCOMES, NO_AGENTS, { ...WINDOWS, days: 30 }).loops;

    expect(drift.map((reading) => reading.metric)).toEqual([...DRIFT_METRICS]);
    expect(DRIFT_METRICS).toEqual(['tasks', 'minutesP50', 'outputTokensP50', 'cacheReadTokensP50', 'turnsP50']);
  });

  it('reads the loops oldest first, so rising minutes in start order read as rising', () => {
    const { drift, rows } = summariseTrend(fiveLoops([10, 20, 30, 40, 50]), NO_OUTCOMES, NO_AGENTS, { ...WINDOWS, days: 30 }).loops;

    // The rows are newest first; the test still reads them the other way.
    expect(rows.map((row) => row.key)).toEqual(['loop-4', 'loop-3', 'loop-2', 'loop-1', 'loop-0']);
    // s = 10, variance 5 * 4 * 15 / 18 = 16.667, z = 9 / 4.0825 = 2.2045, rounded to 2.205.
    expect(drift[1]).toMatchObject({ metric: 'minutesP50', n: 5, s: 10, tau: 1, direction: 'rising' });
    expect(drift[1]?.z).toBe(2.205);
    expect(drift[2]?.direction).toBe('rising');
    expect(drift[3]?.direction).toBe('rising');
    expect(drift[4]?.direction).toBe('rising');
  });

  it('reads falling minutes in start order as falling', () => {
    const { drift } = summariseTrend(fiveLoops([50, 40, 30, 20, 10]), NO_OUTCOMES, NO_AGENTS, { ...WINDOWS, days: 30 }).loops;

    expect(drift[1]).toMatchObject({ s: -10, tau: -1, direction: 'falling' });
  });

  it('reads tasks per loop as no steady trend when every loop holds one task', () => {
    const { drift } = summariseTrend(fiveLoops([10, 20, 30, 40, 50]), NO_OUTCOMES, NO_AGENTS, { ...WINDOWS, days: 30 }).loops;

    expect(drift[0]).toMatchObject({ metric: 'tasks', s: 0, tau: 0, direction: 'no steady trend' });
  });

  it('answers too few values under four loops', () => {
    const { drift } = summariseTrend(fiveLoops([10, 20, 30]), NO_OUTCOMES, NO_AGENTS, { ...WINDOWS, days: 30 }).loops;

    expect(drift.every((reading) => reading.direction === 'too few values' && reading.tau === null && reading.z === null)).toBe(true);
    expect(drift[0]?.n).toBe(3);
  });

  it('reads only the loops the selection picked', () => {
    const { drift } = summariseTrend(fiveLoops([10, 20, 30, 40, 50]), NO_OUTCOMES, NO_AGENTS, { ...WINDOWS, days: 30, loops: 3 }).loops;

    expect(drift[0]?.n).toBe(3);
  });
});

describe('summariseTrend over no task session', () => {
  it('answers a null anchor and windows, empty rows, and a drift of too few values', () => {
    const report = summariseTrend([], NO_OUTCOMES, NO_AGENTS, WINDOWS);

    expect(report.taskSessions).toBe(0);
    expect(report.trend).toEqual({
      anchor: null,
      baseline: null,
      recent: null,
      metrics: [],
      notDoneShare: { baseline: null, recent: null },
      days: [],
      outliers: { limitMinutes: null, sessions: [] },
    });
    expect(report.loops.rows).toEqual([]);
    expect(report.loops.days).toBe(3);
    expect(report.loops.drift).toHaveLength(DRIFT_METRICS.length);
    expect(report.loops.drift.every((reading) => reading.direction === 'too few values')).toBe(true);
  });

  it('answers the same for rows none of which is a task with a span', () => {
    const rows = [task('w', at(20, '10:00'), 10, { kind: 'wrap-up' })];

    const report = summariseTrend(rows, NO_OUTCOMES, NO_AGENTS, { ...WINDOWS, loops: 5, by: 'agent' });

    expect(report.taskSessions).toBe(0);
    expect(report.trend.anchor).toBeNull();
    expect(report.loops).toMatchObject({ days: null, loops: 5, by: 'agent', rows: [] });
  });
});
