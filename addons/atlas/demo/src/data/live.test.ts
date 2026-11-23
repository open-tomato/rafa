/**
 * Tests for the live page source over a stub client: the range windows of
 * D6, the requests the source makes, each of the 17 PoC metrics'
 * `QueryResult` mapped into its `LensResult` fields, each phase-4 metric's
 * (`live-sources.ts`) mapped into its field, a GitHub-only metric with no
 * row marked not wired with the `--github` build line, each field's meta
 * (its row count, and a proxy's `ProxyNote`), the weeks the weekly
 * fields span, every other field marked not wired, an API that is not there failing with the start line, and
 * `?source=` reading as the mock unless it names `live`. The stub client
 * (`testdata/live-client.fixture.ts`) records every call. The page drawn
 * over each source is `App.test.tsx`'s, since this file imports no TSX.
 */
import type { SourceMetric } from './live-sources.js';
import type { LiveMetric } from './live.js';
import type { MockData } from './mock.js';
import type { LensResult } from './source.js';
import type { StubCall } from './testdata/live-client.fixture.js';
import type { QueryResult } from '@open-tomato/atlas-data/contract';
import type { AtlasClient } from '@open-tomato/atlas-transport/client';
import type { BoxGroup } from '@open-tomato/charts';

import { AtlasRequestError, AtlasTransportError } from '@open-tomato/atlas-transport/client';
import { beforeEach, describe, expect, it } from 'bun:test';

import { readPageSource } from '../url.js';

import {
  defectDensityOf,
  GITHUB_BUILD_LINE,
  GITHUB_NOT_READ,
  NO_AGENT,
  PLANS_SOURCE_ID,
  SOURCE_METRIC_FIELDS,
  SOURCE_METRICS,
  SOURCE_WIRED_FIELDS,
  WINDOWED_SOURCE_METRICS,
} from './live-sources.js';
import {
  createLiveLensSource,
  KPI_METRICS,
  LIVE_METRICS,
  LIVE_UNAVAILABLE,
  liveResultOf,
  METRIC_FIELDS,
  NOT_WIRED,
  RANGE_WINDOW,
  taskMinutesBinsOf,
  WIRED_FIELDS,
} from './live.js';
import { TASK_MINUTE_EDGES } from './mock.js';
import {
  failingClient,
  resultOf,
  STUB_ANSWERS,
  STUB_PLANS,
  STUB_PROXIES,
  STUB_SOURCE_ANSWERS,
  STUB_WINDOW,
  STUB_WIP_LIMIT,
  stubLiveClient,
  stubNoteOf,
} from './testdata/live-client.fixture.js';

const DAY_MS = 86_400_000;
const SPAN_MS = 28 * DAY_MS;

/** The page's history, read off the DOM global the preload registers. */
const pageHistory = (globalThis as unknown as { readonly history: { replaceState(data: unknown, unused: string, url: string): void } }).history;

/** Every stub answer by catalogue id, the PoC metrics' and the phase-4 ones'. */
const ANSWER_OF: ReadonlyMap<string, QueryResult> = new Map([
  ...(Object.keys(LIVE_METRICS) as LiveMetric[]).map((key) => [LIVE_METRICS[key], STUB_ANSWERS[key]] as const),
  ...(Object.keys(SOURCE_METRICS) as SourceMetric[]).map((key) => [SOURCE_METRICS[key], STUB_SOURCE_ANSWERS[key]] as const),
]);

/** `answer`'s columns with no row. */
function columnsOnly(answer: QueryResult): QueryResult {
  return resultOf(answer.columns.map((column) => column.key), []);
}

/** A client answering every metric and the plans query with its stub columns and no row: the control the filled fields are held against. */
function emptyClient(): AtlasClient {
  return {
    ...stubLiveClient().client,
    runMetric: (id) => {
      const answer = ANSWER_OF.get(id);
      if (answer === undefined) return Promise.reject(new Error(`no stub answer for ${id}`));
      return Promise.resolve(columnsOnly(answer));
    },
    query: () => Promise.resolve(columnsOnly(STUB_PLANS)),
  };
}

async function liveResult(): Promise<{ readonly result: LensResult; readonly calls: readonly StubCall[] }> {
  const { client, calls } = stubLiveClient();
  return { result: await liveResultOf(client, 'past-month'), calls };
}

