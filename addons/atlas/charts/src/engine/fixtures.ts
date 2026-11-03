/**
 * Fixed data for the engine's stories and tests: small, seeded, no clock.
 * Every date derives from {@link LAST_DAY}, so a story draws the same picture
 * on every run.
 */
import type { ChartOption } from './core.js';
import type {
  BarSeries,
  BoxGroup,
  DonutSlice,
  GraphLink,
  GraphNode,
  HistogramBin,
  LineSeries,
  RadarAxis,
  RadarPole,
  RadarSeries,
  RoseSlice,
  ScatterPoint,
  SunburstNode,
  TimePoint,
  TreemapNode,
  ChartTone,
} from '../seam/types.js';

import { ALL_TONES, CHROME_ROLES, SEQUENTIAL_STEPS, type ResolvedTokens } from '../seam/tones.js';

/** A seeded stream of numbers in [0, 1): the same seed gives the same stream. */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A value between `min` and `max` from a seeded stream. */
export function between(random: () => number, min: number, max: number): number {
  return min + random() * (max - min);
}

const MS_PER_DAY = 86_400_000;

/** The last day of every time series. */
export const LAST_DAY: Date = new Date(Date.UTC(2026, 10, 1));

/** Twenty-eight days ending on {@link LAST_DAY}. */
export const DAY_DATES: readonly Date[] = Array.from({ length: 28 }, (_, index) => new Date(LAST_DAY.getTime() - (27 - index) * MS_PER_DAY));

const random = seeded(20261102);

/* ---------- tokens ---------- */

/** One fixed, distinct colour per token name, so a test can tell which token a mark was painted with. */
export const FIXED_TOKENS: ResolvedTokens = Object.fromEntries(
  [...new Set([...ALL_TONES, ...SEQUENTIAL_STEPS, ...CHROME_ROLES])].map((name, index) => {
    const channel = (step: number): string => ((index * step + 40) % 216 + 20).toString(16).padStart(2, '0');
    return [name, `#${channel(37)}${channel(91)}${channel(53)}`];
  }),
);

/* ---------- reading an option ---------- */

/** A series as a test reads it: the fields are checked one by one, so they stay loose. */
export interface SeriesReading {
  readonly id?: string;
  readonly type?: string;
  readonly name?: string;
  readonly data?: readonly unknown[];
  readonly [field: string]: unknown;
}

/** The option's series as a list, whether it holds one or many. */
export function seriesOf(option: ChartOption): readonly SeriesReading[] {
  const { series } = option;
  if (series === undefined) return [];
  return (Array.isArray(series)
    ? series
    : [series]) as unknown as readonly SeriesReading[];
}

/* ---------- bar ---------- */

export const BAR_CATEGORIES: readonly string[] = ['implementer', 'doc-updater', 'reviewer', 'tdd-guide', 'planner'];

export const BAR_SERIES: readonly BarSeries[] = [
  { id: 'feat', label: 'feat', tone: 'series-1', values: [420, 180, 260, 150, 90] },
  { id: 'fix', label: 'fix', tone: 'series-2', values: [210, 90, 140, 70, 40] },
  { id: 'chore', label: 'chore', tone: 'series-4', values: [80, 120, 60, 30, 20] },
];

/* ---------- line ---------- */

const dailyBase = DAY_DATES.map((date) => {
  const weekend = date.getUTCDay() === 0 || date.getUTCDay() === 6;
  return weekend
    ? 400_000
    : 2_100_000;
});

const LINE_SHARES: readonly { id: string; label: string; tone: ChartTone; share: number }[] = [
  { id: 'opus', label: 'Opus', tone: 'series-1', share: 0.55 },
  { id: 'sonnet', label: 'Sonnet', tone: 'series-2', share: 0.35 },
];

export const LINE_SERIES: readonly LineSeries[] = LINE_SHARES.map((entry) => ({
  id: entry.id,
  label: entry.label,
  tone: entry.tone,
  points: DAY_DATES.map((x, index) => ({ x, y: Math.round((dailyBase[index] ?? 0) * entry.share * between(random, 0.7, 1.3)) })),
}));

/** One series, for the area variant. */
export const AREA_SERIES: readonly LineSeries[] = LINE_SERIES.slice(0, 1);

/* ---------- scatter, histogram, box plot ---------- */

