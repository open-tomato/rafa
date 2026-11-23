/**
 * The live page source: the catalogue metrics, asked of the Atlas API for
 * one range, mapped into the `LensResult` fields the cards read.
 *
 * The client runs each of the PoC cut's 17 metrics (spec section G's 16
 * rows; its fourth PM row names two) over the range's window
 * (`RANGE_WINDOW`), and this file maps each `QueryResult` into the fields
 * `METRIC_FIELDS` names for it. Two metrics also run over the window just
 * before: `pm.tokens-per-day` for `tokensPerDayPrevious` and
 * `arch.debt-ratio` for `minutesByChangeKindPrevious`. Every field a
 * metric fills gets a `FieldMeta` in `fieldMeta`: the metric, its answer's
 * `meta.rowCount` and, for a proxy metric, the `proxyNote` the API's
 * `/metrics` answer gives. Every other field is marked in `notWired` and
 * holds an empty value, so a card that reads one draws "not wired yet"
 * and never a number (Q1 of the data integration plan).
 *
 * The windows are fixed per range (D6): `now` is today for a KPI and the
 * last 7 days for a series, `last-week` is `7d`, `past-month` is `28d`
 * and `last-year` is `52w`. Only the two tiles that are one number,
 * `dev.red-ci-share` and `pm.active-blockers`, read the KPI window. A
 * `last` window ends with today (UTC), as the engine resolves it.
 *
 * The weekly count series (bugs by kind, routes, regressions, tasks done)
 * hold one entry per ISO week of the window, 0 where the answer has no
 * row, since the engine answers no row for an empty bucket. A row whose
 * group is NULL counts as `unknown`, except a task with no work type,
 * which the three work-type columns leave out. The result's `weeks`
 * names those weeks, for the cards whose field holds no dates of its own.
 *
 * Past the PoC cut, the git, board, module and GitHub metrics of phase 4
 * fill `deploysPerWeek`, `modules`, `workspace` (its members and edges),
 * `wip`, `resolutionByPriority`, `bugOutcomeByLoopStart`,
 * `openBugsPerDay` and `defectDensity`, and `pm.minutes-per-agent` fills
 * `minutesPerAgent`. The task cycle's points also fill
 * `taskMinutesBins`, binned on the page (`taskMinutesBinsOf`). Their requests and mappers live in `live-sources.ts`,
 * and the cell readers both files share in `live-read.ts`. A GitHub-only
 * metric that answers no row adds its fields to `notWired` for that
 * result, with the `--github` build line in `notWiredDetail`.
 */
import type { Blocker, ChangeSlice, MockData } from './mock.js';
import type { FieldMeta, LensField, LensResult, MeasuredWorkspace } from './source.js';
import type { MetricDefinition, QueryResult, Window } from '@open-tomato/atlas-data/contract';
import type { AtlasClient } from '@open-tomato/atlas-transport/client';
import type { DataSource, TimeRange } from '@open-tomato/atlas-ui';
import type { ChartTone, HistogramBin, LineSeries, ScatterPoint, TimePoint } from '@open-tomato/charts';

import { AtlasRequestError, AtlasResponseInvalid, AtlasTransportError } from '@open-tomato/atlas-transport/client';

import {
  boundsOf,
  columnOf,
  DAY_MS,
  dayOf,
  numberOf,
  round1,
  stringListOf,
  textOf,
  UNKNOWN,
  WEEK_MS,
  weekKeyOf,
  windowWeeksOf,
} from './live-read.js';
import {
  GITHUB_NOT_READ,
  githubPendingOf,
  moduleGraphOf,
  SOURCE_METRIC_FIELDS,
  SOURCE_METRIC_KEYS,
  SOURCE_METRICS,
  SOURCE_WIRED_FIELDS,
  sourceAnswersOf,
  sourceFieldsOf,
  type SourceAnswers,
} from './live-sources.js';
import { BRANCH_TYPES, TASK_MINUTE_EDGES } from './mock.js';
import { quantile } from './random.js';

/** Where the demo server mounts the Atlas API. */
export const LIVE_API_BASE: string = '/api/atlas';

/** The windows one range asks for: a series card's, and a KPI tile's. */
export interface RangeWindow {
  readonly series: Window;
  readonly kpi: Window;
}