describe('RANGE_WINDOW', () => {
  it('holds D6: now is today for a KPI and seven days for a series, then 7d, 28d and 52w', () => {
    expect(RANGE_WINDOW).toEqual({
      'now': { series: { last: '7d' }, kpi: { last: '1d' } },
      'last-week': { series: { last: '7d' }, kpi: { last: '7d' } },
      'past-month': { series: { last: '28d' }, kpi: { last: '28d' } },
      'last-year': { series: { last: '52w' }, kpi: { last: '52w' } },
    });
    expect(Object.keys(RANGE_WINDOW)).toEqual(['now', 'last-week', 'past-month', 'last-year']);
  });
});

describe('liveResultOf over a stub client: the requests', () => {
  it('GUARD: asks the stub each of the 17 metrics over the range\'s window, the phase-4 ones over it or none, then tokens and debt over the window before it', async () => {
    const { calls } = await liveResult();
    const previous = { from: '2026-09-28T00:00:00.000Z', to: STUB_WINDOW.from };

    expect(calls.length).toBeGreaterThan(0);
    expect(calls).toEqual([
      ...Object.values(LIVE_METRICS).map((id) => ({ id, window: { last: '28d' } })),
      { id: 'dev.deploys-per-week', window: { last: '28d' } },
      { id: 'arch.loc-per-module', window: undefined },
      { id: 'arch.coupling', window: undefined },
      { id: 'dev.wip', window: undefined },
      { id: 'qa.resolution-time', window: { last: '28d' } },
      { id: 'qa.bug-outcome-by-loop-start', window: undefined },
      { id: 'qa.open-bugs-per-day', window: undefined },
      { id: 'pm.minutes-per-agent', window: { last: '28d' } },
      { id: 'qa.defect-density', window: undefined },
      { id: 'pm.tokens-per-day', window: previous },
      { id: 'arch.debt-ratio', window: previous },
    ]);
    expect([...WINDOWED_SOURCE_METRICS].sort()).toEqual(['deploysPerWeek', 'minutesPerAgent', 'resolutionTime']);
  });

  it('reads the plans\' first sessions once, over the series window, for the outcome card', async () => {
    const { client, queries } = stubLiveClient();
    await liveResultOf(client, 'last-year');

    expect(queries).toEqual([{ id: PLANS_SOURCE_ID, params: { window: { last: '52w' }, fields: ['plan_stub', 'first_at'], limit: 5_000 } }]);
  });

  it('asks the two one-number tiles over the KPI window, every other metric over the series window', async () => {
    const { client, calls } = stubLiveClient();
    await liveResultOf(client, 'now');
    const windowOf = (id: string): unknown => calls.find((call) => call.id === id)?.window;

    expect([...KPI_METRICS].sort()).toEqual(['activeBlockers', 'redCiShare']);
    expect(windowOf(LIVE_METRICS.redCiShare)).toEqual({ last: '1d' });
    expect(windowOf(LIVE_METRICS.activeBlockers)).toEqual({ last: '1d' });
    expect(windowOf(LIVE_METRICS.budgetBurn)).toEqual({ last: '7d' });
  });
});

