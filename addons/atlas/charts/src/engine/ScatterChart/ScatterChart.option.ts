import type { ScatterChartProps } from '../../seam/types.js';
import type { LineSeriesOption, ScatterSeriesOption } from 'echarts/charts';

import { formatCompact, formatDay } from '../../seam/format.js';
import {
  firstParam,
  plotGrid,
  timeAxis,
  tooltipChrome,
  tooltipNode,
  type TooltipParams,
  valueAxis,
} from '../chrome.js';
import { type ChartOption, paint, type ResolvedTokens } from '../core.js';

/** 8px dot plus the 2px surface ring (the stroke straddles the edge). */
const DOT_SIZE = 10;
/** The invisible hit target over each dot: dots are small, the pointer is not. */
const HIT_SIZE = 24;
const DOT_OPACITY = 0.7;
export const DOTS_SERIES = 'points';
export const HIT_SERIES = 'points-hit';

/** The ECharts option for the props over the resolved tokens; pure, so it is tested without a canvas. */
export function buildOption(props: ScatterChartProps, tokens: ResolvedTokens): ChartOption {
  const format = props.valueFormat ?? formatCompact;
  const xFormat = props.xFormat ?? formatDay;
  const dot = paint(tokens, 'series-1');
  const data = props.points.map((point) => [point.x.getTime(), point.y]);

  const dots: ScatterSeriesOption = {
    type: 'scatter',
    id: DOTS_SERIES,
    name: props.pointsLabel,
    symbolSize: DOT_SIZE,
    silent: true,
    itemStyle: { color: dot, opacity: DOT_OPACITY, borderColor: paint(tokens, 'surface'), borderWidth: 2 },
    emphasis: { scale: 1.2, itemStyle: { opacity: 1 } },
    data,
    z: 3,
  };
  const hits: ScatterSeriesOption = {
    type: 'scatter',
    id: HIT_SERIES,
    name: props.pointsLabel,
    symbolSize: HIT_SIZE,
    itemStyle: { opacity: 0 },
    emphasis: { disabled: true },
    data,
    z: 6,
  };
  const trend: LineSeriesOption[] = props.trend
    ? [{
      type: 'line',
      id: 'trend',
      name: props.trendLabel ?? 'trend',
      silent: true,
      showSymbol: false,
      symbol: 'none',
      lineStyle: { color: paint(tokens, 'series-2'), width: 2, cap: 'round', join: 'round' },
      data: props.trend.map((point) => [point.x.getTime(), point.y]),
      // Over the dots: dense dots would otherwise hide the summary line.
      z: 5,
    }]
    : [];

  const tooltipFormatter = (params: TooltipParams) => {
    const index = firstParam(params)?.dataIndex ?? 0;
    const point = props.points[index];
    if (!point) return tooltipNode(undefined, []);
    return tooltipNode(point.label, [
      { value: format(point.y), label: props.yLabel, colour: dot, key: 'dot' },
      { value: xFormat(point.x), label: 'day' },
    ]);
  };

  return {
    grid: plotGrid({ right: 12 }),
    xAxis: timeAxis(tokens, xFormat),
    yAxis: valueAxis(tokens, format, { min: 0 }),
    tooltip: { ...tooltipChrome('item'), formatter: tooltipFormatter },
    series: [...trend, dots, hits],
  };
}
