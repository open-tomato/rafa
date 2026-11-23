/**
 * A stub `AtlasClient` for the live source's tests (`../live.test.ts`) and
 * the page's (`../../App.test.tsx`). Its `runMetric` answers the fixed
 * results below, one per PoC metric and one per metric of
 * `live-sources.ts`, in the columns the engine answers it with, and
 * records every call; `query` answers the plans' first sessions
 * (`STUB_PLANS`) and records every query; `listMetrics` answers
 * `STUB_DEFINITIONS`, whose proxies carry a stub note, whose two GitHub
 * metrics are `gh` and whose WIP metric has the goal `STUB_WIP_LIMIT`;
 * each other route refuses. Asked with `{ github: false }`, the GitHub
 * metrics answer no row, as after a build run without `--github`. The
 * values are ones no real store holds (`stub-model-a`, round thousands),
 * so a stray request elsewhere would show. Named without `.test` so bun
 * never runs it alone.
 */
import type { MetricDefinition, QueryParams, QueryResult, Scalar, Window } from '@open-tomato/atlas-data/contract';
import type { AtlasClient } from '@open-tomato/atlas-transport/client';

import { PLANS_SOURCE_ID, SOURCE_METRICS, type SourceMetric } from '../live-sources.js';
import { LIVE_METRICS, type LiveMetric } from '../live.js';

/** The window the stub says it ran: 28 days ending 2026-11-23. */
export const STUB_WINDOW: { readonly from: string; readonly to: string } = { from: '2026-10-26T00:00:00.000Z', to: '2026-11-23T00:00:00.000Z' };

/** A result of string columns, `rows` and the window it ran over. */
export function resultOf(
  columns: readonly string[],
  rows: readonly (readonly Scalar[])[],
  window: { readonly from: string | null; readonly to: string | null } = STUB_WINDOW,
): QueryResult {
  return {
    columns: columns.map((key) => ({ key, label: key, type: 'string' })),
    rows,
    meta: { asOf: '2026-11-22T09:00:00.000Z', partial: false, partialReasons: [], rowCount: rows.length, truncated: false, window },
  };
}

export const STUB_TOKENS: QueryResult = resultOf(['day', 'tokens'], [['2026-11-20', 1_000], ['2026-11-21', 3_000]]);

/** Tokens per day over the 28 days before `STUB_WINDOW`. */
export const STUB_PREVIOUS_TOKENS: QueryResult = resultOf(['day', 'tokens'], [['2026-10-23', 2_000]], { from: '2026-09-28T00:00:00.000Z', to: STUB_WINDOW.from });

export const STUB_BY_MODEL: QueryResult = resultOf(['day', 'model', 'tokens'], [
  ['2026-11-20', 'stub-model-b', 1_000],
  ['2026-11-21', 'stub-model-a', 2_000],
  ['2026-11-21', 'stub-model-b', 1_000],
  ['2026-11-21', null, 500],
]);

export const STUB_QUANTILES: QueryResult = resultOf(['week', 'p50', 'p90'], [['2026-11-16', 12.34, 40.06], ['2026-11-09', null, 8]]);

export const STUB_BUDGET: QueryResult = resultOf(['week', 'tokens'], [['2026-11-09', 9_000], ['2026-11-16', 4_000]]);

export const STUB_PLAN_COMPLETION: QueryResult = resultOf(['week', 'started', 'completed', 'completion'], [['2026-11-09', 4, 3, 0.75]]);

export const STUB_PLANNED: QueryResult = resultOf(['plan_stub', 'planned', 'sessions'], [['stub-plan-a', 6, 9], [null, 2, 2]]);

export const STUB_BLOCKERS: QueryResult = resultOf(['day', 'plan_stub', 'task_line', 'what'], [['2026-11-21', 'stub-plan-a', 7, 'stub blocker']]);

export const STUB_DEBT: QueryResult = resultOf(['work_type', 'minutes', 'share'], [['feature', 600, 0.6], ['fix', 300, 0.3], ['chore', 100, 0.1]]);

