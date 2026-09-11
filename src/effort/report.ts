/**
 * Rolls the stored session rows up into per-plan totals.
 *
 * The collector answers one row per session; this answers one row per
 * PLAN, which is the unit a cost question is actually asked in. It
 * reads the store and nothing else — no log, no repository, no clock —
 * so a report is a pure projection of rows already on disk and two
 * runs over an unchanged store produce identical bytes.
 *
 * ## What a group is keyed on
 *
 * A session's plan stub when attribution resolved one, and its BRANCH
 * otherwise. The fallback is not cosmetic: measured over the live
 * tree, only six of eleven plan-driven branches name their plan
 * exactly, five reach it through the leading queue id alone, and five
 * more carry a stub no plan answers to — so the largest bucket in the
 * tree routinely has no plan to name. Folding those into one
 * catch-all would hide the biggest number in the report behind the
 * word `unknown`.
 *
 * {@link EffortGroup.kind} is what keeps the two readable apart, and
 * it is a column rather than a footnote: a `branch` group is sessions
 * that ran somewhere, not a plan that cost that much. The two never
 * merge even when the strings coincide, because the accumulator keys
 * on the kind and the name together and only the name is displayed.
 *
 * ## Two minute columns, because they answer different questions
 *
 * {@link EffortGroup.workMinutes} sums each session's own span. It is
 * work done, and it is NOT elapsed time: sessions overlap whenever a
 * subagent runs or two legs run at once, so the sum can exceed the
 * wall clock it was taken from.
 *
 * {@link EffortGroup.spanMinutes} is the group's earliest record to
 * its latest. That IS elapsed time, and it is not work done: a plan
 * left overnight between two tasks carries the gap.
 *
 * Reporting either alone invites the other's reading. Both are here,
 * and a session whose timestamps are missing or unparseable is
 * COUNTED in {@link EffortGroup.sessionsWithoutSpan} rather than
 * contributing a silent zero to the first.
 *
 * ## The effort histogram is currently one-valued, on purpose
 *
 * Rolled up over the whole live tree at one reading, this column
 * answers `xhigh` and nothing else, on every group. The figures move
 * with every run and the SHAPE does not, so treat a quoted total as a
 * snapshot: what matters is that there is no second key anywhere yet.
 * That is the BASELINE this column exists to move — a task
 * declaration asking for a cheaper level lands here as a second key,
 * and no other artifact in the repo records what a dispatched session
 * actually ran at. The declaration says what was asked for; this says
 * what ran.
 *
 * A row written before the collector read that field carries no
 * histogram at all, which is a different statement from an empty one.
 * The two are kept apart: {@link EffortGroup.sessionsWithoutEffort}
 * counts rows with no field, so an all-zero effort column reads as
 * "the store predates it" or "nothing declared one" rather than being
 * ambiguous between them.
 *
 * ## Filters
 *
 * `--kind` and `--entrypoint` both narrow the ROW SET, and the row is
 * the finest unit there is — its counters are not split by either, so
 * a session that changed entrypoint mid-run is included or excluded
 * whole. The entrypoint test is therefore taken on the DOMINANT one,
 * which makes the filter a partition rather than an overlapping
 * predicate, and mirrors how attribution already reduces the branch
 * histogram to one name.
 *
 * The filter matters more than a convenience flag: this repo's
 * traffic is not one model and not one entrypoint, so a report over
 * the whole directory mixes hand-driven and measurement sessions into
 * the loop's own numbers and shows a model spread the loop never
 * chose. `--entrypoint=sdk-cli` is the reading that is about the loop.
 *
 * ## Rounding
 *
 * Minutes come from {@link minutesBetween}, so this module and the
 * commit collector round the same way from one place. A group's
 * `workMinutes` is the sum of ALREADY-ROUNDED session spans rather
 * than a re-derivation, which is what makes the column add up when a
 * reader checks it against the sessions beneath it.
 */
