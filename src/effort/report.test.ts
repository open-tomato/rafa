/**
 * Tests for the per-plan effort report.
 *
 * Every case drives PLANTED rows. The report is pure over them, so no
 * case here needs a store, a session log, a repository or a clock —
 * and the two that do touch disk plant a store file with `node:fs`
 * rather than by appending through the store module, so a truncated
 * or legacy file is distinguishable from one this repo wrote wrongly.
 *
 * The plants are shaped around the three claims the module makes that
 * a plausible-looking implementation would get wrong.
 *
 * The two minute columns are planted to DISAGREE, in both directions.
 * `q19` holds two sessions that overlap, so its work minutes exceed
 * its span; `q18` holds two separated by an overnight gap, so its
 * span exceeds its work. A summariser reporting one figure twice
 * passes any fixture where they happen to coincide, and both of these
 * would catch it.
 *
 * A plan group and a branch group are planted with the SAME NAME. The
 * accumulator keys on kind and name together, so they stay apart; a
 * map keyed on the name alone merges them and every counter in the
 * merged row still looks plausible.
 *
 * The effort histogram is planted with a row carrying NO field beside
 * a row carrying an EMPTY one. Those are different statements — a
 * store written before the collector read `effort` against a session
 * where nothing declared one — and only `sessionsWithoutEffort`
 * separates them.
 *
 * {@link SESSION_KINDS} is asserted against {@link PROMPT_SHAPES}
 * rather than against a transcribed list, so a fifth prompt shape
 * landing in `classify.ts` reaches the `--kind` validator without an
 * edit here, and a shape dropped from the derivation reds.
 *
 * Twenty-one module mutations were driven against this file and
 * TWENTY reddened at least one case, none of them missing its target,
 * with the restored module green either side and byte-identical:
 * grouping on the branch before the plan stub, dropping the branch
 * fallback so every unattributed row lands in one bucket, keying the
 * accumulator on the name alone, giving a branch group a non-null
 * `planStub`, summing input into output, leaving cache-write out of
 * `totalTokens`, counting a spanless session as zero minutes instead
 * of counting it, taking the group span from the first row instead of
 * widening it, comparing timestamps as strings, treating a missing
 * `effortCounts` as an empty one, merging the effort histogram into
 * the model one, testing the entrypoint filter against every
 * entrypoint instead of the dominant one, letting a row with no
 * entrypoint pass an entrypoint filter, breaking a dominance tie on
 * insertion order, sorting groups ascending, sorting on sessions
 * instead of tokens, rendering an empty histogram as an empty string,
 * dropping the TOTAL row from the table, accepting an unrecognised
 * argument, and keeping a duplicate on a repeated `--kind`.
 *
 * ONE stayed green and is named rather than dropped, because it is a
 * property of the FIXTURES rather than a hole in the suite: dropping
 * the `workMinutes` re-round at the close of {@link summariseSessions}
 * changes the module and changes nothing here, every plant summing to
 * a figure already exact at three places. It exists for the float tail
 * a longer sum grows, and a fixture chosen to produce one would be
 * asserting JavaScript's arithmetic rather than this module's.
 */
import type { ReportSessionRow } from './report.js';
import type { SessionUsageTotals } from './session-log.js';

import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { PROMPT_SHAPES } from './classify.js';
import {
  buildReport,
  dominantEntrypoint,
  emptyGroup,
  formatCount,
  formatHistogram,
  formatMinutes,
  formatReport,
  formatReportTable,
  groupKeyOf,
  matchesFilters,
  parseReportArgs,
  SESSION_KINDS,
  sessionSpanMinutes,
  sortGroups,
  summariseSessions,
} from './report.js';
import { emptyUsageTotals } from './session-log.js';
import { effortStorePath } from './store.js';

const tempRoot = mkdtempSync(join(tmpdir(), 'ralph-report-'));
let planted = 0;

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

/** Usage totals with only the named counters set. */
function usage(fields: Partial<SessionUsageTotals> = {}): SessionUsageTotals {
  return { ...emptyUsageTotals(), ...fields };
}

/** A minimal row, widened by whatever a case cares about. */
function plantRow(fields: Partial<ReportSessionRow> = {}): ReportSessionRow {
  return {
    sessionId: 'session-0',
    planStub: null,
    branch: null,
    kind: 'task',
    assistantRecordCount: 0,
    firstTimestamp: null,
    lastTimestamp: null,
    entrypointCounts: {},
    modelCounts: {},
    effortCounts: {},
    usage: usage(),
    ...fields,
  };
}

