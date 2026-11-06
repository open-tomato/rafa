/**
 * The headless engine: every primitive's pure option builder, and
 * `renderToSvg`, which draws one primitive to an SVG string with ECharts'
 * server-side mode. No React and no DOM, so a CLI, a server or a test can
 * draw a chart: it registers the SVG renderer over the same `echarts/core`
 * registration the React adapter uses (`../core.ts`).
 *
 * A headless caller has no CSS variables to read, so it passes a full
 * `ResolvedTokens` map, which `tokensFrom` builds from the token values.
 */
import type {
  BarChartProps,
  BoxPlotProps,
  BulletProps,
  DonutProps,
  GaugeProps,
  HeatmapGridProps,
  HistogramProps,
  LineChartProps,
  NightingaleProps,
  RadarProps,
  ScatterChartProps,
  SunburstProps,
  TreemapProps,
} from '../../seam/types.js';
import type { NetworkOptionProps } from '../NetworkGraph/NetworkGraph.option.js';
import type { SankeyOptionProps } from '../Sankey/Sankey.option.js';

import * as echarts from 'echarts/core';
import { SVGRenderer } from 'echarts/renderers';

import { buildOption as buildBarChartOption } from '../BarChart/BarChart.option.js';
import { buildOption as buildBoxPlotOption } from '../BoxPlot/BoxPlot.option.js';
import { buildOption as buildBulletOption } from '../Bullet/Bullet.option.js';
import { finishOption, type ChartOption, type ResolvedTokens } from '../core.js';
import { buildOption as buildDonutOption } from '../Donut/Donut.option.js';
import { buildOption as buildGaugeOption } from '../Gauge/Gauge.option.js';
import { buildOption as buildHeatmapGridOption } from '../HeatmapGrid/HeatmapGrid.option.js';
import { buildOption as buildHistogramOption } from '../Histogram/Histogram.option.js';
import { buildOption as buildLineChartOption } from '../LineChart/LineChart.option.js';
import { buildOption as buildNetworkGraphOption } from '../NetworkGraph/NetworkGraph.option.js';
import { buildOption as buildNightingaleOption } from '../Nightingale/Nightingale.option.js';
import { buildOption as buildRadarOption } from '../Radar/Radar.option.js';
import { buildOption as buildSankeyOption } from '../Sankey/Sankey.option.js';
import { buildOption as buildScatterChartOption } from '../ScatterChart/ScatterChart.option.js';
import { buildOption as buildSunburstOption } from '../Sunburst/Sunburst.option.js';
import { buildOption as buildTreemapOption } from '../Treemap/Treemap.option.js';

echarts.use([SVGRenderer]);

/*
 * The rest of the subpath's surface, re-exported here rather than from
 * `index.ts`: with `sideEffects: false`, bun 1.3 drops an entry module's
 * own named re-exports from the bundle, while names an entry reaches
 * through `export *` survive.
 */
export { finishOption } from '../core.js';
export type { ChartOption, ResolvedTokens } from '../core.js';
export { tokensFrom } from '../../seam/tones.js';
export { buildOption as buildBarChartOption } from '../BarChart/BarChart.option.js';
export { buildOption as buildBoxPlotOption } from '../BoxPlot/BoxPlot.option.js';
export { buildOption as buildBulletOption } from '../Bullet/Bullet.option.js';
export { buildOption as buildDonutOption } from '../Donut/Donut.option.js';
export { buildOption as buildGaugeOption } from '../Gauge/Gauge.option.js';
export { buildOption as buildHeatmapGridOption } from '../HeatmapGrid/HeatmapGrid.option.js';
export { buildOption as buildHistogramOption } from '../Histogram/Histogram.option.js';
export { buildOption as buildLineChartOption } from '../LineChart/LineChart.option.js';
export { buildOption as buildNetworkGraphOption } from '../NetworkGraph/NetworkGraph.option.js';
export type { NetworkOptionProps } from '../NetworkGraph/NetworkGraph.option.js';
export { buildOption as buildNightingaleOption } from '../Nightingale/Nightingale.option.js';
export { buildOption as buildRadarOption } from '../Radar/Radar.option.js';
export { buildOption as buildSankeyOption } from '../Sankey/Sankey.option.js';
export type { SankeyOptionProps } from '../Sankey/Sankey.option.js';
export { buildOption as buildScatterChartOption } from '../ScatterChart/ScatterChart.option.js';
export { buildOption as buildSunburstOption } from '../Sunburst/Sunburst.option.js';
export { buildOption as buildTreemapOption } from '../Treemap/Treemap.option.js';
export type { TokenName } from '../../theme/index.js';
export * from '../../seam/format.js';
export * from '../../seam/format.schema.js';