import type { SessionKind } from './classify.js';
import type { SessionEffortRow } from './collect.js';
import type { SessionUsageTotals } from './session-log.js';

import { getRepoRoot } from '../utils/git.js';

import { PROMPT_SHAPES } from './classify.js';
import { minutesBetween } from './commits.js';
import { effortStorePath, readStoreRows } from './store.js';

/** Decimal places a formatted minute figure carries in the table. */
const TABLE_MINUTE_DECIMALS = 1;

/** Decimal places a summed minute figure is re-rounded to. */
const SUM_MINUTE_DECIMALS = 3;

/** Separates kind from name in the accumulator's composite key. */
const GROUP_KEY_SEPARATOR = ' ';

/** Displayed for a group whose sessions carried no branch at all. */
const UNATTRIBUTED_KEY = '(no branch)';

/** The totals row's displayed key. */
const TOTAL_KEY = 'TOTAL';

/** Every kind a session can classify as, derived not transcribed. */
export const SESSION_KINDS: readonly SessionKind[] = [
  ...PROMPT_SHAPES.map((shape) => shape.kind),
  'other',
];

/** How a group got its name. `total` is the summary row alone. */
export type GroupKind = 'plan' | 'branch' | 'unattributed' | 'total';

/** The three a session row can actually produce. */
export type SessionGroupKind = Exclude<GroupKind, 'total'>;

/**
 * The fields a report reads.
 *
 * Deliberately narrower than the stored row: a report that named the
 * whole row would have to be edited every time the collector widened
 * one, and a test would have to plant thirty fields to exercise three.
 * {@link asReportRows} is where the two are held together.
 *
 * `effortCounts` is OPTIONAL here and required on the stored row,
 * which is the one difference that is not narrowing — a store written
 * before the collector read that field has rows without it, and an
 * append-only store never rewrites what it holds.
 */
export interface ReportSessionRow {
  sessionId: string;
  planStub: string | null;
  branch: string | null;
  kind: SessionKind;
  assistantRecordCount: number;
  firstTimestamp: string | null;
  lastTimestamp: string | null;
  entrypointCounts: Record<string, number>;
  modelCounts: Record<string, number>;
  effortCounts?: Record<string, number>;
  usage: SessionUsageTotals;
}

/** One plan's, or one branch's, totals. */
export interface EffortGroup {
  /** Plan stub, branch name, or the unattributed label. */
  key: string;
  kind: GroupKind;
  /** The resolved plan stub, or null for every other kind. */
  planStub: string | null;
  sessions: number;
  assistantTurns: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** The four above, summed. What the ordering is taken on. */
  totalTokens: number;
  /** Sum of each session's own span. Work done, not elapsed time. */
  workMinutes: number;
  /** Earliest record to latest. Elapsed time, not work done. */
  spanMinutes: number | null;
  firstTimestamp: string | null;
  lastTimestamp: string | null;
  /** Sessions contributing no span, so a zero is never silent. */
  sessionsWithoutSpan: number;
  /** Rows whose store entry predates the effort field entirely. */
  sessionsWithoutEffort: number;
  models: Record<string, number>;
  efforts: Record<string, number>;
}

/** What a report was narrowed to. Null means everything. */
export interface ReportFilters {
  kinds: readonly SessionKind[] | null;
  entrypoints: readonly string[] | null;
}

/** One rollup. */
export interface EffortReport {
  groups: EffortGroup[];
  /** Every included row folded into one, whatever it grouped as. */
  totals: EffortGroup;
  /** Rows handed in. */
  rowsRead: number;
  /** Rows a filter removed. `rowsRead - rowsExcluded` were folded. */
  rowsExcluded: number;
  filters: ReportFilters;
}

/** What the parsed argv asked for. */
export interface ReportArgs {
  json: boolean;
  kinds: readonly SessionKind[] | null;
  entrypoints: readonly string[] | null;
  /** Every refusal, so all of them are reported and not just the first. */
  errors: string[];
}

