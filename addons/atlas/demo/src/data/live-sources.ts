/**
 * The live source's metrics past the PoC cut: the git, board, module and
 * GitHub metrics of phase 4, the minutes per agent and the metrics of
 * the out-of-scope tile, the task pile and work done, asked of the
 * Atlas API and mapped into the fields `SOURCE_METRIC_FIELDS` names. `live.ts` imports this module and
 * lays its fields over the PoC ones; the measured workspace of
 * `composition.ts` and `graph.ts` stays the mock page's.
 *
 * - `dev.deploys-per-week` fills `deploysPerWeek`, one count per ISO
 *   week of the series window, 0 for a week with no release tag.
 * - `arch.loc-per-module` fills `modules`, one treemap tile per module
 *   folder, grouped by the folder it sits in; `arch.coupling` fills the
 *   members and edges of `workspace`, one node per module and one edge per
 *   `@open-tomato` import of another module's package, dependency to
 *   dependent as `graph.ts` draws them. `arch.composition` fills the
 *   package composition, the rose and the sunburst of `workspace`, and
 *   `arch.import-flow` its Sankey, its layer columns and their tones;
 *   their mappers live in `live-architecture.ts`. All three fill the one
 *   `workspace` field, listed once in `SOURCE_WIRED_FIELDS`, and its meta
 *   is `arch.coupling`'s, the first of them; the rose, the sunburst and
 *   the Sankey each keep their own metric's meta in `workspaceMeta`
 *   (`WORKSPACE_CARD_METRICS`), which their live notes read.
 * - `dev.wip` fills `wip`, its count against the metric's `goal`, which
 *   `withAtlasTargets` lays over it from `wipLimit` (null with none).
 * - `qa.bug-outcome-by-loop-start` fills `bugOutcomeByLoopStart`: each
 *   plan's bugs, dated by the plan's `first_at` in `local.plans`, which
 *   one row query over the series window reads, so a plan that started
 *   outside the range, or that `local.plans` does not hold, adds nothing.
 * - `qa.resolution-time` fills `resolutionByPriority`, a box per priority
 *   of the days from open to close; `qa.open-bugs-per-day` fills
 *   `openBugsPerDay`, the bugs open at the end of each day of the series
 *   window. Both are GitHub-only (`feasibility` `gh`): an answer with no
 *   row means the replica was built without `--github`, so
 *   `githubPendingOf` names their fields and the card draws "not wired
 *   yet" with `GITHUB_NOT_READ`, the build line that fills them.
 * - `pm.minutes-per-agent` fills `minutesPerAgent`, the task session
 *   minutes of each agent over the series window, the most first, a
 *   session naming no agent as `NO_AGENT`.
 * - `qa.defect-density` fills `defectDensity`, the bugs per 1,000 lines
 *   over the module folders that hold code: a folder with no line left
 *   (one a bug's path names but the tree no longer holds) adds neither
 *   its bugs nor its lines.
 * - `pm.out-of-scope-per-week` fills `scopeCreepPerWeek` and
 *   `scopeCreepAverage`, `pm.task-pile` fills `taskPileTree` (GitHub-only,
 *   so a replica built without `--github` draws `GITHUB_NOT_READ`) and
 *   `dev.work-done` fills `workDoneTree`; their mappers live in
 *   `live-cards.ts`.
 *
 * Every metric but deploys, resolution, the minutes per agent, the
 * out-of-scope entries and work done is asked with no window:
 * `local.modules` (coupling, composition, the import flow) has no time axis, WIP, the outcome and the task pile
 * read the board as of its cache (`local.issues` bounds a window by
 * `created_at`, NULL offline), and the bugs open on a day include those
 * opened before it.
 */
import type { BugOutcomeDay, MockData, OpenBugsDay, Wip } from './mock.js';
import type { FieldMeta, LensField, WorkspaceCard } from './source.js';
import type { MetricDefinition, QueryResult, Scalar, Window } from '@open-tomato/atlas-data/contract';
import type { AtlasClient } from '@open-tomato/atlas-transport/client';
import type { BoxGroup, GraphLink, GraphNode, TreemapNode } from '@open-tomato/charts';

import { scopeCreepOf, taskPileOf, workDoneOf } from './live-cards.js';
import {
  boundsOf,
  columnOf,
  DAY_MS,
  dayOf,
  dayStartOf,
  numberOf,
  round1,
  stampOrNull,
  stringListOf,
  textOf,
  UNKNOWN,
  windowWeeksOf,
} from './live-read.js';
import { boxOf } from './random.js';