/** Range to window (D6). The tiles of `KPI_METRICS` read `kpi`; every other metric reads `series`. */
export const RANGE_WINDOW: Readonly<Record<TimeRange, RangeWindow>> = {
  'now': { series: { last: '7d' }, kpi: { last: '1d' } },
  'last-week': { series: { last: '7d' }, kpi: { last: '7d' } },
  'past-month': { series: { last: '28d' }, kpi: { last: '28d' } },
  'last-year': { series: { last: '52w' }, kpi: { last: '52w' } },
};

/** The PoC metrics this source runs, by a short name. */
export type LiveMetric =
  | 'budgetBurn'
  | 'tokensPerDay'
  | 'planCompletion'
  | 'plannedVsSessions'
  | 'activeBlockers'
  | 'debtRatio'
  | 'taskMinutesQuantiles'
  | 'tokensByModel'
  | 'preflightHalts'
  | 'tasksDonePerWeek'
  | 'taskCycle'
  | 'redCiShare'
  | 'plansCompletedPerWeek'
  | 'bugsByKind'
  | 'regressions'
  | 'flakyChecks'
  | 'filedShare';

/** The catalogue id of each metric this source runs, in section G's order. */
export const LIVE_METRICS: Readonly<Record<LiveMetric, string>> = {
  budgetBurn: 'pm.budget-burn',
  tokensPerDay: 'pm.tokens-per-day',
  planCompletion: 'pm.plan-completion',
  plannedVsSessions: 'pm.planned-vs-sessions',
  activeBlockers: 'pm.active-blockers',
  debtRatio: 'arch.debt-ratio',
  taskMinutesQuantiles: 'arch.task-minutes-p50-p90',
  tokensByModel: 'arch.tokens-by-model',
  preflightHalts: 'arch.preflight-halts',
  tasksDonePerWeek: 'dev.tasks-done-per-week',
  taskCycle: 'dev.task-cycle',
  redCiShare: 'dev.red-ci-share',
  plansCompletedPerWeek: 'dev.plans-completed-per-week',
  bugsByKind: 'qa.bugs-by-kind',
  regressions: 'qa.regressions',
  flakyChecks: 'qa.flaky-checks',
  filedShare: 'qa.filed-share',
};

/** The fields each metric fills, its card's own field first. */
export const METRIC_FIELDS: Readonly<Record<LiveMetric, readonly LensField[]>> = {
  budgetBurn: ['tokensThisWeek', 'tokensLastWeek'],
  tokensPerDay: ['tokensPerDay', 'tokensPerDayPrevious', 'tokensDailyAverage'],
  planCompletion: ['plansPerWeek'],
  plannedVsSessions: ['plannedVsSessions'],
  activeBlockers: ['activeBlockers'],
  debtRatio: ['debtRatio', 'minutesByChangeKind', 'minutesByChangeKindPrevious'],
  taskMinutesQuantiles: ['taskMinutesQuantiles'],
  tokensByModel: ['tokensByModel'],
  preflightHalts: ['preflightHalts'],
  tasksDonePerWeek: ['tasksDonePerWeek'],
  taskCycle: ['taskCycle', 'taskCycleTrend', 'taskMinutesBins'],
  redCiShare: ['redCiShare'],
  plansCompletedPerWeek: ['plansCompletedPerWeek'],
  bugsByKind: ['bugsByKindPerWeek'],
  regressions: ['regressionsPerWeek'],
  flakyChecks: ['flakyChecks'],
  filedShare: ['filedSharePerWeek'],
};

/** The metrics run in `LIVE_METRICS` order. */
const METRIC_KEYS = Object.keys(LIVE_METRICS) as LiveMetric[];

/** The fields a live metric fills, the PoC metrics' then `live-sources.ts`'s; every other field is not wired yet. */
export const WIRED_FIELDS: readonly LensField[] = [...METRIC_KEYS.flatMap((key) => METRIC_FIELDS[key]), ...SOURCE_WIRED_FIELDS];

/** The metrics that are one number on a tile, run over the range's KPI window. */
export const KPI_METRICS: ReadonlySet<LiveMetric> = new Set<LiveMetric>(['redCiShare', 'activeBlockers']);