describe('liveResultOf over a stub client: each field filled', () => {
  it('runs the 17 metrics of section G\'s 16 rows, each filling its own field first', () => {
    expect(Object.keys(LIVE_METRICS)).toHaveLength(17);
    expect(new Set(Object.values(LIVE_METRICS)).size).toBe(17);
    expect(Object.keys(METRIC_FIELDS)).toEqual(Object.keys(LIVE_METRICS));
    expect(new Set(WIRED_FIELDS).size).toBe(WIRED_FIELDS.length);
  });

  it('fills every wired field from its answer: each differs from what an answer with no rows gives (control)', async () => {
    const { result } = await liveResult();
    const empty = await liveResultOf(emptyClient(), 'past-month');
    const mockFields = WIRED_FIELDS.filter((field): field is keyof MockData => field in result.mock);
    const mockNames: readonly string[] = mockFields;

    expect(mockNames).toEqual(WIRED_FIELDS.filter((field) => field !== 'workspace'));
    for (const field of mockFields) {
      expect({ field, value: result.mock[field] }).not.toEqual({ field, value: empty.mock[field] });
    }
    expect(result.workspace.members).not.toEqual(empty.workspace.members);
    expect(result.workspace.edges).not.toEqual(empty.workspace.edges);
  });

  it('maps tokens per day to one point a row, and the daily average over the 28 days of the window', async () => {
    const { result } = await liveResult();

    expect(result.source).toBe('live');
    expect(result.mock.tokensPerDay).toEqual([
      { x: new Date('2026-11-20'), y: 1_000 },
      { x: new Date('2026-11-21'), y: 3_000 },
    ]);
    expect(result.mock.tokensDailyAverage).toBe(Math.round(4_000 / 28));
  });

  it('draws the previous window\'s days over the current ones, one window length later', async () => {
    const { result } = await liveResult();

    expect(result.mock.tokensPerDayPrevious).toEqual([{ x: new Date(new Date('2026-10-23').getTime() + SPAN_MS), y: 2_000 }]);
  });

  it('reads the budget burn\'s week holding the window\'s last day, and the week before', async () => {
    const { result } = await liveResult();

    expect([result.mock.tokensThisWeek, result.mock.tokensLastWeek]).toEqual([4_000, 9_000]);
  });

  it('maps plans started and completed per week, and the completed ones as points', async () => {
    const { result } = await liveResult();

    expect(result.mock.plansPerWeek).toEqual([{ week: new Date('2026-11-09'), started: 4, completed: 3 }]);
    expect(result.mock.plansCompletedPerWeek).toEqual([{ x: new Date('2026-11-09'), y: 3 }]);
  });

  it('maps planned tasks against sessions per plan, a plan the store did not name as unknown', async () => {
    const { result } = await liveResult();

    expect(result.mock.plannedVsSessions).toEqual([
      { plan: 'stub-plan-a', planned: 6, sessions: 9 },
      { plan: 'unknown', planned: 2, sessions: 2 },
    ]);
  });

  it('maps each active blocker with its day, plan, task line and text', async () => {
    const { result } = await liveResult();

    expect(result.mock.activeBlockers).toEqual([{ day: new Date('2026-11-21'), plan: 'stub-plan-a', taskLine: 7, what: 'stub blocker' }]);
  });

  it('sums the fix and chore shares into the debt ratio, and slices the minutes by work type, the previous window too', async () => {
    const { result } = await liveResult();

    expect(result.mock.debtRatio).toBeCloseTo(0.4, 10);
    expect(result.mock.minutesByChangeKind.map((slice) => [slice.id, slice.value])).toEqual([['feature', 600], ['fix', 300], ['chore', 100]]);
    expect(result.mock.minutesByChangeKindPrevious.map((slice) => [slice.id, slice.value])).toEqual([['feature', 400], ['fix', 0], ['chore', 0]]);
  });

  it('maps the weekly quantiles to one decimal, an empty aggregate as 0', async () => {
    const { result } = await liveResult();

    expect(result.mock.taskMinutesQuantiles).toEqual([
      { week: new Date('2026-11-16'), p50: 12.3, p90: 40.1 },
      { week: new Date('2026-11-09'), p50: 0, p90: 8 },
    ]);
  });

  it('stacks one series per model, the biggest spender first, a point on every day and unknown for no model', async () => {
    const { result } = await liveResult();
    const series = result.mock.tokensByModel;

    expect(series.map((entry) => [entry.id, entry.label, entry.tone])).toEqual([
      ['stub-model-b', 'stub-model-b', 'series-1'],
      ['stub-model-a', 'stub-model-a', 'series-2'],
      ['unknown', 'unknown', 'series-3'],
    ]);
    expect(series[1]?.points).toEqual([
      { x: new Date('2026-11-20'), y: 0 },
      { x: new Date('2026-11-21'), y: 2_000 },
    ]);
  });

  it('lays the preflight halts on weekday rows, Monday first, and one column per week of the window', async () => {
    const { result } = await liveResult();
    const grid = result.mock.preflightHalts;

    expect(grid).toHaveLength(7);
    expect(grid.every((row) => row.length === 4)).toBe(true);
    expect(grid[1]?.[0]).toBe(2);
    expect(grid[6]?.[3]).toBe(1);
    expect(grid.flat().reduce((sum, value) => sum + value, 0)).toBe(3);
  });

  it('counts tasks done per window week by work type, a week with none as zeros and no type left out', async () => {
    const { result } = await liveResult();

    expect(result.mock.tasksDonePerWeek).toEqual([
      { week: new Date('2026-10-26'), feature: 0, fix: 0, chore: 0 },
      { week: new Date('2026-11-02'), feature: 5, fix: 2, chore: 0 },
      { week: new Date('2026-11-09'), feature: 0, fix: 0, chore: 0 },
      { week: new Date('2026-11-16'), feature: 0, fix: 0, chore: 1 },
    ]);
  });

  it('plots each task session with minutes, and a seven-day moving median over the days that hold one', async () => {
    const { result } = await liveResult();

    expect(result.mock.taskCycle).toEqual([
      { x: new Date('2026-11-20T10:00:00.000Z'), y: 12.3, label: 'stub-plan-a task 3' },
      { x: new Date('2026-11-21T09:00:00.000Z'), y: 30, label: 'unknown' },
    ]);
    expect(result.mock.taskCycleTrend).toEqual([
      { x: new Date('2026-11-20'), y: 12.3 },
      { x: new Date('2026-11-21'), y: 12.3 },
      { x: new Date('2026-11-22'), y: 12.3 },
    ]);
  });

  it('bins the task sessions by their minutes on the mock\'s edges, from included and to not', async () => {
    const { result } = await liveResult();
    const counted = result.mock.taskMinutesBins.filter((bin) => bin.count > 0);

    expect(result.mock.taskMinutesBins.map((bin) => bin.from)).toEqual(TASK_MINUTE_EDGES.slice(0, -1));
    expect(counted).toEqual([{ from: 10, to: 15, count: 1 }, { from: 30, to: 45, count: 1 }]);
  });

  it('adds one bin past the last edge only when a session ran that long, to its minutes rounded up', () => {
    const at = new Date('2026-11-20');
    const points = [180, 412.2, 20].map((y) => ({ x: at, y }));

    expect(taskMinutesBinsOf(points).at(-1)).toEqual({ from: 180, to: 413, count: 2 });
    expect(taskMinutesBinsOf([{ x: at, y: 179.9 }]).at(-1)).toEqual({ from: 120, to: 180, count: 1 });
  });

  it('reads the red verdict\'s share for the red CI tile', async () => {
    const { result } = await liveResult();

    expect(result.mock.redCiShare).toBe(0.1);
  });

  it('gives one record per window week of bugs by kind and by route, each group the answer names, unknown for none', async () => {
    const { result } = await liveResult();

    expect(result.mock.bugsByKindPerWeek).toEqual([
      { 'bug': 0, 'own-gap': 0, 'unknown': 0 },
      { 'bug': 2, 'own-gap': 0, 'unknown': 0 },
      { 'bug': 0, 'own-gap': 0, 'unknown': 0 },
      { 'bug': 0, 'own-gap': 1, 'unknown': 1 },
    ]);
    expect(result.mock.filedSharePerWeek.at(-1)).toEqual({ filed: 2, private: 1 });
    expect(result.mock.filedSharePerWeek).toHaveLength(4);
  });

  it('gives regressions as one point per window week, 0 for a week with none', async () => {
    const { result } = await liveResult();

    expect(result.mock.regressionsPerWeek.map((point) => point.y)).toEqual([0, 0, 2, 0]);
    expect(result.mock.regressionsPerWeek[2]?.x).toEqual(new Date('2026-11-09'));
  });

  it('splits each failing set into its checks, summing failures and flipped heads per check, the most failures first', async () => {
    const { result } = await liveResult();

    expect(result.mock.flakyChecks).toEqual([
      { name: 'stub-a.test.ts', failures: 4, readings: 3 },
      { name: 'stub-b.test.ts', failures: 3, readings: 2 },
    ]);
  });
});

