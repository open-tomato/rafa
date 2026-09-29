/**
 * `rafa effort report --trend`: the task sessions of the store read as
 * two segments, the trend metrics and the loop sessions, in one report.
 *
 * Pure over its inputs, as `summariseSessions` in `report.ts` is: session
 * rows, each session's reported outcome and each session's dispatched
 * agent go in, and the report comes out. `report-trend-read.ts` reads
 * them from the store, and `report-trend-format.ts` writes the text.
 *
 * ## The two segments
 *
 * {@link TrendReport.trend} compares the task sessions of a recent window
 * against the baseline window before it, per metric at the median and
 * p90, adds one row per day over both windows, and lists the recent
 * sessions over the baseline's outlier line (`trend-stats.ts`).
 *
 * {@link TrendReport.loops} lists one row per loop, newest first, with
 * each loop's wall-clock and summed time and the spread of its per-task
 * figures, and under the rows the Mann-Kendall reading of each per-loop
 * median across the loops in the order they started. That reading is
 * the answer to "does cost follow the calendar or the plan": plans that
 * change constantly scatter the medians, while something growing with
 * time makes them rise whatever the plan.
 *
 * The JSON result holds both segments, so one call feeds a dashboard.
 *
 * ## No clock
 *
 * The windows are measured back from the newest task session's last
 * record, the {@link TrendSegment.anchor}, never from now, so two reads
 * of an unchanged store answer the same bytes. Days are UTC days: the
 * recent window is the anchor's day and the `recentDays - 1` days before
 * it, the baseline the `days` days before that, and the loop window the
 * anchor's day and the `days - 1` days before it.
 *
 * ## What a loop is
 *
 * The task sessions one plan stub claims, or one branch when no plan
 * does, keyed as `report.ts` keys its groups. The store holds no run id
 * on a session row, so a plan restarted a day later is one loop, and its
 * wall-clock minutes carry the gap; its work minutes, the sum of its
 * sessions' spans, do not.
 */
import type { TrendGrouping } from './report-args.js';
import type { SessionGroupKind, ReportSessionRow } from './report.js';
import type { MannKendall, Spread } from './trend-stats.js';

import { groupKeyOf, sessionSpanMinutes } from './report.js';
import {
  mannKendall,
  outlierLimit,
  quantile,
  roundFigure,
  spreadOf,
} from './trend-stats.js';

/** Milliseconds in one UTC day. */
const MS_PER_DAY = 86_400_000;

/** Milliseconds in one minute. */
const MS_PER_MINUTE = 60_000;

/** Minutes in one hour. */
const MINUTES_PER_HOUR = 60;

/** The outcome a finished task reports; every other one is not done. */
const DONE_OUTCOME = 'done';

/** The sub-row key of a session the chosen grouping has no value for. */
const NO_VALUE_KEY = '(none)';

/** A session row as the trend reads it: the report's fields and the task text. */
export interface TrendSessionRow extends ReportSessionRow {
  taskText?: string | null;
}

/** The windows and splits a trend report is read with. */
export interface TrendOptions {
  /** Days of the baseline window, and of the loop window. */
  days: number;
  /** Days of the recent window, the anchor's day included. */
  recentDays: number;
  /** The newest loops to list whatever their age; null lists the loop window. */
  loops: number | null;
  /** What each loop row splits into; null for no split. */
  by: TrendGrouping | null;
}

/** One task session, reduced to what the trend reads. */
interface TrendSession {
  sessionId: string;
  loop: string;
  loopKind: SessionGroupKind;
  firstTimestamp: string;
  lastTimestamp: string;
  start: number;
  end: number;
  minutes: number;
  outputTokens: number;
  cacheReadTokens: number;
  turns: number;
  taskText: string | null;
  model: string | null;
  effort: string | null;
  agent: string | null;
  outcome: string | null;
}

/** The figures read per task session, named as the JSON names them. */
export const TREND_METRICS = ['minutes', 'outputTokens', 'cacheReadTokens', 'turns'] as const;

