/**
 * Renders the trend report as the lines `rafa effort report --trend`
 * prints in text mode: a header, the trend segment, then the loops
 * segment, each opened by an upper-case heading so the two read apart.
 *
 * Pure over a {@link TrendReport}, as `report-format.ts` is over the
 * session report: `report-trend.ts` decides every figure and this module
 * decides only how each one is written. Json mode never passes through
 * here; the report is the result as it stands.
 *
 * Minutes are written at one decimal, hours at one, token counts compact
 * (`52k`, `5.4M`), shares and changes as whole percents, and instants as
 * UTC minutes, so nothing here reads the machine's time zone.
 */
import type {
  LoopDrift,
  LoopGroup,
  LoopRow,
  LoopsSegment,
  PerTask,
  TrendDay,
  TrendMetric,
  TrendMetricName,
  TrendReport,
  TrendSegment,
} from './report-trend.js';

import { plural } from '../commands/plan/plan-files.js';

import { alignRows, formatHistogram, formatMinutes, oneLine } from './report-format.js';

/** Minutes in one hour. */
const MINUTES_PER_HOUR = 60;

/** Tokens in one `k`. */
const THOUSAND = 1_000;

/** Tokens in one `M`. */
const MILLION = 1_000_000;

/** Tokens in one `B`. */
const BILLION = 1_000_000_000;

/** Characters of a task's text an outlier line keeps. */
const TASK_TEXT_CHARS = 100;

/** Outliers listed in text; the JSON holds every one. */
const OUTLIERS_LISTED = 10;

/** How each metric is named in the table. */
const METRIC_LABELS: Record<TrendMetricName, string> = {
  minutes: 'minutes',
  outputTokens: 'output tokens',
  cacheReadTokens: 'cache-read tokens',
  turns: 'turns',
};

/** How each drift metric is named in the table. */
const DRIFT_LABELS: Record<LoopDrift['metric'], string> = {
  tasks: 'tasks per loop',
  minutesP50: 'minutes per task (p50)',
  outputTokensP50: 'output tokens per task (p50)',
  cacheReadTokensP50: 'cache-read tokens per task (p50)',
  turnsP50: 'turns per task (p50)',
};

/** Each unit from the smallest: its size, its suffix, the places it is written at. */
const TOKEN_UNITS: readonly (readonly [number, string, number])[] = [
  [1, '', 0],
  [THOUSAND, 'k', 0],
  [MILLION, 'M', 1],
  [BILLION, 'B', 1],
];

/** A count written in one unit. */
function inUnit(value: number, [size, suffix, places]: readonly [number, string, number]): string {
  return `${(value / size).toFixed(places)}${suffix}`;
}

/**
 * A token count as `812`, `52k`, `5.4M` or `8.3B`, or a dash for none.
 * The unit is the largest the count reaches, and the next one up when the
 * count rounds to a thousand of it, so `999,999` reads `1.0M` and never
 * `1000k`.
 */
export function formatTokens(value: number | null): string {
  if (value === null) return '-';
  const index = TOKEN_UNITS.reduce((held, [size], at) => (value >= size
    ? at
    : held), 0);
  const unit = TOKEN_UNITS[index] ?? [1, '', 0] as const;
  const next = TOKEN_UNITS[index + 1];
  const rounded = Number((value / unit[0]).toFixed(unit[2]));
  return next !== undefined && rounded >= THOUSAND
    ? inUnit(value, next)
    : inUnit(value, unit);
}

/** A share (0 to 1) as a whole percent, or a dash for none. */
export function formatShare(value: number | null): string {
  return value === null
    ? '-'
    : `${Math.round(value * 100)}%`;
}

/** A change in percent, signed, or a dash for none. */
export function formatChange(value: number | null): string {
  if (value === null) return '-';
  const rounded = Math.round(value);
  return rounded > 0
    ? `+${rounded}%`
    : `${rounded}%`;
}

/** Minutes as hours at one decimal. */
function formatHours(minutes: number): string {
  return (minutes / MINUTES_PER_HOUR).toFixed(1);
}

/** An ISO instant as `YYYY-MM-DD HH:MM`, UTC. */
function formatInstant(stamp: string): string {
  return `${stamp.slice(0, 10)} ${stamp.slice(11, 16)}`;
}

/** A metric's figure, written as its kind reads. */
function formatMetric(name: TrendMetricName, value: number | null): string {
  if (name === 'minutes') return formatMinutes(value);
  if (name === 'turns') {
    return value === null
      ? '-'
      : String(Math.round(value));
  }
  return formatTokens(value);
}

/** One metric row. */
function metricCells(metric: TrendMetric): string[] {
  return [
    METRIC_LABELS[metric.name],
    formatMetric(metric.name, metric.baselineP50),
    formatMetric(metric.name, metric.recentP50),
    formatChange(metric.changePct),
    formatMetric(metric.name, metric.baselineP90),
    formatMetric(metric.name, metric.recentP90),
  ];
}

/** One day row. */
function dayCells(day: TrendDay): string[] {
  return [
    day.day,
    String(day.sessions),
    formatMinutes(day.minutesP50),
    formatMinutes(day.minutesP90),
    formatMinutes(day.minutesMax),
    formatTokens(day.outputTokensP50),
    day.workHours.toFixed(1),
    String(day.loops),
  ];
}