export const SCATTER_POINTS: readonly ScatterPoint[] = Array.from({ length: 40 }, (_, index) => ({
  x: new Date(LAST_DAY.getTime() - (39 - index) * 0.7 * MS_PER_DAY),
  y: Math.round(between(random, 4, 60)),
  label: `task ${index + 1}`,
}));

/** A three-point moving average of the scatter points. */
export const SCATTER_TREND: readonly TimePoint[] = SCATTER_POINTS.map((point, index, all) => {
  const window = all.slice(Math.max(0, index - 2), index + 1);
  return { x: point.x, y: window.reduce((sum, entry) => sum + entry.y, 0) / window.length };
});

export const HISTOGRAM_BINS: readonly HistogramBin[] = [
  [0, 10, 14], [10, 20, 31], [20, 30, 24], [30, 40, 15], [40, 50, 9], [50, 60, 5], [60, 70, 2], [70, 80, 1],
].map(([from = 0, to = 0, count = 0]) => ({ from, to, count }));

export const BOX_GROUPS: readonly BoxGroup[] = [
  { label: 'feat', min: 6, q1: 14, median: 22, q3: 34, max: 52, outliers: [71, 80] },
  { label: 'fix', min: 4, q1: 9, median: 15, q3: 22, max: 33, outliers: [48] },
  { label: 'refactor', min: 8, q1: 18, median: 29, q3: 41, max: 60 },
  { label: 'chore', min: 2, q1: 5, median: 8, q3: 13, max: 20, outliers: [34] },
];

/* ---------- donut, treemap, heatmap ---------- */

export const DONUT_SLICES: readonly DonutSlice[] = [
  { id: 'feat', label: 'feat', tone: 'series-1', value: 5400 },
  { id: 'fix', label: 'fix', tone: 'series-2', value: 2800 },
  { id: 'refactor', label: 'refactor', tone: 'series-3', value: 1600 },
  { id: 'chore', label: 'chore', tone: 'series-4', value: 900 },
];

/** The previous period, same ids and tones. */
export const DONUT_PREVIOUS: readonly DonutSlice[] = [
  { id: 'feat', label: 'feat', tone: 'series-1', value: 4600 },
  { id: 'fix', label: 'fix', tone: 'series-2', value: 3300 },
  { id: 'refactor', label: 'refactor', tone: 'series-3', value: 1200 },
  { id: 'chore', label: 'chore', tone: 'series-4', value: 1000 },
];

export const TREEMAP_NODES: readonly TreemapNode[] = [
  ['core', 'core', 9_800], ['effort', 'core', 7_200], ['ports', 'core', 3_100],
  ['board', 'feature', 4_600], ['pr', 'feature', 5_900], ['triage', 'feature', 3_400],
  ['release', 'feature', 2_900], ['learning', 'feature', 3_800],
  ['eslint-config', 'config', 900], ['typescript-config', 'config', 300],
  ['data', 'addon', 1_400], ['transport', 'addon', 800],
].map(([id = '', group = '', value = 0]) => ({ id: String(id), label: String(id), group: String(group), value: Number(value) }));

export const TREEMAP_TONES: Readonly<Record<string, ChartTone>> = { core: 'series-1', feature: 'series-2', config: 'series-4', addon: 'series-3' };