/** One per-task figure. */
export type TrendMetricName = typeof TREND_METRICS[number];

/** One window's bounds and size. */
export interface TrendWindow {
  /** The window's first UTC day, `YYYY-MM-DD`. */
  from: string;
  /** The window's last UTC day, `YYYY-MM-DD`. */
  to: string;
  sessions: number;
}

/** One metric, baseline against recent. */
export interface TrendMetric {
  name: TrendMetricName;
  baselineP50: number | null;
  recentP50: number | null;
  /** Recent median over baseline median, less one, in percent; null without a baseline. */
  changePct: number | null;
  baselineP90: number | null;
  recentP90: number | null;
}

/** One UTC day's task sessions. */
export interface TrendDay {
  day: string;
  sessions: number;
  minutesP50: number | null;
  minutesP90: number | null;
  minutesMax: number | null;
  outputTokensP50: number | null;
  /** The day's session minutes summed, in hours. */
  workHours: number;
  /** Distinct loops with a session that day. */
  loops: number;
}

/** A recent session over the outlier line. */
export interface TrendOutlier {
  sessionId: string;
  loop: string;
  firstTimestamp: string;
  minutes: number;
  outputTokens: number;
  /** The outcome its task report gave, or null for none stored. */
  outcome: string | null;
  taskText: string | null;
}

/** The first segment: the recent window against the baseline. */
export interface TrendSegment {
  /** The newest task session's last record; every window ends on its day. */
  anchor: string | null;
  baseline: TrendWindow | null;
  recent: TrendWindow | null;
  metrics: TrendMetric[];
  /** The share of reported tasks not `done`, per window; null with none reported. */
  notDoneShare: { baseline: number | null; recent: number | null };
  days: TrendDay[];
  outliers: { limitMinutes: number | null; sessions: TrendOutlier[] };
}

/** The spread of each per-task figure. */
export type PerTask = Record<TrendMetricName, Spread>;

/** One sub-row of a loop under `--by`. */
export interface LoopGroup {
  key: string;
  tasks: number;
  workMinutes: number;
  perTask: PerTask;
}

/** One loop. */
export interface LoopRow {
  key: string;
  kind: SessionGroupKind;
  firstTimestamp: string;
  lastTimestamp: string;
  /** First record to last, gaps included. */
  wallMinutes: number;
  /** The sessions' own spans summed. */
  workMinutes: number;
  tasks: number;
  /** Tasks whose report's outcome is not `done`. */
  notDone: number;
  /** Tasks with no stored report. */
  unreported: number;
  perTask: PerTask;
  /** Sessions per dominant model, effort and dispatched agent. */
  models: Record<string, number>;
  efforts: Record<string, number>;
  agents: Record<string, number>;
  /** The `--by` sub-rows, largest first; null without `--by`. */
  groups: LoopGroup[] | null;
}

/** The per-loop figures the drift test reads, in loop start order. */
export const DRIFT_METRICS = [
  'tasks',
  'minutesP50',
  'outputTokensP50',
  'cacheReadTokensP50',
  'turnsP50',
] as const;

/** One drift reading. */
export interface LoopDrift extends MannKendall {
  metric: typeof DRIFT_METRICS[number];
}

/** The second segment: the loops, newest first, and their drift. */
export interface LoopsSegment {
  /** The loop window in days, or null when `loops` picked the rows. */
  days: number | null;
  loops: number | null;
  by: TrendGrouping | null;
  rows: LoopRow[];
  drift: LoopDrift[];
}

/** The whole report, one segment per key. */
export interface TrendReport {
  /** Task sessions with a span the report read. */
  taskSessions: number;
  trend: TrendSegment;
  loops: LoopsSegment;
}

