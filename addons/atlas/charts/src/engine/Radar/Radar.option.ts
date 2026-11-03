import type { RadarAxis, RadarPole, RadarProps } from '../../seam/types.js';
import type { PieSeriesOption } from 'echarts/charts';
import type { RadarComponentOption } from 'echarts/components';

import { formatCompact } from '../../seam/format.js';
import {
  firstParam,
  tooltipChrome,
  tooltipNode,
  type TooltipParams,
} from '../chrome.js';
import {
  type ChartOption,
  mix,
  paint,
  type ResolvedTokens,
  TICK_FONT_SIZE,
  withAlpha,
} from '../core.js';

/** The radar's radius; the rest of the canvas holds the axis names and the pole labels. */
const RADIUS_SHARE = 0.6;
const RADIUS = `${RADIUS_SHARE * 100}%`;
const DEFAULT_MAX = 2;
const SPLIT_NUMBER = 4;
/** The first axis points straight up; the axes then run clockwise, like the pies behind them. */
const START_ANGLE = 90;
const AREA_ALPHA = 0.1;
const HOVER_ALPHA = 0.05;
const SYMBOL_SIZE = 6;
const POLE_FONT_SIZE = 14;
/** How far past the radar's edge the pole labels sit, clear of the axis names. */
const POLE_LABEL_OFFSET = 52;
const AXIS_NAME_GAP = 8;
const BASELINE_NAME_GAP = 4;
/** The wedge gradient is stepped into this many rings, core colour at the centre, rim colour at the edge. */
const BAND_COUNT = 12;
/** The wedge alpha outside the baseline ring, and inside it at no history and at full history. */
const RIM_ALPHA = 0.14;
const CORE_ALPHA_EMPTY = 0.14;
const CORE_ALPHA_FULL = 0.8;
/** The ring's stroke at no history and at full history. */
const RING_WIDTH_EMPTY = 1;
const RING_WIDTH_FULL = 2;
const RING_ALPHA_EMPTY = 0.3;
const RING_ALPHA_FULL = 0.75;

interface PoleRun { pole: RadarPole | undefined; id: string; count: number }

/** The poles in axis order, one run per block of contiguous axes. */
function poleRuns(axes: readonly RadarAxis[], poles: readonly RadarPole[]): PoleRun[] {
  return axes.reduce<PoleRun[]>((runs, axis) => {
    const last = runs.at(-1);
    if (last && last.id === axis.pole) return [...runs.slice(0, -1), { ...last, count: last.count + 1 }];
    return [...runs, { id: axis.pole, pole: poles.find((pole) => pole.id === axis.pole), count: 1 }];
  }, []);
}

/** A pie whose slices line up with the axes: each spans `count` axis steps, centred on its axes. */
function alignedPie(axisCount: number, radius: [string, string] = ['0%', RADIUS]): PieSeriesOption {
  const step = 360 / Math.max(1, axisCount);
  return {
    type: 'pie',
    radius,
    center: ['50%', '50%'],
    startAngle: START_ANGLE + step / 2,
    clockwise: true,
    avoidLabelOverlap: false,
    animation: false,
  };
}

/** The share of history behind the baseline, 0..1; absent means full. */
function confidence(history: RadarProps['history']): number {
  if (!history || history.of <= 0) return 1;
  return Math.min(1, Math.max(0, history.weeks / history.of));
}

const lerp = (from: number, to: number, share: number) => from + (to - from) * share;

/**
 * The pole wedges as stacked rings: band `i` spans its share of the radius and
 * paints the core-to-rim colour at that distance. Bands inside the baseline
 * solidify with the history share, so the "as usual" centre firms up as the
 * medians gain weeks behind them.
 */
function wedgeBands(runs: PoleRun[], axisCount: number, tokens: ResolvedTokens, baselineShare: number, history: number): PieSeriesOption[] {
  const coreAlpha = lerp(CORE_ALPHA_EMPTY, CORE_ALPHA_FULL, history);
  return Array.from({ length: BAND_COUNT }, (_, band) => {
    const from = band / BAND_COUNT;
    const to = (band + 1) / BAND_COUNT;
    const middle = (from + to) / 2;
    const inside = middle <= baselineShare;
    return {
      ...alignedPie(axisCount, [`${from * RADIUS_SHARE * 100}%`, `${to * RADIUS_SHARE * 100}%`]),
      id: `band-${band}`,
      silent: true,
      z: 0,
      label: { show: false },
      labelLine: { show: false },
      itemStyle: { borderWidth: 0 },
      data: runs.map((run) => {
        const core = paint(tokens, run.pole?.coreTone ?? 'neutral');
        const rim = paint(tokens, run.pole?.tone ?? 'neutral');
        return {
          name: run.id,
          value: run.count,
          itemStyle: { color: withAlpha(mix(core, rim, middle), inside
            ? coreAlpha
            : RIM_ALPHA) },
        };
      }),
    };
  });
}