/** Where a report reads from and what it narrows to. */
export interface ReportOptions {
  /** Defaults to the git repo root. Governs the store path. */
  repoRoot?: string;
  kinds?: readonly SessionKind[] | null;
  entrypoints?: readonly string[] | null;
}

/**
 * Widens stored rows to the shape this module reads.
 *
 * The body is an assignment and the assignment is the point: it is a
 * compile-time assertion that {@link SessionEffortRow} still satisfies
 * {@link ReportSessionRow}, so a field renamed on the collector reds
 * `check-types` here rather than producing a report of zeroes. Putting
 * it in a test would prove nothing — this repo's root tsconfig
 * excludes `*.test.ts`, so a type-level claim in one is never checked.
 */
export function asReportRows(
  rows: readonly SessionEffortRow[],
): readonly ReportSessionRow[] {
  return rows;
}

/** A fresh zeroed group. No two groups ever share a histogram. */
export function emptyGroup(
  key: string,
  kind: GroupKind,
  planStub: string | null = null,
): EffortGroup {
  return {
    key,
    kind,
    planStub,
    sessions: 0,
    assistantTurns: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    workMinutes: 0,
    spanMinutes: null,
    firstTimestamp: null,
    lastTimestamp: null,
    sessionsWithoutSpan: 0,
    sessionsWithoutEffort: 0,
    models: {},
    efforts: {},
  };
}

/**
 * One session's span in minutes, or null when it has none.
 *
 * Null rather than zero on purpose: a session with one record and a
 * session whose timestamps did not parse are both spanless, and only
 * a null can be counted separately from a session that genuinely ran
 * for no measurable time.
 */
export function sessionSpanMinutes(row: ReportSessionRow): number | null {
  const first = row.firstTimestamp;
  const last = row.lastTimestamp;
  if (first === null || last === null) return null;

  return minutesBetween(first, last);
}

/**
 * The entrypoint most of a session's records carried.
 *
 * Ties break on the name so the answer is deterministic; a session
 * with no entrypoint at all answers null and is excluded by any
 * entrypoint filter rather than silently passing it.
 */
export function dominantEntrypoint(row: ReportSessionRow): string | null {
  let best: string | null = null;
  let bestCount = 0;

  for (const [name, count] of Object.entries(row.entrypointCounts)) {
    const wins = count > bestCount
      || (count === bestCount && best !== null && name < best);
    if (!wins) continue;

    best = name;
    bestCount = count;
  }
  return best;
}

/** How one row groups: its plan, else its branch, else neither. */
export function groupKeyOf(
  row: ReportSessionRow,
): { key: string; kind: SessionGroupKind } {
  const plan = row.planStub;
  if (plan !== null && plan.length > 0) return { key: plan, kind: 'plan' };

  const branch = row.branch;
  if (branch !== null && branch.length > 0) {
    return { key: branch, kind: 'branch' };
  }
  return { key: UNATTRIBUTED_KEY, kind: 'unattributed' };
}

/** Whether a row survives the filters. Both are AND-ed. */
export function matchesFilters(
  row: ReportSessionRow,
  filters: ReportFilters,
): boolean {
  const kinds = filters.kinds;
  if (kinds !== null && !kinds.includes(row.kind)) return false;

  const entrypoints = filters.entrypoints;
  if (entrypoints === null) return true;

  const entrypoint = dominantEntrypoint(row);
  return entrypoint !== null && entrypoints.includes(entrypoint);
}

/** Adds one histogram into another, in place. */
function mergeHistogram(
  target: Record<string, number>,
  source: Record<string, number> | undefined,
): void {
  if (source === undefined) return;

  for (const [key, count] of Object.entries(source)) {
    target[key] = (target[key] ?? 0) + count;
  }
}

/** The instant of an ISO stamp, or null when it does not parse. */
function instantOf(stamp: string | null): number | null {
  if (stamp === null) return null;

  const epoch = Date.parse(stamp);
  return Number.isNaN(epoch)
    ? null
    : epoch;
}