/** The key with the largest count, ties broken on the key; null for none. */
export function dominantKey(counts: Record<string, number> | undefined): string | null {
  let best: string | null = null;
  let bestCount = 0;
  for (const [key, count] of Object.entries(counts ?? {})) {
    if (count > bestCount || (count === bestCount && best !== null && key < best)) {
      best = key;
      bestCount = count;
    }
  }
  return best;
}

/** The task sessions with a span, each joined to its outcome and agent. */
function taskSessions(
  rows: readonly TrendSessionRow[],
  outcomes: ReadonlyMap<string, string>,
  agents: ReadonlyMap<string, string>,
): TrendSession[] {
  const sessions: TrendSession[] = [];
  for (const row of rows) {
    const minutes = sessionSpanMinutes(row);
    if (row.kind !== 'task' || minutes === null) continue;
    const { firstTimestamp, lastTimestamp } = row;
    if (firstTimestamp === null || lastTimestamp === null) continue;

    const grouping = groupKeyOf(row);
    sessions.push({
      sessionId: row.sessionId,
      loop: grouping.key,
      loopKind: grouping.kind,
      firstTimestamp,
      lastTimestamp,
      start: Date.parse(firstTimestamp),
      end: Date.parse(lastTimestamp),
      minutes,
      outputTokens: row.usage.outputTokens,
      cacheReadTokens: row.usage.cacheReadInputTokens,
      turns: row.assistantRecordCount,
      taskText: row.taskText ?? null,
      model: dominantKey(row.modelCounts),
      effort: dominantKey(row.effortCounts),
      agent: agents.get(row.sessionId) ?? null,
      outcome: outcomes.get(row.sessionId) ?? null,
    });
  }
  return sessions;
}

/** The start of the UTC day an instant falls on. */
function dayStart(instant: number): number {
  return Math.floor(instant / MS_PER_DAY) * MS_PER_DAY;
}

/** The `YYYY-MM-DD` of an instant, in UTC. */
function dayOf(instant: number): string {
  return new Date(instant).toISOString()
    .slice(0, 10);
}

/** One per-task figure of a session. */
function metricOf(session: TrendSession, name: TrendMetricName): number {
  return session[name];
}

/** The rounded quantile of one figure over sessions. */
function quantileOf(sessions: readonly TrendSession[], name: TrendMetricName, p: number): number | null {
  const value = quantile(sessions.map((session) => metricOf(session, name)), p);
  return value === null
    ? null
    : roundFigure(value);
}

/** The share of reported sessions whose outcome is not done. */
function notDoneShareOf(sessions: readonly TrendSession[]): number | null {
  const reported = sessions.filter((session) => session.outcome !== null);
  if (reported.length === 0) return null;

  return roundFigure(reported.filter((session) => session.outcome !== DONE_OUTCOME).length / reported.length);
}

/** One metric's baseline and recent quantiles and their change. */
function metricRow(name: TrendMetricName, baseline: readonly TrendSession[], recent: readonly TrendSession[]): TrendMetric {
  const baselineP50 = quantileOf(baseline, name, 0.5);
  const recentP50 = quantileOf(recent, name, 0.5);
  const changePct = baselineP50 === null || recentP50 === null || baselineP50 === 0
    ? null
    : roundFigure((recentP50 / baselineP50 - 1) * 100);
  return {
    name,
    baselineP50,
    recentP50,
    changePct,
    baselineP90: quantileOf(baseline, name, 0.9),
    recentP90: quantileOf(recent, name, 0.9),
  };
}

/** One row per UTC day holding a session, oldest first. */
function dayRows(sessions: readonly TrendSession[]): TrendDay[] {
  const byDay = new Map<string, TrendSession[]>();
  for (const session of sessions) {
    const day = dayOf(session.start);
    byDay.set(day, [...(byDay.get(day) ?? []), session]);
  }
  return [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, held]) => ({
      day,
      sessions: held.length,
      minutesP50: quantileOf(held, 'minutes', 0.5),
      minutesP90: quantileOf(held, 'minutes', 0.9),
      minutesMax: quantileOf(held, 'minutes', 1),
      outputTokensP50: quantileOf(held, 'outputTokens', 0.5),
      workHours: roundFigure(held.reduce((sum, session) => sum + session.minutes, 0) / MINUTES_PER_HOUR),
      loops: new Set(held.map((session) => session.loop)).size,
    }));
}

