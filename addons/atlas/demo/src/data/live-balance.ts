/**
 * The balance radar's nine indices on the live page (spec C5), from the
 * weekly metrics of the catalogue, asked of the Atlas API.
 *
 * "This week" is the 7 days ending at the replica's build time, never the
 * current ISO week: on a Monday that week holds one day, and every index
 * would read as a collapse. The baseline is the 12 weeks of the 84 days
 * before those 7: the median of their 12 values, the mean of the same 12
 * when the median is 0, and none when the mean is 0 too, the axis then
 * reading `NONE_IN_12_WEEKS` and drawing at 0. An index is this week's
 * value over its baseline, to two decimals, so 1 is "as usual".
 *
 * The metrics answer ISO weeks, and the 7 days ending at a build cross
 * an ISO week's Monday on every day but a Sunday, so `balanceAnswersOf`
 * asks each metric's own params (source, filters, groups, measures) at
 * day grain, over one fixed window of 91 whole UTC days ending with the
 * build's day (`balanceWindowOf`), whatever the page's range. The replica
 * holds nothing past its build, so the build's whole day holds what the 7
 * days ending at the build time hold. `liveBalanceOf` folds the days into
 * 13 periods of 7, the build's day in the first.
 *
 * The metrics each index reads, as `BALANCE_INDEX_METRICS` in
 * `rafa-atlas/src/metrics/developer.ts` lists them:
 *
 * - `feat-rate`: the `major` and `minor` entries of `dev.changes-per-week`
 *   (a feature, D4).
 * - `plan-done`: completed over started plans, `pm.plan-completion`.
 * - `releases`: the release tags of `dev.deploys-per-week`.
 * - `bug-intake`: the entries of `pm.out-of-scope-per-week` per 100 task
 *   sessions of `dev.sessions-per-week`.
 * - `regressions`: the bugs of `qa.regressions` over every routed bug of
 *   `qa.bugs-by-kind`.
 * - `red-ci`: red over green and red readings, `dev.ci-verdicts-per-week`.
 * - `blocked`: the `blocked` sessions of `dev.sessions-per-week` and the
 *   sessions of `dev.repeat-sessions-per-week`, over all task sessions.
 * - `refactor-share`: the `chore` minutes of `dev.sessions-per-week` over
 *   all its minutes; D4 has no refactor type.
 * - `docs-share`: the entries of `dev.changes-per-week` whose area tidies
 *   to `docs` (`tidyArea`, as C4 tidies) over all its entries. The stale
 *   docs cleared, the other half of the mock's definition, wait on a
 *   replica holding the store's `stale_docs`, and its definition line says
 *   so (`DOCS_SHARE_DEFINITION`).
 *
 * A share over a week with nothing to divide by (no plan started, no bug
 * routed, no reading) is 0 for that week: no event, never an invented one.
 */
import type { BalanceIndex } from './balance.js';
import type { QueryParams, QueryResult, Scalar, Window } from '@open-tomato/atlas-data/contract';
import type { AtlasClient } from '@open-tomato/atlas-transport/client';

import { tidyArea } from './areas.js';
import { BALANCE_CATALOGUE, BALANCE_WINDOW_WEEKS } from './balance.js';
import { columnOf, DAY_MS, dayOf, dayStartOf, numberOf, textOf } from './live-read.js';

/** What an axis reads when its index had no event in the 12 weeks of its baseline. */
export const NONE_IN_12_WEEKS = 'none in 12 weeks';

/** The docs share's definition on the live page: the stale docs half waits on the replica. */
export const DOCS_SHARE_DEFINITION = 'docs changes / changes; the stale docs cleared wait on the replica holding the store\'s stale_docs';

/** The days of one period: this week and each week of the baseline. */
const PERIOD_DAYS = 7;

/** The periods the window holds: this week, then the 12 of the baseline. */
const PERIODS: number = 1 + BALANCE_WINDOW_WEEKS;

/** The whole days the window asks for: 91. */
export const BALANCE_WINDOW_DAYS: number = PERIODS * PERIOD_DAYS;

/** Task sessions per how many the bug intake counts its bugs. */
const PER_HUNDRED = 100;

/** The two decimals an index is rounded to. */
const INDEX_SCALE = 100;

/** The metrics the indices read, by a short name. */
export type BalanceMetric =
  | 'changes'
  | 'planCompletion'
  | 'deploys'
  | 'outOfScope'
  | 'sessions'
  | 'repeats'
  | 'regressions'
  | 'bugsByKind'
  | 'ciVerdicts';