/** The fields filled from the window just before the range's, by the metric run over it. */
const PREVIOUS_FIELDS: Readonly<Partial<Record<LensField, LiveMetric>>> = {
  tokensPerDayPrevious: 'tokensPerDay',
  minutesByChangeKindPrevious: 'debtRatio',
};

/** What a card's error says when the API is not there: how to start the demo with it. */
export const LIVE_UNAVAILABLE: string = 'The Atlas API under /api/atlas did not answer. Start the demo with'
  + ' ATLAS_PROJECT_ROOT=<main checkout> bun run --cwd addons/atlas/demo dev, which builds the replica'
  + ' when none exists, then open the page with ?source=live again.';

/** The days a point of the task cycle trend looks back over, its own included. */
const TREND_DAYS = 7;

/** How many checks the flaky table keeps. */
const FLAKY_TOP = 10;

/** The tones of the model series, in order of tokens spent; a model past the eighth draws muted. */
const SERIES_TONES: readonly ChartTone[] = ['series-1', 'series-2', 'series-3', 'series-4', 'series-5', 'series-6', 'series-7', 'series-8'];

/** The work types of decision D4, as the debt ratio's slices and the tasks-done columns. */
const WORK_TYPES = ['feature', 'fix', 'chore'] as const;

/** The work types the debt ratio sums. */
const DEBT_TYPES: ReadonlySet<string> = new Set(['fix', 'chore']);

/** Every mock field with no value in it: a fresh set of empty arrays and zeros. */
function emptyMock(): MockData {
  return {
    tokensPerDay: [],
    tokensPerDayPrevious: [],
    tokensThisWeek: 0,
    tokensLastWeek: 0,
    tokensDailyAverage: 0,
    plansPerWeek: [],
    plansCompletedPerWeek: [],
    plannedVsSessions: [],
    activeBlockers: [],
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
    redCiShare: 0,
    deploysPerWeek: [],
    wip: { now: 0, limit: null },
    bugOutcomeByLoopStart: [],
    openBugsPerDay: [],
    bugsByKindPerWeek: [],
    regressionsPerWeek: [],
    filedSharePerWeek: [],
    resolutionByPriority: [],
    defectDensity: 0,
    flakyChecks: [],
    workDoneTree: [],
    taskPileTree: [],
  };
}

/** The workspace with nothing in it: the live one lays the module graph's members and edges over it. */
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

/* ---------- reading a cell ---------- */

/** The sum of `valueKey` per week key and per group, NULL groups as `unknown`. */
function sumsByWeek(result: QueryResult, groupKey: string, valueKey: string): Map<string, Map<string, number>> {
  const week = columnOf(result, 'week');
  const group = columnOf(result, groupKey);
  const value = columnOf(result, valueKey);
  const byWeek = new Map<string, Map<string, number>>();
  for (const row of result.rows) {
    const key = String(row[week]);
    const name = textOf(row[group], UNKNOWN);
    const groups = byWeek.get(key) ?? new Map<string, number>();
    groups.set(name, (groups.get(name) ?? 0) + numberOf(row[value]));
    byWeek.set(key, groups);
  }
  return byWeek;
}

/* ---------- one field per answer ---------- */

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
    const name = textOf(row[model], UNKNOWN);
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

/**
 * The tokens of the week holding the window's last day and of the week
 * before, from `week` and `tokens` rows; an open window reads its last row's week.
 */
export function budgetWeeksOf(result: QueryResult): { readonly thisWeek: number; readonly lastWeek: number } {
  const week = columnOf(result, 'week');
  const tokens = columnOf(result, 'tokens');
  const bounds = boundsOf(result);
  const lastRow = result.rows.at(-1);
  const current = bounds === null
    ? lastRow === undefined
      ? null
      : weekKeyOf(dayOf(lastRow[week]).getTime())
    : weekKeyOf(bounds.to.getTime() - 1);
  if (current === null) return { thisWeek: 0, lastWeek: 0 };
  const previous = weekKeyOf(Date.parse(current) - WEEK_MS);
  const tokensOf = (key: string): number => result.rows
    .filter((row) => row[week] === key)
    .reduce((sum, row) => sum + numberOf(row[tokens]), 0);
  return { thisWeek: tokensOf(current), lastWeek: tokensOf(previous) };
}

