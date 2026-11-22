/**
 * The live page source: the catalogue metrics, asked of the Atlas API for
 * one range, mapped into the `LensResult` fields the cards read.
 *
 * The client runs each metric over the range's window (`RANGE_WINDOW`)
 * and this file maps each `QueryResult` into its field: `pm.tokens-per-day`
 * fills `tokensPerDay` (and, run again over the window just before,
 * `tokensPerDayPrevious`, with `tokensDailyAverage` from the same rows),
 * `arch.tokens-by-model` fills `tokensByModel` and
 * `arch.task-minutes-p50-p90` fills `taskMinutesQuantiles`. Every other
 * field is marked in `notWired` and holds an empty value, so a card that
 * reads one draws "not wired yet" and never a number (Q1 of the data
 * integration plan).
 *
 * The windows are fixed per range (D6): `now` is today for a KPI and the
 * last 7 days for a series, `last-week` is `7d`, `past-month` is `28d`
 * and `last-year` is `52w`. A `last` window ends with today (UTC), as the
 * engine resolves it.
 */
import type { MockData } from './mock.js';
import type { LensField, LensResult, MeasuredWorkspace } from './source.js';
import type { QueryResult, Scalar, Window } from '@open-tomato/atlas-data/contract';
import type { AtlasClient } from '@open-tomato/atlas-transport/client';
import type { DataSource, TimeRange } from '@open-tomato/atlas-ui';
import type { ChartTone, LineSeries, TimePoint } from '@open-tomato/charts';

import { AtlasRequestError, AtlasResponseInvalid, AtlasTransportError } from '@open-tomato/atlas-transport/client';

/** Where the demo server mounts the Atlas API. */
export const LIVE_API_BASE: string = '/api/atlas';

/** The windows one range asks for: a series card's, and a KPI tile's. */
export interface RangeWindow {
  readonly series: Window;
  readonly kpi: Window;
}

/** Range to window (D6). A KPI tile reads `kpi`; no KPI is wired yet, so only `series` is asked today. */
export const RANGE_WINDOW: Readonly<Record<TimeRange, RangeWindow>> = {
  'now': { series: { last: '7d' }, kpi: { last: '1d' } },
  'last-week': { series: { last: '7d' }, kpi: { last: '7d' } },
  'past-month': { series: { last: '28d' }, kpi: { last: '28d' } },
  'last-year': { series: { last: '52w' }, kpi: { last: '52w' } },
};

/** The catalogue metrics this source runs, by the field each one fills. */
export const LIVE_METRICS: Readonly<Record<'tokensPerDay' | 'tokensByModel' | 'taskMinutesQuantiles', string>> = {
  tokensPerDay: 'pm.tokens-per-day',
  tokensByModel: 'arch.tokens-by-model',
  taskMinutesQuantiles: 'arch.task-minutes-p50-p90',
};

/** The fields a live metric fills; every other field is not wired yet. */
export const WIRED_FIELDS: readonly LensField[] = [
  'tokensPerDay',
  'tokensPerDayPrevious',
  'tokensDailyAverage',
  'tokensByModel',
  'taskMinutesQuantiles',
];

/** What a card's error says when the API is not there: how to start the demo with it. */
export const LIVE_UNAVAILABLE: string = 'The Atlas API under /api/atlas did not answer. Start the demo with'
  + ' ATLAS_PROJECT_ROOT=<main checkout> bun run --cwd addons/atlas/demo dev, which builds the replica'
  + ' when none exists, then open the page with ?source=live again.';

const DAY_MS = 86_400_000;

/** The tones of the model series, in order of tokens spent; a model past the eighth draws muted. */
const SERIES_TONES: readonly ChartTone[] = ['series-1', 'series-2', 'series-3', 'series-4', 'series-5', 'series-6', 'series-7', 'series-8'];

/** The label of a session whose model the store did not record. */
const UNKNOWN_MODEL = 'unknown';