/** The outlier lines: a heading, then two lines per session listed. */
function outlierLines(outliers: TrendSegment['outliers']): string[] {
  if (outliers.limitMinutes === null) return [];

  const lines = [
    '',
    `outliers: ${plural(outliers.sessions.length, 'recent session')} over ${formatMinutes(outliers.limitMinutes)} min`
    + ' (baseline median + 3 robust SD)',
  ];
  for (const session of outliers.sessions.slice(0, OUTLIERS_LISTED)) {
    lines.push(
      `  ${formatMinutes(session.minutes)} min  ${formatTokens(session.outputTokens)} out`
      + `  ${session.outcome ?? 'no report'}  ${session.loop}`,
      `    ${oneLine(session.taskText ?? '').slice(0, TASK_TEXT_CHARS)}`,
    );
  }
  if (outliers.sessions.length > OUTLIERS_LISTED) {
    lines.push(`  and ${outliers.sessions.length - OUTLIERS_LISTED} more in --output=json`);
  }
  return lines;
}

/** The trend segment's lines. */
export function formatTrendSegment(trend: TrendSegment): string[] {
  const { baseline, recent } = trend;
  if (baseline === null || recent === null) return ['TREND', '  no task session with a span is stored'];

  const lines = [
    'TREND',
    `  recent    ${recent.from} to ${recent.to}, ${plural(recent.sessions, 'task session')}`,
    `  baseline  ${baseline.from} to ${baseline.to}, ${plural(baseline.sessions, 'task session')}`,
    '',
    ...alignRows(
      ['per task', 'base p50', 'recent p50', 'change', 'base p90', 'recent p90'],
      [
        ...trend.metrics.map(metricCells),
        ['not done', formatShare(trend.notDoneShare.baseline), formatShare(trend.notDoneShare.recent), '', '', ''],
      ],
      new Set(['base p50', 'recent p50', 'change', 'base p90', 'recent p90']),
    ),
    '',
    ...alignRows(
      ['day', 'tasks', 'p50 min', 'p90 min', 'max min', 'p50 out', 'work-h', 'loops'],
      trend.days.map(dayCells),
      new Set(['tasks', 'p50 min', 'p90 min', 'max min', 'p50 out', 'work-h', 'loops']),
    ),
  ];
  return [...lines, ...outlierLines(trend.outliers)];
}

/** The per-task cells a loop row and a `--by` sub-row share. */
function perTaskCells(perTask: PerTask): string[] {
  return [
    formatMinutes(perTask.minutes.min),
    formatMinutes(perTask.minutes.max),
    formatMinutes(perTask.minutes.avg),
    formatMinutes(perTask.minutes.p50),
    formatTokens(perTask.outputTokens.avg),
    formatTokens(perTask.cacheReadTokens.avg),
    perTask.turns.avg === null
      ? '-'
      : String(Math.round(perTask.turns.avg)),
  ];
}

/** One loop row, then its `--by` sub-rows. */
function loopCells(row: LoopRow): string[][] {
  const main = [
    row.key,
    formatInstant(row.firstTimestamp),
    formatHours(row.wallMinutes),
    formatHours(row.workMinutes),
    String(row.tasks),
    ...perTaskCells(row.perTask),
    String(row.notDone),
    formatHistogram(row.efforts),
  ];
  const groups = (row.groups ?? []).map((group: LoopGroup) => [
    `  ${group.key}`,
    '',
    '',
    formatHours(group.workMinutes),
    String(group.tasks),
    ...perTaskCells(group.perTask),
    '',
    '',
  ]);
  return [main, ...groups];
}

/** One drift row. */
function driftCells(drift: LoopDrift): string[] {
  return [
    DRIFT_LABELS[drift.metric],
    drift.tau === null
      ? '-'
      : drift.tau.toFixed(2),
    drift.z === null
      ? '-'
      : drift.z.toFixed(2),
    drift.direction,
  ];
}

/** The loops segment's lines. */
export function formatLoopsSegment(loops: LoopsSegment): string[] {
  const selection = loops.loops === null
    ? `loops active in the last ${loops.days} days`
    : `the newest ${loops.loops} loops`;
  const split = loops.by === null
    ? ''
    : `, split by ${loops.by}`;
  const lines = ['', 'LOOPS', `  ${selection}, newest first${split}; times are UTC, minutes per task`];
  if (loops.rows.length === 0) return [...lines, '  no loop in the selection'];

  const columns = [
    'loop', 'started', 'wall-h', 'work-h', 'tasks', 'min', 'max', 'avg', 'p50',
    'avg out', 'avg cache-r', 'avg turns', 'not done', 'effort',
  ];
  const drift = loops.drift[0];
  return [
    ...lines,
    '',
    ...alignRows(columns, loops.rows.flatMap(loopCells), new Set(columns.slice(2, 13))),
    '',
    `  drift across ${drift?.n ?? 0} loops, oldest to newest (Mann-Kendall; rising or falling at |z| >= 1.96)`,
    ...alignRows(['metric', 'tau', 'z', 'reading'], loops.drift.map(driftCells), new Set(['tau', 'z']))
      .map((line) => `  ${line}`),
  ];
}

/** The whole report's lines: the header, then both segments. */
export function formatTrendReport(report: TrendReport): string[] {
  const anchor = report.trend.anchor;
  const header = anchor === null
    ? `effort report --trend: ${plural(report.taskSessions, 'task session')}`
    : `effort report --trend: ${plural(report.taskSessions, 'task session')}, newest ends ${formatInstant(anchor)} UTC`;
  return [header, '', ...formatTrendSegment(report.trend), ...formatLoopsSegment(report.loops)];
}
