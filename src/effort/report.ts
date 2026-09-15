/**
 * Rolls the stored session rows up into per-plan totals.
 *
 * The collector answers one row per session; this answers one row per
 * PLAN, which is the unit a cost question is actually asked in. It
 * reads the config, the store the config selects and the task reports
 * the loop stored, and nothing else — no log, no clock — so a report is
 * a pure projection of rows already on disk and two runs over an
 * unchanged store produce identical bytes.
 *
 * ## Which store it reads
 *
 * The one `rafa effort collect` writes. Both resolve it the same way,
 * `loadConfig` over the repo root and the home, then `selectEffortStore`
 * over the resolved config, so under the `sqlite` default a report reads
 * `effort.sqlite` and under `store: ndjson` the sessions file. A report
 * reading one backend's file directly reads nothing right after a
 * successful collect into the other, and says nothing was collected.
 * {@link ReportOptions.store} is the seam for a caller that already
 * holds a store, and a store passed there means the config is not read.
 *
 * A config the loop cannot run on is refused as the collect command
 * refuses it: {@link buildReport} throws the `ConfigError`, and the
 * command refuses with exit code 1, one line per problem. A warning about
 * an unknown key goes through `loadConfig`'s default sink, the active
 * output's `warn`, so in json mode it is a `log` event of its own and the
 * report stays whole in the terminal result.
 *
 * ## Task reports beside the sessions
 *
 * {@link EffortReport.taskReports} is read from the `task_reports`
 * table, tallied by plan, by the report's `status` and by the loop's
 * outcome (`store/reports.ts`). The table sits in the SQLite file
 * whichever backend `store` selects, so it is read under the repo root
 * even when {@link ReportOptions.store} passes a store. A tally whose
 * status and outcome differ counts sessions whose claim the loop did
 * not take: a `done` beside a listed blocker, a commit git refused, a
 * nonzero exit. The filters do not narrow the tallies, because a task
 * report carries neither a kind nor an entrypoint to test them on, and
 * the table printed under a filter says so.
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
import type { ConfigRoots } from '../config-load.js';
import type { TaskReportTally } from './store/reports.js';
import type { EffortStore } from './store/types.js';

import { homedir } from 'node:os';

import { activeOutput, activeOutputMode } from '../adapters/output/active.js';
import { CommandExit } from '../cli/command.js';
import { loadConfig } from '../config-load.js';
import { ConfigError } from '../config.js';

import { PROMPT_SHAPES } from './classify.js';
import { minutesBetween } from './commits.js';
import { formatReport, formatTaskReports } from './report-format.js';
import { selectEffortStore } from './store/index.js';
import { readTaskReportTallies } from './store/reports.js';

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
  /**
   * The stored task reports, one tally per plan, status and outcome.
   * The filters do not narrow them; see the module note.
   */
  taskReports: readonly TaskReportTally[];
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
  /** The project root, with no default. Governs the config and the store. */
  repoRoot: string;
  /**
   * The home the user scope's config is read under. No default: the
   * command passes `homedir()`, so a caller cannot reach the real home by
   * leaving it out. Unread when a store is passed.
   */
  home: string;
  /**
   * The store the session rows are read from. Defaults to the backend
   * the config under the repo root and the home selects; a store passed
   * here means neither file is read. See the module note.
   */
  store?: EffortStore;
  kinds?: readonly SessionKind[] | null;
  entrypoints?: readonly string[] | null;
}

/**
 * Widens stored rows to the shape this module reads.
 *
 * The body is an assignment and the assignment is the point: it is a
 * compile-time assertion that {@link SessionEffortRow} still satisfies
 * {@link ReportSessionRow}, so a field renamed on the stored row reds
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
 * planted row needs no store, no log and no repository. `taskReports`
 * is carried into the report as it is handed in, never filtered.
 */
