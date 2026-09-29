/**
 * Tests for the trend report's text (`report-trend-format.ts`): the compact
 * figure formatters at their edges, and the lines `formatTrendReport`
 * writes over reports summarised from planted session rows.
 */
import type { TrendOptions, TrendReport, TrendSessionRow } from './report-trend.js';

import { describe, expect, it } from 'bun:test';

import { formatChange, formatShare, formatTokens, formatTrendReport } from './report-trend-format.js';
import { summariseTrend } from './report-trend.js';
import { emptyUsageTotals } from './session-log.js';

const MS_PER_MINUTE = 60_000;

const WINDOWS: TrendOptions = { days: 5, recentDays: 2, loops: null, by: null };

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
    assistantRecordCount: 5,
    firstTimestamp: start,
    lastTimestamp: new Date(Date.parse(start) + minutes * MS_PER_MINUTE).toISOString(),
    entrypointCounts: {},
    modelCounts: {},
    usage: { ...emptyUsageTotals(), outputTokens: minutes * 1000, cacheReadInputTokens: minutes * 100_000 },
    ...extra,
  };
}

/** The report over `rows`, with `outcomes` and the windows `options` lays over {@link WINDOWS}. */
function report(
  rows: readonly TrendSessionRow[],
  outcomes: ReadonlyMap<string, string> = new Map(),
  options: Partial<TrendOptions> = {},
): TrendReport {
  return summariseTrend(rows, outcomes, new Map(), { ...WINDOWS, ...options });
}

/** A baseline of four ten-minute sessions on the 17th and one ninety-minute one on the 20th. */
function smallStore(): TrendSessionRow[] {
  return [
    task('b1', at(17, '10:00'), 10, { planStub: 'plan-a', effortCounts: { high: 1 } }),
    task('b2', at(17, '11:00'), 10, { planStub: 'plan-a', effortCounts: { high: 1 } }),
    task('b3', at(17, '12:00'), 10, { planStub: 'plan-a', effortCounts: { high: 1 } }),
    task('b4', at(17, '13:00'), 12, { planStub: 'plan-a', effortCounts: { high: 1 } }),
    task('r1', at(20, '10:00'), 90, { planStub: 'plan-b', effortCounts: { low: 1 }, taskText: 'the long\n one' }),
  ];
}

/** Ten baseline sessions, nine of ten minutes and one of twelve, so the outlier line is 10, then `recent`. */
function outlierStore(recent: readonly TrendSessionRow[]): TrendSessionRow[] {
  const baseline = Array.from({ length: 10 }, (_, index) => task(
    `b${index}`,
    at(16, `${String(index).padStart(2, '0')}:00`),
    index === 9
      ? 12
      : 10,
  ));
  return [...baseline, ...recent];
}

describe('formatTokens', () => {
  it('writes a count under a thousand whole', () => {
    expect(formatTokens(812)).toBe('812');
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(999)).toBe('999');
  });

  it('writes thousands, millions and billions with their suffix', () => {
    expect(formatTokens(52_000)).toBe('52k');
    expect(formatTokens(1_000)).toBe('1k');
    expect(formatTokens(5_400_000)).toBe('5.4M');
    expect(formatTokens(1_000_000)).toBe('1.0M');
    expect(formatTokens(8_300_000_000)).toBe('8.3B');
    expect(formatTokens(999_999)).toBe('1.0M');
    expect(formatTokens(999_960_000)).toBe('1.0B');
  });

  it('rounds thousands to a whole number', () => {
    expect(formatTokens(1_499)).toBe('1k');
    expect(formatTokens(1_500)).toBe('2k');
  });

  it('writes a dash for null', () => {
    expect(formatTokens(null)).toBe('-');
  });
});

describe('formatShare', () => {
  it('writes a share as a whole percent', () => {
    expect(formatShare(0.256)).toBe('26%');
    expect(formatShare(0)).toBe('0%');
    expect(formatShare(1)).toBe('100%');
  });

  it('writes a dash for null', () => {
    expect(formatShare(null)).toBe('-');
  });
});