describe('liveResultOf over a stub client: the phase-4 fields', () => {
  it('wires the four fields phase 4 names, WIP, the two bug backlog fields, the minutes per agent and the defect density, each from its own metric', () => {
    expect(SOURCE_WIRED_FIELDS).toEqual([
      'deploysPerWeek', 'modules', 'workspace', 'wip', 'resolutionByPriority', 'bugOutcomeByLoopStart', 'openBugsPerDay', 'minutesPerAgent', 'defectDensity',
    ]);
    expect(Object.keys(SOURCE_METRIC_FIELDS)).toEqual(Object.keys(SOURCE_METRICS));
    for (const field of SOURCE_WIRED_FIELDS) expect({ field, wired: WIRED_FIELDS.includes(field) }).toEqual({ field, wired: true });
  });

  it('counts release tags per window week, 0 for a week with none', async () => {
    const { result } = await liveResult();

    expect(result.mock.deploysPerWeek).toEqual([0, 2, 0, 1]);
  });

  it('draws one treemap tile per module folder with lines, grouped by the folder it sits in', async () => {
    const { result } = await liveResult();

    expect(result.mock.modules).toEqual([
      { id: 'packages/stub-core', label: 'stub-core', group: 'packages', value: 1_200 },
      { id: 'addons/stub-addon', label: 'stub-addon', group: 'addons', value: 300 },
    ]);
  });

  it('lays the module graph into the workspace: a node per module, an edge per import of another module, dependency first', async () => {
    const { result } = await liveResult();

    expect(result.workspace.members).toEqual([
      { id: '@open-tomato/stub-core', label: 'stub-core', group: 'packages', value: 3 },
      { id: '@open-tomato/stub-addon', label: 'stub-addon', group: 'addons', value: 1 },
      { id: 'packages/stub-loose', label: 'stub-loose', group: 'packages', value: 1 },
    ]);
    expect(result.workspace.edges).toEqual([
      { source: '@open-tomato/stub-core', target: '@open-tomato/stub-addon', value: 1 },
      { source: '@open-tomato/stub-core', target: 'packages/stub-loose', value: 1 },
    ]);
  });

  it('refuses an import list that is not a list of package names', async () => {
    const stub = stubLiveClient().client;
    const client: AtlasClient = {
      ...stub,
      runMetric: (id, window) => (id === SOURCE_METRICS.coupling
        ? Promise.resolve(resultOf(['path', 'package', 'imports_json', 'fan_in', 'fan_out'], [['packages/x', null, '[1]', 0, 0]]))
        : stub.runMetric(id, window)),
    };

    await expect(liveResultOf(client, 'past-month')).rejects.toThrow('atlas: "[1]" is not a list of packages');
  });

  it('reads WIP as the issue count against the goal the API lists for dev.wip, and no ceiling with none', async () => {
    const { result } = await liveResult();
    const stub = stubLiveClient().client;
    const noGoal: AtlasClient = {
      ...stub,
      listMetrics: async () => (await stub.listMetrics()).map((definition) => (definition.id === SOURCE_METRICS.wip
        ? { ...definition, goal: undefined }
        : definition)),
    };

    expect(result.mock.wip).toEqual({ now: 3, limit: STUB_WIP_LIMIT });
    expect((await liveResultOf(noGoal, 'past-month')).mock.wip).toEqual({ now: 3, limit: null });
  });

  it('draws a box per priority of the days each fixed bug was open, a bug with no priority as unknown last', async () => {
    const { result } = await liveResult();
    const box = (label: string, days: number): BoxGroup => ({ label, min: days, q1: days, median: days, q3: days, max: days, outliers: [] });

    expect(result.mock.resolutionByPriority).toEqual([box('P1', 0.5), box('P2', 2), box('unknown', 4)]);
  });

  it('counts each loop\'s bugs on the day its plan started as fixed, dropped or open, leaving out a plan with no start', async () => {
    const { result } = await liveResult();

    expect(result.mock.bugOutcomeByLoopStart).toEqual([
      { day: new Date('2026-11-03'), fixed: 0, dropped: 0, open: 4 },
      { day: new Date('2026-11-10'), fixed: 3, dropped: 1, open: 2 },
    ]);
  });

  it('counts the bugs open at the end of each window day, all of them and those a loop filed', async () => {
    const { result } = await liveResult();
    const days = result.mock.openBugsPerDay;
    const on = (day: string): unknown => days.find((entry) => entry.day.getTime() === new Date(day).getTime());

    expect(days).toHaveLength(28);
    expect(days[0]).toEqual({ day: new Date('2026-10-26'), all: 1, fromLoops: 1 });
    expect(on('2026-11-20')).toEqual({ day: new Date('2026-11-20'), all: 2, fromLoops: 1 });
    expect(on('2026-11-21')).toEqual({ day: new Date('2026-11-21'), all: 2, fromLoops: 1 });
    expect(days.at(-1)).toEqual({ day: new Date('2026-11-22'), all: 1, fromLoops: 1 });
  });

  it('sums the task session minutes per agent in the answer\'s order, no agent named as such and an agent with none left out', async () => {
    const { result } = await liveResult();

    expect(result.mock.minutesPerAgent).toEqual([{ agent: 'stub-agent-a', minutes: 600 }, { agent: NO_AGENT, minutes: 90 }]);
  });

  it('reads the defect density per 1,000 lines over the folders that hold code, a folder with no line left out', async () => {
    const { result } = await liveResult();

    // (3 + 1) bugs over 4,000 lines: the 7 bugs of src/gone, a folder with no line, count nowhere.
    expect(result.mock.defectDensity).toBe(1);
    expect(defectDensityOf(resultOf(['path', 'bugs', 'loc'], [['src/gone', 7, 0]]))).toBe(0);
  });

  it('gives each phase-4 field its metric and row count, a proxy\'s note on the module fields', async () => {
    const { result } = await liveResult();

    for (const key of Object.keys(SOURCE_METRICS) as SourceMetric[]) {
      for (const field of SOURCE_METRIC_FIELDS[key]) {
        expect({ field, metricId: result.fieldMeta.get(field)?.metricId, rowCount: result.fieldMeta.get(field)?.rowCount })
          .toEqual({ field, metricId: SOURCE_METRICS[key], rowCount: STUB_SOURCE_ANSWERS[key].meta.rowCount });
      }
    }
    expect(result.fieldMeta.get('modules')?.proxyNote).toBe(stubNoteOf('arch.loc-per-module'));
    expect(result.fieldMeta.get('wip')?.proxyNote).toBeUndefined();
  });
});

