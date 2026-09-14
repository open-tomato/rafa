/**
 * Tests for the per-plan effort report.
 *
 * Every case drives PLANTED rows. The report is pure over them, so no
 * case needs a session log or a clock, and only the cases over the
 * store and the command touch disk.
 *
 * The `buildReport` cases plant an NDJSON sessions file with `node:fs`
 * rather than by appending through the store module, so a truncated or
 * legacy file is distinguishable from one this repo wrote wrongly. Each
 * plants a `.rafa/config.yaml` selecting `ndjson` beside it, because the
 * report reads the store the config selects, and under the `sqlite`
 * default a planted NDJSON file is a store nothing reads. The SQLite
 * plants go through that backend's own `append`: a database cannot be
 * written a line at a time.
 *
 * The cases over which store is read plant DIFFERENT rows in the two
 * backends under one root, so a report reading the wrong one answers
 * the other's count rather than a plausible empty. The command cases
 * spawn `effort report` in a scratch git repository, since the command
 * resolves its root through git and takes no seam. The refusal's
 * control is the same command over a config it can run on, which exits
 * 0 and prints a document `JSON.parse` reads. The refused config holds
 * a problem in each of its two settings, so a command printing the
 * error's message as one line cannot pass for one printing a line per
 * problem: measured, with only the `store` problem planted, it did.
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
 * Nineteen module mutations were driven against this file and
 * EIGHTEEN reddened at least one case, none of them missing its target,
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
 * instead of tokens, accepting an unrecognised argument, and keeping a
 * duplicate on a repeated `--kind`. The two aimed at the table, an
 * empty histogram rendered as an empty string and the TOTAL row
 * dropped, moved with its cases to `report-format.test.ts`.
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
import type { SessionEffortRow } from './store/types.js';

import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'bun:test';

import { ConfigError, loadConfig } from '../config.js';

import { PROMPT_SHAPES } from './classify.js';
import {
  buildReport,
  dominantEntrypoint,
  emptyGroup,
  groupKeyOf,
  matchesFilters,
  parseReportArgs,
  SESSION_KINDS,
  sessionSpanMinutes,
  sortGroups,
  summariseSessions,
} from './report.js';
import { emptyUsageTotals } from './session-log.js';
import { openNdjsonStore, openSqliteStore } from './store/index.js';

const RAFA_ENTRY = fileURLToPath(new URL('../rafa.ts', import.meta.url));

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

/** A directory of its own under the suite's temporary root. */
function freshRoot(): string {
  planted += 1;
  const root = join(tempRoot, `${planted}-repo`);
  mkdirSync(root, { recursive: true });
  return root;
}

/** Plants `.rafa/config.yaml` under a root. */
function writeConfig(root: string, text: string): void {
  mkdirSync(join(root, '.rafa'), { recursive: true });
  writeFileSync(join(root, '.rafa', 'config.yaml'), text, 'utf8');
}