/** Widens a group's span to cover one row's timestamps. */
function widenSpan(group: EffortGroup, row: ReportSessionRow): void {
  const first = instantOf(row.firstTimestamp);
  const held = instantOf(group.firstTimestamp);
  if (first !== null && (held === null || first < held)) {
    group.firstTimestamp = row.firstTimestamp;
  }

  const last = instantOf(row.lastTimestamp);
  const latest = instantOf(group.lastTimestamp);
  if (last !== null && (latest === null || last > latest)) {
    group.lastTimestamp = row.lastTimestamp;
  }
}

/** Folds one row into one group, in place. */
function addRow(group: EffortGroup, row: ReportSessionRow): void {
  const usage = row.usage;

  group.sessions += 1;
  group.assistantTurns += row.assistantRecordCount;
  group.inputTokens += usage.inputTokens;
  group.outputTokens += usage.outputTokens;
  group.cacheReadTokens += usage.cacheReadInputTokens;
  group.cacheWriteTokens += usage.cacheCreationInputTokens;
  group.totalTokens += usage.inputTokens
    + usage.outputTokens
    + usage.cacheReadInputTokens
    + usage.cacheCreationInputTokens;

  const minutes = sessionSpanMinutes(row);
  if (minutes === null) {
    group.sessionsWithoutSpan += 1;
  } else {
    group.workMinutes += minutes;
  }
  if (row.effortCounts === undefined) group.sessionsWithoutEffort += 1;

  widenSpan(group, row);
  mergeHistogram(group.models, row.modelCounts);
  mergeHistogram(group.efforts, row.effortCounts);
}

/**
 * Closes a group: rounds the accumulated minutes and derives the span.
 *
 * The rounding is re-applied because a sum of values already rounded
 * to three places is still a binary float, and leaving it would put a
 * `12.300000000000001` into the JSON a close-out quotes.
 */
function finishGroup(group: EffortGroup): EffortGroup {
  const first = group.firstTimestamp;
  const last = group.lastTimestamp;

  group.workMinutes = Number(group.workMinutes.toFixed(SUM_MINUTE_DECIMALS));
  group.spanMinutes = first === null || last === null
    ? null
    : minutesBetween(first, last);
  return group;
}

/**
 * Orders groups by spend, descending, ties broken by name then kind.
 *
 * Total tokens rather than sessions: the question a cost report is
 * opened for is where the money went, and a plan of three expensive
 * sessions outranks one of thirty cheap ones.
 */
export function sortGroups(groups: readonly EffortGroup[]): EffortGroup[] {
  return [...groups].sort((a, b) => {
    if (a.totalTokens !== b.totalTokens) return b.totalTokens - a.totalTokens;
    if (a.key !== b.key) {
      return a.key < b.key
        ? -1
        : 1;
    }
    if (a.kind === b.kind) return 0;
    return a.kind < b.kind
      ? -1
      : 1;
  });
}

/**
 * Rolls rows up into the report.
 *
 * Pure over its inputs, which is the seam the whole suite drives: a
 * planted row needs no store, no log and no repository.
 */
export function summariseSessions(
  rows: readonly ReportSessionRow[],
  filters: ReportFilters = { kinds: null, entrypoints: null },
): EffortReport {
  const groups = new Map<string, EffortGroup>();
  const totals = emptyGroup(TOTAL_KEY, 'total');
  let rowsExcluded = 0;

  for (const row of rows) {
    if (!matchesFilters(row, filters)) {
      rowsExcluded += 1;
      continue;
    }

    const grouping = groupKeyOf(row);
    const mapKey = `${grouping.kind}${GROUP_KEY_SEPARATOR}${grouping.key}`;
    const held = groups.get(mapKey);
    const group = held ?? emptyGroup(
      grouping.key,
      grouping.kind,
      grouping.kind === 'plan'
        ? grouping.key
        : null,
    );
    if (held === undefined) groups.set(mapKey, group);

    addRow(group, row);
    addRow(totals, row);
  }

  return {
    groups: sortGroups([...groups.values()].map(finishGroup)),
    totals: finishGroup(totals),
    rowsRead: rows.length,
    rowsExcluded,
    filters,
  };
}

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