/** Task minutes by work type over the 28 days before `STUB_WINDOW`: a task with no work type, and no fix or chore. */
export const STUB_PREVIOUS_DEBT: QueryResult = resultOf(['work_type', 'minutes', 'share'], [['feature', 400, 0.8], [null, 100, 0.2]], { from: '2026-09-28T00:00:00.000Z', to: STUB_WINDOW.from });

/** A Tuesday of the window's first week and the Sunday of its last. */
export const STUB_HALTS: QueryResult = resultOf(['day', 'halts', 'runs'], [['2026-10-27', 2, 5], ['2026-11-22', 1, 3]]);

export const STUB_TASKS_DONE: QueryResult = resultOf(['week', 'work_type', 'tasks'], [
  ['2026-11-02', 'feature', 5],
  ['2026-11-02', 'fix', 2],
  ['2026-11-16', 'chore', 1],
  ['2026-11-16', null, 4],
]);

/** Two sessions with minutes, and one still running (no minutes). */
export const STUB_TASK_CYCLE: QueryResult = resultOf(['started_at', 'plan_stub', 'task_line', 'minutes'], [
  ['2026-11-20T10:00:00.000Z', 'stub-plan-a', 3, 12.34],
  ['2026-11-21T09:00:00.000Z', null, null, 30],
  ['2026-11-21T11:00:00.000Z', 'stub-plan-a', 5, null],
]);

export const STUB_RED_CI: QueryResult = resultOf(['verdict', 'readings', 'share'], [['green', 9, 0.9], ['red', 1, 0.1]]);

export const STUB_PLANS_COMPLETED: QueryResult = resultOf(['week', 'completed'], [['2026-11-09', 3]]);

export const STUB_BUGS: QueryResult = resultOf(['week', 'kind', 'bugs'], [['2026-11-02', 'bug', 2], ['2026-11-16', 'own-gap', 1], ['2026-11-16', null, 1]]);

export const STUB_REGRESSIONS: QueryResult = resultOf(['week', 'bugs'], [['2026-11-09', 2]]);

export const STUB_FLAKY: QueryResult = resultOf(['failing_json', 'failures', 'heads'], [['["stub-a.test.ts","stub-b.test.ts"]', 3, 2], ['["stub-a.test.ts"]', 1, 1]]);

export const STUB_FILED: QueryResult = resultOf(['week', 'route', 'bugs'], [['2026-11-16', 'filed', 2], ['2026-11-16', 'private', 1]]);

/** The answer of each metric over the range's window. */
export const STUB_ANSWERS: Readonly<Record<LiveMetric, QueryResult>> = {
  budgetBurn: STUB_BUDGET,
  tokensPerDay: STUB_TOKENS,
  planCompletion: STUB_PLAN_COMPLETION,
  plannedVsSessions: STUB_PLANNED,
  activeBlockers: STUB_BLOCKERS,
  debtRatio: STUB_DEBT,
  taskMinutesQuantiles: STUB_QUANTILES,
  tokensByModel: STUB_BY_MODEL,
  preflightHalts: STUB_HALTS,
  tasksDonePerWeek: STUB_TASKS_DONE,
  taskCycle: STUB_TASK_CYCLE,
  redCiShare: STUB_RED_CI,
  plansCompletedPerWeek: STUB_PLANS_COMPLETED,
  bugsByKind: STUB_BUGS,
  regressions: STUB_REGRESSIONS,
  flakyChecks: STUB_FLAKY,
  filedShare: STUB_FILED,
};

/** Release tags in the window's second and fourth weeks. */
export const STUB_DEPLOYS: QueryResult = resultOf(['week', 'deploys'], [['2026-11-02', 2], ['2026-11-16', 1]]);

/** Two module folders with lines, and one with none, which draws no tile. */
export const STUB_LOC: QueryResult = resultOf(['path', 'loc', 'files'], [
  ['packages/stub-core', 1_200, 10],
  ['addons/stub-addon', 300, 4],
  ['packages/stub-empty', 0, 0],
], { from: null, to: null });