/** The metrics past the PoC cut this source runs, by a short name. */
export type SourceMetric =
  | 'deploysPerWeek'
  | 'locPerModule'
  | 'coupling'
  | 'wip'
  | 'resolutionTime'
  | 'bugOutcome'
  | 'openBugsPerDay'
  | 'minutesPerAgent'
  | 'defectDensity'
  | 'scopeCreep'
  | 'taskPile'
  | 'workDone'
  | 'composition'
  | 'importFlow';

/** The catalogue id of each metric this module runs. */
export const SOURCE_METRICS: Readonly<Record<SourceMetric, string>> = {
  deploysPerWeek: 'dev.deploys-per-week',
  locPerModule: 'arch.loc-per-module',
  coupling: 'arch.coupling',
  wip: 'dev.wip',
  resolutionTime: 'qa.resolution-time',
  bugOutcome: 'qa.bug-outcome-by-loop-start',
  openBugsPerDay: 'qa.open-bugs-per-day',
  minutesPerAgent: 'pm.minutes-per-agent',
  defectDensity: 'qa.defect-density',
  scopeCreep: 'pm.out-of-scope-per-week',
  taskPile: 'pm.task-pile',
  workDone: 'dev.work-done',
  composition: 'arch.composition',
  importFlow: 'arch.import-flow',
};

/** The field each metric fills. */
export const SOURCE_METRIC_FIELDS: Readonly<Record<SourceMetric, readonly LensField[]>> = {
  deploysPerWeek: ['deploysPerWeek'],
  locPerModule: ['modules'],
  coupling: ['workspace'],
  wip: ['wip'],
  resolutionTime: ['resolutionByPriority'],
  bugOutcome: ['bugOutcomeByLoopStart'],
  openBugsPerDay: ['openBugsPerDay'],
  minutesPerAgent: ['minutesPerAgent'],
  defectDensity: ['defectDensity'],
  scopeCreep: ['scopeCreepPerWeek', 'scopeCreepAverage'],
  taskPile: ['taskPileTree'],
  workDone: ['workDoneTree'],
  composition: ['workspace'],
  importFlow: ['workspace'],
};

/** The metrics run in `SOURCE_METRICS` order. */
export const SOURCE_METRIC_KEYS: readonly SourceMetric[] = Object.keys(SOURCE_METRICS) as SourceMetric[];

/** The fields a metric of this module fills, each once: three metrics fill `workspace`. */
export const SOURCE_WIRED_FIELDS: readonly LensField[] = [...new Set(SOURCE_METRIC_KEYS.flatMap((key) => SOURCE_METRIC_FIELDS[key]))];

/** The metric each workspace card with one of its own reads: the rose and the sunburst `arch.composition`, the Sankey `arch.import-flow`. */
export const WORKSPACE_CARD_METRICS: Readonly<Record<WorkspaceCard, SourceMetric>> = {
  sizeRose: 'composition',
  composition: 'composition',
  importFlow: 'importFlow',
};

/** A field's or a card's meta: its metric, the row count of the answer that filled it and, for a proxy, the metric's note. */
export function metaOf(metricId: string, answer: QueryResult | undefined, notes: ReadonlyMap<string, string>): FieldMeta {
  const rowCount = answer?.meta.rowCount ?? 0;
  const proxyNote = notes.get(metricId);
  return proxyNote === undefined
    ? { metricId, rowCount }
    : { metricId, rowCount, proxyNote };
}

/** The meta of each workspace card with a metric of its own, from that metric's answer. */
export function workspaceMetaOf(sources: SourceAnswers, notes: ReadonlyMap<string, string>): ReadonlyMap<WorkspaceCard, FieldMeta> {
  return new Map((Object.keys(WORKSPACE_CARD_METRICS) as WorkspaceCard[]).map((card) => {
    const key = WORKSPACE_CARD_METRICS[card];
    return [card, metaOf(SOURCE_METRICS[key], sources.metrics[key], notes)] as const;
  }));
}

/** The metrics asked over the range's series window; every other one is asked with none (see the module note). */
export const WINDOWED_SOURCE_METRICS: ReadonlySet<SourceMetric> = new Set<SourceMetric>([
  'deploysPerWeek',
  'resolutionTime',
  'minutesPerAgent',
  'scopeCreep',
  'workDone',
]);

/** The source whose `first_at` dates a plan's bugs on the outcome card. */
export const PLANS_SOURCE_ID = 'local.plans';

/** The most plans the outcome card's plan query reads. */
const PLANS_LIMIT = 5_000;

/** The build line that reads GitHub into the replica. */
export const GITHUB_BUILD_LINE = 'rafa module exec @open-tomato/rafa-atlas build --github';