/** One builder per primitive: props and tokens in, the ECharts option out. */
export interface OptionBuilders {
  readonly BarChart: (props: BarChartProps, tokens: ResolvedTokens) => ChartOption;
  readonly BoxPlot: (props: BoxPlotProps, tokens: ResolvedTokens) => ChartOption;
  readonly Bullet: (props: BulletProps, tokens: ResolvedTokens) => ChartOption;
  readonly Donut: (props: DonutProps, tokens: ResolvedTokens) => ChartOption;
  readonly Gauge: (props: GaugeProps, tokens: ResolvedTokens) => ChartOption;
  readonly HeatmapGrid: (props: HeatmapGridProps, tokens: ResolvedTokens) => ChartOption;
  readonly Histogram: (props: HistogramProps, tokens: ResolvedTokens) => ChartOption;
  readonly LineChart: (props: LineChartProps, tokens: ResolvedTokens) => ChartOption;
  readonly NetworkGraph: (props: NetworkOptionProps, tokens: ResolvedTokens) => ChartOption;
  readonly Nightingale: (props: NightingaleProps, tokens: ResolvedTokens) => ChartOption;
  readonly Radar: (props: RadarProps, tokens: ResolvedTokens) => ChartOption;
  readonly Sankey: (props: SankeyOptionProps, tokens: ResolvedTokens) => ChartOption;
  readonly ScatterChart: (props: ScatterChartProps, tokens: ResolvedTokens) => ChartOption;
  /** `width` sizes the radial labels; `renderToSvg` passes the drawing's width. */
  readonly Sunburst: (props: SunburstProps, tokens: ResolvedTokens, width?: number, measuredHeight?: number) => ChartOption;
  readonly Treemap: (props: TreemapProps, tokens: ResolvedTokens) => ChartOption;
}

/** The fifteen builders, by primitive name. */
export const OPTION_BUILDERS: OptionBuilders = {
  BarChart: buildBarChartOption,
  BoxPlot: buildBoxPlotOption,
  Bullet: buildBulletOption,
  Donut: buildDonutOption,
  Gauge: buildGaugeOption,
  HeatmapGrid: buildHeatmapGridOption,
  Histogram: buildHistogramOption,
  LineChart: buildLineChartOption,
  NetworkGraph: buildNetworkGraphOption,
  Nightingale: buildNightingaleOption,
  Radar: buildRadarOption,
  Sankey: buildSankeyOption,
  ScatterChart: buildScatterChartOption,
  Sunburst: buildSunburstOption,
  Treemap: buildTreemapOption,
};

/** A primitive's name, as `ChartPrimitives` and the React engine spell it. */
export type PrimitiveName = keyof OptionBuilders;

/** The props a primitive's builder reads. */
export type PrimitiveOptionProps<K extends PrimitiveName> = Parameters<OptionBuilders[K]>[0];

/** The size of the drawing, and what it may override. */
export interface SvgRenderOptions {
  /** The drawing's width in px. */
  readonly width: number;
  /** The drawing's height in px. */
  readonly height: number;
  /** The font stack for every text; `sans-serif` when absent, as there is no page to read it from. */
  readonly fontFamily?: string;
  /**
   * The prefix of the ids and classes inside the SVG. Two SVGs inlined in one
   * page need different prefixes; absent, it is a hash of the drawing, so the
   * same input gives the same string and two different drawings do not clash.
   */
  readonly idPrefix?: string;
}

/** ECharts names ids and classes `zr<instance>-<kind><n>`, from counters that grow with every instance. */
const INSTANCE_ID = /zr\d+-(?=[a-z]+-?\d)/g;

/** The same names once the instance number is taken out. */
const PLACEHOLDER_ID = /zr-(?=[a-z]+-?\d)/g;

/** A style class, numbered by a module-wide counter. */
const STYLE_CLASS = /zr\d+-cls-(\d+)/g;

/** The FNV-1a offset basis and prime, for a short stable hash with no platform API. */
const FNV_OFFSET = 0x81_1c_9d_c5;
const FNV_PRIME = 0x01_00_01_93;
const HEX = 16;

/** A short hex hash of `text`. */
function hashOf(text: string): string {
  let hash = FNV_OFFSET;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash.toString(HEX).padStart(8, '0');
}

/**
 * Makes the ids and classes of one rendering independent of how many charts
 * were drawn before it: classes are renumbered by first use, and the
 * instance prefix becomes `prefix`, or a hash of the drawing.
 */
function stableIds(svg: string, prefix: string | undefined): string {
  const classes = new Map<string, number>();
  const renumbered = svg.replace(STYLE_CLASS, (_match, number: string) => {
    const index = classes.get(number) ?? classes.size;
    classes.set(number, index);
    return `zr-cls-${index}`;
  }).replace(INSTANCE_ID, 'zr-');
  const stable = prefix ?? `c${hashOf(renumbered)}`;
  return renumbered.replace(PLACEHOLDER_ID, `${stable}-`);
}

/**
 * Draws one primitive to an SVG string with ECharts' server-side renderer:
 * the builder's option over `tokens`, finished as the React adapter
 * finishes it but with animation off, set on an instance with no DOM, then
 * disposed. The same input gives the same string. A chart whose `height`
 * is `'fill'` fills the drawing: the builders that size a layout from the
 * height (Sunburst) read the drawing's height as the measured one.
 */
export function renderToSvg<K extends PrimitiveName>(
  primitive: K,
  props: PrimitiveOptionProps<K>,
  tokens: ResolvedTokens,
  options: SvgRenderOptions,
): string {
  const { width, height, fontFamily, idPrefix } = options;
  const build = OPTION_BUILDERS[primitive] as (props: PrimitiveOptionProps<K>, tokens: ResolvedTokens, width: number, measuredHeight: number) => ChartOption;
  const finished = finishOption(build(props, tokens, width, height), false);
  const option: ChartOption = {
    ...finished,
    animation: false,
    textStyle: fontFamily === undefined
      ? finished.textStyle
      : { fontFamily },
  };
  const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width, height });
  try {
    chart.setOption(option);
    return stableIds(chart.renderToSVGString(), idPrefix);
  } finally {
    chart.dispose();
  }
}
