import type { HistogramProps } from '../../seam/types.js';

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
  BAR_RADIUS,
  type ChartOption,
  markHover,
  paint,
  type ResolvedTokens,
} from '../core.js';

/** Bins touch: the only gap is the 2px surface gap. */
const BIN_GAP_PX = 2;

/** The ECharts option for the props over the resolved tokens; pure, so it is tested without a canvas. */
export function buildOption(props: HistogramProps, tokens: ResolvedTokens): ChartOption {
  const { bins, unit } = props;
  const format = props.valueFormat ?? formatCompact;
  const fill = paint(tokens, 'series-1');
  const edges = [...bins.map((bin) => bin.from), bins.at(-1)?.to ?? 0];
  const edgeLabels = edges.map((edge, index) => (index === edges.length - 1
    ? `${edge} ${unit}`
    : String(edge)));

  // The bars sit on a band axis with hidden labels; a second category axis with
  // n+1 entries and no boundary gap puts its ticks on the band edges.
  const bands = categoryAxis(tokens, bins.map((bin) => `${bin.from}–${bin.to}`), { showLabels: false });
  const edgeAxis = categoryAxis(tokens, edgeLabels, { showLine: false, boundaryGap: false, position: 'bottom' });

  const tooltipFormatter = (params: TooltipParams) => {
    const bin = bins[firstParam(params)?.dataIndex ?? 0];
    if (!bin) return tooltipNode(undefined, []);
    return tooltipNode(`${bin.from}–${bin.to} ${unit}`, [{ value: format(bin.count), label: 'count', colour: fill, key: 'dot' }]);
  };

  return {
    grid: plotGrid({ right: 16 }),
    xAxis: [bands, edgeAxis],
    yAxis: valueAxis(tokens, format, { min: 0 }),
    tooltip: { ...tooltipChrome('item'), formatter: tooltipFormatter },
    series: [{
      type: 'bar',
      name: 'count',
      xAxisIndex: 0,
      barCategoryGap: BIN_GAP_PX,
      itemStyle: { color: fill, borderRadius: [BAR_RADIUS, BAR_RADIUS, 0, 0] },
      ...markHover,
      data: bins.map((bin) => bin.count),
    }],
  };
}