export function summariseSessions(
  rows: readonly ReportSessionRow[],
  filters: ReportFilters = { kinds: null, entrypoints: null },
  taskReports: readonly TaskReportTally[] = [],
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
    taskReports,
  };
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
 * The store a report reads: the one passed, else the one the config
 * under `roots` selects, resolved as `rafa effort collect` resolves its
 * own.
 *
 * Throws a `ConfigError` when the config is one the loop cannot run on.
 */
function resolveStore(
  store: EffortStore | undefined,
  roots: ConfigRoots,
): EffortStore {
  if (store !== undefined) return store;

  const resolved = loadConfig(roots);
  return selectEffortStore(roots.root, resolved.config);
}

/**
 * Reads the session rows of the selected store and the task report
 * tallies under the repo root, and rolls the rows up.
 *
 * A missing store answers an EMPTY report rather than throwing — every
 * backend answers absence as the first-run case — so the command below
 * is what says "nothing collected yet" in words, which is the one thing
 * a table of zeroes cannot convey. A missing SQLite file answers no
 * tallies the same way.
 *
 * Throws a `ConfigError`, having read no row, when no store is passed
 * and a config file under the repo root or the home is one the loop
 * cannot run on.
 */
export function buildReport(options: ReportOptions): EffortReport {
  const { repoRoot } = options;
  const store = resolveStore(options.store, { root: repoRoot, home: options.home });

  return summariseSessions(
    asReportRows(store.read('sessions')),
    {
      kinds: options.kinds ?? null,
      entrypoints: options.entrypoints ?? null,
    },
    readTaskReportTallies(repoRoot),
  );
}

/** Refuses the run with exit code 1, its message one line per refusal. */
function refuse(problems: readonly string[]): never {
  throw new CommandExit(1, problems.map((problem) => `ralph effort report: ${problem}`).join('\n'));
}

/**
 * `ralph effort report` — the command entry, over `repoRoot`, the project
 * root the dispatcher resolved (`src/commands/wrap.ts`).
 *
 * Writes through the active output (`adapters/output/active.ts`), in the
 * mode the dispatcher set beside it. In json mode the report is the
 * command's result, the `data` of the invocation's terminal result event.
 * In text mode each table line goes at `info`, and `--json` writes the
 * report as JSON indented by two spaces through one `info` line, the
 * bytes phase 0 printed. The dispatcher reads `--json` as `--output=json`
 * (`src/commands/effort/report.ts`), so text mode meets `--json` only
 * when this entry is called directly, as `effortReportCommand` is.
 *
 * Refuses by throwing `CommandExit` with exit code 1 and the refusal as
 * its message, one line per problem, and neither sets `process.exitCode`
 * nor calls `process.exit`: the dispatcher is the one place that sets
 * the exit code. It writes the message to stderr in text mode, the bytes
 * this command printed there before, and carries it in the terminal
 * result in json mode.
 *
 * A config the loop cannot run on is refused, one line per problem, the
 * way a bad argument is and the way `rafa effort collect` refuses it.
 * Anything else thrown is a fault rather than a refusal, and is rethrown.
 */
export default async function report(args: string[], repoRoot: string): Promise<void> {
  const parsed = parseReportArgs(args);
  if (parsed.errors.length > 0) refuse(parsed.errors);

  let built: EffortReport;
  try {
    built = buildReport({
      repoRoot,
      home: homedir(),
      kinds: parsed.kinds,
      entrypoints: parsed.entrypoints,
    });
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    refuse(error.problems);
  }
  const output = activeOutput();
  if (activeOutputMode() === 'json') {
    output.result(built);
    return;
  }
  if (parsed.json) {
    output.info(JSON.stringify(built, null, 2));
    return;
  }
  if (built.rowsRead === 0) {
    output.info('effort report: no session rows stored yet'
      + ' (run `ralph effort collect` first)');
    for (const line of formatTaskReports(built)) output.info(line);
    return;
  }
  for (const line of formatReport(built)) {
    output.info(line);
  }
}