/** Splits a comma-separated flag value into its members. */
function splitList(raw: string): string[] {
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** Narrows a string to a session kind, or null when it is not one. */
function asSessionKind(value: string): SessionKind | null {
  return SESSION_KINDS.find((kind) => kind === value) ?? null;
}

/**
 * Parses the report argv.
 *
 * Every refusal is collected rather than thrown at the first, and an
 * unrecognised argument IS a refusal: a mistyped `--entrypint=sdk-cli`
 * that parsed as "no filter" would print the whole directory's traffic
 * under a command line that reads like the loop's own.
 *
 * A repeated flag UNIONS rather than replacing, because both of these
 * take a set and `--kind=task --kind=wrap-up` has one obvious meaning.
 */
export function parseReportArgs(args: readonly string[]): ReportArgs {
  const errors: string[] = [];
  const kinds: SessionKind[] = [];
  const entrypoints: string[] = [];
  let json = false;

  for (const arg of args) {
    if (arg === '--json') {
      json = true;
    } else if (arg === '--kind' || arg === '--entrypoint') {
      errors.push(`${arg} takes a value, as ${arg}=<value>`);
    } else if (arg.startsWith('--kind=')) {
      for (const value of splitList(arg.slice('--kind='.length))) {
        const kind = asSessionKind(value);
        if (kind === null) {
          errors.push(
            `--kind value is not a session kind: ${value}`
            + ` (one of ${SESSION_KINDS.join(', ')})`,
          );
        } else if (!kinds.includes(kind)) {
          kinds.push(kind);
        }
      }
    } else if (arg.startsWith('--entrypoint=')) {
      for (const value of splitList(arg.slice('--entrypoint='.length))) {
        if (!entrypoints.includes(value)) entrypoints.push(value);
      }
    } else {
      errors.push(`unrecognised argument: ${arg}`);
    }
  }

  return {
    json,
    kinds: kinds.length === 0
      ? null
      : kinds,
    entrypoints: entrypoints.length === 0
      ? null
      : entrypoints,
    errors,
  };
}

/**
 * Reads the store and rolls it up.
 *
 * A missing store answers an EMPTY report rather than throwing —
 * {@link readStoreRows} already treats absence as the first-run case —
 * so the command below is what says "nothing collected yet" in words,
 * which is the one thing a table of zeroes cannot convey.
 */
export function buildReport(options: ReportOptions = {}): EffortReport {
  const repoRoot = options.repoRoot ?? getRepoRoot();
  const stored = readStoreRows<SessionEffortRow>(
    effortStorePath(repoRoot, 'sessions'),
  );

  return summariseSessions(asReportRows(stored.rows), {
    kinds: options.kinds ?? null,
    entrypoints: options.entrypoints ?? null,
  });
}

/**
 * `ralph effort report` — the command entry.
 *
 * Sets `process.exitCode` rather than calling `process.exit`, so the
 * function is drivable from a test and a caller's output is not
 * truncated mid-flush.
 */
export default async function report(args: string[]): Promise<void> {
  const parsed = parseReportArgs(args);
  if (parsed.errors.length > 0) {
    for (const error of parsed.errors) {
      console.error(`ralph effort report: ${error}`);
    }
    process.exitCode = 1;
    return;
  }

  const built = buildReport({
    kinds: parsed.kinds,
    entrypoints: parsed.entrypoints,
  });
  if (parsed.json) {
    console.log(JSON.stringify(built, null, 2));
    return;
  }
  if (built.rowsRead === 0) {
    console.log('effort report: no session rows stored yet'
      + ' (run `ralph effort collect` first)');
    return;
  }
  for (const line of formatReport(built)) {
    console.log(line);
  }
}