/** The catalogue id of each metric the indices read. */
export const BALANCE_METRICS: Readonly<Record<BalanceMetric, string>> = {
  changes: 'dev.changes-per-week',
  planCompletion: 'pm.plan-completion',
  deploys: 'dev.deploys-per-week',
  outOfScope: 'pm.out-of-scope-per-week',
  sessions: 'dev.sessions-per-week',
  repeats: 'dev.repeat-sessions-per-week',
  regressions: 'qa.regressions',
  bugsByKind: 'qa.bugs-by-kind',
  ciVerdicts: 'dev.ci-verdicts-per-week',
};

/** The metrics asked, in `BALANCE_METRICS` order. */
const BALANCE_METRIC_KEYS = Object.keys(BALANCE_METRICS) as BalanceMetric[];

/** One answer per metric, each over `balanceWindowOf`'s days at day grain. */
export type BalanceAnswers = Readonly<Record<BalanceMetric, QueryResult>>;

/** Which rule gave an index its baseline. */
export type BaselineRule = 'median' | 'mean' | 'none';

/** An index's baseline: the rule that gave it, and its value (0 for `none`). */
export interface BalanceBaseline {
  readonly rule: BaselineRule;
  readonly value: number;
}

/** One index of the catalogue with its live value, this week's reading and the baseline it was divided by. */
export interface LiveBalanceIndex extends BalanceIndex {
  /** This week's reading: a count, a share or a rate, as the definition says. */
  readonly current: number;
  readonly baseline: BalanceBaseline;
}

/** The weekly readings of one index, this week first, then the 12 of the baseline, newest first. */
type WeeklyOf = (answers: BalanceAnswers, buildDay: number) => readonly number[];

/** The UTC midnight of the build's day, from the replica's build time; a time that names no instant is refused. */
function buildDayOf(builtAt: string): number {
  return dayStartOf(dayOf(builtAt).getTime());
}

/**
 * The window the indices are asked over: the 91 whole UTC days ending
 * with the day of the build, the same whatever the page's range.
 */
export function balanceWindowOf(builtAt: string): Window {
  return {
    to: new Date(buildDayOf(builtAt)).toISOString()
      .slice(0, 10),
    last: `${BALANCE_WINDOW_DAYS}d`,
  };
}

/** A metric's params asked at day grain over `window`, ordered by day: its source, filters, groups and measures kept. */
function dailyParamsOf(params: QueryParams, window: Window): QueryParams {
  return { ...params, grain: 'day', window, orderBy: [{ key: 'day', dir: 'asc' }] };
}

/** Every metric the indices read, each described then asked at day grain over `balanceWindowOf(builtAt)`, at once. */
export async function balanceAnswersOf(client: AtlasClient, builtAt: string, signal?: AbortSignal): Promise<BalanceAnswers> {
  const window = balanceWindowOf(builtAt);
  const entries = await Promise.all(BALANCE_METRIC_KEYS.map(async (key) => {
    const metric = await client.describeMetric(BALANCE_METRICS[key], signal);
    return [key, await client.query(metric.sourceId, dailyParamsOf(metric.params, window), signal)] as const;
  }));
  return Object.fromEntries(entries) as Record<BalanceMetric, QueryResult>;
}

/** The period a day falls in: 0 for the 7 days ending with the build's, 1 to 12 for the baseline's; null outside them. */
export function periodOf(day: number, buildDay: number): number | null {
  const back = Math.round((buildDay - dayStartOf(day)) / DAY_MS);
  const period = Math.floor(back / PERIOD_DAYS);
  return back < 0 || period >= PERIODS
    ? null
    : period;
}

/** The sum of `valueKey` per period of `result`'s `day` rows, over the rows `keep` takes. */
function periodSumsOf(
  result: QueryResult,
  buildDay: number,
  valueKey: string,
  keep: (row: readonly Scalar[]) => boolean = () => true,
): number[] {
  const day = columnOf(result, 'day');
  const value = columnOf(result, valueKey);
  const sums: number[] = Array.from({ length: PERIODS }, () => 0);
  for (const row of result.rows) {
    const period = periodOf(dayOf(row[day]).getTime(), buildDay);
    if (period === null || !keep(row)) continue;
    sums[period] = (sums[period] ?? 0) + numberOf(row[value]);
  }
  return sums;
}

/** A row filter on `key`'s text being one of `values`. */
function whereIn(result: QueryResult, key: string, values: readonly string[]): (row: readonly Scalar[]) => boolean {
  const cell = columnOf(result, key);
  return (row) => values.includes(textOf(row[cell], ''));
}