/** A window's bounds and how many sessions fall in it. */
function windowOf(from: number, to: number, sessions: readonly TrendSession[]): TrendWindow {
  return { from: dayOf(from), to: dayOf(to), sessions: sessions.length };
}

/** The recent sessions over the baseline's outlier line, longest first. */
function outliersOf(baseline: readonly TrendSession[], recent: readonly TrendSession[]): TrendSegment['outliers'] {
  const limitMinutes = outlierLimit(baseline.map((session) => session.minutes));
  if (limitMinutes === null) return { limitMinutes, sessions: [] };

  const over = recent
    .filter((session) => session.minutes > limitMinutes)
    .sort((a, b) => b.minutes - a.minutes)
    .map((session) => ({
      sessionId: session.sessionId,
      loop: session.loop,
      firstTimestamp: session.firstTimestamp,
      minutes: session.minutes,
      outputTokens: session.outputTokens,
      outcome: session.outcome,
      taskText: session.taskText,
    }));
  return { limitMinutes, sessions: over };
}

/** The first segment. See the module note for the windows. */
function trendSegment(sessions: readonly TrendSession[], options: TrendOptions): TrendSegment {
  if (sessions.length === 0) {
    return {
      anchor: null,
      baseline: null,
      recent: null,
      metrics: [],
      notDoneShare: { baseline: null, recent: null },
      days: [],
      outliers: { limitMinutes: null, sessions: [] },
    };
  }
  const anchorEnd = Math.max(...sessions.map((session) => session.end));
  const anchorDay = dayStart(anchorEnd);
  const recentFrom = anchorDay - (options.recentDays - 1) * MS_PER_DAY;
  const baselineFrom = recentFrom - options.days * MS_PER_DAY;
  const recent = sessions.filter((session) => session.start >= recentFrom);
  const baseline = sessions.filter((session) => session.start >= baselineFrom && session.start < recentFrom);

  return {
    anchor: new Date(anchorEnd).toISOString(),
    baseline: windowOf(baselineFrom, recentFrom - MS_PER_DAY, baseline),
    recent: windowOf(recentFrom, anchorDay, recent),
    metrics: TREND_METRICS.map((name) => metricRow(name, baseline, recent)),
    notDoneShare: { baseline: notDoneShareOf(baseline), recent: notDoneShareOf(recent) },
    days: dayRows([...baseline, ...recent]),
    outliers: outliersOf(baseline, recent),
  };
}

/** The spread of every per-task figure over sessions. */
function perTaskOf(sessions: readonly TrendSession[]): PerTask {
  return {
    minutes: spreadOf(sessions.map((session) => session.minutes)),
    outputTokens: spreadOf(sessions.map((session) => session.outputTokens)),
    cacheReadTokens: spreadOf(sessions.map((session) => session.cacheReadTokens)),
    turns: spreadOf(sessions.map((session) => session.turns)),
  };
}