/** Plans started and completed per week, from `week`, `started` and `completed` rows. */
export function plansOf(result: QueryResult): MockData['plansPerWeek'] {
  const week = columnOf(result, 'week');
  const started = columnOf(result, 'started');
  const completed = columnOf(result, 'completed');
  return result.rows.map((row) => ({ week: dayOf(row[week]), started: numberOf(row[started]), completed: numberOf(row[completed]) }));
}

/** Planned tasks against task sessions per plan, a plan the store did not name as `unknown`. */
export function plannedVsSessionsOf(result: QueryResult): MockData['plannedVsSessions'] {
  const plan = columnOf(result, 'plan_stub');
  const planned = columnOf(result, 'planned');
  const sessions = columnOf(result, 'sessions');
  return result.rows.map((row) => ({ plan: textOf(row[plan], UNKNOWN), planned: numberOf(row[planned]), sessions: numberOf(row[sessions]) }));
}

/** One blocker per row, in the answer's order (the newest first). */
export function blockersOf(result: QueryResult): Blocker[] {
  const day = columnOf(result, 'day');
  const plan = columnOf(result, 'plan_stub');
  const line = columnOf(result, 'task_line');
  const what = columnOf(result, 'what');
  return result.rows.map((row) => {
    const taskLine = row[line];
    return {
      day: dayOf(row[day]),
      plan: typeof row[plan] === 'string'
        ? row[plan]
        : null,
      taskLine: typeof taskLine === 'number'
        ? taskLine
        : null,
      what: textOf(row[what], ''),
    };
  });
}

/** Task minutes by work type, one slice per D4 type in feature, fix, chore order; a NULL type has no slice. */
export function changeSlicesOf(result: QueryResult): ChangeSlice[] {
  const type = columnOf(result, 'work_type');
  const minutes = columnOf(result, 'minutes');
  return WORK_TYPES.map((id) => {
    const kind = BRANCH_TYPES.find((entry) => entry.id === id) ?? { id, label: id, tone: 'muted' as const };
    const value = result.rows.filter((row) => row[type] === id).reduce((sum, row) => sum + numberOf(row[minutes]), 0);
    return { ...kind, value: Math.round(value) };
  });
}

/** The fix and chore shares of all task minutes summed: the debt ratio. */
export function debtRatioOf(result: QueryResult): number {
  const type = columnOf(result, 'work_type');
  const share = columnOf(result, 'share');
  return result.rows
    .filter((row) => typeof row[type] === 'string' && DEBT_TYPES.has(row[type]))
    .reduce((sum, row) => sum + numberOf(row[share]), 0);
}

/** Halts per weekday (Monday first) and window week, from `day` and `halts` rows. */
export function preflightGridOf(result: QueryResult): number[][] {
  const day = columnOf(result, 'day');
  const halts = columnOf(result, 'halts');
  const weeks = windowWeeksOf(result, 'day');
  const counts = new Map<string, number>();
  for (const row of result.rows) {
    const date = dayOf(row[day]);
    const cell = `${(date.getUTCDay() + 6) % 7}:${weekKeyOf(date.getTime())}`;
    counts.set(cell, (counts.get(cell) ?? 0) + numberOf(row[halts]));
  }
  return Array.from({ length: 7 }, (_, weekday) => weeks.map((week) => counts.get(`${weekday}:${week}`) ?? 0));
}

/** Tasks done per window week by work type, 0 for a week with none; a NULL type is left out. */
export function tasksDoneOf(result: QueryResult): MockData['tasksDonePerWeek'] {
  const sums = sumsByWeek(result, 'work_type', 'tasks');
  return windowWeeksOf(result, 'week').map((week) => {
    const types = sums.get(week);
    return { week: dayOf(week), feature: types?.get('feature') ?? 0, fix: types?.get('fix') ?? 0, chore: types?.get('chore') ?? 0 };
  });
}

/** One point per task session with its minutes: when it started, its minutes, its plan and task line. */
export function taskCycleOf(result: QueryResult): ScatterPoint[] {
  const started = columnOf(result, 'started_at');
  const plan = columnOf(result, 'plan_stub');
  const line = columnOf(result, 'task_line');
  const minutes = columnOf(result, 'minutes');
  return result.rows
    .filter((row) => typeof row[minutes] === 'number')
    .map((row) => {
      const taskLine = row[line];
      const label = typeof taskLine === 'number'
        ? `${textOf(row[plan], UNKNOWN)} task ${taskLine}`
        : textOf(row[plan], UNKNOWN);
      return { x: dayOf(row[started]), y: round1(numberOf(row[minutes])), label };
    });
}