/** Every mock field with no value in it: a fresh set of empty arrays and zeros. */
function emptyMock(): MockData {
  return {
    tokensPerDay: [],
    tokensPerDayPrevious: [],
    tokensThisWeek: 0,
    tokensLastWeek: 0,
    tokensDailyAverage: 0,
    plansPerWeek: [],
    plannedVsSessions: [],
    minutesPerAgent: [],
    scopeCreepPerWeek: [],
    minutesByChangeKind: [],
    minutesByChangeKindPrevious: [],
    debtRatio: 0,
    taskMinutesQuantiles: [],
    tokensByModel: [],
    preflightHalts: [],
    modules: [],
    tasksDonePerWeek: [],
    taskCycle: [],
    taskCycleTrend: [],
    taskMinutesBins: [],
    deploysPerWeek: [],
    bugsByKindPerWeek: [],
    regressionsPerWeek: [],
    filedSharePerWeek: [],
    resolutionByPriority: [],
    flakyChecks: [],
    workDoneTree: [],
    taskPileTree: [],
  };
}

/** The measured workspace with nothing in it: no live source measures it yet. */
const EMPTY_WORKSPACE: MeasuredWorkspace = {
  composition: [],
  sizeRose: [],
  compositionSunburst: [],
  members: [],
  edges: [],
  sankeyNodes: [],
  sankeyLinks: [],
};

/** Every field of a result set, mock series first. */
const ALL_FIELDS: readonly LensField[] = [...(Object.keys(emptyMock()) as (keyof MockData)[]), 'balance', 'workspace'];

/** The fields the live result marks: all of them but `WIRED_FIELDS`. */
export const NOT_WIRED: ReadonlySet<LensField> = new Set(ALL_FIELDS.filter((field) => !WIRED_FIELDS.includes(field)));

/** The position of column `key` in `result`; an answer without it is refused. */
function columnOf(result: QueryResult, key: string): number {
  const index = result.columns.findIndex((column) => column.key === key);
  if (index < 0) throw new Error(`atlas: the answer holds no ${key} column`);
  return index;
}

/** A cell as a number: an aggregate over no value reads 0. */
function numberOf(value: Scalar | undefined): number {
  return typeof value === 'number'
    ? value
    : 0;
}

