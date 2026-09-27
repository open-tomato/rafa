import type { Recurrence } from './recurrence.js';
import type { SkillsReport, SkillsReportArm, SkillsReportPlan } from './report-skills.js';
import type { LessonSignalRow, SkillSignalRow } from './skill-signals.js';
import type { PlanCiRow } from './store/plan-ci.js';

import { describe, expect, test } from 'bun:test';

import {
  formatMetric,
  formatPlanCi,
  formatSkillsArm,
  formatSkillsPlan,
  formatSkillsReport,
  PLAN_CI_LABEL,
  PROBE_FOOTNOTE,
  SKILLS_REPORT_HEADER,
} from './report-skills-format.js';

const HEADER = 'Co-occurrence, not cause: a skill can be invoked and its failure recur for reasons the skill does not cover.';

function recurrence(text: string): Recurrence {
  return { string: 'boom', source: 'blocker', sessionId: 's2', taskLine: 'later task', field: 'what', text };
}

function skill(overrides: Partial<SkillSignalRow>): SkillSignalRow {
  return {
    name: 'alpha',
    offered: 2,
    invoked: 1,
    uptake: 1,
    reported: 0,
    unknown: 0,
    recurred: 0,
    matches: [],
    signal: 'earning',
    ...overrides,
  };
}

function lesson(overrides: Partial<LessonSignalRow>): LessonSignalRow {
  return { id: 'L1', artifact: 'Cannot find package', injected: 1, recurred: 0, matches: [], signal: 'injected', ...overrides };
}

function arm(overrides: Partial<SkillsReportArm>): SkillsReportArm {
  return {
    resolver: 'planner',
    sessions: 2,
    unknownSessions: 0,
    skills: [],
    neverOffered: [],
    lessons: [],
    m1: { numerator: 1, denominator: 2, percent: 50 },
    m2: { numerator: 1, denominator: 3, percent: (1 / 3) * 100 },
    ...overrides,
  };
}

function plan(overrides: Partial<SkillsReportPlan>): SkillsReportPlan {
  return { planStub: 'rafa-9-demo', sessions: 2, planCi: null, resolvers: [arm({})], ...overrides };
}

const RED_CI: PlanCiRow = {
  planStub: 'rafa-9-demo',
  pr: 42,
  headSha: '0123456789abcdef',
  verdict: 'red',
  failing: ['lint', 'unit tests'],
  readAt: '2026-09-27T10:00:00.000Z',
};

describe('the header line', () => {
  test('is the fixed sentence, byte for byte', () => {
    expect(SKILLS_REPORT_HEADER).toBe(HEADER);
  });

  test('opens every report, empty or not', () => {
    expect(formatSkillsReport({ plans: [] })[0]).toBe(HEADER);
    expect(formatSkillsReport({ plans: [plan({})] })[0]).toBe(HEADER);
  });
});

describe('the probe footnote', () => {
  test('ends every report after a blank line', () => {
    for (const report of [{ plans: [] }, { plans: [plan({})] }] satisfies SkillsReport[]) {
      const lines = formatSkillsReport(report);
      expect(lines.slice(-PROBE_FOOTNOTE.length)).toEqual([...PROBE_FOOTNOTE]);
      expect(lines[lines.length - PROBE_FOOTNOTE.length - 1]).toBe('');
    }
  });

  test('names the CLI record the probe found and the difference', () => {
    const text = PROBE_FOOTNOTE.join(' ');
    expect(text).toContain('pluginUsage');
    expect(text).toContain('~/.claude/.claude.json');
    expect(text).toContain('never a project skill');
  });
});

describe('an empty report', () => {
  test('says no sessions were recorded between the header and the footnote', () => {
    expect(formatSkillsReport({ plans: [] })).toEqual([
      HEADER,
      '',
      'no task sessions recorded for the plans read',
      '',
      ...PROBE_FOOTNOTE,
    ]);
  });
});

describe('the plan CI line', () => {
  test('is labelled plan CI and names the latest reading', () => {
    expect(formatPlanCi(RED_CI)).toBe('plan CI: red on #42 at 0123456, read 2026-09-27T10:00:00.000Z, failing: lint, unit tests');
  });

  test('names no failing checks on a green reading', () => {
    expect(formatPlanCi({ ...RED_CI, verdict: 'green', failing: [] })).toBe('plan CI: green on #42 at 0123456, read 2026-09-27T10:00:00.000Z');
  });

  test('says not read when the plan has no reading', () => {
    expect(formatPlanCi(null)).toBe(`${PLAN_CI_LABEL}: not read`);
  });

  test('is written once per plan, never per resolver arm', () => {
    const lines = formatSkillsPlan(plan({ planCi: RED_CI, resolvers: [arm({ resolver: 'planner' }), arm({ resolver: 'tag' })] }));
    expect(lines.filter((line) => line.includes(PLAN_CI_LABEL))).toHaveLength(1);
  });
});

describe('the metrics', () => {
  test('write the ratio and its percentage at one decimal', () => {
    expect(formatMetric({ numerator: 22, denominator: 30, percent: (22 / 30) * 100 })).toBe('22/30, 73.3%');
  });

  test('write a dash for the percentage over a zero denominator', () => {
    expect(formatMetric({ numerator: 0, denominator: 0, percent: null })).toBe('0/0, -');
  });
});

