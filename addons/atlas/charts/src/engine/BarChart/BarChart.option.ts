import type { BarChartProps, BarSeries } from '../../seam/types.js';
import type { BarSeriesOption } from 'echarts/charts';

import { formatCompact, formatPercent } from '../../seam/format.js';
import {
  categoryAxis,
  firstParam,
  plotGrid,
  referenceLabelRoom,
  referenceLine,
  tooltipChrome,
  tooltipNode,
  type TooltipParams,
  valueAxis,
} from '../chrome.js';
import {
  BAR_MAX_WIDTH,
  BAR_RADIUS,
  type ChartOption,
  markHover,
  paint,
  type ResolvedTokens,
} from '../core.js';

type Corners = [number, number, number, number];

/** Each category's values as shares of its total (ECharts has no percent stack). */
function toShares(series: readonly BarSeries[], categoryCount: number): BarSeries[] {
  const totals = Array.from({ length: categoryCount }, (_, index) => series.reduce((sum, entry) => sum + (entry.values[index] ?? 0), 0));
  return series.map((entry) => ({
    ...entry,
    values: entry.values.map((value, index) => {
      const total = totals[index] ?? 0;
      return total === 0
        ? 0
        : value / total;
    }),
  }));
}

/** For each category, the index of the series drawn last in the stack with a non-zero value. */
function topOfStack(series: readonly BarSeries[], categoryCount: number): number[] {
  return Array.from({ length: categoryCount }, (_, index) => series.reduce((top, entry, seriesIndex) => ((entry.values[index] ?? 0) !== 0
    ? seriesIndex
    : top), -1));
}

/** The ECharts option for the props over the resolved tokens; pure, so it is tested without a canvas. */
export function buildOption(props: BarChartProps, tokens: ResolvedTokens): ChartOption {
  const { categories, mode = 'grouped', orientation = 'vertical', limit } = props;
  const stacked = mode !== 'grouped';
  const format = props.valueFormat ?? (mode === 'stacked100'
    ? formatPercent
    : formatCompact);
  const drawn = mode === 'stacked100'
    ? toShares(props.series, categories.length)
    : props.series;
  const tops = topOfStack(drawn, categories.length);
  const horizontal = orientation === 'horizontal';
  const dataEnd: Corners = horizontal
    ? [0, BAR_RADIUS, BAR_RADIUS, 0]
    : [BAR_RADIUS, BAR_RADIUS, 0, 0];
  const square: Corners = [0, 0, 0, 0];
  const surface = paint(tokens, 'surface');

  const series: BarSeriesOption[] = drawn.map((entry, seriesIndex) => ({
    type: 'bar',
    id: entry.id,
    name: entry.label,
    stack: stacked
      ? 'total'
      : undefined,
    barMaxWidth: BAR_MAX_WIDTH,
    barGap: 0,
    // A 1px surface stroke on each side reads as the 2px gap between touching marks.
    itemStyle: { color: paint(tokens, entry.tone), borderColor: surface, borderWidth: 1 },
    ...markHover,
    data: entry.values.map((value, index) => ({
      value,
      itemStyle: { borderRadius: !stacked || tops[index] === seriesIndex
        ? dataEnd
        : square },
    })),
    // The inverted category axis puts a vertical line's start at the top.
    markLine: limit && seriesIndex === 0
      ? (horizontal
        ? referenceLine(tokens, 'xAxis', limit.value, limit.label, 'start')
        : referenceLine(tokens, 'yAxis', limit.value, limit.label))
      : undefined,
  }));

  const valueBounds = mode === 'stacked100'
    ? { min: 0, max: 1 }
    : { max: limit
      ? (extent: { max: number }) => Math.max(extent.max, limit.value)
      : undefined };
  const value = valueAxis(tokens, format, valueBounds);
  const category = categoryAxis(tokens, categories, { inverse: horizontal });

  const tooltipFormatter = (params: TooltipParams) => {
    const item = firstParam(params);
    const seriesIndex = item?.seriesIndex ?? 0;
    const dataIndex = item?.dataIndex ?? 0;
    const entry = drawn[seriesIndex];
    const raw = props.series[seriesIndex]?.values[dataIndex] ?? 0;
    const shown = entry?.values[dataIndex] ?? 0;
    const rows = [{ value: format(shown), label: entry?.label ?? '', colour: paint(tokens, entry?.tone ?? 'series-1'), key: 'dot' as const }];
    const extra = mode === 'stacked100'
      ? [{ value: formatCompact(raw), label: 'count' }]
      : [];
    return tooltipNode(categories[dataIndex], [...rows, ...extra]);
  };

  return {
    grid: plotGrid({ right: limit && !horizontal
      ? referenceLabelRoom(limit.label)
      : 12, top: limit && horizontal
      ? 24
      : 12 }),
    xAxis: horizontal
      ? value
      : category,
    yAxis: horizontal
      ? category
      : value,
    tooltip: { ...tooltipChrome('item'), formatter: tooltipFormatter },
    series,
  };
}