/**
 * The task sessions of `points` counted per bin of `TASK_MINUTE_EDGES`,
 * a session in the bin its minutes fall in (from included, to not). A
 * session past the last edge counts in one more bin, from that edge to
 * the longest session's minutes rounded up (one past the edge at the
 * least), added only when one ran that long.
 */
export function taskMinutesBinsOf(points: readonly ScatterPoint[]): HistogramBin[] {
  const minutes = points.map((point) => point.y);
  const bins = TASK_MINUTE_EDGES.slice(0, -1).map((from, index) => {
    const to = TASK_MINUTE_EDGES[index + 1] ?? from;
    return { from, to, count: minutes.filter((value) => value >= from && value < to).length };
  });
  const last = TASK_MINUTE_EDGES.at(-1) ?? 0;
  const longer = minutes.filter((value) => value >= last);
  return longer.length === 0
    ? bins
    : [...bins, { from: last, to: Math.max(Math.ceil(Math.max(...longer)), last + 1), count: longer.length }];
}

/**
 * The seven-day moving median of `points`, one point per day of the
 * window (of the points, when open) whose seven days hold a point.
 */
export function cycleTrendOf(points: readonly ScatterPoint[], result: QueryResult): TimePoint[] {
  const bounds = boundsOf(result);
  const stamps = points.map((point) => point.x.getTime());
  const first = Math.floor((bounds?.from.getTime() ?? Math.min(...stamps)) / DAY_MS) * DAY_MS;
  const end = bounds?.to.getTime() ?? Math.max(...stamps) + 1;
  if (!Number.isFinite(first) || !Number.isFinite(end)) return [];
  const trend: TimePoint[] = [];
  for (let dayStart = first; dayStart < end; dayStart += DAY_MS) {
    const seen = points
      .filter((point) => point.x.getTime() < dayStart + DAY_MS && point.x.getTime() >= dayStart - (TREND_DAYS - 1) * DAY_MS)
      .map((point) => point.y)
      .sort((a, b) => a - b);
    if (seen.length > 0) trend.push({ x: new Date(dayStart), y: quantile(seen, 0.5) });
  }
  return trend;
}

/** The red verdict's share of the readings; 0 when no reading is red. */
export function redShareOf(result: QueryResult): number {
  const verdict = columnOf(result, 'verdict');
  const share = columnOf(result, 'share');
  return numberOf(result.rows.find((row) => row[verdict] === 'red')?.[share]);
}

/**
 * The ten checks failing most on heads that later read green: each
 * `failing_json` set split into its names, its `failures` summed per name
 * and its `heads` summed into `readings`, which here counts the flipped
 * heads a check failed on, not every reading of the check.
 */
export function flakyChecksOf(result: QueryResult): MockData['flakyChecks'] {
  const failing = columnOf(result, 'failing_json');
  const failures = columnOf(result, 'failures');
  const heads = columnOf(result, 'heads');
  const byName = new Map<string, { failures: number; readings: number }>();
  for (const row of result.rows) {
    for (const name of stringListOf(row[failing], 'checks')) {
      const seen = byName.get(name) ?? { failures: 0, readings: 0 };
      byName.set(name, { failures: seen.failures + numberOf(row[failures]), readings: seen.readings + numberOf(row[heads]) });
    }
  }
  return [...byName.entries()]
    .map(([name, counts]) => ({ name, ...counts }))
    .sort((a, b) => b.failures - a.failures || a.name.localeCompare(b.name))
    .slice(0, FLAKY_TOP);
}

/** One record per window week of `valueKey` per group: every group the answer names, 0 where a week has none. */
export function weeklyGroupsOf(result: QueryResult, groupKey: string, valueKey: string): Record<string, number>[] {
  const sums = sumsByWeek(result, groupKey, valueKey);
  const groups = [...new Set([...sums.values()].flatMap((entry) => [...entry.keys()]))];
  return windowWeeksOf(result, 'week').map((week) => Object.fromEntries(groups.map((name) => [name, sums.get(week)?.get(name) ?? 0])));
}

