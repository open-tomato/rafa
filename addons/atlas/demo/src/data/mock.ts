/**
 * Mock data in the shape the Atlas buckets would give: twelve weeks ending
 * 2026-11-01, the sixteen PoC metrics plus the gap charts, all derived from
 * seeded streams. The fixed parts (dates, kinds, tones, limits) are module
 * constants; the measured-looking parts come from `buildMock(seeds)`, so
 * the page source can ask for one set per range. `MOCK_SEEDS` gives the
 * set the bake-off drew.
 */
import type { BoxGroup, ChartTone, HistogramBin, LineSeries, ScatterPoint, TimePoint, TreemapNode } from '@open-tomato/charts';

import { between, quantile, seeded, skewed } from './random.js';

/* ---------- the fixed frame ---------- */

export const WEEKS = 12;
export const DAYS: number = WEEKS * 7;
export const LAST_DAY: Date = new Date(Date.UTC(2026, 10, 1));

/** One day in milliseconds. */
const DAY_MS = 86_400_000;

export const DAY_DATES: Date[] = Array.from({ length: DAYS }, (_, index) => new Date(LAST_DAY.getTime() - (DAYS - 1 - index) * DAY_MS));

export const WEEK_DATES: Date[] = Array.from({ length: WEEKS }, (_, index) => DAY_DATES[index * 7] ?? LAST_DAY);

/** A labelled series kind: its id, its label and its tone. */
export interface Kind {
  readonly id: string;
  readonly label: string;
  readonly tone: ChartTone;
}

export const WEEKLY_TOKEN_BUDGET = 18_000_000;
/** The allowance is set below this week's spend on purpose: the exceeded case. */
export const WEEKLY_TOKEN_BUDGET_TIGHT = 12_000_000;
export const PLAN_NAMES: string[] = ['rafa-1266', 'rafa-1380', 'rafa-1395', 'rafa-1401', 'rafa-1407', 'rafa-1412'];
export const AGENTS: string[] = ['implementer', 'doc-updater', 'reviewer', 'tdd-guide', 'planner'];
export const WIP_LIMIT_MINUTES = 900;
export const ACTIVE_BLOCKERS = 4;
export const ON_TIME_SHARE = 0.78;

export const CHANGE_LEVELS: Kind[] = [
  { id: 'feat', label: 'feat', tone: 'series-1' },
  { id: 'fix', label: 'fix', tone: 'series-2' },
  { id: 'refactor', label: 'refactor', tone: 'series-3' },
  { id: 'chore', label: 'chore', tone: 'series-4' },
];

/** The minutes each change kind centres on over twelve weeks. */
const CHANGE_MINUTES = [5_400, 2_800, 1_600, 900];

/** A model with its share of the tokens. */
export interface Model extends Kind {
  readonly share: number;
}

export const MODELS: Model[] = [
  { id: 'opus', label: 'Opus 5.5', tone: 'series-1', share: 0.5 },
  { id: 'sonnet', label: 'Sonnet 5.5', tone: 'series-2', share: 0.3 },
  { id: 'haiku', label: 'Haiku 5.5', tone: 'series-3', share: 0.15 },
  { id: 'other', label: 'Other', tone: 'muted', share: 0.05 },
];