describe('formatChange', () => {
  it('signs a rise with a plus and a fall with a minus, in whole percents', () => {
    expect(formatChange(26.4)).toBe('+26%');
    expect(formatChange(-3.2)).toBe('-3%');
  });

  it('writes zero, and a change that rounds to zero, without a sign', () => {
    expect(formatChange(0)).toBe('0%');
    expect(formatChange(0.4)).toBe('0%');
    expect(formatChange(-0.4)).toBe('0%');
  });

  it('writes a dash for null', () => {
    expect(formatChange(null)).toBe('-');
  });
});

describe('formatTrendReport', () => {
  it('opens with the count and the anchor in UTC, then the TREND and LOOPS headings', () => {
    const lines = formatTrendReport(report(smallStore()));

    expect(lines[0]).toBe('effort report --trend: 5 task sessions, newest ends 2026-09-20 11:30 UTC');
    expect(lines).toContain('TREND');
    expect(lines).toContain('LOOPS');
    expect(lines.indexOf('TREND')).toBeLessThan(lines.indexOf('LOOPS'));
  });

  it('writes the windows and one line per metric with its change', () => {
    const text = formatTrendReport(report(smallStore())).join('\n');

    expect(text).toContain('  recent    2026-09-19 to 2026-09-20, 1 task session');
    expect(text).toContain('  baseline  2026-09-14 to 2026-09-18, 4 task sessions');
    expect(text).toMatch(/minutes\s+10\.0\s+90\.0\s+\+800%\s+12\.0\s+90\.0/);
    expect(text).toMatch(/output tokens\s+10k\s+90k\s+\+800%/);
    expect(text).toMatch(/cache-read tokens\s+1\.0M\s+9\.0M\s+\+800%/);
    expect(text).toMatch(/turns\s+5\s+5\s+0%/);
  });

  it('writes the not-done share of each window, a dash where none reported', () => {
    const lines = formatTrendReport(report(smallStore(), new Map([['r1', 'blocked']])));

    expect(lines.find((line) => line.startsWith('not done'))).toMatch(/^not done\s+-\s+100%$/);
  });

  it('writes one row per day and one per loop, each loop\'s effort histogram beside it', () => {
    const lines = formatTrendReport(report(smallStore()));

    expect(lines.some((line) => /^2026-09-17\s+4\s+10\.0\s+12\.0\s+12\.0\s+10k\s+0\.7\s+1$/.test(line))).toBe(true);
    expect(lines.find((line) => line.startsWith('plan-b'))).toMatch(/2026-09-20 10:00\s+1\.5\s+1\.5\s+1\s.*low=1$/);
    expect(lines.find((line) => line.startsWith('plan-a'))).toMatch(/2026-09-17 10:00\s+3\.2\s+0\.7\s+4\s.*high=4$/);
  });

  it('lists the outliers over the line, collapsing the task text to one line', () => {
    const rows = outlierStore([task('r1', at(20, '10:00'), 90, { planStub: 'plan-b', taskText: 'the long\n one' })]);

    const text = formatTrendReport(report(rows)).join('\n');

    expect(text).toContain('outliers: 1 recent session over 10.0 min (baseline median + 3 robust SD)');
    expect(text).toContain('  90.0 min  90k out  no report  plan-b');
    expect(text).toContain('    the long one');
  });

  it('names the outcome an outlier\'s report gave', () => {
    const rows = outlierStore([task('r1', at(20, '10:00'), 90, { planStub: 'plan-b' })]);

    const text = formatTrendReport(report(rows, new Map([['r1', 'blocked']]))).join('\n');

    expect(text).toContain('  90.0 min  90k out  blocked  plan-b');
  });

  it('keeps the first 100 characters of an outlier\'s task text', () => {
    const rows = outlierStore([task('r1', at(20, '10:00'), 90, { taskText: `${'a'.repeat(100)}TAIL` })]);

    const text = formatTrendReport(report(rows)).join('\n');

    expect(text).toContain(`    ${'a'.repeat(100)}\n`);
    expect(text).not.toContain('TAIL');
  });

  it('lists ten outliers and points the rest at the JSON', () => {
    const recent = Array.from({ length: 12 }, (_, index) => task(`r${index}`, at(20, `${String(index).padStart(2, '0')}:00`), 50));

    const lines = formatTrendReport(report(outlierStore(recent)));

    expect(lines.filter((line) => line.startsWith('  50.0 min'))).toHaveLength(10);
    expect(lines).toContain('  and 2 more in --output=json');
  });

  it('lists an outlier block with no session when nothing is over the line', () => {
    const lines = formatTrendReport(report(outlierStore([task('r1', at(20, '10:00'), 10)])));

    expect(lines).toContain('outliers: 0 recent sessions over 10.0 min (baseline median + 3 robust SD)');
  });

  it('writes no outliers block when the baseline is under ten sessions', () => {
    const text = formatTrendReport(report(smallStore())).join('\n');

    expect(text).not.toContain('outliers:');
  });

  it('writes the loops selection as a window, or as the newest n', () => {
    const window = formatTrendReport(report(smallStore())).join('\n');
    const newest = formatTrendReport(report(smallStore(), new Map(), { loops: 2 })).join('\n');

    expect(window).toContain('  loops active in the last 5 days, newest first; times are UTC, minutes per task');
    expect(newest).toContain('  the newest 2 loops, newest first; times are UTC, minutes per task');
  });

  it('writes sub-rows under a loop and names the split when --by is given', () => {
    const lines = formatTrendReport(report(smallStore(), new Map(), { by: 'effort' }));

    expect(lines.join('\n')).toContain('newest first, split by effort;');
    expect(lines.some((line) => /^ {2}low\s+1\.5\s+1\s/.test(line))).toBe(true);
    expect(lines.some((line) => /^ {2}high\s+0\.7\s+4\s/.test(line))).toBe(true);
  });

  it('writes the drift line and one reading per metric, with tau and z to two decimals', () => {
    const rising = [10, 20, 30, 40, 50].map((minutes, index) => task(`s${index}`, at(10 + index, '10:00'), minutes, { planStub: `loop-${index}` }));

    const lines = formatTrendReport(report(rising, new Map(), { days: 30 }));

    expect(lines).toContain('  drift across 5 loops, oldest to newest (Mann-Kendall; rising or falling at |z| >= 1.96)');
    expect(lines.find((line) => line.includes('minutes per task (p50)'))).toMatch(/^\s+minutes per task \(p50\)\s+1\.00\s+2\.21\s+rising$/);
    expect(lines.find((line) => line.includes('tasks per loop'))).toMatch(/^\s+tasks per loop\s+0\.00\s+0\.00\s+no steady trend$/);
  });

  it('writes a dash for the tau and z of a drift with too few loops', () => {
    const lines = formatTrendReport(report(smallStore()));

    expect(lines).toContain('  drift across 2 loops, oldest to newest (Mann-Kendall; rising or falling at |z| >= 1.96)');
    expect(lines.find((line) => line.includes('minutes per task (p50)'))).toMatch(/-\s+-\s+too few values$/);
  });

  it('writes the no-session line and no loop rows for an empty report', () => {
    const lines = formatTrendReport(report([]));

    expect(lines[0]).toBe('effort report --trend: 0 task sessions');
    expect(lines).toContain('TREND');
    expect(lines).toContain('  no task session with a span is stored');
    expect(lines).toContain('LOOPS');
    expect(lines).toContain('  no loop in the selection');
    expect(lines.join('\n')).not.toContain('drift');
  });
});
