import type { GaugeProps } from '../../seam/types.js';
import type { GaugeSeriesOption } from 'echarts/charts';

import { formatCompact, formatPercent } from '../../seam/format.js';
import {
  type ChartOption,
  paint,
  type ResolvedTokens,
  withAlpha,
} from '../core.js';

/** A 220 degree arc, open at the bottom. */
const START_ANGLE = 200;
const END_ANGLE = -20;
const CENTER: [string, string] = ['50%', '58%'];
const RADIUS = '92%';
const ARC_WIDTH = 12;
/** The compare reading: a thin arc inside the main one, clear of the centre text. */
const COMPARE_RADIUS = '76%';
const COMPARE_WIDTH = 4;
const COMPARE_ALPHA = 0.6;
/** How far the max marker reaches past the arc on each side. */
const MARKER_OVERHANG = 3;
const VALUE_FONT_SIZE = 28;
const SUB_FONT_SIZE = 13;
const LABEL_FONT_SIZE = 12;

type FillTone = 'series-1' | 'warning' | 'critical';

function fillTone(fraction: number, thresholds: GaugeProps['thresholds']): FillTone {
  if (fraction > 1) return 'critical';
  if (!thresholds) return 'series-1';
  if (fraction >= thresholds.critical) return 'critical';
  if (fraction >= thresholds.warning) return 'warning';
  return 'series-1';
}

function clamp(value: number, max: number): number {
  return Math.min(Math.max(value, 0), max);
}

/** The parts every gauge series here shares: the arc geometry, no pointer, no scale. */
function arcBase(max: number): GaugeSeriesOption {
  return {
    type: 'gauge',
    startAngle: START_ANGLE,
    endAngle: END_ANGLE,
    min: 0,
    max,
    center: CENTER,
    silent: true,
    pointer: { show: false },
    anchor: { show: false },
    axisTick: { show: false },
    splitLine: { show: false },
    axisLabel: { show: false },
    title: { show: false },
    detail: { show: false },
  };
}

/** The centre text as rich-text lines: the value (or the true share past max), the sub-lines under it. */
function centreText(props: GaugeProps, format: (value: number) => string): string {
  const { value, max, label, compare } = props;
  const over = value > max;
  const lines = over
    ? [`{big|${formatPercent(value / max)}}`, `{sub|${format(value)}}`, `{label|${label}}`]
    : [`{big|${format(value)}}`, `{label|${label}}`];
  const compareLine = compare
    ? [`{compare|${compare.label} ${format(compare.value)}}`]
    : [];
  return [...lines, ...compareLine].join('\n');
}

/**
 * The max marker: a gauge with no span whose only split line sits at the
 * arc's end, drawn 2px in `ink` across the arc with a small overhang.
 */
function maxMarker(tokens: ResolvedTokens, max: number): GaugeSeriesOption {
  return {
    ...arcBase(max),
    startAngle: END_ANGLE,
    endAngle: END_ANGLE,
    radius: RADIUS,
    splitNumber: 1,
    // The split line is measured from the axis line's inner edge; a zero-width line starts it at the radius.
    axisLine: { show: false, lineStyle: { width: 0 } },
    splitLine: {
      show: true,
      distance: -MARKER_OVERHANG,
      length: ARC_WIDTH + 2 * MARKER_OVERHANG,
      lineStyle: { color: paint(tokens, 'ink'), width: 2, cap: 'butt' },
    },
    z: 3,
    data: [{ value: 0 }],
  };
}

/** The ECharts option for the props over the resolved tokens; pure, so it is tested without a canvas. */
export function buildOption(props: GaugeProps, tokens: ResolvedTokens): ChartOption {
  const { value, max, thresholds, compare } = props;
  const format = props.valueFormat ?? formatCompact;
  const fraction = max === 0
    ? 0
    : value / max;
  const fill = paint(tokens, fillTone(fraction, thresholds));
  const track = paint(tokens, 'grid');

  const main: GaugeSeriesOption = {
    ...arcBase(max),
    radius: RADIUS,
    progress: { show: true, width: ARC_WIDTH, roundCap: true, itemStyle: { color: fill } },
    axisLine: { roundCap: true, lineStyle: { width: ARC_WIDTH, color: [[1, track]] } },
    // The arc stops at max; the text keeps the true value (and share) past it.
    detail: {
      show: true,
      valueAnimation: false,
      offsetCenter: [0, compare
        ? '2%'
        : '0%'],
      formatter: () => centreText(props, format),
      rich: {
        big: { color: paint(tokens, 'ink'), fontSize: VALUE_FONT_SIZE, fontWeight: 600, lineHeight: 34 },
        sub: { color: paint(tokens, 'ink-2'), fontSize: SUB_FONT_SIZE, fontWeight: 600, lineHeight: 18 },
        label: { color: paint(tokens, 'muted'), fontSize: LABEL_FONT_SIZE, lineHeight: 18 },
        compare: { color: paint(tokens, 'ink-2'), fontSize: LABEL_FONT_SIZE, lineHeight: 18 },
      },
    },
    z: 2,
    data: [{ value: clamp(value, max) }],
  };

  const inner: GaugeSeriesOption[] = compare
    ? [{
      ...arcBase(max),
      radius: COMPARE_RADIUS,
      progress: {
        show: true,
        width: COMPARE_WIDTH,
        roundCap: true,
        itemStyle: { color: withAlpha(paint(tokens, 'muted'), COMPARE_ALPHA) },
      },
      axisLine: { roundCap: true, lineStyle: { width: COMPARE_WIDTH, color: [[1, track]] } },
      z: 1,
      data: [{ value: clamp(compare.value, max) }],
    }]
    : [];

  const marker = value > max
    ? [maxMarker(tokens, max)]
    : [];
  return { series: [main, ...inner, ...marker] };
}
