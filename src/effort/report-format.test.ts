/**
 * Tests for the effort report's table renderer.
 *
 * Every case drives a PLANTED report rather than rows rolled up through
 * `summariseSessions`, so a fault in the rollup cannot move a figure
 * this file asserts, and a fault here cannot hide behind one there.
 * `src/tests/effort-pipeline.test.ts` is where a report the rollup built
 * gets rendered.
 *
 * The fixture is shaped around what the table has to survive: a branch
 * key and an unattributed kind wider than their headers, so a width
 * taken from the header alone misaligns the columns after them, and an
 * effort cell shorter than its column, so an untrimmed line keeps its
 * padding.
 *
 * Twenty-three mutations of `report-format.ts` were driven against this
 * file, each restored byte-identical with the suite green either side,
 * and NINETEEN reddened at least one case. The four that stayed green
 * are one hole rather than four: no case reads a data cell's value by
 * its column, so swapping the models and effort cells, the input and
 * output cells or the work and span cells, or writing the turn count
 * into the sessions cell, renders a table every case accepts. The same
 * four stayed green against these cases' predecessors in
 * `report.test.ts`, which rendered rolled-up rows, before the move.
 *
 * The task report section came later. Six legs of `report-format.ts` were
 * driven against this file and `report.test.ts`, each restored
 * sha256-identical, and each reddened at least one case here: the status
 * and outcome cells swapped (1), the filter note dropped (1), the section
 * left out of `formatReport` (1), a section printed for no tallies (1),
 * right alignment ignored (2, the session table's alignment case among
 * them), and a NULL status written as `null` (1). The command case in
 * `report.test.ts` reddened too for the swap, the empty section and the
 * alignment.
 *
 * The preflight halt section came after that. Seven legs of
 * `report-format.ts` were driven on 2026-09-15 against this file,
 * `report.test.ts` and five store suites, each restored sha256-identical,
 * and each reddened at least one case: the section left out of
 * `formatReport` (1), a section printed for no halts (3: the task report
 * and preflight halt cases here that expect nothing, and the command's
 * task report case), the filter note dropped (1), a failure left on its
 * lines (1), right alignment ignored (2), the outcome and duration cells
 * swapped (2), and one run counted as `runs` (2). The command's preflight
 * halt case in `report.test.ts` is one of the two for each of the last
 * three.
 */
import type { BudgetedSession } from './report-budgets.js';
import type { EffortGroup, EffortReport, GroupKind } from './report.js';
import type { PreflightHalt } from './store/preflight.js';
import type { TaskReportTally } from './store/reports.js';

import { describe, expect, it } from 'bun:test';

import {
  formatBudgets,
  formatCount,
  formatHistogram,
  formatMinutes,
  formatPreflightHalts,
  formatReport,
  formatReportHeader,
  formatReportTable,
  formatTaskReports,
} from './report-format.js';
import { emptyGroup } from './report.js';

/** A group with only the named fields moved off their zero. */
function plantGroup(
  key: string,
  kind: GroupKind,
  fields: Partial<EffortGroup> = {},
): EffortGroup {
  return { ...emptyGroup(key, kind), ...fields };
}

/** A report holding only what a case names; the rest is empty. */
function plantReport(fields: Partial<EffortReport> = {}): EffortReport {
  return {
    groups: [],
    totals: emptyGroup('TOTAL', 'total'),
    rowsRead: 0,
    rowsExcluded: 0,
    filters: { kinds: null, entrypoints: null },
    taskReports: [],
    preflightHalts: [],
    budgets: [],
    ...fields,
  };
}

/**
 * Three groups and totals summing their counters. The unattributed group
 * is spanless, predates the effort field, and renders its effort cell as
 * a dash.
 */