describe('liveResultOf over a stub client: a replica with no GitHub data', () => {
  it('marks the fields of a GitHub-only metric that answered no row not wired, with the --github build line', async () => {
    const result = await liveResultOf(stubLiveClient({ github: false }).client, 'past-month');

    expect(GITHUB_NOT_READ).toContain(GITHUB_BUILD_LINE);
    expect(GITHUB_BUILD_LINE).toBe('rafa module exec @open-tomato/rafa-atlas build --github');
    expect(result.notWired.has('resolutionByPriority')).toBe(true);
    expect(result.notWired.has('openBugsPerDay')).toBe(true);
    expect([...result.notWiredDetail.entries()]).toEqual([['resolutionByPriority', GITHUB_NOT_READ], ['openBugsPerDay', GITHUB_NOT_READ]]);
    expect(result.notWired.size).toBe(NOT_WIRED.size + 2);
  });

  it('control: keeps the offline phase-4 fields wired, and with GitHub data marks neither GitHub field', async () => {
    const offline = await liveResultOf(stubLiveClient({ github: false }).client, 'past-month');
    const { result } = await liveResult();

    for (const field of ['deploysPerWeek', 'modules', 'workspace', 'wip', 'bugOutcomeByLoopStart'] as const) {
      expect({ field, marked: offline.notWired.has(field) }).toEqual({ field, marked: false });
    }
    expect(offline.mock.bugOutcomeByLoopStart).toHaveLength(2);
    expect(result.notWired.has('resolutionByPriority')).toBe(false);
    expect(result.notWired.has('openBugsPerDay')).toBe(false);
  });
});

