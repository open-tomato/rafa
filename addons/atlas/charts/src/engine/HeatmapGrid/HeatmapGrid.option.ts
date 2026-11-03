import type { HeatmapGridProps } from '../../seam/types.js';

import { formatCompact } from '../../seam/format.js';
import { SEQUENTIAL_STEPS } from '../../seam/tones.js';
import {
  categoryAxis,
  firstParam,
  numericAt,
  plotGrid,
  tooltipChrome,
  tooltipNode,
  type TooltipParams,
} from '../chrome.js';
import {
  type ChartOption,
  markHover,
  paint,
  type ResolvedTokens,
} from '../core.js';

const CELL_RADIUS = 2;
const RING_WIDTH = 2;

/** The ECharts option for the props over the resolved tokens; pure, so it is tested without a canvas. */
export function buildOption(props: HeatmapGridProps, tokens: ResolvedTokens): ChartOption {
  const { rows, cols, cells, colLabelEvery = 1, unit } = props;
  const format = props.valueFormat ?? formatCompact;
  const ramp = SEQUENTIAL_STEPS.map((step) => paint(tokens, step));
  const { selected } = props;
  const isSelected = (rowIndex: number, colIndex: number) => selected?.row === rowIndex && selected.col === colIndex;
  const ring = { borderColor: paint(tokens, 'ink'), borderWidth: RING_WIDTH };
  const plain = cells.flatMap((row, rowIndex) => row
    .map((value, colIndex) => [colIndex, rowIndex, value])
    .filter((_, colIndex) => !isSelected(rowIndex, colIndex)));
  // The selected cell is drawn last, so its neighbours' surface gap never paints over its ring.
  const picked = selected
    ? cells[selected.row]?.[selected.col]
    : undefined;
  const data = picked === undefined || !selected
    ? plain
    : [...plain, { value: [selected.col, selected.row, picked], itemStyle: ring }];
  const max = Math.max(1, ...cells.flat());

  const tooltipFormatter = (params: TooltipParams) => {
    const value = firstParam(params)?.value;
    const col = cols[numericAt(value, 0)];
    const row = rows[numericAt(value, 1)];
    return tooltipNode(`${row ?? ''} · ${col ?? ''}`, [{ value: format(numericAt(value, 2)), label: unit }]);
  };

  return {
    grid: plotGrid({ right: 4, top: 4 }),
    xAxis: categoryAxis(tokens, cols, { interval: Math.max(0, colLabelEvery - 1), showLine: false, position: 'bottom' }),
    yAxis: categoryAxis(tokens, rows, { inverse: true, showLine: false }),
    // Seven steps of the sequential ramp, seq-100 near zero to seq-700 at the max.
    visualMap: {
      type: 'piecewise',
      show: false,
      min: 0,
      max,
      splitNumber: ramp.length,
      inRange: { color: ramp },
    },
    tooltip: { ...tooltipChrome('item'), formatter: tooltipFormatter },
    series: [{
      type: 'heatmap',
      name: unit,
      // A 2px surface stroke reads as the gap between cells.
      itemStyle: { borderColor: paint(tokens, 'surface'), borderWidth: 2, borderRadius: CELL_RADIUS },
      ...markHover,
      data,
    }],
  };
}
