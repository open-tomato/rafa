/**
 * A stub `AtlasClient` for the live source's tests (`../live.test.ts`) and
 * the page's (`../../App.test.tsx`). Its `runMetric` answers the fixed
 * results below, one per PoC metric in the columns the engine answers it
 * with, and records every call; `listMetrics` answers `STUB_DEFINITIONS`,
 * whose proxies carry a stub note; each other route refuses. The
 * values are ones no real store holds (`stub-model-a`, round thousands),
 * so a stray request elsewhere would show. Named without `.test` so bun
 * never runs it alone.
 */
import type { MetricDefinition, QueryResult, Scalar, Window } from '@open-tomato/atlas-data/contract';
import type { AtlasClient } from '@open-tomato/atlas-transport/client';

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
];

/** The note the stub lists for proxy `id`. */
export function stubNoteOf(id: string): string {
  return `stub proxy note for ${id}`;
}

/** One definition per metric, a proxy with its stub note; the params are not what the catalogue holds. */
export const STUB_DEFINITIONS: readonly MetricDefinition[] = Object.values(LIVE_METRICS).map((id) => {
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
  return STUB_PROXIES.includes(id)
    ? { ...base, feasibility: 'proxy', proxyFor: 'stub', proxyNote: stubNoteOf(id) }
    : base;
});

/** The metric of each catalogue id. */
const KEY_OF: ReadonlyMap<string, LiveMetric> = new Map((Object.keys(LIVE_METRICS) as LiveMetric[]).map((key) => [LIVE_METRICS[key], key]));

/** One call the stub took. */
export interface StubCall {
  readonly id: string;
  readonly window: Window | undefined;
}

/** The stub client and the calls it has taken so far. */
export interface StubLiveClient {
  readonly client: AtlasClient;
  readonly calls: readonly StubCall[];
}

/** A client whose `runMetric` answers the results above and records each call; every other route refuses. */
export function stubLiveClient(): StubLiveClient {
  const calls: StubCall[] = [];
  const unused = (): never => {
    throw new Error('the live source asked a route it does not use');
  };
  const client: AtlasClient = {
    listSources: unused,
    describeSource: unused,
    query: unused,
    listMetrics: () => Promise.resolve(STUB_DEFINITIONS),
    describeMetric: unused,
    runMetric: (id, window) => {
      calls.push({ id, window });
      const key = KEY_OF.get(id);
      if (key === undefined) return Promise.reject(new Error(`no stub answer for ${id}`));
      const previous = STUB_PREVIOUS[key];
      if (window?.from !== undefined && previous !== undefined) return Promise.resolve(previous);
      return Promise.resolve(STUB_ANSWERS[key]);
    },
  };
  return { client, calls };
}

/** A client whose every metric fails with `error`. */
export function failingClient(error: Error): AtlasClient {
  return { ...stubLiveClient().client, runMetric: () => Promise.reject(error) };
}