describe('liveResultOf over a stub client: field meta and the rest', () => {
  it('gives every wired field its metric and its answer\'s row count, the previous-window fields the earlier answer\'s', async () => {
    const { result } = await liveResult();

    expect([...result.fieldMeta.keys()].sort()).toEqual([...WIRED_FIELDS].sort());
    for (const key of Object.keys(LIVE_METRICS) as LiveMetric[]) {
      const own = METRIC_FIELDS[key][0] ?? 'balance';
      expect({ key, rowCount: result.fieldMeta.get(own)?.rowCount }).toEqual({ key, rowCount: STUB_ANSWERS[key].meta.rowCount });
      for (const field of METRIC_FIELDS[key]) expect(result.fieldMeta.get(field)?.metricId).toBe(LIVE_METRICS[key]);
    }
    expect(result.fieldMeta.get('tokensPerDay')?.rowCount).toBe(2);
    expect(result.fieldMeta.get('tokensPerDayPrevious')?.rowCount).toBe(1);
    expect(result.fieldMeta.get('minutesByChangeKindPrevious')?.rowCount).toBe(2);
  });

  it('carries the listed ProxyNote on every field of a proxy metric, and none on a direct one', async () => {
    const { result } = await liveResult();
    const proxies = [...result.fieldMeta.values()].filter((meta) => meta.proxyNote !== undefined);

    expect(new Set(proxies.map((meta) => meta.metricId))).toEqual(new Set(STUB_PROXIES));
    for (const meta of proxies) expect(meta.proxyNote).toBe(stubNoteOf(meta.metricId));
    expect(result.fieldMeta.get('debtRatio')?.proxyNote).toBe(stubNoteOf('arch.debt-ratio'));
    expect(result.fieldMeta.get('tokensPerDay')).toEqual({ metricId: 'pm.tokens-per-day', rowCount: 2 });
  });

  it('marks every other field not wired, the balance and the workspace included, and leaves them empty', async () => {
    const { result } = await liveResult();

    expect(result.notWired).toBe(NOT_WIRED);
    for (const field of WIRED_FIELDS) expect(result.notWired.has(field)).toBe(false);
    expect([...result.notWired].sort()).toEqual(['balance', 'scopeCreepPerWeek', 'taskPileTree', 'workDoneTree']);
    expect(result.notWired.size + WIRED_FIELDS.length).toBe(Object.keys(result.mock).length + 2);
    expect(result.notWiredDetail.size).toBe(0);
    expect(result.mock.scopeCreepPerWeek).toEqual([]);
    expect(result.balance).toEqual([]);
    expect(result.workspace.composition).toEqual([]);
    expect(result.workspace.sankeyNodes).toEqual([]);
  });

  it('names the series window\'s weeks, one per entry of the weekly fields that hold no dates', async () => {
    const { result } = await liveResult();
    const mondays = ['2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16'].map((day) => new Date(`${day}T00:00:00.000Z`));

    expect(result.weeks).toEqual(mondays);
    expect(result.mock.bugsByKindPerWeek).toHaveLength(mondays.length);
    expect(result.mock.filedSharePerWeek).toHaveLength(mondays.length);
    expect(result.mock.preflightHalts[0]).toHaveLength(mondays.length);
  });

  it('refuses an answer without the column a field is read from', async () => {
    const client: AtlasClient = { ...stubLiveClient().client, runMetric: () => Promise.resolve(resultOf(['day'], [])) };

    await expect(liveResultOf(client, 'now')).rejects.toThrow(/^atlas: the answer holds no \w+ column$/u);
  });

  it('refuses a failing set that is not a list of check names', async () => {
    const stub = stubLiveClient().client;
    const client: AtlasClient = {
      ...stub,
      runMetric: (id, window) => (id === LIVE_METRICS.flakyChecks
        ? Promise.resolve(resultOf(['failing_json', 'failures', 'heads'], [['{"a":1}', 1, 1]]))
        : stub.runMetric(id, window)),
    };

    await expect(liveResultOf(client, 'past-month')).rejects.toThrow('atlas: "{\\"a\\":1}" is not a list of checks');
  });
});