describe('an arm', () => {
  test('writes the skills table with invoked and reported side by side', () => {
    const lines = formatSkillsArm(arm({ skills: [skill({ reported: 2 })] }));
    expect(lines.slice(0, 2)).toEqual([
      'skill  offered  invoked  reported  recurred  matched  signal',
      'alpha        2        1         2         0  -        earning',
    ]);
  });

  test('writes unmeasured as invoked N/M, recurrence not declared', () => {
    const [, row] = formatSkillsArm(arm({ skills: [skill({ offered: 3, invoked: 2, uptake: 2, signal: 'unmeasured' })] }));
    expect(row).toEndWith('invoked 2/3, recurrence not declared');
  });

  test('writes a null signal as unknown, never as ignored', () => {
    const [, row] = formatSkillsArm(arm({ skills: [skill({ invoked: 0, uptake: 0, unknown: 1, signal: null })] }));
    expect(row).toEndWith('unknown');
    expect(row).not.toContain('ignored');
  });

  test('writes each matched text once, on one line', () => {
    const matches = [recurrence('boom\n  again'), recurrence('boom\n  again'), recurrence('boom later')];
    const [, row] = formatSkillsArm(arm({ skills: [skill({ recurred: 1, matches, signal: 'recurring' })] }));
    expect(row).toContain('boom again / boom later');
    expect(row).toEndWith('recurring');
  });

  test('lists the skills invoked and never offered, with no signal', () => {
    const lines = formatSkillsArm(arm({
      neverOffered: [{ name: 'stray', offered: 0, invoked: 2, uptake: 0, reported: 0, unknown: 0, recurred: 1, matches: [] }],
    }));
    expect(lines).toContain('never offered: stray (invoked 2, recurred 1)');
  });

  test('says when nothing was offered, never offered or injected', () => {
    const lines = formatSkillsArm(arm({}));
    expect(lines).toContain('skills: none offered');
    expect(lines).toContain('never offered: none');
    expect(lines).toContain('lessons: none injected');
  });

  test('writes the lessons table, an unresolved artifact as unknown', () => {
    const lines = formatSkillsArm(arm({
      lessons: [
        lesson({ recurred: 1, matches: [recurrence('Cannot find package x')], signal: 'injected-recurring' }),
        lesson({ id: 'L2', artifact: null }),
      ],
    }));
    const start = lines.indexOf('lesson  artifact             injected  recurred  matched                signal');
    expect(start).toBeGreaterThan(-1);
    expect(lines.slice(start + 1, start + 3)).toEqual([
      'L1      Cannot find package         1         1  Cannot find package x  injected-recurring',
      'L2      unknown                     1         0  -                      injected',
    ]);
  });

  test('writes M1 and M2 last', () => {
    const lines = formatSkillsArm(arm({}));
    expect(lines.slice(-2)).toEqual(['M1  1/2, 50.0% (task lines invoking a skill)', 'M2  1/3, 33.3% (offered skills invoked)']);
  });

  test('notes the sessions with unknown invocations left out of M1 and M2', () => {
    const lines = formatSkillsArm(arm({ sessions: 3, unknownSessions: 1 }));
    expect(lines.at(-1)).toBe('note: 1 of 3 sessions have unknown invocations, left out of M1 and M2');
  });
});

describe('a plan', () => {
  test('run under one resolver names it on its heading and has one table set', () => {
    const lines = formatSkillsPlan(plan({ resolvers: [arm({ skills: [skill({})] })] }));
    expect(lines.slice(0, 3)).toEqual(['plan rafa-9-demo: 2 sessions, resolver planner', 'plan CI: not read', '']);
    expect(lines.filter((line) => line.startsWith('skill '))).toHaveLength(1);
    expect(lines.filter((line) => line.startsWith('M1 '))).toHaveLength(1);
  });

  test('run under two resolvers gets a table set, M1 and M2 per resolver', () => {
    const lines = formatSkillsPlan(plan({
      sessions: 4,
      resolvers: [
        arm({ resolver: 'planner', skills: [skill({})] }),
        arm({ resolver: 'tag', skills: [skill({ name: 'beta' })], m1: { numerator: 0, denominator: 2, percent: 0 } }),
      ],
    }));
    expect(lines[0]).toBe('plan rafa-9-demo: 4 sessions, 2 resolvers');
    const planner = lines.indexOf('  resolver planner: 2 sessions');
    const tag = lines.indexOf('  resolver tag: 2 sessions');
    expect(planner).toBeGreaterThan(-1);
    expect(tag).toBeGreaterThan(planner);
    expect(lines.slice(planner, tag).some((line) => line.startsWith('    alpha '))).toBe(true);
    expect(lines.slice(tag).some((line) => line.startsWith('    beta '))).toBe(true);
    expect(lines.slice(planner, tag)).toContain('    M1  1/2, 50.0% (task lines invoking a skill)');
    expect(lines.slice(tag)).toContain('    M1  0/2, 0.0% (task lines invoking a skill)');
    expect(lines.slice(tag).filter((line) => line.trimStart().startsWith('M2 '))).toHaveLength(1);
  });

  test('keeps a blank line inside an indented arm empty', () => {
    const lines = formatSkillsPlan(plan({ resolvers: [arm({}), arm({ resolver: 'tag' })] }));
    expect(lines.filter((line) => line.trim() === '' && line !== '')).toEqual([]);
  });

  test('under no plan and no recorded resolver reads as such', () => {
    expect(formatSkillsPlan(plan({ planStub: null, resolvers: [arm({ resolver: null })] }))[0])
      .toBe('no plan: 2 sessions, resolver not recorded');
  });

  test('comes after a blank line, one block per plan, in the report\'s order', () => {
    const lines = formatSkillsReport({ plans: [plan({ planStub: 'first' }), plan({ planStub: 'second' })] });
    const first = lines.indexOf('plan first: 2 sessions, resolver planner');
    const second = lines.indexOf('plan second: 2 sessions, resolver planner');
    expect(lines[first - 1]).toBe('');
    expect(second).toBeGreaterThan(first);
    expect(lines[second - 1]).toBe('');
  });
});
