/**
 * The ChartPrimitives seam: the one interface every engine implements, so a
 * card never imports a chart library. Props carry data and tones only;
 * colours are resolved by the engine from the CSS tokens (see tones.ts).
 */
import type { ChartHeight } from './height.js';
import type { POLE_TOKENS, SERIES_TOKENS, STATUS_TOKENS, TokenName } from '../theme/index.js';
import type { ComponentType } from 'react';

export type EngineId = 'echarts';

/** A series colour name: `series-1` to `series-8`. */
export type SeriesTone = TokenName<typeof SERIES_TOKENS[number]>;

/** A status colour name: `good`, `warning`, `serious`, `critical`. */
export type StatusTone = TokenName<typeof STATUS_TOKENS[number]>;

/** A balance pole colour name: the rim colour and the `-core` colour at the centre. */
export type PoleTone = TokenName<typeof POLE_TOKENS[number]>;

/** A role, never a hex: the engines paint marks with the token behind it. */
export type ChartTone = SeriesTone | StatusTone | PoleTone | 'neutral' | 'muted';

export interface ChartCommonProps {
  /**
   * Plot height: px, or `'fill'` for the full height of the container, which
   * must have a height of its own (a maximised card's box). 220px when absent.
   * The width always follows the container.
   */
  height?: ChartHeight;
  className?: string;
  /** Read by assistive tech on the chart root; required. */
  ariaLabel: string;
  /** Formats a value for axis ticks, direct labels and tooltips. */
  valueFormat?: (value: number) => string;
  /**
   * Mount animation and animated layouts. Defaults to true; stories, captures
   * and tests that need a still picture pass false.
   */
  animate?: boolean;
}

export interface BarSeries {
  id: string;
  label: string;
  tone: ChartTone;
  /** One value per category, same order as `categories`. */
  values: readonly number[];
}

export interface BarChartProps extends ChartCommonProps {
  categories: readonly string[];
  series: readonly BarSeries[];
  /** grouped: side by side; stacked: sums; stacked100: shares of the category total. */
  mode?: 'grouped' | 'stacked' | 'stacked100';
  orientation?: 'vertical' | 'horizontal';
  /** A reference line across the value axis (a WIP limit, a target). */
  limit?: { value: number; label: string };
}

export interface TimePoint { x: Date; y: number }

export interface LineSeries {
  id: string;
  label: string;
  tone: ChartTone;
  points: readonly TimePoint[];
}

export interface LineChartProps extends ChartCommonProps {
  series: readonly LineSeries[];
  /** line: strokes only; area: one series with a 10% wash; stacked-area: sums. */
  variant?: 'line' | 'area' | 'stacked-area';
  /** A horizontal reference (an average, a target). */
  baseline?: { value: number; label: string };
  xFormat?: (date: Date) => string;
  /** A range selector under the plot (a brush or data zoom); the plot shows the selected range. */
  zoom?: boolean;
  /** Fires when the selected range changes; null when the whole range is back. */
  onRangeChange?: (range: { from: Date; to: Date } | null) => void;
}

export interface ScatterPoint { x: Date; y: number; label: string }

export interface ScatterChartProps extends ChartCommonProps {
  points: readonly ScatterPoint[];
  /** A smoothed line over the points (a moving average), same x domain. */
  trend?: readonly TimePoint[];
  trendLabel?: string;
  pointsLabel: string;
  yLabel: string;
  xFormat?: (date: Date) => string;
}

export interface HistogramBin { from: number; to: number; count: number }

export interface HistogramProps extends ChartCommonProps {
  bins: readonly HistogramBin[];
  /** The unit of the binned value, for the x axis ("min"). */
  unit: string;
}

export interface BoxGroup {
  label: string;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  outliers?: readonly number[];
}

export interface BoxPlotProps extends ChartCommonProps {
  groups: readonly BoxGroup[];
  unit: string;
}

export interface GaugeProps extends ChartCommonProps {
  value: number;
  max: number;
  label: string;
  /** Fractions of max where the fill turns warning, then critical. */
  thresholds?: { warning: number; critical: number };
  /**
   * A second reading on a thin inner arc (last week, the plan). When `value`
   * passes `max` the main arc is full and critical, the text says the true
   * share (124%), and a marker sits at the max.
   */
  compare?: { value: number; label: string };
}

export interface BulletProps extends ChartCommonProps {
  value: number;
  target: number;
  max: number;
  /** Band ends as fractions of max: good up to [0], warning up to [1], serious after. */
  ranges: [number, number];
  label: string;
  /** false when a smaller value is the good one (a failure share). */
  higherIsBetter?: boolean;
}

export interface DonutSlice { id: string; label: string; tone: ChartTone; value: number }

export interface DonutProps extends ChartCommonProps {
  slices: readonly DonutSlice[];
  /** A second set of slices on a thinner inner ring (the previous period), same ids and tones. */
  compare?: { label: string; slices: readonly DonutSlice[] };
  centerValue?: string;
  centerLabel?: string;
}

export interface TreemapNode { id: string; label: string; value: number; group: string }