/**
 * Two overlapping q19 sessions, two q18 sessions an hour apart, one
 * branch-only row, one row with no branch at all, and one row whose
 * store entry predates the effort field.
 */
const ROWS: readonly ReportSessionRow[] = [
  plantRow({
    sessionId: 'q19-a',
    planStub: 'q19-loop-economics',
    branch: 'feat/q19-loop-economics',
    assistantRecordCount: 10,
    firstTimestamp: '2026-09-08T10:00:00.000Z',
    lastTimestamp: '2026-09-08T10:30:00.000Z',
    entrypointCounts: { 'sdk-cli': 40 },
    modelCounts: { 'claude-opus-5': 10 },
    effortCounts: { xhigh: 10 },
    usage: usage({
      inputTokens: 100,
      outputTokens: 20,
      cacheReadInputTokens: 5000,
      cacheCreationInputTokens: 700,
    }),
  }),
  plantRow({
    sessionId: 'q19-b',
    planStub: 'q19-loop-economics',
    branch: 'feat/q19-loop-economics',
    assistantRecordCount: 4,
    // Starts before q19-a has finished, so the two spans overlap.
    firstTimestamp: '2026-09-08T10:20:00.000Z',
    lastTimestamp: '2026-09-08T10:40:00.000Z',
    entrypointCounts: { 'sdk-cli': 8 },
    modelCounts: { 'claude-fable-5': 4 },
    effortCounts: { low: 4 },
    usage: usage({
      inputTokens: 50,
      outputTokens: 10,
      cacheReadInputTokens: 1000,
      cacheCreationInputTokens: 300,
    }),
  }),
  plantRow({
    sessionId: 'q18-a',
    planStub: 'q18-runaway-control',
    branch: 'feat/q18-runaway-control',
    assistantRecordCount: 2,
    firstTimestamp: '2026-09-07T09:00:00.000Z',
    lastTimestamp: '2026-09-07T09:10:00.000Z',
    entrypointCounts: { 'sdk-cli': 5 },
    modelCounts: { 'claude-opus-5': 2 },
    effortCounts: { xhigh: 2 },
    usage: usage({ inputTokens: 10, outputTokens: 5 }),
  }),
  plantRow({
    sessionId: 'q18-b',
    planStub: 'q18-runaway-control',
    branch: 'feat/q18-runaway-control',
    assistantRecordCount: 1,
    // An hour after q18-a ends: the group's span carries the gap.
    firstTimestamp: '2026-09-07T10:10:00.000Z',
    lastTimestamp: '2026-09-07T10:20:00.000Z',
    entrypointCounts: { 'sdk-cli': 3 },
    modelCounts: { 'claude-opus-5': 1 },
    effortCounts: {},
    usage: usage({ inputTokens: 4, outputTokens: 1 }),
  }),
  plantRow({
    sessionId: 'unplanned',
    kind: 'other',
    branch: 'chore/no-plan-for-this',
    assistantRecordCount: 3,
    firstTimestamp: '2026-09-06T08:00:00.000Z',
    lastTimestamp: '2026-09-06T08:05:00.000Z',
    entrypointCounts: { 'claude-desktop': 9 },
    modelCounts: { 'claude-opus-5': 3 },
    effortCounts: { xhigh: 3 },
    usage: usage({ inputTokens: 7, outputTokens: 2 }),
  }),
  plantRow({
    sessionId: 'branchless',
    kind: 'other',
    assistantRecordCount: 1,
    entrypointCounts: { 'claude-desktop': 1 },
    modelCounts: {},
    usage: usage({ inputTokens: 1 }),
    // No effortCounts at all: a row written before the field existed.
    effortCounts: undefined,
  }),
];

/** The q19 group of the unfiltered report. */
function q19Group() {
  const report = summariseSessions(ROWS);
  const group = report.groups.find((g) => g.key === 'q19-loop-economics');
  expect(group).toBeDefined();
  return group!;
}

describe('groupKeyOf', () => {
  it('prefers the plan stub over the branch', () => {
    const row = plantRow({ planStub: 'q19-x', branch: 'feat/q19-x' });

    expect(groupKeyOf(row)).toEqual({ key: 'q19-x', kind: 'plan' });
  });

  it('falls back to the branch, labelled as one', () => {
    const row = plantRow({ branch: 'feat/whatever' });

    expect(groupKeyOf(row)).toEqual({
      key: 'feat/whatever',
      kind: 'branch',
    });
  });

  it('labels a row with neither as unattributed', () => {
    expect(groupKeyOf(plantRow())).toEqual({
      key: '(no branch)',
      kind: 'unattributed',
    });
  });

  it('treats an empty plan stub as no plan stub', () => {
    const row = plantRow({ planStub: '', branch: 'feat/x' });

    expect(groupKeyOf(row).kind).toBe('branch');
  });
});

