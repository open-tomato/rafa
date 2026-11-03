import type { BoxPlotProps } from '../../seam/types.js';
import type { BoxplotSeriesOption, CustomSeriesOption, ScatterSeriesOption } from 'echarts/charts';

import { formatCompact } from '../../seam/format.js';
import {
  categoryAxis,
  firstParam,
  plotGrid,
  tooltipChrome,
  tooltipNode,
  type TooltipParams,
  valueAxis,
} from '../chrome.js';
import {
  BAR_MAX_WIDTH,
  type ChartOption,
  markHover,
  paint,
  type ResolvedTokens,
  withAlpha,
} from '../core.js';

const BOX_FILL_ALPHA = 0.35;
/** 6px outlier dot plus the 2px surface ring (the stroke straddles the edge). */
const OUTLIER_SIZE = 8;

/** The ECharts option for the props over the resolved tokens; pure, so it is tested without a canvas. */
export function buildOption(props: BoxPlotProps, tokens: ResolvedTokens): ChartOption {
  const { groups, unit } = props;
  const format = props.valueFormat ?? formatCompact;
  const tone = paint(tokens, 'series-1');
  const ink = paint(tokens, 'ink');

  // ECharts strokes the box, the whiskers and the median with one borderColor.
  // It is set to ink-2 (the whisker rule); the median is redrawn on top in ink.
  const boxes: BoxplotSeriesOption = {
    type: 'boxplot',
    name: unit,
    boxWidth: [BAR_MAX_WIDTH, BAR_MAX_WIDTH],
    itemStyle: { color: withAlpha(tone, BOX_FILL_ALPHA), borderColor: paint(tokens, 'ink-2'), borderWidth: 1 },
    ...markHover,
    data: groups.map((group) => [group.min, group.q1, group.median, group.q3, group.max]),
  };
  const medians: CustomSeriesOption = {
    type: 'custom',
    name: 'median',
    silent: true,
    z: 3,
    renderItem: (_params, api) => {
      const [x = 0, y = 0] = api.coord([api.value(0), api.value(1)]);
      const half = BAR_MAX_WIDTH / 2;
      return {
        type: 'line',
        shape: { x1: x - half, y1: y, x2: x + half, y2: y },
        style: { stroke: ink, lineWidth: 2 },
      };
    },
    data: groups.map((group, index) => [index, group.median]),
  };
  const outliers: ScatterSeriesOption = {
    type: 'scatter',
    name: 'outlier',
    symbolSize: OUTLIER_SIZE,
    itemStyle: { color: tone, borderColor: paint(tokens, 'surface'), borderWidth: 2 },
    data: groups.flatMap((group, index) => (group.outliers ?? []).map((value) => [index, value])),
  };

  const tooltipFormatter = (params: TooltipParams) => {
    const item = firstParam(params);
    if (item?.seriesType === 'scatter') {
      const value = Array.isArray(item.value)
        ? Number(item.value[1])
        : Number(item.value);
      const group = groups[Array.isArray(item.value)
        ? Number(item.value[0])
        : 0];
      return tooltipNode(group?.label, [{ value: `${format(value)} ${unit}`, label: 'outlier', colour: tone, key: 'dot' }]);
    }
    const group = groups[item?.dataIndex ?? 0];
    if (!group) return tooltipNode(undefined, []);
    const row = (value: number, label: string) => ({ value: `${format(value)} ${unit}`, label });
    return tooltipNode(group.label, [
      row(group.max, 'max'), row(group.q3, 'q3'), row(group.median, 'median'), row(group.q1, 'q1'), row(group.min, 'min'),
    ]);
  };

  return {
    grid: plotGrid({ right: 12 }),
    xAxis: categoryAxis(tokens, groups.map((group) => group.label)),
    yAxis: valueAxis(tokens, (value) => format(value), { min: 0 }),
    tooltip: { ...tooltipChrome('item'), formatter: tooltipFormatter },
    series: [boxes, medians, outliers],
  };
}
