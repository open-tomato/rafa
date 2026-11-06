import type { DonutProps, DonutSlice } from '../../seam/types.js';
import type { PieSeriesOption } from 'echarts/charts';

import { formatCompact, formatPercent } from '../../seam/format.js';
import {
  firstParam,
  tooltipChrome,
  tooltipNode,
  type TooltipParams,
} from '../chrome.js';
import {
  type ChartOption,
  markHover,
  paint,
  type ResolvedTokens,
  withAlpha,
} from '../core.js';

/** Inner radius at ~65% of the outer one; the outer leaves air for the canvas edge. */
const RADIUS: [string, string] = ['60%', '92%'];
/** With a compare ring: the main ring moves out, the previous period sits inside it, thinner. */
const RADIUS_WITH_COMPARE: [string, string] = ['65%', '98%'];
const COMPARE_RADIUS: [string, string] = ['40%', '58%'];
const COMPARE_ALPHA = 0.6;
const CURRENT_LABEL = 'this period';
const CENTER_VALUE_SIZE = 24;
const CENTER_LABEL_SIZE = 12;

/** The ECharts option for the props over the resolved tokens; pure, so it is tested without a canvas. */
export function buildOption(props: DonutProps, tokens: ResolvedTokens): ChartOption {
  const { slices, centerValue, centerLabel } = props;
  const format = props.valueFormat ?? formatCompact;
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const centreText = [centerValue === undefined
    ? ''
    : `{value|${centerValue}}`, centerLabel === undefined
    ? ''
    : `{label|${centerLabel}}`]
    .filter((line) => line !== '')
    .join('\n');

  const compare = props.compare;
  const compareTotal = compare
    ? compare.slices.reduce((sum, slice) => sum + slice.value, 0)
    : 0;
  const share = (value: number, of: number) => formatPercent(of === 0
    ? 0
    : value / of);

  // Either ring's slice shows both periods: the slice is matched across rings by id.
  const tooltipFormatter = (params: TooltipParams) => {
    const item = firstParam(params);
    const ring = item?.seriesId === 'compare'
      ? compare?.slices
      : slices;
    const id = ring?.[item?.dataIndex ?? 0]?.id;
    const current = slices.find((slice) => slice.id === id);
    const previous = compare?.slices.find((slice) => slice.id === id);
    const shown = current ?? previous;
    if (!shown) return tooltipNode(undefined, []);
    const colour = paint(tokens, shown.tone);
    const currentRow = current
      ? [{ value: format(current.value), label: `${CURRENT_LABEL}, ${share(current.value, total)}`, colour, key: 'dot' as const }]
      : [];
    const previousRow = compare && previous
      ? [{ value: format(previous.value), label: `${compare.label}, ${share(previous.value, compareTotal)}`, colour: withAlpha(colour, COMPARE_ALPHA), key: 'dot' as const }]
      : [];
    return tooltipNode(shown.label, compare
      ? [...currentRow, ...previousRow]
      : [
        { value: format(shown.value), label: 'value', colour, key: 'dot' },
        { value: share(shown.value, total), label: 'share' },
      ]);
  };

  const ring = (id: string, radius: [string, string], ringSlices: readonly DonutSlice[], alpha: number): PieSeriesOption => ({
    type: 'pie',
    id,
    radius,
    center: ['50%', '50%'],
    avoidLabelOverlap: false,
    label: { show: false },
    labelLine: { show: false },
    // A 2px surface stroke reads as the gap between slices.
    itemStyle: { borderColor: paint(tokens, 'surface'), borderWidth: 2 },
    ...markHover,
    emphasis: { ...markHover.emphasis, scale: false },
    data: ringSlices.map((slice) => ({
      name: slice.label,
      value: slice.value,
      itemStyle: { color: alpha === 1
        ? paint(tokens, slice.tone)
        : withAlpha(paint(tokens, slice.tone), alpha) },
    })),
  });

  return {
    tooltip: { ...tooltipChrome('item'), formatter: tooltipFormatter },
    graphic: centreText === ''
      ? []
      : [{
        type: 'text',
        left: 'center',
        top: 'middle',
        silent: true,
        style: {
          text: centreText,
          align: 'center',
          rich: {
            value: { fill: paint(tokens, 'ink'), fontSize: CENTER_VALUE_SIZE, fontWeight: 600, lineHeight: 30, align: 'center' },
            label: { fill: paint(tokens, 'muted'), fontSize: CENTER_LABEL_SIZE, lineHeight: 16, align: 'center' },
          },
        },
      }],
    series: compare
      ? [ring('main', RADIUS_WITH_COMPARE, slices, 1), ring('compare', COMPARE_RADIUS, compare.slices, COMPARE_ALPHA)]
      : [ring('main', RADIUS, slices, 1)],
  };
}
