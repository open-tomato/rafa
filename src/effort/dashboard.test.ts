/**
 * Tests for the dashboard's pure composition (`dashboard.ts`):
 * `summariseSkills` over hand-built skills reports and `totalsOf` over
 * reports summarised from planted session rows and task report tallies.
 */
import type { SkillsMetric, SkillsReport, SkillsReportArm, SkillsReportPlan } from './report-skills.js';
import type { ReportSessionRow } from './report.js';

import { describe, expect, it } from 'bun:test';

import { summariseSkills, totalsOf } from './dashboard.js';
import { summariseSessions } from './report.js';
import { emptyUsageTotals } from './session-log.js';

/** A metric of `numerator` over `denominator`, its percent left to the caller. */
function metric(numerator: number, denominator: number): SkillsMetric {
  return { numerator, denominator, percent: null };
}

/** An arm offering `skills` skills and injecting `lessons` lessons, with the two metrics handed in. */
function arm(skills: number, lessons: number, m1: SkillsMetric, m2: SkillsMetric): SkillsReportArm {
  return {
    resolver: null,
    sessions: 1,
    unknownSessions: 0,
    skills: Array.from({ length: skills }, () => ({}) as SkillsReportArm['skills'][number]),
    neverOffered: [],
    lessons: Array.from({ length: lessons }, () => ({}) as SkillsReportArm['lessons'][number]),
    m1,
    m2,
  };
}

/** A plan of `sessions` task sessions holding `resolvers`. */
function plan(planStub: string | null, sessions: number, resolvers: readonly SkillsReportArm[]): SkillsReportPlan {
  return { planStub, sessions, planCi: null, resolvers };
}

describe('summariseSkills', () => {
  it('answers no plan for a report with none', () => {
    expect(summariseSkills({ plans: [] })).toEqual([]);
  });

  it('sums numerators and denominators across resolver arms and derives the percent again', () => {
    const report: SkillsReport = {
      plans: [
        plan('demo', 5, [
          arm(3, 2, metric(1, 2), metric(2, 4)),
          arm(1, 0, metric(2, 2), metric(0, 4)),
        ]),
      ],
    };

    const [summary] = summariseSkills(report);

    // m1: 3 over 4 is 75. m2: 2 over 8 is 25. Neither is the mean of the arms' own percents.
    expect(summary?.m1).toEqual({ numerator: 3, denominator: 4, percent: 75 });
    expect(summary?.m2).toEqual({ numerator: 2, denominator: 8, percent: 25 });
  });

  it('counts the skills offered and lessons injected once per arm holding them, and carries the plan and its sessions', () => {
    const report: SkillsReport = {
      plans: [
        plan('demo', 5, [
          arm(3, 2, metric(0, 0), metric(0, 0)),
          arm(1, 4, metric(0, 0), metric(0, 0)),
        ]),
      ],
    };

    expect(summariseSkills(report)[0]).toMatchObject({
      planStub: 'demo',
      sessions: 5,
      skillsOffered: 4,
      lessonsInjected: 6,
    });
  });

  it('answers a null percent when the summed denominator is 0, and a real 0 when the numerator is', () => {
    const report: SkillsReport = {
      plans: [
        plan('none', 1, [arm(0, 0, metric(0, 0), metric(0, 0))]),
        plan('zero', 1, [arm(0, 0, metric(0, 3), metric(0, 3))]),
      ],
    };

    const [none, zero] = summariseSkills(report);

    expect(none?.m1).toEqual({ numerator: 0, denominator: 0, percent: null });
    expect(zero?.m1).toEqual({ numerator: 0, denominator: 3, percent: 0 });
  });

  it('answers zeroes and null percents for a plan with no resolver arm', () => {
    const [summary] = summariseSkills({ plans: [plan(null, 0, [])] });

    expect(summary).toEqual({
      planStub: null,
      sessions: 0,
      skillsOffered: 0,
      lessonsInjected: 0,
      m1: { numerator: 0, denominator: 0, percent: null },
      m2: { numerator: 0, denominator: 0, percent: null },
    });
  });

  it('answers one summary per plan, in the report\'s order', () => {
    const report: SkillsReport = {
      plans: [plan('b', 1, []), plan('a', 1, []), plan(null, 1, [])],
    };

    expect(summariseSkills(report).map((summary) => summary.planStub)).toEqual(['b', 'a', null]);
  });

  it('does not change the arms it reads', () => {
    const first = metric(1, 2);
    const report: SkillsReport = { plans: [plan('demo', 1, [arm(0, 0, first, metric(0, 0)), arm(0, 0, metric(1, 2), metric(0, 0))])] };

    summariseSkills(report);

    expect(first).toEqual({ numerator: 1, denominator: 2, percent: null });
  });
});