describe('summariseSessions grouping', () => {
  it('groups per plan and keeps the branch groups apart', () => {
    const report = summariseSessions(ROWS);
    const keys = report.groups.map((group) => `${group.kind}:${group.key}`);

    expect(new Set(keys)).toEqual(new Set([
      'plan:q19-loop-economics',
      'plan:q18-runaway-control',
      'branch:chore/no-plan-for-this',
      'unattributed:(no branch)',
    ]));
    expect(report.rowsRead).toBe(ROWS.length);
    expect(report.rowsExcluded).toBe(0);
  });

  it('never merges a plan and a branch of one name', () => {
    const rows = [
      plantRow({ sessionId: 'a', planStub: 'shared', branch: 'shared' }),
      plantRow({ sessionId: 'b', branch: 'shared' }),
    ];
    const report = summariseSessions(rows);

    expect(report.groups).toHaveLength(2);
    expect(report.groups.map((group) => group.kind).sort())
      .toEqual(['branch', 'plan']);
    for (const group of report.groups) {
      expect(group.sessions).toBe(1);
    }
  });

  it('names planStub on a plan group and nowhere else', () => {
    const report = summariseSessions(ROWS);

    for (const group of report.groups) {
      expect(group.planStub).toBe(group.kind === 'plan'
        ? group.key
        : null);
    }
    expect(report.totals.planStub).toBeNull();
  });

  it('answers an empty report for no rows at all', () => {
    const report = summariseSessions([]);

    expect(report.groups).toEqual([]);
    expect(report.rowsRead).toBe(0);
    expect(report.totals).toEqual(emptyGroup('TOTAL', 'total'));
  });
});

describe('summariseSessions counters', () => {
  it('sums turns and the four token counters per group', () => {
    const group = q19Group();

    expect(group.sessions).toBe(2);
    expect(group.assistantTurns).toBe(14);
    expect(group.inputTokens).toBe(150);
    expect(group.outputTokens).toBe(30);
    expect(group.cacheReadTokens).toBe(6000);
    expect(group.cacheWriteTokens).toBe(1000);
    expect(group.totalTokens).toBe(7180);
  });

  it('totals every group, counter by counter', () => {
    const report = summariseSessions(ROWS);
    const counters = [
      'sessions',
      'assistantTurns',
      'inputTokens',
      'outputTokens',
      'cacheReadTokens',
      'cacheWriteTokens',
      'totalTokens',
      'sessionsWithoutSpan',
      'sessionsWithoutEffort',
    ] as const;

    for (const counter of counters) {
      const summed = report.groups
        .reduce((total, group) => total + group[counter], 0);
      const seen = [counter, report.totals[counter]];
      expect(seen).toEqual([counter, summed]);
    }
  });
});