/** A `YYYY-MM-DD` key as the UTC midnight it names; anything else is refused. */
function dayOf(value: Scalar | undefined): Date {
  const ms = typeof value === 'string'
    ? Date.parse(value)
    : Number.NaN;
  if (Number.isNaN(ms)) throw new Error(`atlas: ${JSON.stringify(value)} is not a day`);
  return new Date(ms);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** One point per row: `timeKey` on x, `valueKey` on y. */
export function timePointsOf(result: QueryResult, timeKey: string, valueKey: string): TimePoint[] {
  const time = columnOf(result, timeKey);
  const value = columnOf(result, valueKey);
  return result.rows.map((row) => ({ x: dayOf(row[time]), y: numberOf(row[value]) }));
}

/** `points` moved later by `ms`: a previous window's days drawn over the current one's. */
export function shiftPoints(points: readonly TimePoint[], ms: number): TimePoint[] {
  return points.map((point) => ({ x: new Date(point.x.getTime() + ms), y: point.y }));
}

/**
 * One stacked series per model from `day`, `model` and `tokens` rows, the
 * biggest spender first. Every series has a point on every day of the
 * answer, 0 where the model ran no session, so the stack lines up.
 */
export function modelSeriesOf(result: QueryResult): LineSeries[] {
  const day = columnOf(result, 'day');
  const model = columnOf(result, 'model');
  const tokens = columnOf(result, 'tokens');
  const days = [...new Set(result.rows.map((row) => String(row[day])))].sort();
  const byModel = new Map<string, Map<string, number>>();
  for (const row of result.rows) {
    const name = typeof row[model] === 'string'
      ? row[model]
      : UNKNOWN_MODEL;
    const perDay = byModel.get(name) ?? new Map<string, number>();
    perDay.set(String(row[day]), (perDay.get(String(row[day])) ?? 0) + numberOf(row[tokens]));
    byModel.set(name, perDay);
  }
  const totalOf = (perDay: ReadonlyMap<string, number>): number => [...perDay.values()].reduce((sum, value) => sum + value, 0);
  const ranked = [...byModel.entries()].sort(([, a], [, b]) => totalOf(b) - totalOf(a));
  return ranked.map(([name, perDay], index) => ({
    id: name,
    label: name,
    tone: SERIES_TONES[index] ?? 'muted',
    points: days.map((key) => ({ x: dayOf(key), y: perDay.get(key) ?? 0 })),
  }));
}

/** The p50 and p90 minutes per week, to one decimal. */
export function quantilesOf(result: QueryResult): MockData['taskMinutesQuantiles'] {
  const week = columnOf(result, 'week');
  const p50 = columnOf(result, 'p50');
  const p90 = columnOf(result, 'p90');
  return result.rows.map((row) => ({ week: dayOf(row[week]), p50: round1(numberOf(row[p50])), p90: round1(numberOf(row[p90])) }));
}

/** The window's bounds as instants, or null for a window open at either end. */
function boundsOf(result: QueryResult): { readonly from: Date; readonly to: Date } | null {
  const { from, to } = result.meta.window;
  return from === null || to === null
    ? null
    : { from: new Date(from), to: new Date(to) };
}

/** Tokens per day of the window, the days with no session counted as 0. */
function dailyAverageOf(points: readonly TimePoint[], result: QueryResult): number {
  const total = points.reduce((sum, point) => sum + point.y, 0);
  const bounds = boundsOf(result);
  const days = bounds === null
    ? points.length
    : Math.round((bounds.to.getTime() - bounds.from.getTime()) / DAY_MS);
  return days > 0
    ? Math.round(total / days)
    : 0;
}

/** Tokens per day over the window just before `current`'s, drawn over the current days; none for an open window. */
async function previousTokensOf(client: AtlasClient, current: QueryResult, signal?: AbortSignal): Promise<TimePoint[]> {
  const bounds = boundsOf(current);
  if (bounds === null) return [];
  const span = bounds.to.getTime() - bounds.from.getTime();
  const window: Window = { from: new Date(bounds.from.getTime() - span).toISOString(), to: bounds.from.toISOString() };
  const previous = await client.runMetric(LIVE_METRICS.tokensPerDay, window, signal);
  return shiftPoints(timePointsOf(previous, 'day', 'tokens'), span);
}

/** The live result set for `range`: the wired fields from the API, every other field marked. */
export async function liveResultOf(client: AtlasClient, range: TimeRange, signal?: AbortSignal): Promise<LensResult> {
  const window = RANGE_WINDOW[range].series;
  const [tokens, byModel, quantiles] = await Promise.all([
    client.runMetric(LIVE_METRICS.tokensPerDay, window, signal),
    client.runMetric(LIVE_METRICS.tokensByModel, window, signal),
    client.runMetric(LIVE_METRICS.taskMinutesQuantiles, window, signal),
  ]);
  const tokensPerDay = timePointsOf(tokens, 'day', 'tokens');
  const mock: MockData = {
    ...emptyMock(),
    tokensPerDay,
    tokensPerDayPrevious: await previousTokensOf(client, tokens, signal),
    tokensDailyAverage: dailyAverageOf(tokensPerDay, tokens),
    tokensByModel: modelSeriesOf(byModel),
    taskMinutesQuantiles: quantilesOf(quantiles),
  };
  return { range, source: 'live', notWired: NOT_WIRED, mock, balance: [], workspace: EMPTY_WORKSPACE };
}

/** True for an answer that says the API is not there: unreachable, not mounted (a 404 that is no envelope), or no replica (503). */
function isUnavailable(error: unknown): boolean {
  if (error instanceof AtlasTransportError) return true;
  if (error instanceof AtlasResponseInvalid) return error.status === 404;
  return error instanceof AtlasRequestError && error.status === 503;
}

/**
 * The page source over `client`. An API that is not there fails the page
 * with `LIVE_UNAVAILABLE`, the cause kept; any other error passes as it is.
 */
export function createLiveLensSource(client: AtlasClient): DataSource<LensResult, TimeRange> {
  return async (range) => {
    try {
      return await liveResultOf(client, range);
    } catch (error: unknown) {
      if (isUnavailable(error)) throw new Error(LIVE_UNAVAILABLE, { cause: error });
      throw error;
    }
  };
}