export const HEAT_ROWS: readonly string[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const HEAT_COLS: readonly string[] = Array.from({ length: 12 }, (_, index) => `W${index + 1}`);

/** Halts per weekday and week: busy weekdays, quiet weekends. */
export const HEAT_CELLS: readonly (readonly number[])[] = HEAT_ROWS.map((_, row) => HEAT_COLS.map(() => Math.round(row >= 5
  ? between(random, 0, 1.4)
  : between(random, 0, 7))));

/* ---------- graphs ---------- */

/** The layers of a small workspace, left to right. */
export const LAYER_ORDER: readonly string[] = ['core', 'platform', 'feature', 'addon', 'app'];

export const LAYER_TONES: Readonly<Record<string, ChartTone>> = {
  core: 'series-1',
  platform: 'series-3',
  feature: 'series-2',
  addon: 'series-7',
  app: 'series-5',
};

const MEMBERS: readonly (readonly [string, string, readonly string[]])[] = [
  ['core', 'core', []],
  ['inventory', 'platform', ['core']],
  ['effort', 'platform', ['core', 'inventory']],
  ['board', 'platform', ['core', 'effort']],
  ['release', 'feature', ['board', 'core', 'effort']],
  ['pr', 'feature', ['board', 'core', 'inventory', 'release']],
  ['run', 'feature', ['board', 'core', 'effort', 'pr', 'release']],
  ['data', 'addon', []],
  ['visualization', 'addon', ['data']],
  ['demo', 'app', ['data', 'visualization']],
];

const DEPENDENTS = new Map<string, number>();
for (const [, , deps] of MEMBERS) {
  for (const dep of deps) DEPENDENTS.set(dep, (DEPENDENTS.get(dep) ?? 0) + 1);
}

export const GRAPH_NODES: readonly GraphNode[] = MEMBERS.map(([id, group]) => ({
  id,
  label: id,
  group,
  value: 1 + (DEPENDENTS.get(id) ?? 0),
}));

/** Dependency to dependent: the direction code flows. */
export const GRAPH_LINKS: readonly GraphLink[] = MEMBERS.flatMap(([id, , deps]) => deps.map((dep) => ({ source: dep, target: id, value: 1 })));

/* ---------- rose and sunburst ---------- */

export const ROSE_SLICES: readonly RoseSlice[] = [
  { id: 'core', label: 'core', value: 140_000, group: 'core' },
  { id: 'board', label: 'board', value: 92_000, group: 'platform' },
  { id: 'run', label: 'run', value: 68_000, group: 'feature' },
  { id: 'pr', label: 'pr', value: 58_000, group: 'feature' },
  { id: 'inventory', label: 'inventory', value: 33_000, group: 'platform' },
  { id: 'release', label: 'release', value: 28_000, group: 'feature' },
  { id: 'effort', label: 'effort', value: 14_000, group: 'platform' },
  { id: 'data', label: 'data', value: 2_000, group: 'addon' },
];

const PART_TONES: Readonly<Record<string, ChartTone>> = { source: 'series-1', tests: 'series-3', docs: 'series-5', config: 'series-4' };

/** Inner ring: the packages; outer ring: what each one is made of. */
export const SUNBURST_NODES: readonly SunburstNode[] = [
  ['core', 'core', [50, 44, 1, 45]],
  ['board', 'platform', [51, 41, 1, 1]],
  ['run', 'feature', [33, 35, 0, 1]],
  ['pr', 'feature', [25, 25, 1, 8]],
].map(([id = '', group = '', counts = []]) => ({
  id: String(id),
  label: String(id),
  group: String(group),
  children: ['source', 'tests', 'docs', 'config']
    .map((part, index) => ({ id: `${String(id)}/${part}`, label: part, value: (counts as number[])[index] ?? 0, group: part }))
    .filter((child) => child.value > 0),
}));

export const SUNBURST_TONES: Readonly<Record<string, ChartTone>> = { ...LAYER_TONES, ...PART_TONES };

/* ---------- radar ---------- */

export const RADAR_POLES: readonly RadarPole[] = [
  { id: 'shipping', label: 'Shipping', icon: '\u{1F4E6}', tone: 'pole-ship', coreTone: 'pole-ship-core' },
  { id: 'failing', label: 'Failing', icon: '\u{1F525}', tone: 'pole-fail', coreTone: 'pole-fail-core' },
  { id: 'foundation', label: 'Foundation', icon: '\u{1F6E0}️', tone: 'pole-base', coreTone: 'pole-base-core' },
];

export const RADAR_AXES: readonly RadarAxis[] = [
  { id: 'feat-rate', label: 'features landed', pole: 'shipping' },
  { id: 'plan-done', label: 'plans completed', pole: 'shipping' },
  { id: 'releases', label: 'releases', pole: 'shipping' },
  { id: 'bug-intake', label: 'bugs per 100 tasks', pole: 'failing' },
  { id: 'regressions', label: 'regression share', pole: 'failing' },
  { id: 'blocked', label: 'blocked or repeated', pole: 'failing' },
  { id: 'refactor-share', label: 'refactor + chore', pole: 'foundation' },
  { id: 'docs-share', label: 'docs kept current', pole: 'foundation' },
];

/** This week over its twelve-week median on each axis. */
export const RADAR_SERIES: readonly RadarSeries[] = [
  { id: 'now', label: 'This week', tone: 'neutral', values: [1.35, 1.2, 1.5, 1.1, 1.45, 1.25, 0.55, 0.8] },
];