describe('summariseSessions minutes', () => {
  it('sums work minutes over overlapping sessions', () => {
    const group = q19Group();

    // 30 + 20 of work inside a 40-minute wall clock.
    expect(group.workMinutes).toBe(50);
    expect(group.spanMinutes).toBe(40);
    expect(group.firstTimestamp).toBe('2026-09-08T10:00:00.000Z');
    expect(group.lastTimestamp).toBe('2026-09-08T10:40:00.000Z');
  });

  it('carries an idle gap in the span and not in the work', () => {
    const report = summariseSessions(ROWS);
    const group = report.groups
      .find((entry) => entry.key === 'q18-runaway-control');

    expect(group?.workMinutes).toBe(20);
    expect(group?.spanMinutes).toBe(80);
  });

  it('counts a spanless session instead of adding zero', () => {
    const report = summariseSessions(ROWS);
    const group = report.groups
      .find((entry) => entry.kind === 'unattributed');

    expect(group?.sessionsWithoutSpan).toBe(1);
    expect(group?.workMinutes).toBe(0);
    expect(group?.spanMinutes).toBeNull();
    expect(group?.firstTimestamp).toBeNull();
  });

  it('widens the span rather than taking the first row', () => {
    const rows = [
      plantRow({
        sessionId: 'late',
        branch: 'b',
        firstTimestamp: '2026-09-08T12:00:00.000Z',
        lastTimestamp: '2026-09-08T12:01:00.000Z',
      }),
      plantRow({
        sessionId: 'early',
        branch: 'b',
        firstTimestamp: '2026-09-08T11:00:00.000Z',
        lastTimestamp: '2026-09-08T11:01:00.000Z',
      }),
    ];
    const group = summariseSessions(rows).groups[0];

    expect(group?.firstTimestamp).toBe('2026-09-08T11:00:00.000Z');
    expect(group?.lastTimestamp).toBe('2026-09-08T12:01:00.000Z');
    expect(group?.spanMinutes).toBe(61);
  });

  it('orders timestamps by instant, not by string', () => {
    const rows = [
      plantRow({
        sessionId: 'coarse',
        branch: 'b',
        firstTimestamp: '2026-09-08T10:00:00.5Z',
        lastTimestamp: '2026-09-08T10:00:00.5Z',
      }),
      plantRow({
        sessionId: 'fine',
        branch: 'b',
        // Sorts BEFORE '.5Z' as a string and after it as an instant.
        firstTimestamp: '2026-09-08T10:00:00.55Z',
        lastTimestamp: '2026-09-08T10:00:00.55Z',
      }),
    ];
    const group = summariseSessions(rows).groups[0];

    expect(group?.firstTimestamp).toBe('2026-09-08T10:00:00.5Z');
    expect(group?.lastTimestamp).toBe('2026-09-08T10:00:00.55Z');
  });
});

describe('sessionSpanMinutes', () => {
  it('answers null when either timestamp is missing', () => {
    expect(sessionSpanMinutes(plantRow())).toBeNull();
    expect(sessionSpanMinutes(plantRow({
      firstTimestamp: '2026-09-08T10:00:00.000Z',
    }))).toBeNull();
  });

  it('answers null for a timestamp that does not parse', () => {
    const row = plantRow({
      firstTimestamp: 'not a date',
      lastTimestamp: '2026-09-08T10:00:00.000Z',
    });

    expect(sessionSpanMinutes(row)).toBeNull();
  });

  it('rounds to three places, as the commit half does', () => {
    const row = plantRow({
      firstTimestamp: '2026-09-08T10:00:00.000Z',
      lastTimestamp: '2026-09-08T10:00:05.000Z',
    });

    expect(sessionSpanMinutes(row)).toBe(0.083);
  });
});

describe('effort histogram', () => {
  it('merges the effort values it was given', () => {
    const group = q19Group();

    expect(group.efforts).toEqual({ xhigh: 10, low: 4 });
    expect(group.models).toEqual({
      'claude-opus-5': 10,
      'claude-fable-5': 4,
    });
  });

  it('separates a missing histogram from an empty one', () => {
    const report = summariseSessions(ROWS);
    const legacy = report.groups
      .find((group) => group.kind === 'unattributed');
    const emptyOnly = report.groups
      .find((group) => group.key === 'q18-runaway-control');

    expect(legacy?.sessionsWithoutEffort).toBe(1);
    expect(legacy?.efforts).toEqual({});
    // q18-b carries an EMPTY histogram, which is not a missing one.
    expect(emptyOnly?.sessionsWithoutEffort).toBe(0);
    expect(emptyOnly?.efforts).toEqual({ xhigh: 2 });
  });

  it('keeps the model and effort histograms separate', () => {
    const group = q19Group();

    for (const key of Object.keys(group.efforts)) {
      expect(group.models).not.toHaveProperty(key);
    }
  });

  it('gives each group a histogram of its own', () => {
    const report = summariseSessions(ROWS);
    const q19 = report.groups.find((g) => g.key === 'q19-loop-economics');
    const q18 = report.groups.find((g) => g.key === 'q18-runaway-control');

    expect(q19?.efforts).not.toBe(q18?.efforts);
    expect(q18?.efforts).toEqual({ xhigh: 2 });
  });
});

describe('dominantEntrypoint', () => {
  it('answers null when there is no entrypoint at all', () => {
    expect(dominantEntrypoint(plantRow())).toBeNull();
  });

  it('answers the most-recorded entrypoint', () => {
    const row = plantRow({
      entrypointCounts: { 'claude-desktop': 2, 'sdk-cli': 9 },
    });

    expect(dominantEntrypoint(row)).toBe('sdk-cli');
  });

  it('breaks a tie on the name, not on insertion order', () => {
    const first = plantRow({
      entrypointCounts: { 'sdk-cli': 4, 'claude-desktop': 4 },
    });
    const second = plantRow({
      entrypointCounts: { 'claude-desktop': 4, 'sdk-cli': 4 },
    });

    expect(dominantEntrypoint(first)).toBe('claude-desktop');
    expect(dominantEntrypoint(second)).toBe('claude-desktop');
  });
});