const REPORT = plantReport({
  groups: [
    plantGroup('q19-loop-economics', 'plan', {
      planStub: 'q19-loop-economics',
      sessions: 2,
      assistantTurns: 14,
      inputTokens: 150,
      outputTokens: 30,
      cacheReadTokens: 6000,
      cacheWriteTokens: 1000,
      totalTokens: 7180,
      workMinutes: 50,
      spanMinutes: 40,
      models: { 'claude-opus-5': 10, 'claude-fable-5': 4 },
      efforts: { xhigh: 10, low: 4 },
    }),
    plantGroup('chore/no-plan-for-this', 'branch', {
      sessions: 1,
      assistantTurns: 3,
      inputTokens: 7,
      outputTokens: 2,
      totalTokens: 9,
      workMinutes: 5,
      spanMinutes: 5,
      models: { 'claude-opus-5': 3 },
      efforts: { xhigh: 3 },
    }),
    plantGroup('(no branch)', 'unattributed', {
      sessions: 1,
      assistantTurns: 1,
      inputTokens: 1,
      totalTokens: 1,
      sessionsWithoutSpan: 1,
      sessionsWithoutEffort: 1,
    }),
  ],
  totals: plantGroup('TOTAL', 'total', {
    sessions: 4,
    assistantTurns: 18,
    inputTokens: 158,
    outputTokens: 32,
    cacheReadTokens: 6000,
    cacheWriteTokens: 1000,
    totalTokens: 7190,
    workMinutes: 55,
    sessionsWithoutSpan: 1,
    sessionsWithoutEffort: 1,
    models: { 'claude-opus-5': 13, 'claude-fable-5': 4 },
    efforts: { xhigh: 13, low: 4 },
  }),
  rowsRead: 4,
});

describe('formatting', () => {
  it('groups a count in threes without a locale', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(999)).toBe('999');
    expect(formatCount(1000)).toBe('1,000');
    expect(formatCount(84053)).toBe('84,053');
    expect(formatCount(1234567)).toBe('1,234,567');
  });

  it('renders a missing span as a dash', () => {
    expect(formatMinutes(null)).toBe('-');
    expect(formatMinutes(0)).toBe('0.0');
    expect(formatMinutes(12.34)).toBe('12.3');
  });

  it('renders a histogram commonest first, ties by key', () => {
    expect(formatHistogram({})).toBe('-');
    expect(formatHistogram({ low: 2, xhigh: 9 })).toBe('xhigh=9 low=2');
    expect(formatHistogram({ b: 1, a: 1 })).toBe('a=1 b=1');
  });
});

describe('formatReportTable', () => {
  it('renders a header, every group and a TOTAL row', () => {
    const lines = formatReportTable(REPORT);

    expect(lines).toHaveLength(5);
    expect(lines[0]?.startsWith('plan / branch')).toBe(true);
    expect(lines[4]?.startsWith('TOTAL')).toBe(true);
  });

  it('carries no pipe, so no markdown row can split', () => {
    for (const line of formatReportTable(REPORT)) {
      expect(line).not.toContain('|');
    }
  });

  it('aligns every cell into one column per header', () => {
    const lines = formatReportTable(REPORT);
    const header = lines[0] ?? '';
    const offset = header.indexOf('sessions');

    expect(offset).toBeGreaterThan(0);
    for (const line of lines.slice(1)) {
      // Right-aligned, so the column's last character is its end.
      expect(line.slice(offset - 2, offset + 8)).toMatch(/^ +\d[\d,]*$/);
    }
  });

  it('leaves no trailing whitespace on any line', () => {
    for (const line of formatReportTable(REPORT)) {
      expect(line).toBe(line.trimEnd());
    }
  });

  it('names both filters, and what they left', () => {
    const lines = formatReport(plantReport({
      rowsRead: 6,
      rowsExcluded: 2,
      filters: { kinds: ['task', 'other'], entrypoints: ['sdk-cli'] },
    }));

    expect(lines[0]).toContain('4 of 6 session rows');
    expect(lines[1]).toContain('task, other');
    expect(lines[2]).toContain('sdk-cli');
  });

  it('notes the spanless rows and the legacy ones', () => {
    const text = formatReport(REPORT).join('\n');

    expect(text).toContain('1 sessions contributed no span');
    expect(text).toContain('1 rows predate the effort field');
  });

  it('omits both notes when neither applies', () => {
    const spanned = { sessions: 1, workMinutes: 1, spanMinutes: 1 };
    const lines = formatReport(plantReport({
      groups: [plantGroup('b', 'branch', spanned)],
      totals: plantGroup('TOTAL', 'total', spanned),
      rowsRead: 1,
    }));

    expect(lines[1]).toBe('');
    expect(lines.join('\n')).not.toContain('note');
  });
});

/** One tally, every field named. */
function tally(
  planStub: string | null,
  status: TaskReportTally['status'],
  outcome: string,
  reports: number,
): TaskReportTally {
  return { planStub, status, outcome, reports };
}

/**
 * Tallies holding a plan with no stub, a NULL status, a row where status
 * and outcome differ beside one where they agree, and a count past a
 * thousand, wider than every cell above it but not than its header.
 */