/** Two modules importing the core one, one with no package, and an import no module carries. */
export const STUB_COUPLING: QueryResult = resultOf(['path', 'package', 'imports_json', 'fan_in', 'fan_out'], [
  ['packages/stub-core', '@open-tomato/stub-core', '[]', 2, 0],
  ['addons/stub-addon', '@open-tomato/stub-addon', '["@open-tomato/stub-core","@open-tomato/stub-outside"]', 0, 1],
  ['packages/stub-loose', null, '["@open-tomato/stub-core"]', 0, 1],
], { from: null, to: null });

export const STUB_WIP: QueryResult = resultOf(['issues'], [[3]], { from: null, to: null });

/** The WIP ceiling the stub lists as `dev.wip`'s goal. */
export const STUB_WIP_LIMIT = 5;

/** Three fixed bugs: half a day at P1, two days at P2, four days with no priority. */
export const STUB_RESOLUTION: QueryResult = resultOf(['number', 'priority', 'created_at', 'closed_at'], [
  [1, 'P2', '2026-11-01T00:00:00.000Z', '2026-11-03T00:00:00.000Z'],
  [2, 'P1', '2026-11-02T00:00:00.000Z', '2026-11-02T12:00:00.000Z'],
  [3, null, '2026-11-04T00:00:00.000Z', '2026-11-08T00:00:00.000Z'],
]);

/** Plan a's bugs fixed, dropped and open; plan b's open; and a plan `STUB_PLANS` does not date. */
export const STUB_OUTCOME: QueryResult = resultOf(['plan_stub', 'state', 'state_reason', 'bugs'], [
  ['stub-plan-a', 'CLOSED', 'COMPLETED', 3],
  ['stub-plan-a', 'CLOSED', 'NOT_PLANNED', 1],
  ['stub-plan-a', 'OPEN', null, 2],
  ['stub-plan-b', 'OPEN', null, 4],
  ['stub-plan-old', 'CLOSED', 'COMPLETED', 9],
], { from: null, to: null });

/** The first session of plans a and b, b late on its day (UTC). */
export const STUB_PLANS: QueryResult = resultOf(['plan_stub', 'first_at'], [
  ['stub-plan-a', '2026-11-10T08:00:00.000Z'],
  ['stub-plan-b', '2026-11-03T22:00:00.000Z'],
]);

/** A loop's bug open since before the window, and one filed by hand, open two nights. */
export const STUB_OPEN_BUGS: QueryResult = resultOf(['number', 'plan_stub', 'created_at', 'closed_at'], [
  [1, 'stub-plan-a', '2026-10-01T00:00:00.000Z', null],
  [2, null, '2026-11-20T10:00:00.000Z', '2026-11-22T10:00:00.000Z'],
], { from: null, to: null });

/** The answer of each metric of `live-sources.ts`. */
export const STUB_SOURCE_ANSWERS: Readonly<Record<SourceMetric, QueryResult>> = {
  deploysPerWeek: STUB_DEPLOYS,
  locPerModule: STUB_LOC,
  coupling: STUB_COUPLING,
  wip: STUB_WIP,
  resolutionTime: STUB_RESOLUTION,
  bugOutcome: STUB_OUTCOME,
  openBugsPerDay: STUB_OPEN_BUGS,
};

/** The metrics the stub lists as GitHub-only, as the catalogue does. */
export const STUB_GITHUB: readonly string[] = [SOURCE_METRICS.resolutionTime, SOURCE_METRICS.openBugsPerDay];

/** The answer of each metric run over the window before the range's. */
const STUB_PREVIOUS: Readonly<Partial<Record<LiveMetric, QueryResult>>> = { tokensPerDay: STUB_PREVIOUS_TOKENS, debtRatio: STUB_PREVIOUS_DEBT };

/** The metrics the stub lists as proxies, as the catalogue does. */
export const STUB_PROXIES: readonly string[] = [
  'pm.plan-completion',
  'arch.debt-ratio',
  'arch.task-minutes-p50-p90',
  'arch.preflight-halts',
  'dev.tasks-done-per-week',
  'dev.plans-completed-per-week',
  'arch.loc-per-module',
  'arch.coupling',
];

/** The note the stub lists for proxy `id`. */
export function stubNoteOf(id: string): string {
  return `stub proxy note for ${id}`;
}