export interface TreemapProps extends ChartCommonProps {
  nodes: readonly TreemapNode[];
  groupTones: Readonly<Record<string, ChartTone>>;
  unit: string;
}

export interface HeatmapGridProps extends ChartCommonProps {
  rows: readonly string[];
  cols: readonly string[];
  /** cells[rowIndex][colIndex]; the sequential blue ramp maps 0..max. */
  cells: readonly (readonly number[])[];
  /** Show every nth column label (weeks: 4). */
  colLabelEvery?: number;
  unit: string;
  /** The cell is a button when set: click or Enter fires it. */
  onCellClick?: (cell: HeatmapCell) => void;
  /** The cell drawn with a selection ring. */
  selected?: { row: number; col: number } | null;
}

export interface HeatmapCell { row: number; col: number; value: number }

export interface GraphNode {
  id: string;
  label: string;
  /** The group names the tone and, in a Sankey, the column. */
  group: string;
  /** Node weight (size in a network map). */
  value?: number;
}

export interface GraphLink { source: string; target: string; value: number }

export interface NetworkGraphProps extends ChartCommonProps {
  nodes: readonly GraphNode[];
  links: readonly GraphLink[];
  groupTones: Readonly<Record<string, ChartTone>>;
  onNodeClick?: (node: GraphNode) => void;
}

export interface SankeyProps extends ChartCommonProps {
  /** A DAG; the engine lays columns out by group order when it can. */
  nodes: readonly GraphNode[];
  links: readonly GraphLink[];
  groupTones: Readonly<Record<string, ChartTone>>;
  /** Column order of the groups, left to right. */
  groupOrder: readonly string[];
}

export interface RoseSlice {
  id: string;
  label: string;
  value: number;
  /** The group names the tone through `groupTones`; `tone` wins when set. */
  group?: string;
  tone?: ChartTone;
}

/** A Nightingale rose: equal angles, the radius encodes the value, so the biggest slice is the tallest. */
export interface NightingaleProps extends ChartCommonProps {
  slices: readonly RoseSlice[];
  groupTones?: Readonly<Record<string, ChartTone>>;
  unit: string;
}

export interface SunburstNode {
  id: string;
  label: string;
  /** Leaf value; a parent's value is the sum of its children when left out. */
  value?: number;
  group?: string;
  tone?: ChartTone;
  children?: readonly SunburstNode[];
}

/** A layered sunburst: the inner ring is the first level, each outer ring a level deeper. */
export interface SunburstProps extends ChartCommonProps {
  nodes: readonly SunburstNode[];
  groupTones?: Readonly<Record<string, ChartTone>>;
  unit: string;
  /** Fires with the ids from the root to the clicked node. */
  onNodeClick?: (path: string[]) => void;
}

export interface RadarAxis {
  id: string;
  label: string;
  /** The pole this axis is pulled toward; axes of one pole are contiguous. */
  pole: string;
}

/** One of the directions the shape can tilt toward: a wedge behind its axes, coloured core to rim. */
export interface RadarPole {
  id: string;
  label: string;
  /** The colour at the rim of the wedge. */
  tone: ChartTone;
  /** The colour at the centre of the wedge. */
  coreTone: ChartTone;
  /** A glyph drawn at the wedge's outer edge (an emoji is fine). */
  icon?: string;
}

export interface RadarSeries {
  id: string;
  label: string;
  tone: ChartTone;
  /** One value per axis, same order as `axes`, on the 0..max scale. */
  values: readonly number[];
}

/** A radar whose axes are grouped into poles, so the shape's bulge reads as a tilt toward one pole. */
export interface RadarProps extends ChartCommonProps {
  axes: readonly RadarAxis[];
  poles: readonly RadarPole[];
  series: readonly RadarSeries[];
  /** The outer edge of the scale; 1 is the baseline ring when values are ratios to a baseline. */
  max?: number;
  /** A ring drawn at this value with a label (the baseline). */
  baseline?: { value: number; label: string };
  /**
   * How much history stands behind the baseline: `weeks` of `of`. The ring and
   * the wedge cores inside it solidify as the share grows; absent means full.
   */
  history?: { weeks: number; of: number };
}

export interface ChartPrimitives {
  id: EngineId;
  label: string;
  /** What this engine could not draw natively and how the gap is covered. */
  notes: readonly string[];
  BarChart: ComponentType<BarChartProps>;
  LineChart: ComponentType<LineChartProps>;
  ScatterChart: ComponentType<ScatterChartProps>;
  Histogram: ComponentType<HistogramProps>;
  BoxPlot: ComponentType<BoxPlotProps>;
  Gauge: ComponentType<GaugeProps>;
  Bullet: ComponentType<BulletProps>;
  Donut: ComponentType<DonutProps>;
  Treemap: ComponentType<TreemapProps>;
  HeatmapGrid: ComponentType<HeatmapGridProps>;
  NetworkGraph: ComponentType<NetworkGraphProps>;
  Sankey: ComponentType<SankeyProps>;
  Nightingale: ComponentType<NightingaleProps>;
  Sunburst: ComponentType<SunburstProps>;
  Radar: ComponentType<RadarProps>;
}