const TALLIES: readonly TaskReportTally[] = [
  tally(null, 'done', 'done', 1),
  tally('phase-1-installable', null, 'failed', 2),
  tally('phase-1-installable', 'done', 'blocked', 1),
  tally('phase-1-installable', 'done', 'done', 1204),
];

describe('formatTaskReports', () => {
  it('renders the status beside the outcome, one aligned row per tally', () => {
    expect(formatTaskReports(plantReport({ taskReports: TALLIES }))).toEqual([
      '',
      'task reports: 1,208 stored, by plan, status and outcome',
      'plan                 status  outcome  reports',
      '(no plan)            done    done           1',
      'phase-1-installable  -       failed         2',
      'phase-1-installable  done    blocked        1',
      'phase-1-installable  done    done       1,204',
    ]);
  });

  it('adds nothing to a report that stores no task report', () => {
    const before = [...formatReportHeader(REPORT), '', ...formatReportTable(REPORT)];

    expect(formatTaskReports(REPORT)).toEqual([]);
    expect(formatReport(REPORT)).toEqual(before);

    // The control: the same report holding tallies ends with their section.
    const withTallies = { ...REPORT, taskReports: TALLIES };
    expect(formatReport(withTallies))
      .toEqual([...before, ...formatTaskReports(withTallies)]);
    expect(formatTaskReports(withTallies)).toHaveLength(7);
  });

  it('notes under a filter that the tallies are not narrowed', () => {
    const filtered = formatTaskReports(plantReport({
      taskReports: TALLIES,
      filters: { kinds: ['wrap-up'], entrypoints: null },
    }));

    expect(filtered[2]).toBe('  note        the filters narrow session rows, not task reports');
    expect(filtered).toHaveLength(8);
    expect(formatTaskReports(plantReport({ taskReports: TALLIES })).join('\n'))
      .not.toContain('note');
  });
});

/**
 * Two halted runs: the first failed two required checks, one a presence
 * check that took no measurable time and one a timeout past a thousand
 * milliseconds whose probe spans two lines; the second failed one. The
 * run id and item cells of the first are wider than their headers.
 */
const HALTS: readonly PreflightHalt[] = [
  {
    runId: '0f6c1a2e-run',
    collectedAt: '2026-09-15T10:00:00.000Z',
    checks: 4,
    failed: [
      {
        kind: 'env',
        item: 'GITHUB_TOKEN',
        probe: null,
        outcome: 'fail',
        durationMs: 0,
        failure: 'presence check: GITHUB_TOKEN is not set',
      },
      {
        kind: 'tool',
        item: 'mgrep',
        probe: 'mgrep --version\n  --quiet',
        outcome: 'timeout',
        durationMs: 30012,
        failure: 'probe `mgrep --version\n  --quiet` timed out after 30s and was killed (exit 137)',
      },
    ],
  },
  {
    runId: 'r2',
    collectedAt: '2026-09-15T11:30:00.000Z',
    checks: 1,
    failed: [{
      kind: 'tool',
      item: 'bun',
      probe: 'bun --version',
      outcome: 'fail',
      durationMs: 41,
      failure: 'probe `bun --version` exited 127: sh: bun: not found',
    }],
  },
];

describe('formatPreflightHalts', () => {
  it('renders one aligned row per failed required check, its run on every row', () => {
    expect(formatPreflightHalts(plantReport({ preflightHalts: HALTS }))).toEqual([
      '',
      'preflight halts: 2 runs, by run and failed required item',
      'run           at                        item                outcome      ms  failure',
      '0f6c1a2e-run  2026-09-15T10:00:00.000Z  env "GITHUB_TOKEN"  fail          0  presence check: GITHUB_TOKEN is not set',
      '0f6c1a2e-run  2026-09-15T10:00:00.000Z  tool "mgrep"        timeout  30,012  probe `mgrep --version --quiet` timed out after 30s and was killed (exit 137)',
      'r2            2026-09-15T11:30:00.000Z  tool "bun"          fail         41  probe `bun --version` exited 127: sh: bun: not found',
    ]);
  });

  it('counts one run as one run', () => {
    const [first] = HALTS;
    expect(first).toBeDefined();

    expect(formatPreflightHalts(plantReport({ preflightHalts: [first!] }))[1])
      .toBe('preflight halts: 1 run, by run and failed required item');
  });

  it('adds nothing to a report where no run halted', () => {
    const withTallies = { ...REPORT, taskReports: TALLIES };
    const before = formatReport(withTallies);

    expect(formatPreflightHalts(withTallies)).toEqual([]);
    expect(before).toEqual([...formatReportHeader(REPORT), '', ...formatReportTable(REPORT), ...formatTaskReports(withTallies)]);

    // The control: the same report holding halts ends with their section,
    // after the task reports.
    const withHalts = { ...withTallies, preflightHalts: HALTS };
    expect(formatReport(withHalts)).toEqual([...before, ...formatPreflightHalts(withHalts)]);
    expect(formatPreflightHalts(withHalts)).toHaveLength(6);
  });

  it('notes under a filter that the halts are not narrowed', () => {
    const filtered = formatPreflightHalts(plantReport({
      preflightHalts: HALTS,
      filters: { kinds: null, entrypoints: ['sdk-cli'] },
    }));

    expect(filtered[2]).toBe('  note        the filters narrow session rows, not preflight halts');
    expect(filtered).toHaveLength(7);
    expect(formatPreflightHalts(plantReport({ preflightHalts: HALTS })).join('\n'))
      .not.toContain('note');
  });
});