/** Sessions per value, a session with none counted under {@link NO_VALUE_KEY}. */
function histogramOf(values: readonly (string | null)[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    const key = value ?? NO_VALUE_KEY;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

/** The summed session minutes, rounded. */
function workMinutesOf(sessions: readonly TrendSession[]): number {
  return roundFigure(sessions.reduce((sum, session) => sum + session.minutes, 0));
}

/** A loop's `--by` sub-rows, most tasks first, ties on the key. */
function loopGroups(sessions: readonly TrendSession[], by: TrendGrouping): LoopGroup[] {
  const held = new Map<string, TrendSession[]>();
  for (const session of sessions) {
    const key = session[by] ?? NO_VALUE_KEY;
    held.set(key, [...(held.get(key) ?? []), session]);
  }
  return [...held.entries()]
    .map(([key, grouped]) => ({
      key,
      tasks: grouped.length,
      workMinutes: workMinutesOf(grouped),
      perTask: perTaskOf(grouped),
    }))
    .sort((a, b) => b.tasks - a.tasks || a.key.localeCompare(b.key));
}

/** One loop's row. */
function loopRow(sessions: readonly TrendSession[], by: TrendGrouping | null): LoopRow {
  const first = sessions.reduce((held, session) => (session.start < held.start
    ? session
    : held));
  const last = sessions.reduce((held, session) => (session.end > held.end
    ? session
    : held));
  return {
    key: first.loop,
    kind: first.loopKind,
    firstTimestamp: first.firstTimestamp,
    lastTimestamp: last.lastTimestamp,
    wallMinutes: roundFigure((last.end - first.start) / MS_PER_MINUTE),
    workMinutes: workMinutesOf(sessions),
    tasks: sessions.length,
    notDone: sessions.filter((session) => session.outcome !== null && session.outcome !== DONE_OUTCOME).length,
    unreported: sessions.filter((session) => session.outcome === null).length,
    perTask: perTaskOf(sessions),
    models: histogramOf(sessions.map((session) => session.model)),
    efforts: histogramOf(sessions.map((session) => session.effort)),
    agents: histogramOf(sessions.map((session) => session.agent)),
    groups: by === null
      ? null
      : loopGroups(sessions, by),
  };
}

/** The per-loop figure one drift reading is taken on. */
function driftValue(row: LoopRow, metric: LoopDrift['metric']): number {
  if (metric === 'tasks') return row.tasks;
  const spreads: Record<Exclude<LoopDrift['metric'], 'tasks'>, Spread> = {
    minutesP50: row.perTask.minutes,
    outputTokensP50: row.perTask.outputTokens,
    cacheReadTokensP50: row.perTask.cacheReadTokens,
    turnsP50: row.perTask.turns,
  };
  return spreads[metric].p50 ?? 0;
}

/** The second segment: the selected loops, newest first, and their drift. */
function loopsSegment(sessions: readonly TrendSession[], options: TrendOptions): LoopsSegment {
  const byLoop = new Map<string, TrendSession[]>();
  for (const session of sessions) {
    const key = `${session.loopKind} ${session.loop}`;
    byLoop.set(key, [...(byLoop.get(key) ?? []), session]);
  }
  const all = [...byLoop.values()]
    .map((held) => loopRow(held, options.by))
    .sort((a, b) => b.firstTimestamp.localeCompare(a.firstTimestamp) || a.key.localeCompare(b.key));

  let rows = all;
  if (options.loops !== null) {
    rows = all.slice(0, options.loops);
  } else if (sessions.length > 0) {
    const anchorDay = dayStart(Math.max(...sessions.map((session) => session.end)));
    const from = anchorDay - (options.days - 1) * MS_PER_DAY;
    rows = all.filter((row) => Date.parse(row.lastTimestamp) >= from);
  }
  const oldestFirst = [...rows].reverse();
  return {
    days: options.loops === null
      ? options.days
      : null,
    loops: options.loops,
    by: options.by,
    rows,
    drift: DRIFT_METRICS.map((metric) => ({
      metric,
      ...mannKendall(oldestFirst.map((row) => driftValue(row, metric))),
    })),
  };
}

/**
 * The trend report over stored session rows, each session's reported
 * outcome and each session's dispatched agent, both keyed by session id.
 * See the module note.
 */
export function summariseTrend(
  rows: readonly TrendSessionRow[],
  outcomes: ReadonlyMap<string, string>,
  agents: ReadonlyMap<string, string>,
  options: TrendOptions,
): TrendReport {
  const sessions = taskSessions(rows, outcomes, agents);
  return {
    taskSessions: sessions.length,
    trend: trendSegment(sessions, options),
    loops: loopsSegment(sessions, options),
  };
}