/** A session row of `minutes` starting at 2026-09-15 10:00 UTC, its usage the numbers handed in. */
function row(sessionId: string, minutes: number, input: number, output: number, cacheRead: number, cacheWrite: number): ReportSessionRow {
  const start = Date.parse('2026-09-15T10:00:00.000Z');
  return {
    sessionId,
    planStub: 'demo',
    branch: null,
    kind: 'task',
    assistantRecordCount: 3,
    firstTimestamp: new Date(start).toISOString(),
    lastTimestamp: new Date(start + minutes * 60_000).toISOString(),
    entrypointCounts: {},
    modelCounts: {},
    usage: {
      ...emptyUsageTotals(),
      inputTokens: input,
      outputTokens: output,
      cacheReadInputTokens: cacheRead,
      cacheCreationInputTokens: cacheWrite,
    },
  };
}

describe('totalsOf', () => {
  it('reads the sessions, work minutes and each token total from the report\'s totals row', () => {
    const report = summariseSessions([
      row('a', 10, 100, 10, 1000, 5),
      row('b', 20, 200, 20, 2000, 6),
    ]);

    expect(totalsOf(report)).toEqual({
      sessions: 2,
      workMinutes: 30,
      tokens: { input: 300, output: 30, cacheRead: 3000, cacheWrite: 11 },
      taskReports: { done: 0, notDone: 0 },
      preflightHalts: 0,
      budgetedSessions: 0,
    });
  });

  it('counts the task reports whose outcome is done as done and every other outcome as not done', () => {
    const report = summariseSessions([], undefined, [
      { planStub: 'a', status: 'done', outcome: 'done', reports: 3 },
      { planStub: 'b', status: 'done', outcome: 'done', reports: 2 },
      { planStub: 'a', status: 'blocked', outcome: 'blocked', reports: 4 },
      { planStub: null, status: null, outcome: 'failed', reports: 1 },
    ]);

    expect(totalsOf(report).taskReports).toEqual({ done: 5, notDone: 5 });
  });

  it('counts a task whose status said done but whose outcome was not done as not done', () => {
    const report = summariseSessions([], undefined, [
      { planStub: 'a', status: 'done', outcome: 'blocked', reports: 2 },
    ]);

    expect(totalsOf(report).taskReports).toEqual({ done: 0, notDone: 2 });
  });

  it('counts the preflight halts and the budgeted sessions', () => {
    const report = summariseSessions(
      [row('a', 10, 1, 1, 1, 1)],
      undefined,
      [],
      [
        { runId: 'run-1', collectedAt: '2026-09-15T10:00:00.000Z', checks: 4, failed: [] },
        { runId: 'run-2', collectedAt: '2026-09-15T11:00:00.000Z', checks: 4, failed: [] },
      ],
      [
        { sessionId: 'a', planStub: 'demo', taskLine: '- [ ] One', budgetUsd: 2 },
        { sessionId: 'gone', planStub: 'demo', taskLine: '- [ ] Two', budgetUsd: 3 },
      ],
    );

    expect(totalsOf(report)).toMatchObject({ preflightHalts: 2, budgetedSessions: 2 });
  });

  it('answers zeroes for an empty report', () => {
    expect(totalsOf(summariseSessions([]))).toEqual({
      sessions: 0,
      workMinutes: 0,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      taskReports: { done: 0, notDone: 0 },
      preflightHalts: 0,
      budgetedSessions: 0,
    });
  });
});
