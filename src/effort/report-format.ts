/**
 * Renders a rolled-up effort report as the lines `rafa effort report`
 * prints in table mode: the per-plan session table, then, when any task
 * report is stored, the reports tallied by plan, status and outcome.
 *
 * Pure over an {@link EffortReport}: no store, no config and no clock
 * reach it, so `report.ts` decides every figure and this module decides
 * only how each one is written. The JSON document, json mode's result or
 * the indented text `--json` writes outside the dispatcher, does not pass
 * through here; the command hands on the report as it stands.
 *
 * The import back into `report.ts` is type-only, so the command module
 * importing {@link formatReport} forms no runtime cycle.
 *
 * A minute cell is written at one decimal place from a figure the
 * rollup already rounded to three, so the table rounds the JSON figure
 * again rather than deriving one of its own.
 */
import type { EffortGroup, EffortReport } from './report.js';
import type { TaskReportTally } from './store/reports.js';

/** Decimal places a formatted minute figure carries in the table. */
const TABLE_MINUTE_DECIMALS = 1;

/** A count with thousands separators, locale-independently. */
export function formatCount(value: number): string {
  return String(Math.trunc(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Minutes for the table, or a dash when there is no span. */
export function formatMinutes(value: number | null): string {
  return value === null
    ? '-'
    : value.toFixed(TABLE_MINUTE_DECIMALS);
}

/**
 * A histogram as `key=count` pairs, commonest first.
 *
 * Ties break on the key, so the string is stable across runs and can
 * be asserted verbatim. An empty histogram renders as a dash rather
 * than as nothing, which keeps a column from looking truncated.
 */
export function formatHistogram(counts: Record<string, number>): string {
  const entries = Object.entries(counts).sort((a, b) => {
    if (a[1] !== b[1]) return b[1] - a[1];
    return a[0] < b[0]
      ? -1
      : 1;
  });
  return entries.length === 0
    ? '-'
    : entries.map(([key, count]) => `${key}=${count}`).join(' ');
}

/** The table's columns, in order. */
const TABLE_COLUMNS = [
  'plan / branch',
  'kind',
  'sessions',
  'turns',
  'input',
  'output',
  'cache-r',
  'cache-w',
  'work-min',
  'span-min',
  'models',
  'effort',
] as const;

/** Columns rendered right-aligned; the rest are left-aligned. */
const RIGHT_ALIGNED: ReadonlySet<string> = new Set([
  'sessions',
  'turns',
  'input',
  'output',
  'cache-r',
  'cache-w',
  'work-min',
  'span-min',
]);

/** The task report table's columns, in order. */
const TASK_REPORT_COLUMNS = ['plan', 'status', 'outcome', 'reports'] as const;

/** The task report columns rendered right-aligned. */
const TASK_REPORT_RIGHT_ALIGNED: ReadonlySet<string> = new Set(['reports']);

/** Written for a tally of reports dispatched under no plan. */
const NO_PLAN_CELL = '(no plan)';

/** Written for a tally of reports that gave no usable status. */
const NO_STATUS_CELL = '-';

/** One group as its table cells, in {@link TABLE_COLUMNS} order. */
function groupCells(group: EffortGroup): string[] {
  return [
    group.key,
    group.kind,
    formatCount(group.sessions),
    formatCount(group.assistantTurns),
    formatCount(group.inputTokens),
    formatCount(group.outputTokens),
    formatCount(group.cacheReadTokens),
    formatCount(group.cacheWriteTokens),
    formatMinutes(group.workMinutes),
    formatMinutes(group.spanMinutes),
    formatHistogram(group.models),
    formatHistogram(group.efforts),
  ];
}

/** One tally as its table cells, in {@link TASK_REPORT_COLUMNS} order. */
function tallyCells(tally: TaskReportTally): string[] {
  return [
    tally.planStub ?? NO_PLAN_CELL,
    tally.status ?? NO_STATUS_CELL,
    tally.outcome,
    formatCount(tally.reports),
  ];
}

/** Pads one cell to a column width, on the side its alignment wants. */
function padCell(cell: string, width: number, right: boolean): string {
  const pad = ' '.repeat(Math.max(0, width - cell.length));
  return right
    ? `${pad}${cell}`
    : `${cell}${pad}`;
}

/**
 * A header row and its data rows as space-padded columns two spaces
 * apart, each column as wide as its widest cell, header included, and
 * every line trimmed of trailing whitespace.
 */
function alignRows(
  columns: readonly string[],
  rows: readonly (readonly string[])[],
  rightAligned: ReadonlySet<string>,
): string[] {
  const table = [columns, ...rows];
  const widths = columns.map((_column, index) => Math.max(
    ...table.map((row) => (row[index] ?? '').length),
  ));

  return table.map((row) => columns
    .map((column, index) => padCell(
      row[index] ?? '',
      widths[index] ?? 0,
      rightAligned.has(column),
    ))
    .join('  ')
    .trimEnd());
}

/**
 * Renders the report as an aligned table.
 *
 * Space-padded columns and no pipes at all, which is deliberate: a
 * bare `|` inside a cell splits a markdown table row silently, and a
 * histogram cell here is assembled from model names nobody in this
 * repo controls. A table that cannot be pasted into markdown is a
 * smaller problem than one that renders wrong when it is.
 *
 * Trailing whitespace is trimmed from every line, so a short last
 * column cannot leave a ragged right edge in a captured diff.
 */
export function formatReportTable(report: EffortReport): string[] {
  const rows = [...report.groups.map(groupCells), groupCells(report.totals)];
  return alignRows(TABLE_COLUMNS, rows, RIGHT_ALIGNED);
}

/** The lines describing what was read and what was filtered out. */
export function formatReportHeader(report: EffortReport): string[] {
  const kinds = report.filters.kinds;
  const entrypoints = report.filters.entrypoints;
  const included = report.rowsRead - report.rowsExcluded;
  const lines = [
    `effort report: ${included} of ${report.rowsRead} session rows`
    + `, ${report.groups.length} groups`,
  ];

  if (kinds !== null) lines.push(`  kind        ${kinds.join(', ')}`);
  if (entrypoints !== null) {
    lines.push(`  entrypoint  ${entrypoints.join(', ')}`);
  }
  if (report.totals.sessionsWithoutSpan > 0) {
    lines.push(
      `  note        ${report.totals.sessionsWithoutSpan} sessions`
      + ' contributed no span',
    );
  }
  if (report.totals.sessionsWithoutEffort > 0) {
    lines.push(
      `  note        ${report.totals.sessionsWithoutEffort} rows predate`
      + ' the effort field',
    );
  }
  return lines;
}

/**
 * The task report section: a blank line, a heading counting the stored
 * reports, and one row per plan, status and outcome, the report's status
 * beside the loop's outcome so a row where the two differ reads as one.
 *
 * Nothing at all when no report is stored, so a store holding none
 * prints what it printed before the table existed. A report narrowed by
 * `--kind` or `--entrypoint` gets a note under the heading, because the
 * tallies are not narrowed and a table that looked filtered would
 * misstate what it counts.
 */
export function formatTaskReports(report: EffortReport): string[] {
  const tallies = report.taskReports;
  if (tallies.length === 0) return [];

  const stored = tallies.reduce((sum, tally) => sum + tally.reports, 0);
  const lines = ['', `task reports: ${formatCount(stored)} stored, by plan, status and outcome`];
  if (report.filters.kinds !== null || report.filters.entrypoints !== null) {
    lines.push('  note        the filters narrow session rows, not task reports');
  }
  const rows = tallies.map(tallyCells);
  return [...lines, ...alignRows(TASK_REPORT_COLUMNS, rows, TASK_REPORT_RIGHT_ALIGNED)];
}

/** Everything the command prints in table mode. */
export function formatReport(report: EffortReport): string[] {
  return [
    ...formatReportHeader(report),
    '',
    ...formatReportTable(report),
    ...formatTaskReports(report),
  ];
}