/** What a card fed by a GitHub-only metric says when the replica holds no GitHub data. */
export const GITHUB_NOT_READ: string = 'This card reads GitHub, and the replica holds no GitHub data. Build it with'
  + ` ${GITHUB_BUILD_LINE}, then start the demo again.`;

/** The answers this module maps: one per metric, and the plans' first sessions. */
export interface SourceAnswers {
  readonly metrics: Readonly<Record<SourceMetric, QueryResult>>;
  readonly plans: QueryResult;
}

/** The fields of the mock shape this module fills. */
export type SourceFields = Pick<
  MockData,
  | 'deploysPerWeek'
  | 'modules'
  | 'wip'
  | 'resolutionByPriority'
  | 'bugOutcomeByLoopStart'
  | 'openBugsPerDay'
  | 'minutesPerAgent'
  | 'defectDensity'
  | 'scopeCreepPerWeek'
  | 'scopeCreepAverage'
  | 'taskPileTree'
  | 'workDoneTree'
>;

/** The module graph `arch.coupling` gives: the members and edges of the live `workspace`. */
export interface ModuleGraph {
  readonly members: readonly GraphNode[];
  readonly edges: readonly GraphLink[];
}

/** Every metric of this module and the plans query, asked at once, metrics first in `SOURCE_METRICS` order. */
export async function sourceAnswersOf(client: AtlasClient, series: Window, signal?: AbortSignal): Promise<SourceAnswers> {
  const asked = SOURCE_METRIC_KEYS.map(async (key) => [key, await client.runMetric(
    SOURCE_METRICS[key],
    WINDOWED_SOURCE_METRICS.has(key)
      ? series
      : undefined,
    signal,
  )] as const);
  const plans = client.query(PLANS_SOURCE_ID, { window: series, fields: ['plan_stub', 'first_at'], limit: PLANS_LIMIT }, signal);
  const [entries, plansAnswer] = await Promise.all([Promise.all(asked), plans]);
  return { metrics: Object.fromEntries(entries) as Record<SourceMetric, QueryResult>, plans: plansAnswer };
}

/* ---------- one field per answer ---------- */

/** The release tags per window week, 0 for a week with none, from `week` and `deploys` rows. */
export function deploysOf(result: QueryResult): number[] {
  const week = columnOf(result, 'week');
  const deploys = columnOf(result, 'deploys');
  return windowWeeksOf(result, 'week').map((key) => result.rows
    .filter((row) => row[week] === key)
    .reduce((sum, row) => sum + numberOf(row[deploys]), 0));
}

/** The folder a module's folder sits in (`packages` for `packages/rafa-board`), or the path itself at the root. */
function parentOf(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut < 0
    ? path
    : path.slice(0, cut);
}

/** The last segment of a module's path: its own folder's name. */
function folderOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** One treemap tile per module folder with lines of code, from `path` and `loc` rows, grouped by the folder it sits in. */
export function moduleNodesOf(result: QueryResult): TreemapNode[] {
  const path = columnOf(result, 'path');
  const loc = columnOf(result, 'loc');
  return result.rows
    .map((row) => {
      const id = textOf(row[path], UNKNOWN);
      return { id, label: folderOf(id), group: parentOf(id), value: numberOf(row[loc]) };
    })
    .filter((node) => node.value > 0);
}

/**
 * The module graph from `path`, `package`, `imports_json` and `fan_in`
 * rows: one node per module, keyed by its package (its path when it has
 * none) and weighted one more than its fan-in, and one edge per import of
 * another module's package, from the dependency to the dependent. A
 * package no module carries draws no edge.
 */
export function moduleGraphOf(result: QueryResult): ModuleGraph {
  const path = columnOf(result, 'path');
  const pkg = columnOf(result, 'package');
  const imports = columnOf(result, 'imports_json');
  const fanIn = columnOf(result, 'fan_in');
  const members = result.rows.map((row) => {
    const folder = textOf(row[path], UNKNOWN);
    return { id: textOf(row[pkg], folder), label: folderOf(folder), group: parentOf(folder), value: 1 + numberOf(row[fanIn]) };
  });
  const ids = new Set(members.map((member) => member.id));
  const edges = result.rows.flatMap((row, index) => {
    const target = members[index]?.id ?? UNKNOWN;
    return stringListOf(row[imports], 'packages')
      .filter((source) => ids.has(source) && source !== target)
      .map((source) => ({ source, target, value: 1 }));
  });
  return { members, edges };
}