export const WEEKDAYS: string[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const HOUR_SLOTS: string[] = ['00–04', '04–08', '08–12', '12–16', '16–20', '20–24'];
export const PREFLIGHT_CHECKS: string[] = ['tsc', 'eslint', 'bun test (changed)', 'graph check', 'codeowners', 'publish rules'];

/** The modules of the (cardless) treemap: id, group and lines. */
const MODULE_SIZES: [string, string, number][] = [
  ['rafa/core', 'core', 9_800], ['rafa/effort', 'core', 7_200], ['rafa/ports', 'core', 3_100],
  ['rafa-board', 'feature', 4_600], ['rafa-pr', 'feature', 5_900], ['rafa-triage', 'feature', 3_400],
  ['rafa-release', 'feature', 2_900], ['rafa-learning', 'feature', 3_800], ['rafa-hub', 'feature', 2_200],
  ['eslint-config', 'config', 900], ['typescript-config', 'config', 300],
  ['atlas-data', 'addon', 1_400], ['atlas-transport', 'addon', 800], ['atlas-visualization', 'addon', 1_900],
];

export const BRANCH_TYPES: Kind[] = [
  { id: 'feature', label: 'feature', tone: 'series-1' },
  { id: 'fix', label: 'fix', tone: 'series-2' },
  { id: 'chore', label: 'chore', tone: 'series-4' },
];

export const RED_CI_THRESHOLD = 0.1;
export const RED_CI_SHARE = 0.064;
export const WIP_NOW = 7;
export const WIP_LIMIT = 8;

export const BUG_KINDS: Kind[] = [
  { id: 'bug', label: 'bug', tone: 'series-1' },
  { id: 'own-fallout', label: 'own-fallout', tone: 'series-2' },
  { id: 'own-gap', label: 'own-gap', tone: 'series-3' },
  { id: 'convention', label: 'convention', tone: 'series-4' },
  { id: 'docs', label: 'docs', tone: 'series-5' },
];

export const ROUTES: Kind[] = [
  { id: 'filed', label: 'filed to tracker', tone: 'series-1' },
  { id: 'private', label: 'private channel', tone: 'series-2' },
  { id: 'inherited', label: 'inherited', tone: 'series-4' },
];

export const PRIORITIES: string[] = ['P1', 'P2', 'P3', 'P4'];

/** The median resolution days each priority centres on. */
const PRIORITY_MEDIAN_DAYS = [1.5, 4, 9, 16];

const FLAKY_CHECK_NAMES = [
  'merge-untracked.test.ts', 'location.test.ts', 'package-build.test.ts', 'pr-wait.test.ts',
  'board-refresh.test.ts', 'release-settle.test.ts', 'loop-guard.test.ts', 'hub-sync.test.ts',
  'triage-match.test.ts', 'effort-report.test.ts',
];

export const DEFECT_DENSITY = 1.9;
export const OPEN_BUGS = 23;

export const TOP_MODULES: string[] = ['rafa-core', 'rafa-board', 'rafa-pr', 'rafa-run', 'rafa-release', 'other'];

/** A kind with the item count its tree spreads over the outer ring. */
interface TreeKind extends Kind {
  readonly total: number;
}

export const WORK_KINDS: TreeKind[] = [
  { id: 'features', label: 'features', tone: 'series-1', total: 184 },
  { id: 'fixes', label: 'fixed bugs', tone: 'series-2', total: 121 },
  { id: 'chores', label: 'chores', tone: 'series-4', total: 66 },
  { id: 'docs', label: 'documentation', tone: 'series-5', total: 43 },
];

export const WORK_TONES: Record<string, ChartTone> = Object.fromEntries(WORK_KINDS.map((kind) => [kind.id, kind.tone]));

export const AGE_BUCKETS: string[] = ['under a week', '1 to 4 weeks', 'over 4 weeks'];

export const PILE_KINDS: TreeKind[] = [
  { id: 'bugs', label: 'open bugs', tone: 'series-2', total: 23 },
  { id: 'features', label: 'features queued', tone: 'series-1', total: 41 },
  { id: 'chores', label: 'chores pending', tone: 'series-4', total: 17 },
  { id: 'docs', label: 'docs pending', tone: 'series-5', total: 12 },
];

export const PILE_TONES: Record<string, ChartTone> = Object.fromEntries(PILE_KINDS.map((kind) => [kind.id, kind.tone]));

/* ---------- the seeded part ---------- */

/** The three streams a mock set draws from. */
export interface MockSeeds {
  readonly main: number;
  readonly extra: number;
  readonly tree: number;
}

/** The seeds the bake-off drew with; the page's 'past-month' range uses them. */
export const MOCK_SEEDS: MockSeeds = { main: 20_261_102, extra: 7_112_026, tree: 31_337 };

/** A slice of a part-to-whole tree: a kind, then its parts. */
export interface TreeBranch {
  readonly id: string;
  readonly label: string;
  readonly group: string;
  readonly children: { id: string; label: string; value: number; group: string }[];
}

/** A slice of the change-kind donut. */
export interface ChangeSlice extends Kind {
  readonly value: number;
}

/** One set of mock values: every series the lenses draw. */
export interface MockData {
  readonly tokensPerDay: TimePoint[];
  readonly tokensPerDayPrevious: TimePoint[];
  readonly tokensThisWeek: number;
  readonly tokensLastWeek: number;
  readonly tokensDailyAverage: number;
  readonly plansPerWeek: { week: Date; started: number; completed: number }[];
  readonly plannedVsSessions: { plan: string; planned: number; sessions: number }[];
  readonly minutesPerAgent: { agent: string; minutes: number }[];
  readonly scopeCreepPerWeek: number[];
  readonly minutesByChangeKind: ChangeSlice[];
  readonly minutesByChangeKindPrevious: ChangeSlice[];
  readonly debtRatio: number;
  readonly taskMinutesQuantiles: { week: Date; p50: number; p90: number }[];
  readonly tokensByModel: LineSeries[];
  readonly preflightHalts: number[][];
  readonly modules: TreemapNode[];
  readonly tasksDonePerWeek: { week: Date; feature: number; fix: number; chore: number }[];
  readonly taskCycle: ScatterPoint[];
  readonly taskCycleTrend: TimePoint[];
  readonly taskMinutesBins: HistogramBin[];
  readonly deploysPerWeek: number[];
  readonly bugsByKindPerWeek: Record<string, number>[];
  readonly regressionsPerWeek: TimePoint[];
  readonly filedSharePerWeek: Record<string, number>[];
  readonly resolutionByPriority: BoxGroup[];
  readonly flakyChecks: { name: string; failures: number; readings: number }[];
  readonly workDoneTree: TreeBranch[];
  readonly taskPileTree: TreeBranch[];
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** Tokens per day: weekdays busy, weekends quiet, a slow upward drift. */
function tokensPerDayFrom(random: () => number): TimePoint[] {
  return DAY_DATES.map((date, index) => {
    const weekend = date.getUTCDay() === 0 || date.getUTCDay() === 6;
    const base = weekend
      ? 400_000
      : 2_100_000 + index * 9_000;
    return { x: date, y: Math.round(base * between(random, 0.55, 1.45)) };
  });
}

/** One point per task: dispatch-to-report minutes over the last four weeks. */
function taskCycleFrom(random: () => number): ScatterPoint[] {
  return Array.from({ length: 160 }, (_, index) => {
    const x = new Date(LAST_DAY.getTime() - between(random, 0, 28) * DAY_MS);
    return { x, y: Math.round(skewed(random, 21, 0.75)), label: `task ${1_240 + index}` };
  }).sort((a, b) => a.x.getTime() - b.x.getTime());
}

/** A seven-day moving median over the cycle points. */
function cycleTrendOf(taskCycle: readonly ScatterPoint[]): TimePoint[] {
  return Array.from({ length: 28 }, (_, dayIndex) => {
    const dayStart = LAST_DAY.getTime() - (27 - dayIndex) * DAY_MS;
    const window = taskCycle
      .filter((point) => point.x.getTime() <= dayStart + DAY_MS && point.x.getTime() > dayStart - 6 * DAY_MS)
      .map((point) => point.y)
      .sort((a, b) => a - b);
    return { x: new Date(dayStart), y: window.length > 0
      ? quantile(window, 0.5)
      : 21 };
  });
}

function taskMinutesBinsFrom(random: () => number): HistogramBin[] {
  const edges = [0, 5, 10, 15, 20, 30, 45, 60, 90, 120, 180];
  const minutes = Array.from({ length: 400 }, () => skewed(random, 20, 0.7));
  return edges.slice(0, -1).map((from, index) => {
    const to = edges[index + 1] ?? from;
    return { from, to, count: minutes.filter((value) => value >= from && value < to).length };
  });
}

/** Issue resolution days by priority label, as box statistics. */
function resolutionFrom(random: () => number): BoxGroup[] {
  return PRIORITIES.map((label, index) => {
    const days = Array.from({ length: 30 }, () => skewed(random, PRIORITY_MEDIAN_DAYS[index] ?? 1, 0.6)).sort((a, b) => a - b);
    const q1 = quantile(days, 0.25);
    const q3 = quantile(days, 0.75);
    const fence = q3 + 1.5 * (q3 - q1);
    const inside = days.filter((value) => value <= fence);
    return {
      label,
      min: round1(inside[0] ?? 0),
      q1: round1(q1),
      median: round1(quantile(days, 0.5)),
      q3: round1(q3),
      max: round1(inside.at(-1) ?? 0),
      outliers: days.filter((value) => value > fence).map(round1),
    };
  });
}

function flakyChecksFrom(random: () => number): { name: string; failures: number; readings: number }[] {
  return FLAKY_CHECK_NAMES.map((name) => {
    const readings = Math.round(between(random, 40, 232));
    return { name, failures: Math.round(readings * between(random, 0.02, 0.2)), readings };
  }).sort((a, b) => b.failures / b.readings - a.failures / a.readings);
}

/** A kind's total spread over its parts by seeded weights. */
function spreadOver(tree: () => number, total: number, parts: readonly string[], prefix: string, group: string): TreeBranch['children'] {
  const weights = parts.map(() => 0.3 + tree());
  const weightSum = sum(weights);
  return parts.map((part, index) => ({
    id: `${prefix}/${part}`,
    label: part.replace(/^rafa-/, ''),
    value: Math.max(1, Math.round((total * (weights[index] ?? 0)) / weightSum)),
    group,
  }));
}

function treeOf(tree: () => number, kinds: readonly TreeKind[], parts: readonly string[]): TreeBranch[] {
  return kinds.map((kind) => ({ id: kind.id, label: kind.label, group: kind.id, children: spreadOver(tree, kind.total, parts, kind.id, kind.id) }));
}

/** The project-management series, drawn first from the main stream. */
function projectSeries(random: () => number) {
  const tokensPerDay = tokensPerDayFrom(random);
  const plansPerWeek = WEEK_DATES.map((week) => {
    const started = Math.round(between(random, 6, 14));
    return { week, started, completed: Math.round(started * between(random, 0.6, 1)) };
  });
  const plannedVsSessions = PLAN_NAMES.map((plan) => {
    const planned = Math.round(between(random, 4, 14));
    return { plan, planned, sessions: Math.round(planned * between(random, 0.9, 1.8)) };
  });
  const minutesPerAgent = AGENTS.map((agent) => ({ agent, minutes: Math.round(between(random, 180, 1_150)) }));
  const scopeCreepPerWeek = WEEK_DATES.map(() => Math.round(between(random, 8, 30)));
  return { tokensPerDay, plansPerWeek, plannedVsSessions, minutesPerAgent, scopeCreepPerWeek };
}

/** The architecture series, next in the main stream. */
function architectureSeries(random: () => number, tokensPerDay: readonly TimePoint[]) {
  const minutesByChangeKind: ChangeSlice[] = CHANGE_LEVELS.map((level, index) => ({
    ...level,
    value: Math.round((CHANGE_MINUTES[index] ?? 0) * between(random, 0.8, 1.2)),
  }));
  const taskMinutesQuantiles = WEEK_DATES.map((week) => {
    const minutes = Array.from({ length: 40 }, () => skewed(random, 22, 0.7)).sort((a, b) => a - b);
    return { week, p50: Math.round(quantile(minutes, 0.5)), p90: Math.round(quantile(minutes, 0.9)) };
  });
  const tokensByModel: LineSeries[] = MODELS.map((model) => ({
    id: model.id,
    label: model.label,
    tone: model.tone,
    points: tokensPerDay.map((point) => ({ x: point.x, y: Math.round(point.y * model.share * between(random, 0.8, 1.2)) })),
  }));
  const preflightHalts = WEEKDAYS.map((_, dayIndex) => WEEK_DATES.map(() => (dayIndex >= 5
    ? Math.round(between(random, 0, 1.4))
    : Math.round(between(random, 0, 7)))));
  const modules: TreemapNode[] = MODULE_SIZES.map(([id, group, lines]) => ({ id, label: id, group, value: Math.round(lines * between(random, 0.9, 1.1)) }));
  return { minutesByChangeKind, taskMinutesQuantiles, tokensByModel, preflightHalts, modules };
}

/** The development series, next in the main stream. */
function developmentSeries(random: () => number) {
  const tasksDonePerWeek = WEEK_DATES.map((week) => ({
    week,
    feature: Math.round(between(random, 10, 26)),
    fix: Math.round(between(random, 4, 14)),
    chore: Math.round(between(random, 2, 8)),
  }));
  const taskCycle = taskCycleFrom(random);
  const taskMinutesBins = taskMinutesBinsFrom(random);
  const deploysPerWeek = WEEK_DATES.map(() => Math.round(between(random, 1, 5)));
  return { tasksDonePerWeek, taskCycle, taskMinutesBins, deploysPerWeek };
}

/** The QA series, last in the main stream. */
function qualitySeries(random: () => number) {
  const bugsByKindPerWeek: Record<string, number>[] = WEEK_DATES.map(() => ({
    'bug': Math.round(between(random, 3, 12)),
    'own-fallout': Math.round(between(random, 0, 6)),
    'own-gap': Math.round(between(random, 1, 7)),
    'convention': Math.round(between(random, 0, 4)),
    'docs': Math.round(between(random, 1, 6)),
  }));
  const filedSharePerWeek: Record<string, number>[] = WEEK_DATES.map(() => ({
    filed: Math.round(between(random, 6, 16)),
    private: Math.round(between(random, 0, 3)),
    inherited: Math.round(between(random, 1, 5)),
  }));
  const resolutionByPriority = resolutionFrom(random);
  const flakyChecks = flakyChecksFrom(random);
  return { bugsByKindPerWeek, filedSharePerWeek, resolutionByPriority, flakyChecks };
}

/**
 * One set of mock values from three seeded streams. The draws happen in
 * the bake-off's order, so `buildMock(MOCK_SEEDS)` gives its values.
 */
export function buildMock(seeds: MockSeeds): MockData {
  const random = seeded(seeds.main);
  const project = projectSeries(random);
  const architecture = architectureSeries(random, project.tokensPerDay);
  const development = developmentSeries(random);
  const quality = qualitySeries(random);

  const extra = seeded(seeds.extra);
  const tokensPerDayPrevious = project.tokensPerDay.map((point, index) => ({
    x: point.x,
    y: Math.max(120_000, Math.round(point.y * between(extra, 0.6, 1.1) - index * 4_000)),
  }));
  const minutesByChangeKindPrevious = architecture.minutesByChangeKind.map((kind) => ({
    ...kind,
    value: Math.round(kind.value * between(extra, 0.7, 1.25)),
  }));

  const tree = seeded(seeds.tree);
  const workDoneTree = treeOf(tree, WORK_KINDS, TOP_MODULES);
  const taskPileTree = treeOf(tree, PILE_KINDS, AGE_BUCKETS);

  const allMinutes = sum(architecture.minutesByChangeKind.map((kind) => kind.value));
  const debtMinutes = sum(architecture.minutesByChangeKind.slice(1).map((kind) => kind.value));

  return {
    ...project,
    ...architecture,
    ...development,
    ...quality,
    tokensPerDayPrevious,
    minutesByChangeKindPrevious,
    workDoneTree,
    taskPileTree,
    tokensThisWeek: sum(project.tokensPerDay.slice(-7).map((point) => point.y)),
    tokensLastWeek: sum(project.tokensPerDay.slice(-14, -7).map((point) => point.y)),
    tokensDailyAverage: Math.round(sum(project.tokensPerDay.map((point) => point.y)) / DAYS),
    debtRatio: debtMinutes / allMinutes,
    taskCycleTrend: cycleTrendOf(development.taskCycle),
    regressionsPerWeek: WEEK_DATES.map((week, index) => ({ x: week, y: quality.bugsByKindPerWeek[index]?.['own-fallout'] ?? 0 })),
  };
}

/* ---------- drill-downs over a set ---------- */

/** The halts behind one heatmap cell, split by check, summing to the cell. */
export function preflightHaltDetails(halts: readonly (readonly number[])[], dayIndex: number, weekIndex: number): { check: string; halts: number }[] {
  const total = halts[dayIndex]?.[weekIndex] ?? 0;
  const local = seeded(dayIndex * 31 + weekIndex * 7 + 1);
  const weights = PREFLIGHT_CHECKS.map(() => local());
  const weightSum = sum(weights) || 1;
  const counts = weights.map((weight) => Math.floor((weight / weightSum) * total));
  const missing = total - sum(counts);
  return PREFLIGHT_CHECKS.map((check, index) => ({ check, halts: (counts[index] ?? 0) + (index === 0
    ? missing
    : 0) }))
    .filter((row) => row.halts > 0)
    .sort((a, b) => b.halts - a.halts);
}

/** One week zoomed in: halts per weekday and four-hour slot, each day summing to its cell. */
export function preflightHaltsByHour(halts: readonly (readonly number[])[], weekIndex: number): number[][] {
  return WEEKDAYS.map((_, dayIndex) => {
    const total = halts[dayIndex]?.[weekIndex] ?? 0;
    const local = seeded(weekIndex * 101 + dayIndex);
    const weights = HOUR_SLOTS.map((_slot, slot) => (slot >= 2 && slot <= 4
      ? 2
      : 0.4) * local());
    const weightSum = sum(weights) || 1;
    const counts = weights.map((weight) => Math.floor((weight / weightSum) * total));
    const missing = total - sum(counts);
    return counts.map((count, slot) => count + (slot === 3
      ? missing
      : 0));
  });
}