/** `valueKey` per window week as points, 0 for a week with no row. */
export function weeklyPointsOf(result: QueryResult, valueKey: string): TimePoint[] {
  const week = columnOf(result, 'week');
  const value = columnOf(result, valueKey);
  return windowWeeksOf(result, 'week').map((key) => ({
    x: dayOf(key),
    y: result.rows.filter((row) => row[week] === key).reduce((sum, row) => sum + numberOf(row[value]), 0),
  }));
}

/**
 * The Mondays (UTC) of the series window's weeks, oldest first: the week
 * of each entry `weeklyGroupsOf` and `preflightGridOf` answer for the
 * same window, read from `result`'s window.
 */
export function seriesWeeksOf(result: QueryResult, timeKey: string): Date[] {
  return windowWeeksOf(result, timeKey).map((week) => dayOf(week));
}

/* ---------- the result set ---------- */

/** One answer per metric. */
type Answers = Readonly<Record<LiveMetric, QueryResult>>;

/** The window just before `current`'s, as long; null for an open window. */
function previousWindowOf(current: QueryResult): Window | null {
  const bounds = boundsOf(current);
  if (bounds === null) return null;
  const span = bounds.to.getTime() - bounds.from.getTime();
  return { from: new Date(bounds.from.getTime() - span).toISOString(), to: bounds.from.toISOString() };
}

/** `key`'s metric over the window just before `current`'s; null for an open window. */
async function previousOf(client: AtlasClient, key: LiveMetric, current: QueryResult, signal?: AbortSignal): Promise<QueryResult | null> {
  const window = previousWindowOf(current);
  return window === null
    ? null
    : client.runMetric(LIVE_METRICS[key], window, signal);
}

/** Every metric over its window for `range`, asked at once in `LIVE_METRICS` order. */
async function answersOf(client: AtlasClient, range: TimeRange, signal?: AbortSignal): Promise<Answers> {
  const windows = RANGE_WINDOW[range];
  const entries = await Promise.all(METRIC_KEYS.map(async (key) => {
    const window = KPI_METRICS.has(key)
      ? windows.kpi
      : windows.series;
    return [key, await client.runMetric(LIVE_METRICS[key], window, signal)] as const;
  }));
  return Object.fromEntries(entries) as Answers;
}

/** The `proxyNote` of each proxy metric the API lists, by id. */
function proxyNotesOf(definitions: readonly MetricDefinition[]): ReadonlyMap<string, string> {
  return new Map(definitions.flatMap((definition) => (definition.feasibility === 'proxy' && definition.proxyNote !== undefined
    ? [[definition.id, definition.proxyNote] as const]
    : [])));
}

/** One field's meta: its metric, the row count of the answer that filled it and the metric's proxy note. */
function metaOf(field: LensField, metricId: string, answer: QueryResult | undefined, notes: ReadonlyMap<string, string>): readonly [LensField, FieldMeta] {
  const rowCount = answer?.meta.rowCount ?? 0;
  const proxyNote = notes.get(metricId);
  return [field, proxyNote === undefined
    ? { metricId, rowCount }
    : { metricId, rowCount, proxyNote }];
}

/** The meta of every wired field, the PoC metrics' then `live-sources.ts`'s. */
function fieldMetaOf(answers: Answers, previous: Partial<Answers>, sources: SourceAnswers, notes: ReadonlyMap<string, string>): ReadonlyMap<LensField, FieldMeta> {
  const poc = METRIC_KEYS.flatMap((key) => METRIC_FIELDS[key].map((field) => metaOf(field, LIVE_METRICS[key], PREVIOUS_FIELDS[field] === undefined
    ? answers[key]
    : previous[key], notes)));
  const past = SOURCE_METRIC_KEYS.flatMap((key) => SOURCE_METRIC_FIELDS[key].map((field) => metaOf(field, SOURCE_METRICS[key], sources.metrics[key], notes)));
  return new Map([...poc, ...past]);
}

/** The fields marked not wired for one result: `NOT_WIRED` itself, or with the GitHub fields that answered no row. */
function notWiredOf(pending: readonly LensField[]): ReadonlySet<LensField> {
  return pending.length === 0
    ? NOT_WIRED
    : new Set([...NOT_WIRED, ...pending]);
}

