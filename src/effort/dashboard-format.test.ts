import type { StatusLoop, StatusWidget } from './dashboard-status.js';
import type { Dashboard, SkillsPlanSummary } from './dashboard.js';
import type { LoopRow } from './report-trend.js';

import { describe, expect, it } from 'bun:test';

import { formatDashboard, formatSkills, formatStatus, formatTotals } from './dashboard-format.js';
import { spreadOf } from './trend-stats.js';

/** A loop row keyed by `key`, started at `firstTimestamp`. */
function loopRow(key: string, firstTimestamp: string): LoopRow {
  const spread = spreadOf([5]);
  return {
    key,
    kind: 'plan',
    firstTimestamp,
    lastTimestamp: firstTimestamp,
    wallMinutes: 5,
    workMinutes: 5,
    tasks: 1,
    notDone: 0,
    unreported: 0,
    perTask: { minutes: spread, outputTokens: spread, cacheReadTokens: spread, turns: spread },
    models: {},
    efforts: {},
    agents: {},
    groups: null,
  };
}

/** A skills summary for `planStub` with M1 at `numerator` of 10. */
function skillsPlan(planStub: string, numerator: number): SkillsPlanSummary {
  return {
    planStub,
    sessions: 10,
    skillsOffered: 2,
    lessonsInjected: 1,
    m1: { numerator, denominator: 10, percent: numerator * 10 },
    m2: { numerator: 0, denominator: 0, percent: null },
  };
}

const LIVE_LOOP: StatusLoop = {
  sessionId: 's-1',
  planStub: 'rafa-9-thing',
  branch: 'feat/rafa-9-thing',
  state: 'running',
  startedAt: '2026-09-29T08:00:00.000Z',
  task: { line: 12, text: 'Do it' },
  tasks: { total: 10, done: 4, blocked: 0, open: 6 },
  byTask: { secondsPerTask: 480, seconds: 2880, sessions: 4 },
  byProgress: { secondsPerTask: 1200, seconds: 7200, planStartedAt: '2026-09-29T08:00:00.000Z', elapsedSeconds: 4800 },
  bySession: { finished: 4, left: 6, secondsPerTask: 900, seconds: 5400 },
};

const STATUS: StatusWidget = {
  running: 1,
  paused: 0,
  tasks: { total: 10, done: 4, blocked: 0, open: 6 },
  longest: { byTask: 2880, byProgress: 7200, bySession: 5400 },
  loops: [LIVE_LOOP],
};

/** A dashboard over the given status, loop rows and skills summaries. */
function dashboardOf(status: StatusWidget, rows: LoopRow[], plans: SkillsPlanSummary[]): Dashboard {
  return {
    generatedAt: '2026-09-29T10:15:42.000Z',
    status,
    trend: {
      anchor: null,
      baseline: null,
      recent: null,
      metrics: [],
      notDoneShare: { baseline: null, recent: null },
      days: [],
      outliers: { limitMinutes: null, sessions: [] },
    },
    loops: { days: 14, loops: null, by: null, rows, drift: [] },
    skills: { plans, report: { plans: [] } },
    totals: {
      sessions: 1045,
      workMinutes: 9834,
      tokens: { input: 548_426, output: 116_256_056, cacheRead: 8_334_508_326, cacheWrite: 364_277_709 },
      taskReports: { done: 748, notDone: 4 },
      preflightHalts: 2,
      budgetedSessions: 1,
    },
  };
}

describe('formatStatus', () => {
  it('writes the counters, the longest of each estimate, and one row per live loop', () => {
    const lines = formatStatus(STATUS);

    expect(lines[0]).toBe('STATUS  1 running, 0 paused');
    expect(lines[1]).toBe('  tasks  4/10 done, 0 blocked, 6 open');
    expect(lines[2]).toBe('  left   longest by task 48m, by progress 2h, this session 1h 30m');
    expect(lines.find((line) => line.startsWith('rafa-9-thing'))).toContain('48m (8m/task)');
    expect(lines.find((line) => line.startsWith('rafa-9-thing'))).toContain('2h (20m/task)');
    expect(lines.find((line) => line.startsWith('rafa-9-thing'))).toContain('1h 30m (15m/task)');
    expect(lines.find((line) => line.startsWith('rafa-9-thing'))).toContain('line 12');
  });

  it('writes a dash for an estimate with nothing to divide by', () => {
    const loop: StatusLoop = { ...LIVE_LOOP, byTask: null, byProgress: null, bySession: null, task: null };
    const row = formatStatus({ ...STATUS, loops: [loop] }).find((line) => line.startsWith('rafa-9-thing')) ?? '';

    expect(row.split(/\s{2,}/)).toEqual(['rafa-9-thing', 'running', '4/10', '-', '-', '-', '-']);
  });

  it('says no loop is running when none is', () => {
    const empty: StatusWidget = { ...STATUS, running: 0, loops: [], longest: { byTask: null, byProgress: null, bySession: null } };

    expect(formatStatus(empty)).toEqual(['STATUS  0 running, 0 paused', '  no loop is running']);
  });
});

describe('formatSkills', () => {
  it('lists the plans the loops block lists, in its order, and leaves every other plan out', () => {
    const rows = [loopRow('rafa-2-new', '2026-09-29T00:00:00.000Z'), loopRow('rafa-1-old', '2026-09-28T00:00:00.000Z')];
    const plans = [skillsPlan('rafa-1-old', 3), skillsPlan('rafa-0-gone', 1), skillsPlan('rafa-2-new', 5)];
    const lines = formatSkills(dashboardOf(STATUS, rows, plans));
    const table = lines.filter((line) => line.startsWith('rafa-'));

    expect(table.map((line) => line.split(/\s+/)[0])).toEqual(['rafa-2-new', 'rafa-1-old']);
    expect(table[0]).toContain('5/10 50%');
  });

  it('says there is no reading when no listed plan has one', () => {
    const lines = formatSkills(dashboardOf(STATUS, [loopRow('rafa-3-x', '2026-09-29T00:00:00.000Z')], []));

    expect(lines.at(-1)).toBe('  no skills reading for these plans');
  });
});

describe('formatTotals', () => {
  it('writes hours at one decimal and token counts compact', () => {
    const lines = formatTotals(dashboardOf(STATUS, [], []).totals);
    const values = lines.at(-1)?.trim()
      .split(/\s+/);

    expect(values).toEqual(['1045', '163.9', '548k', '116.3M', '8.3B', '364.3M', '748', '4', '2', '1']);
  });
});

describe('formatDashboard', () => {
  it('opens with the UTC minute it was taken at and prints every block in order', () => {
    const lines = formatDashboard(dashboardOf(STATUS, [], []));
    const headings = lines.filter((line) => /^[A-Z]+\b/.test(line)).map((line) => line.split(/\s/)[0]);

    expect(lines[0]).toBe('effort dashboard: 2026-09-29 10:15 UTC');
    expect(headings).toEqual(['STATUS', 'TREND', 'LOOPS', 'SKILLS', 'TOTALS']);
  });
});