describe('filters', () => {
  it('passes everything when both filters are null', () => {
    const filters = { kinds: null, entrypoints: null };

    expect(matchesFilters(plantRow(), filters)).toBe(true);
  });

  it('narrows to the named session kinds', () => {
    const report = summariseSessions(ROWS, {
      kinds: ['task'],
      entrypoints: null,
    });

    expect(report.rowsExcluded).toBe(2);
    expect(report.totals.sessions).toBe(4);
    expect(report.groups.map((group) => group.kind))
      .toEqual(['plan', 'plan']);
  });

  it('narrows on the dominant entrypoint alone', () => {
    const row = plantRow({
      entrypointCounts: { 'claude-desktop': 20, 'sdk-cli': 1 },
    });
    const filters = { kinds: null, entrypoints: ['sdk-cli'] };

    // One sdk-cli record is present and is not the dominant one.
    expect(matchesFilters(row, filters)).toBe(false);
  });

  it('excludes a row carrying no entrypoint at all', () => {
    const filters = { kinds: null, entrypoints: ['sdk-cli'] };

    expect(matchesFilters(plantRow(), filters)).toBe(false);
  });

  it('drops the desktop traffic from the loop reading', () => {
    const report = summariseSessions(ROWS, {
      kinds: null,
      entrypoints: ['sdk-cli'],
    });

    expect(report.rowsExcluded).toBe(2);
    expect(report.totals.models).toEqual({
      'claude-opus-5': 13,
      'claude-fable-5': 4,
    });
  });

  it('reports the filters it was given', () => {
    const filters = { kinds: ['wrap-up'] as const, entrypoints: null };

    expect(summariseSessions(ROWS, filters).filters).toBe(filters);
  });
});

describe('sortGroups', () => {
  it('orders by total tokens, descending', () => {
    const report = summariseSessions(ROWS);
    const totals = report.groups.map((group) => group.totalTokens);

    expect(totals).toEqual([...totals].sort((a, b) => b - a));
    expect(report.groups[0]?.key).toBe('q19-loop-economics');
  });

  it('breaks a tie on the key, then on the kind', () => {
    const tied = ['b', 'a', 'a'].map((key, index) => ({
      ...emptyGroup(key, index === 2
        ? 'branch'
        : 'plan'),
    }));

    expect(sortGroups(tied).map((group) => `${group.key}:${group.kind}`))
      .toEqual(['a:branch', 'a:plan', 'b:plan']);
  });

  it('leaves the input array alone', () => {
    const groups = [emptyGroup('b', 'plan'), emptyGroup('a', 'plan')];
    sortGroups(groups);

    expect(groups.map((group) => group.key)).toEqual(['b', 'a']);
  });
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
    const lines = formatReportTable(summariseSessions(ROWS));

    expect(lines).toHaveLength(6);
    expect(lines[0]?.startsWith('plan / branch')).toBe(true);
    expect(lines[5]?.startsWith('TOTAL')).toBe(true);
  });

  it('carries no pipe, so no markdown row can split', () => {
    for (const line of formatReportTable(summariseSessions(ROWS))) {
      expect(line).not.toContain('|');
    }
  });

  it('aligns every cell into one column per header', () => {
    const lines = formatReportTable(summariseSessions(ROWS));
    const header = lines[0] ?? '';
    const offset = header.indexOf('sessions');

    expect(offset).toBeGreaterThan(0);
    for (const line of lines.slice(1)) {
      // Right-aligned, so the column's last character is its end.
      expect(line.slice(offset - 2, offset + 8)).toMatch(/^ +\d[\d,]*$/);
    }
  });

  it('leaves no trailing whitespace on any line', () => {
    for (const line of formatReportTable(summariseSessions(ROWS))) {
      expect(line).toBe(line.trimEnd());
    }
  });

  it('names both filters, and what they left', () => {
    const lines = formatReport(summariseSessions(ROWS, {
      kinds: ['task', 'other'],
      entrypoints: ['sdk-cli'],
    }));

    expect(lines[0]).toContain('4 of 6 session rows');
    expect(lines[1]).toContain('task, other');
    expect(lines[2]).toContain('sdk-cli');
  });

  it('notes the spanless rows and the legacy ones', () => {
    const text = formatReport(summariseSessions(ROWS)).join('\n');

    expect(text).toContain('1 sessions contributed no span');
    expect(text).toContain('1 rows predate the effort field');
  });

  it('omits both notes when neither applies', () => {
    const clean = [plantRow({
      branch: 'b',
      firstTimestamp: '2026-09-08T10:00:00.000Z',
      lastTimestamp: '2026-09-08T10:01:00.000Z',
    })];
    const lines = formatReport(summariseSessions(clean));

    expect(lines[1]).toBe('');
    expect(lines.join('\n')).not.toContain('note');
  });
});