/** An NDJSON sessions file written directly under a root. */
function writeNdjsonSessions(root: string, rows: readonly unknown[]): void {
  const path = openNdjsonStore(root).path('sessions');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`,
    'utf8',
  );
}

/** Rows appended to the SQLite store under a root, through its backend. */
function appendSqliteSessions(
  root: string,
  rows: readonly ReportSessionRow[],
): void {
  const stored = rows as unknown as readonly SessionEffortRow[];
  const result = openSqliteStore(root).append('sessions', stored);
  if (result.appended !== rows.length) {
    throw new Error(`planted ${result.appended} of ${rows.length} rows`);
  }
}

/**
 * A store file written directly, in a directory of its own, beside the
 * config selecting the backend that file belongs to.
 */
function plantStore(rows: readonly unknown[]): string {
  const root = freshRoot();
  writeConfig(root, 'store: ndjson\n');
  writeNdjsonSessions(root, rows);
  return root;
}

/** What a call threw, or null when it returned. */
function thrownBy(call: () => unknown): unknown {
  try {
    call();
  } catch (error) {
    return error;
  }
  return null;
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

/** Rows the SQLite store holds when both backends are planted. */
const SQLITE_ROWS = ROWS.slice(0, 2);

/** Rows the NDJSON store holds when both backends are planted. */
const NDJSON_ROWS = ROWS.slice(2);

/** A root holding different rows in each backend, and a config. */
function plantBothBackends(config: string | null): string {
  const root = freshRoot();
  if (config !== null) writeConfig(root, config);
  appendSqliteSessions(root, SQLITE_ROWS);
  writeNdjsonSessions(root, NDJSON_ROWS);
  return root;
}

describe('the store a report reads', () => {
  it('reads the SQLite store when no config names one', () => {
    const report = buildReport({ repoRoot: plantBothBackends(null) });

    expect(report.rowsRead).toBe(SQLITE_ROWS.length);
    expect(report.groups.map((group) => group.key))
      .toEqual(['q19-loop-economics']);
  });

  it.each([
    ['sqlite', SQLITE_ROWS.length],
    ['ndjson', NDJSON_ROWS.length],
  ])('reads the rows of the backend store: %s selects', (backend, rows) => {
    const root = plantBothBackends(`store: ${backend}\n`);

    const report = buildReport({ repoRoot: root });

    expect(report.rowsRead).toBe(rows);
  });

  it('rolls the same rows up to the same bytes from either backend', () => {
    const sqliteRoot = freshRoot();
    appendSqliteSessions(sqliteRoot, ROWS);
    const ndjsonRoot = plantStore(ROWS);

    const fromSqlite = buildReport({ repoRoot: sqliteRoot });
    const fromNdjson = buildReport({ repoRoot: ndjsonRoot });

    expect(fromSqlite.rowsRead).toBe(ROWS.length);
    expect(fromSqlite.totals.sessionsWithoutEffort).toBe(1);
    expect(JSON.stringify(fromSqlite)).toBe(JSON.stringify(fromNdjson));
  });

  it('never reads the config when a store is passed', () => {
    // The config names a store no backend opens, so a report that read
    // it at all would refuse; the one below reads the store it was given.
    const root = plantBothBackends('store: postgres\n');

    const report = buildReport({
      repoRoot: root,
      store: openNdjsonStore(root),
    });

    expect(report.rowsRead).toBe(NDJSON_ROWS.length);
  });

  it('refuses a config it cannot run on', () => {
    const root = plantBothBackends('store: postgres\n');

    const refusal = thrownBy(() => buildReport({ repoRoot: root }));

    expect(refusal).toBeInstanceOf(ConfigError);
    expect((refusal as ConfigError).problems).toEqual([
      expect.stringContaining('store is "postgres"'),
    ]);
  });
});

/** A config holding a problem in each of its two settings. */
const TWO_PROBLEM_CONFIG = 'store: postgres\nplan:\n  inject: bogus\n';

/** What one run of the command printed, and how it exited. */
interface CommandRun {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * A scratch git repository with a config and a planted NDJSON store,
 * answered as its real path. The command takes its root from git, which
 * resolves macOS's `/var` symlink to `/private/var`, and a refusal quotes
 * the config path under that root.
 */
function makeRepo(config: string): string {
  const root = realpathSync(freshRoot());
  const init = Bun.spawnSync(['git', 'init', '-q'], { cwd: root });
  if (init.exitCode !== 0) {
    throw new Error(`git init: ${init.stderr.toString()}`);
  }
  writeConfig(root, config);
  writeNdjsonSessions(root, ROWS);
  return root;
}

/** Runs `effort report` inside a repository, as the dispatcher would. */
function runReport(root: string, args: readonly string[]): CommandRun {
  const run = Bun.spawnSync(
    [process.execPath, RAFA_ENTRY, 'effort', 'report', ...args],
    { cwd: root },
  );
  return {
    exitCode: run.exitCode,
    stdout: run.stdout.toString(),
    stderr: run.stderr.toString(),
  };
}

describe('the report command', () => {
  it('reads the store the config selects, warning on stderr alone', () => {
    const root = makeRepo('store: ndjson\ntracker: linear\n');

    const run = runReport(root, ['--json']);

    expect(run.exitCode).toBe(0);
    expect((JSON.parse(run.stdout) as { rowsRead: number }).rowsRead)
      .toBe(ROWS.length);
    expect(run.stderr).toContain('"tracker"');
  });

  it('prints a config it cannot run on as one refusal per problem', () => {
    const root = makeRepo(TWO_PROBLEM_CONFIG);
    const refusal = thrownBy(() => loadConfig(root)) as ConfigError;

    const run = runReport(root, ['--json']);

    expect(refusal.problems).toEqual([
      expect.stringContaining('store is "postgres"'),
      expect.stringContaining('bogus'),
    ]);
    expect(run.exitCode).toBe(1);
    expect(run.stderr.trimEnd().split('\n')).toEqual(
      refusal.problems.map((problem) => `ralph effort report: ${problem}`),
    );
    expect(run.stdout).toBe('');
  });
});