/** The ECharts option for the props over the resolved tokens; pure, so it is tested without a canvas. */
export function buildOption(props: RadarProps, tokens: ResolvedTokens): ChartOption {
  const { axes, poles, series, baseline } = props;
  const max = props.max ?? DEFAULT_MAX;
  const format = props.valueFormat ?? formatCompact;
  const grid = paint(tokens, 'grid');
  const ink = paint(tokens, 'ink');
  const ink2 = paint(tokens, 'ink-2');
  const step = 360 / Math.max(1, axes.length);
  const history = confidence(props.history);
  const baselineShare = baseline && baseline.value > 0 && baseline.value <= max
    ? baseline.value / max
    : 0;

  const tooltipFormatter = (params: TooltipParams) => {
    const index = firstParam(params)?.dataIndex ?? -1;
    const axis = axes[index];
    if (!axis) return tooltipNode(undefined, []);
    const pole = poles.find((entry) => entry.id === axis.pole);
    return tooltipNode([pole?.icon, axis.label].filter(Boolean).join(' '), series.map((entry) => ({
      value: format(entry.values[index] ?? 0),
      label: entry.label,
      colour: paint(tokens, entry.tone),
      key: 'line' as const,
    })));
  };

  const scale: RadarComponentOption = {
    center: ['50%', '50%'],
    radius: RADIUS,
    startAngle: START_ANGLE,
    clockwise: true,
    shape: 'circle',
    splitNumber: SPLIT_NUMBER,
    z: 1,
    indicator: axes.map((axis) => ({ name: axis.label, min: 0, max })),
    axisName: { color: ink2, fontSize: TICK_FONT_SIZE },
    axisNameGap: AXIS_NAME_GAP,
    axisLine: { lineStyle: { color: grid, width: 1 } },
    splitLine: { lineStyle: { color: grid, width: 1 } },
    splitArea: { show: false },
  };

  // The baseline ring: a second, one-axis radar sized to the baseline value; its only split line is the ring
  // and its axis name is the label, set on the boundary between the last pole and the first.
  const baselineRing: RadarComponentOption[] = baselineShare > 0 && baseline
    ? [{
      center: ['50%', '50%'],
      radius: `${RADIUS_SHARE * 100 * baselineShare}%`,
      startAngle: START_ANGLE + step / 2,
      shape: 'circle',
      splitNumber: 1,
      z: 2,
      indicator: [{ name: baseline.label, min: 0, max: 1 }],
      axisName: { color: ink2, fontSize: TICK_FONT_SIZE },
      axisNameGap: BASELINE_NAME_GAP,
      axisLine: { show: false },
      splitLine: {
        lineStyle: {
          color: withAlpha(ink, lerp(RING_ALPHA_EMPTY, RING_ALPHA_FULL, history)),
          width: lerp(RING_WIDTH_EMPTY, RING_WIDTH_FULL, history),
        },
      },
      splitArea: { show: false },
    }]
    : [];

  const runs = poleRuns(axes, poles);

  return {
    tooltip: { ...tooltipChrome('item'), formatter: tooltipFormatter },
    radar: [scale, ...baselineRing],
    series: [
      ...wedgeBands(runs, axes.length, tokens, baselineShare, history),
      // The pole labels: a transparent full pie carrying one label per run at the outer edge.
      {
        ...alignedPie(axes.length),
        id: 'poles',
        silent: true,
        z: 0,
        itemStyle: { color: 'transparent', borderWidth: 0 },
        label: {
          show: true,
          position: 'outside',
          color: ink2,
          fontSize: POLE_FONT_SIZE,
          formatter: (params: { dataIndex: number }) => {
            const pole = runs[params.dataIndex]?.pole;
            return [pole?.icon, pole?.label].filter(Boolean).join(' ');
          },
        },
        labelLine: { show: false, length: POLE_LABEL_OFFSET, length2: 0 },
        data: runs.map((run) => ({ name: run.id, value: run.count })),
      },
      {
        type: 'radar',
        id: 'shapes',
        radarIndex: 0,
        silent: true,
        z: 3,
        symbol: 'circle',
        symbolSize: SYMBOL_SIZE,
        data: series.map((entry) => {
          const colour = paint(tokens, entry.tone);
          return {
            name: entry.label,
            value: axes.map((_, index) => entry.values[index] ?? 0),
            itemStyle: { color: colour },
            lineStyle: { color: colour, width: 2, join: 'round' as const, cap: 'round' as const },
            areaStyle: { color: withAlpha(colour, AREA_ALPHA) },
          };
        }),
      },
      // The hit layer: a transparent slice per axis, so hovering anywhere near an axis reads every series on it.
      {
        ...alignedPie(axes.length),
        id: 'axes',
        z: 4,
        cursor: 'default',
        label: { show: false },
        labelLine: { show: false },
        itemStyle: { color: 'transparent', borderWidth: 0 },
        emphasis: { scale: false, itemStyle: { color: withAlpha(ink, HOVER_ALPHA) } },
        data: axes.map((axis) => ({ name: axis.label, value: 1 })),
      },
    ],
  };
}