/**
 * Two budgeted sessions: one collected, whose plan stub is wider than its
 * header and whose counts run past a thousand, and one no collect has
 * read, under no plan, whose usage cells are dashes.
 */
const BUDGETS: readonly BudgetedSession[] = [
  {
    sessionId: 'aaaa-1111',
    planStub: 'phase-1-installable',
    taskLine: 'Add the module',
    budgetUsd: 0.5,
    usage: {
      assistantTurns: 12,
      inputTokens: 1500,
      outputTokens: 20,
      cacheReadTokens: 1234567,
      cacheWriteTokens: 0,
      totalTokens: 1236087,
    },
  },
  {
    sessionId: 'bbbb-2222',
    planStub: null,
    taskLine: 'Add another module',
    budgetUsd: 2,
    usage: null,
  },
];

describe('formatBudgets', () => {
  it('renders each budget beside its usage, and a dash for a session not read yet', () => {
    expect(formatBudgets(plantReport({ budgets: BUDGETS }))).toEqual([
      '',
      'budgets: 2 sessions dispatched with a budget, beside the tokens each used',
      '  note        usage is in tokens: no dollar cost is stored, and a text-mode session prints none',
      '  note        - is a session no collect has read yet',
      'session    plan                 budget-usd  turns  input  output    cache-r  cache-w      total',
      'aaaa-1111  phase-1-installable         0.5     12  1,500      20  1,234,567        0  1,236,087',
      'bbbb-2222  (no plan)                     2      -      -       -          -        -          -',
    ]);
  });

  it('counts one session as one, with no dash note when every session was read', () => {
    const [collected] = BUDGETS;
    const lines = formatBudgets(plantReport({ budgets: collected === undefined
      ? []
      : [collected] }));

    expect(lines[1]).toBe('budgets: 1 session dispatched with a budget, beside the tokens each used');
    expect(lines).toHaveLength(5);
    expect(lines.join('\n')).not.toContain('read yet');
  });

  it('adds nothing to a report with no budgeted session', () => {
    const withHalts = { ...REPORT, taskReports: TALLIES, preflightHalts: HALTS };
    const before = formatReport(withHalts);

    expect(formatBudgets(withHalts)).toEqual([]);
    expect(before).toEqual([
      ...formatReportHeader(REPORT),
      '',
      ...formatReportTable(REPORT),
      ...formatTaskReports(withHalts),
      ...formatPreflightHalts(withHalts),
    ]);

    // The control: the same report holding budgets ends with their
    // section, after the preflight halts.
    const withBudgets = { ...withHalts, budgets: BUDGETS };
    expect(formatReport(withBudgets)).toEqual([...before, ...formatBudgets(withBudgets)]);
    expect(formatBudgets(withBudgets)).toHaveLength(7);
  });

  it('notes under a filter that the budgets are not narrowed', () => {
    const filtered = formatBudgets(plantReport({
      budgets: BUDGETS,
      filters: { kinds: ['task'], entrypoints: null },
    }));

    expect(filtered[4]).toBe('  note        the filters narrow session rows, not budgets');
    expect(filtered).toHaveLength(8);
    expect(formatBudgets(plantReport({ budgets: BUDGETS })).join('\n'))
      .not.toContain('narrow');
  });
});
