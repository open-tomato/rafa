/**
 * Renders a rolled-up effort report as the lines `rafa effort report`
 * prints in table mode.
 *
 * Pure over an {@link EffortReport}: no store, no config and no clock
 * reach it, so `report.ts` decides every figure and this module decides
 * only how each one is written. The `--json` document does not pass
 * through here; the command serialises the report as it stands.
 *
 * The import back into `report.ts` is type-only, so the command module
 * importing {@link formatReport} forms no runtime cycle.
 *
 * A minute cell is written at one decimal place from a figure the
 * rollup already rounded to three, so the table rounds the JSON figure
 * again rather than deriving one of its own.
 */
import type { EffortGroup, EffortReport } from './report.js';

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

/** Pads one cell to a column width, on the side its alignment wants. */
function padCell(cell: string, width: number, right: boolean): string {
  const pad = ' '.repeat(Math.max(0, width - cell.length));
  return right
    ? `${pad}${cell}`
    : `${cell}${pad}`;
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
  const rows = [
    [...TABLE_COLUMNS],
    ...report.groups.map(groupCells),
    groupCells(report.totals),
  ];
  const widths = TABLE_COLUMNS.map((_column, index) => Math.max(
    ...rows.map((row) => (row[index] ?? '').length),
  ));

  return rows.map((row) => TABLE_COLUMNS
    .map((column, index) => padCell(
      row[index] ?? '',
      widths[index] ?? 0,
      RIGHT_ALIGNED.has(column),
    ))
    .join('  ')
    .trimEnd());
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

/** Everything the command prints in table mode. */
export function formatReport(report: EffortReport): string[] {
  return [...formatReportHeader(report), '', ...formatReportTable(report)];
}