/** One definition per metric, a proxy with its stub note, a GitHub one `gh`, WIP with its goal; the params are not what the catalogue holds. */
export const STUB_DEFINITIONS: readonly MetricDefinition[] = [...Object.values(LIVE_METRICS), ...Object.values(SOURCE_METRICS)].map((id) => {
  const base: MetricDefinition = {
    id,
    title: id,
    lenses: ['pm'],
    description: `stub definition of ${id}`,
    sourceId: 'stub.source',
    params: {},
    formula: { kind: 'none' },
    chart: 'line',
    feasibility: 'direct',
  };
  if (STUB_PROXIES.includes(id)) return { ...base, feasibility: 'proxy', proxyFor: 'stub', proxyNote: stubNoteOf(id) };
  if (STUB_GITHUB.includes(id)) return { ...base, feasibility: 'gh' };
  return id === SOURCE_METRICS.wip
    ? { ...base, goal: STUB_WIP_LIMIT }
    : base;
});

/** The PoC metric of each catalogue id. */
const KEY_OF: ReadonlyMap<string, LiveMetric> = new Map((Object.keys(LIVE_METRICS) as LiveMetric[]).map((key) => [LIVE_METRICS[key], key]));

/** The answer of each metric of `live-sources.ts`, by catalogue id. */
const SOURCE_ANSWER_OF: ReadonlyMap<string, QueryResult> = new Map((Object.keys(SOURCE_METRICS) as SourceMetric[]).map((key) => [SOURCE_METRICS[key], STUB_SOURCE_ANSWERS[key]]));

/** `answer` with its columns and no row: a GitHub metric's after a build without `--github`. */
export function noRowsOf(answer: QueryResult): QueryResult {
  return resultOf(answer.columns.map((column) => column.key), [], answer.meta.window);
}

/** One call the stub took. */
export interface StubCall {
  readonly id: string;
  readonly window: Window | undefined;
}

/** One query the stub took. */
export interface StubQuery {
  readonly id: string;
  readonly params: QueryParams;
}

/** The stub client and the calls and queries it has taken so far. */
export interface StubLiveClient {
  readonly client: AtlasClient;
  readonly calls: readonly StubCall[];
  readonly queries: readonly StubQuery[];
}

/** What the stub's replica holds: GitHub data (the default), or none, as after a build without `--github`. */
export interface StubOptions {
  readonly github?: boolean;
}

/**
 * A client whose `runMetric` answers the results above and records each
 * call, and whose `query` answers `STUB_PLANS` for `local.plans` and
 * records each query; every other route refuses.
 */
export function stubLiveClient({ github = true }: StubOptions = {}): StubLiveClient {
  const calls: StubCall[] = [];
  const queries: StubQuery[] = [];
  const unused = (): never => {
    throw new Error('the live source asked a route it does not use');
  };
  const client: AtlasClient = {
    listSources: unused,
    describeSource: unused,
    query: (id, params) => {
      queries.push({ id, params });
      return id === PLANS_SOURCE_ID
        ? Promise.resolve(STUB_PLANS)
        : Promise.reject(new Error(`no stub answer for a query of ${id}`));
    },
    listMetrics: () => Promise.resolve(STUB_DEFINITIONS),
    describeMetric: unused,
    runMetric: (id, window) => {
      calls.push({ id, window });
      const source = SOURCE_ANSWER_OF.get(id);
      if (source !== undefined) {
        return Promise.resolve(github || !STUB_GITHUB.includes(id)
          ? source
          : noRowsOf(source));
      }
      const key = KEY_OF.get(id);
      if (key === undefined) return Promise.reject(new Error(`no stub answer for ${id}`));
      const previous = STUB_PREVIOUS[key];
      if (window?.from !== undefined && previous !== undefined) return Promise.resolve(previous);
      return Promise.resolve(STUB_ANSWERS[key]);
    },
  };
  return { client, calls, queries };
}

/** A client whose every metric fails with `error`. */
export function failingClient(error: Error): AtlasClient {
  return { ...stubLiveClient().client, runMetric: () => Promise.reject(error) };
}