describe('SESSION_KINDS', () => {
  it('is every prompt shape plus the residue kind', () => {
    const shapes = PROMPT_SHAPES.map((shape) => shape.kind);

    expect(new Set(SESSION_KINDS)).toEqual(new Set([...shapes, 'other']));
    expect(SESSION_KINDS).toHaveLength(shapes.length + 1);
  });
});

describe('parseReportArgs', () => {
  it('defaults to a table over everything', () => {
    expect(parseReportArgs([])).toEqual({
      json: false,
      kinds: null,
      entrypoints: null,
      errors: [],
    });
  });

  it('reads --json', () => {
    expect(parseReportArgs(['--json']).json).toBe(true);
  });

  it('reads a comma-separated kind list', () => {
    const parsed = parseReportArgs(['--kind=task, wrap-up']);

    expect(parsed.kinds).toEqual(['task', 'wrap-up']);
    expect(parsed.errors).toEqual([]);
  });

  it('unions a repeated flag and drops the duplicate', () => {
    const parsed = parseReportArgs([
      '--kind=task',
      '--kind=task,other',
      '--entrypoint=sdk-cli',
      '--entrypoint=sdk-cli',
    ]);

    expect(parsed.kinds).toEqual(['task', 'other']);
    expect(parsed.entrypoints).toEqual(['sdk-cli']);
  });

  it('refuses a kind that is not a session kind', () => {
    const parsed = parseReportArgs(['--kind=tasks']);

    expect(parsed.kinds).toBeNull();
    expect(parsed.errors).toHaveLength(1);
    expect(parsed.errors[0]).toContain('tasks');
  });

  it('refuses a valueless flag', () => {
    expect(parseReportArgs(['--kind']).errors).toEqual([
      '--kind takes a value, as --kind=<value>',
    ]);
    expect(parseReportArgs(['--entrypoint']).errors).toHaveLength(1);
  });

  it('refuses an unrecognised argument', () => {
    const parsed = parseReportArgs(['--entrypint=sdk-cli']);

    expect(parsed.entrypoints).toBeNull();
    expect(parsed.errors).toEqual([
      'unrecognised argument: --entrypint=sdk-cli',
    ]);
  });

  it('collects every refusal, not just the first', () => {
    const parsed = parseReportArgs(['--nope', '--kind=nope']);

    expect(parsed.errors).toHaveLength(2);
  });
});

/** A store file written directly, in a directory of its own. */
function plantStore(rows: readonly unknown[]): string {
  planted += 1;
  const root = join(tempRoot, `${planted}-repo`);
  const path = effortStorePath(root, 'sessions');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`,
    'utf8',
  );
  return root;
}

describe('buildReport', () => {
  it('answers an empty report when no store exists', () => {
    const report = buildReport({ repoRoot: join(tempRoot, 'nothing-here') });

    expect(report.rowsRead).toBe(0);
    expect(report.groups).toEqual([]);
  });

  it('rolls up the rows a store holds', () => {
    const report = buildReport({ repoRoot: plantStore(ROWS) });

    expect(report.rowsRead).toBe(ROWS.length);
    expect(report.groups).toHaveLength(4);
    expect(report.totals.assistantTurns).toBe(21);
  });

  it('applies its filters to what the store held', () => {
    const root = plantStore(ROWS);
    const report = buildReport({ repoRoot: root, kinds: ['task'] });

    expect(report.totals.sessions).toBe(4);
    expect(report.filters.kinds).toEqual(['task']);
  });

  it('reads a legacy row with no effort field at all', () => {
    const root = plantStore([{
      ...plantRow({ sessionId: 'legacy', branch: 'feat/x' }),
      effortCounts: undefined,
    }]);
    const report = buildReport({ repoRoot: root });

    expect(report.totals.sessionsWithoutEffort).toBe(1);
  });
});