/** `part` over `whole` per period, times `scale`; 0 for a period with no whole. */
function sharesOf(part: readonly number[], whole: readonly number[], scale = 1): number[] {
  return part.map((value, period) => {
    const of = whole[period] ?? 0;
    return of > 0
      ? value / of * scale
      : 0;
  });
}

/** `a` and `b` added per period. */
function addedOf(a: readonly number[], b: readonly number[]): number[] {
  return a.map((value, period) => value + (b[period] ?? 0));
}

/** The changelog entries whose raw area tidies to `docs`. */
function docsEntriesOf(result: QueryResult, buildDay: number): number[] {
  const area = columnOf(result, 'area');
  return periodSumsOf(result, buildDay, 'entries', (row) => {
    const raw = row[area];
    return tidyArea(typeof raw === 'string'
      ? raw
      : null) === 'docs';
  });
}

/** The weekly readings of each index of the catalogue, by its id. */
export const INDEX_WEEKS: Readonly<Record<string, WeeklyOf>> = {
  'feat-rate': ({ changes }, day) => periodSumsOf(changes, day, 'entries', whereIn(changes, 'level', ['major', 'minor'])),
  'plan-done': ({ planCompletion }, day) => sharesOf(periodSumsOf(planCompletion, day, 'completed'), periodSumsOf(planCompletion, day, 'started')),
  'releases': ({ deploys }, day) => periodSumsOf(deploys, day, 'deploys'),
  'bug-intake': ({ outOfScope, sessions }, day) => sharesOf(periodSumsOf(outOfScope, day, 'entries'), periodSumsOf(sessions, day, 'sessions'), PER_HUNDRED),
  'regressions': ({ regressions, bugsByKind }, day) => sharesOf(periodSumsOf(regressions, day, 'bugs'), periodSumsOf(bugsByKind, day, 'bugs')),
  'red-ci': ({ ciVerdicts }, day) => sharesOf(
    periodSumsOf(ciVerdicts, day, 'readings', whereIn(ciVerdicts, 'verdict', ['red'])),
    periodSumsOf(ciVerdicts, day, 'readings'),
  ),
  'blocked': ({ sessions, repeats }, day) => sharesOf(
    addedOf(periodSumsOf(sessions, day, 'sessions', whereIn(sessions, 'status', ['blocked'])), periodSumsOf(repeats, day, 'sessions')),
    periodSumsOf(sessions, day, 'sessions'),
  ),
  'refactor-share': ({ sessions }, day) => sharesOf(
    periodSumsOf(sessions, day, 'minutes', whereIn(sessions, 'work_type', ['chore'])),
    periodSumsOf(sessions, day, 'minutes'),
  ),
  'docs-share': ({ changes }, day) => sharesOf(docsEntriesOf(changes, day), periodSumsOf(changes, day, 'entries')),
};

/** The median of `values`: the middle one, or the mean of the middle two. */
function medianOf(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle] ?? 0
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/** The mean of `values`, 0 for none. */
function meanOf(values: readonly number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** The baseline of the 12 weekly readings: their median, their mean when it is 0, none when that is 0 too. */
export function baselineOf(weeks: readonly number[]): BalanceBaseline {
  const median = medianOf(weeks);
  if (median > 0) return { rule: 'median', value: median };
  const mean = meanOf(weeks);
  return mean > 0
    ? { rule: 'mean', value: mean }
    : { rule: 'none', value: 0 };
}

/** One index from its weekly readings: this week over the baseline, to two decimals; 0 with no baseline. */
function indexOf(index: BalanceIndex, weekly: readonly number[]): LiveBalanceIndex {
  const [current = 0, ...weeks] = weekly;
  const baseline = baselineOf(weeks);
  const value = baseline.rule === 'none'
    ? 0
    : Math.round(current / baseline.value * INDEX_SCALE) / INDEX_SCALE;
  const definition = index.id === 'docs-share'
    ? DOCS_SHARE_DEFINITION
    : index.definition;
  return { ...index, definition, value, current, baseline };
}

/**
 * The catalogue's nine indices with their live values, in catalogue order
 * and with their default switches, from `balanceAnswersOf`'s answers and
 * the build time they were asked to. An index the catalogue holds and no
 * reading of `INDEX_WEEKS` answers is refused.
 */
export function liveBalanceOf(answers: BalanceAnswers, builtAt: string): LiveBalanceIndex[] {
  const buildDay = buildDayOf(builtAt);
  return BALANCE_CATALOGUE.map((index) => {
    const weekly = INDEX_WEEKS[index.id];
    if (weekly === undefined) throw new Error(`atlas: no live reading for the balance index ${index.id}`);
    return indexOf(index, weekly(answers, buildDay));
  });
}