/** The issues in progress, from the `issues` count, against `limit`. */
export function wipOf(result: QueryResult, limit: number | null): Wip {
  const issues = columnOf(result, 'issues');
  return { now: numberOf(result.rows[0]?.[issues]), limit };
}

/** The `goal` the API lists for `id`, as `withAtlasTargets` laid it over; null when it lists none. */
export function goalOf(definitions: readonly MetricDefinition[], id: string): number | null {
  return definitions.find((definition) => definition.id === id)?.goal ?? null;
}

/** The days from open to close of each fixed bug, a box per priority in label order, a bug with none as `unknown` last. */
export function resolutionOf(result: QueryResult): BoxGroup[] {
  const priority = columnOf(result, 'priority');
  const created = columnOf(result, 'created_at');
  const closed = columnOf(result, 'closed_at');
  const byPriority = new Map<string, number[]>();
  for (const row of result.rows) {
    const opened = stampOrNull(row[created]);
    const shut = stampOrNull(row[closed]);
    if (opened === null || shut === null) continue;
    const label = textOf(row[priority], UNKNOWN);
    byPriority.set(label, [...(byPriority.get(label) ?? []), (shut - opened) / DAY_MS]);
  }
  const labels = [...byPriority.keys()].sort((a, b) => Number(a === UNKNOWN) - Number(b === UNKNOWN) || a.localeCompare(b));
  return labels.map((label) => boxOf(label, byPriority.get(label) ?? []));
}

/** What became of a bug, from its state and close reason: open, fixed (closed completed) or dropped. */
function outcomeOf(state: Scalar | undefined, reason: Scalar | undefined): keyof Omit<BugOutcomeDay, 'day'> {
  if (state === 'OPEN') return 'open';
  return reason === 'COMPLETED'
    ? 'fixed'
    : 'dropped';
}

/** The day (`YYYY-MM-DD`) each plan of `plans` started on, from `plan_stub` and `first_at` rows; a plan with no session is left out. */
function planStartsOf(plans: QueryResult): ReadonlyMap<string, string> {
  const plan = columnOf(plans, 'plan_stub');
  const first = columnOf(plans, 'first_at');
  return new Map(plans.rows.flatMap((row) => {
    const stub = row[plan];
    const started = stampOrNull(row[first]);
    return typeof stub === 'string' && started !== null
      ? [[stub, new Date(dayStartOf(started)).toISOString()
        .slice(0, 10)] as const]
      : [];
  }));
}

/**
 * The bugs loops filed, counted on the day their plan's first session
 * started as fixed, dropped or open, from `plan_stub`, `state`,
 * `state_reason` and `bugs` rows; one entry per day holding a count,
 * oldest first. A plan `plans` does not date adds nothing.
 */
export function outcomeByLoopStartOf(result: QueryResult, plans: QueryResult): BugOutcomeDay[] {
  const plan = columnOf(result, 'plan_stub');
  const state = columnOf(result, 'state');
  const reason = columnOf(result, 'state_reason');
  const bugs = columnOf(result, 'bugs');
  const starts = planStartsOf(plans);
  const byDay = new Map<string, Omit<BugOutcomeDay, 'day'>>();
  for (const row of result.rows) {
    const stub = row[plan];
    const day = typeof stub === 'string'
      ? starts.get(stub)
      : undefined;
    if (day === undefined) continue;
    const seen = byDay.get(day) ?? { fixed: 0, dropped: 0, open: 0 };
    const outcome = outcomeOf(row[state], row[reason]);
    byDay.set(day, { ...seen, [outcome]: seen[outcome] + numberOf(row[bugs]) });
  }
  return [...byDay.keys()].sort().map((day) => ({ day: dayOf(day), ...(byDay.get(day) ?? { fixed: 0, dropped: 0, open: 0 }) }));
}

/** One bug's open span and whether a loop filed it. */
interface BugSpan {
  readonly opened: number;
  readonly closed: number | null;
  readonly fromLoop: boolean;
}

/** The first and the end of the days to count over: `window`'s bounds, or the bugs' own span for an open window. */
function countedDaysOf(spans: readonly BugSpan[], window: QueryResult): { readonly first: number; readonly end: number } | null {
  const bounds = boundsOf(window);
  if (bounds !== null) return { first: dayStartOf(bounds.from.getTime()), end: bounds.to.getTime() };
  if (spans.length === 0) return null;
  const stamps = spans.flatMap((span) => (span.closed === null
    ? [span.opened]
    : [span.opened, span.closed]));
  return { first: dayStartOf(Math.min(...stamps)), end: dayStartOf(Math.max(...stamps)) + DAY_MS };
}