describe('createLiveLensSource', () => {
  it('fails with the start line when the API cannot be reached or has no replica, keeping the cause', async () => {
    const unreachable = new AtlasTransportError('the Atlas server could not be reached');
    const noReplica = new AtlasRequestError('replica_unavailable', 503, 'no replica');

    const first = await createLiveLensSource(failingClient(unreachable))('now').catch((error: unknown) => error);
    const second = await createLiveLensSource(failingClient(noReplica))('now').catch((error: unknown) => error);

    expect(first).toBeInstanceOf(Error);
    expect((first as Error).message).toBe(LIVE_UNAVAILABLE);
    expect((first as Error).cause).toBe(unreachable);
    expect((second as Error).message).toBe(LIVE_UNAVAILABLE);
  });

  it('control: passes any other error as it is', async () => {
    const invalid = new AtlasRequestError('invalid_params', 400, 'bad window');

    await expect(createLiveLensSource(failingClient(invalid))('now')).rejects.toBe(invalid);
  });
});

describe('the page source', () => {
  beforeEach(() => {
    pageHistory.replaceState(null, '', '/?still');
  });

  it('is the mock with no ?source, and with one it does not know', () => {
    expect(readPageSource()).toBe('mock');
    pageHistory.replaceState(null, '', '/?source=sample');
    expect(readPageSource()).toBe('mock');
  });

  it('control: is live when the page opens with ?source=live', () => {
    pageHistory.replaceState(null, '', '/?source=live&still');

    expect(readPageSource()).toBe('live');
  });
});