/** The wired fields of the mock shape, each filled from its metric's answer. */
function mockOf(answers: Answers, previous: Partial<Answers>, sources: SourceAnswers, definitions: readonly MetricDefinition[]): MockData {
  const tokensPerDay = timePointsOf(answers.tokensPerDay, 'day', 'tokens');
  const previousTokens = previous.tokensPerDay;
  const previousWindow = boundsOf(answers.tokensPerDay);
  const span = previousWindow === null
    ? 0
    : previousWindow.to.getTime() - previousWindow.from.getTime();
  const budget = budgetWeeksOf(answers.budgetBurn);
  const taskCycle = taskCycleOf(answers.taskCycle);
  return {
    ...emptyMock(),
    tokensPerDay,
    tokensPerDayPrevious: previousTokens === undefined
      ? []
      : shiftPoints(timePointsOf(previousTokens, 'day', 'tokens'), span),
    tokensDailyAverage: dailyAverageOf(tokensPerDay, answers.tokensPerDay),
    tokensThisWeek: budget.thisWeek,
    tokensLastWeek: budget.lastWeek,
    plansPerWeek: plansOf(answers.planCompletion),
    plansCompletedPerWeek: timePointsOf(answers.plansCompletedPerWeek, 'week', 'completed'),
    plannedVsSessions: plannedVsSessionsOf(answers.plannedVsSessions),
    activeBlockers: blockersOf(answers.activeBlockers),
    debtRatio: debtRatioOf(answers.debtRatio),
    minutesByChangeKind: changeSlicesOf(answers.debtRatio),
    minutesByChangeKindPrevious: previous.debtRatio === undefined
      ? []
      : changeSlicesOf(previous.debtRatio),
    taskMinutesQuantiles: quantilesOf(answers.taskMinutesQuantiles),
    tokensByModel: modelSeriesOf(answers.tokensByModel),
    preflightHalts: preflightGridOf(answers.preflightHalts),
    tasksDonePerWeek: tasksDoneOf(answers.tasksDonePerWeek),
    taskCycle,
    taskCycleTrend: cycleTrendOf(taskCycle, answers.taskCycle),
    taskMinutesBins: taskMinutesBinsOf(taskCycle),
    redCiShare: redShareOf(answers.redCiShare),
    bugsByKindPerWeek: weeklyGroupsOf(answers.bugsByKind, 'kind', 'bugs'),
    regressionsPerWeek: weeklyPointsOf(answers.regressions, 'bugs'),
    flakyChecks: flakyChecksOf(answers.flakyChecks),
    filedSharePerWeek: weeklyGroupsOf(answers.filedShare, 'route', 'bugs'),
    ...sourceFieldsOf(sources, definitions),
  };
}

/** The live result set for `range`: the wired fields from the API with their meta, every other field marked. */
export async function liveResultOf(client: AtlasClient, range: TimeRange, signal?: AbortSignal): Promise<LensResult> {
  const [answers, sources, definitions] = await Promise.all([
    answersOf(client, range, signal),
    sourceAnswersOf(client, RANGE_WINDOW[range].series, signal),
    client.listMetrics(undefined, signal),
  ]);
  const [tokens, debt] = await Promise.all([
    previousOf(client, 'tokensPerDay', answers.tokensPerDay, signal),
    previousOf(client, 'debtRatio', answers.debtRatio, signal),
  ]);
  const previous: Partial<Answers> = {
    ...(tokens === null
      ? {}
      : { tokensPerDay: tokens }),
    ...(debt === null
      ? {}
      : { debtRatio: debt }),
  };
  const pending = githubPendingOf(sources, definitions);
  return {
    range,
    source: 'live',
    notWired: notWiredOf(pending),
    notWiredDetail: new Map(pending.map((field) => [field, GITHUB_NOT_READ])),
    fieldMeta: fieldMetaOf(answers, previous, sources, proxyNotesOf(definitions)),
    weeks: seriesWeeksOf(answers.bugsByKind, 'week'),
    mock: mockOf(answers, previous, sources, definitions),
    balance: [],
    workspace: { ...EMPTY_WORKSPACE, ...moduleGraphOf(sources.metrics.coupling) },
  };
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