/**
 * The bugs open at the end of each day of `window`'s bounds (of the bugs'
 * own span when open), all of them and those a loop filed (a plan named),
 * from `plan_stub`, `created_at` and `closed_at` rows. A bug counts on a
 * day when it was opened before the day's end and not closed by then.
 */
export function openBugsPerDayOf(result: QueryResult, window: QueryResult): OpenBugsDay[] {
  const plan = columnOf(result, 'plan_stub');
  const created = columnOf(result, 'created_at');
  const closed = columnOf(result, 'closed_at');
  const spans: BugSpan[] = result.rows.flatMap((row) => {
    const opened = stampOrNull(row[created]);
    return opened === null
      ? []
      : [{ opened, closed: stampOrNull(row[closed]), fromLoop: typeof row[plan] === 'string' }];
  });
  const days = countedDaysOf(spans, window);
  if (days === null) return [];
  const counted: OpenBugsDay[] = [];
  for (let dayStart = days.first; dayStart < days.end; dayStart += DAY_MS) {
    const dayEnd = dayStart + DAY_MS;
    const open = spans.filter((span) => span.opened < dayEnd && (span.closed === null || span.closed >= dayEnd));
    counted.push({ day: new Date(dayStart), all: open.length, fromLoops: open.filter((span) => span.fromLoop).length });
  }
  return counted;
}

/** What the minutes per agent call a task session that names no agent. */
export const NO_AGENT = 'no agent';

/** The task session minutes of each agent, from `agent` and `minutes` rows, in the answer's order; an agent with none left out. */
export function minutesPerAgentOf(result: QueryResult): MockData['minutesPerAgent'] {
  const agent = columnOf(result, 'agent');
  const minutes = columnOf(result, 'minutes');
  return result.rows
    .map((row) => ({ agent: textOf(row[agent], NO_AGENT), minutes: numberOf(row[minutes]) }))
    .filter((row) => row.minutes > 0);
}

/** The lines a density counts per bug: per 1,000. */
const DENSITY_LINES = 1_000;

/** The bugs per 1,000 lines over the folders holding code, from `bugs` and `loc` rows, to one decimal; 0 with no line. */
export function defectDensityOf(result: QueryResult): number {
  const bugs = columnOf(result, 'bugs');
  const loc = columnOf(result, 'loc');
  const counted = result.rows.filter((row) => numberOf(row[loc]) > 0);
  const lines = counted.reduce((sum, row) => sum + numberOf(row[loc]), 0);
  if (lines === 0) return 0;
  const found = counted.reduce((sum, row) => sum + numberOf(row[bugs]), 0);
  return round1(found / lines * DENSITY_LINES);
}

/* ---------- the fields together ---------- */

/** The fields this module fills, each from its answer; the WIP ceiling from the metric's listed goal. */
export function sourceFieldsOf(answers: SourceAnswers, definitions: readonly MetricDefinition[]): SourceFields {
  const { metrics } = answers;
  const scopeCreep = scopeCreepOf(metrics.scopeCreep);
  return {
    deploysPerWeek: deploysOf(metrics.deploysPerWeek),
    modules: moduleNodesOf(metrics.locPerModule),
    wip: wipOf(metrics.wip, goalOf(definitions, SOURCE_METRICS.wip)),
    resolutionByPriority: resolutionOf(metrics.resolutionTime),
    bugOutcomeByLoopStart: outcomeByLoopStartOf(metrics.bugOutcome, answers.plans),
    openBugsPerDay: openBugsPerDayOf(metrics.openBugsPerDay, metrics.deploysPerWeek),
    minutesPerAgent: minutesPerAgentOf(metrics.minutesPerAgent),
    defectDensity: defectDensityOf(metrics.defectDensity),
    scopeCreepPerWeek: scopeCreep.perWeek,
    scopeCreepAverage: scopeCreep.average,
    taskPileTree: taskPileOf(metrics.taskPile),
    workDoneTree: workDoneOf(metrics.workDone),
  };
}

/**
 * The fields of a GitHub-only metric (`feasibility` `gh` in the API's
 * list) that answered no row: the replica holds no GitHub data for them,
 * so their cards draw `GITHUB_NOT_READ` in place of an empty chart.
 */
export function githubPendingOf(answers: SourceAnswers, definitions: readonly MetricDefinition[]): readonly LensField[] {
  const github = new Set(definitions.filter((definition) => definition.feasibility === 'gh').map((definition) => definition.id));
  return SOURCE_METRIC_KEYS
    .filter((key) => github.has(SOURCE_METRICS[key]) && answers.metrics[key].meta.rowCount === 0)
    .flatMap((key) => SOURCE_METRIC_FIELDS[key]);
}
