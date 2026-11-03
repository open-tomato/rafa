import type { BulletProps } from '../../seam/types.js';
import type { BarSeriesOption } from 'echarts/charts';

import { formatCompact } from '../../seam/format.js';
import { plotHeightOf } from '../../seam/height.js';
import { categoryAxis, tooltipChrome, tooltipNode } from '../chrome.js';
import {
  type ChartOption,
  paint,
  type ResolvedTokens,
  TICK_FONT_SIZE,
} from '../core.js';

/** The track's thickness; the target tick spans it. */
const TRACK_HEIGHT = 28;
const VALUE_BAR_HEIGHT = 8;
/** Room for the value text and its label at the right of the track. */
const TEXT_ROOM = 96;
const AXIS_LABEL_ROOM = 20;
/** From the value text's top to its label's top. */
const VALUE_TO_LABEL = 24;
/** The three bands in `grid`, lightest where the reading is best. */
const BAND_OPACITY = [0.45, 0.75, 1] as const;

/** The ECharts option for the props over the resolved tokens; pure, so it is tested without a canvas. */
export function buildOption(props: BulletProps, tokens: ResolvedTokens): ChartOption {
  const { value, target, max, ranges, label, higherIsBetter = true } = props;
  const fill = props.height === 'fill';
  const height = plotHeightOf(props.height);
  const format = props.valueFormat ?? formatCompact;
  const pastTarget = !higherIsBetter && value > target;
  const valueColour = paint(tokens, pastTarget
    ? 'critical'
    : 'series-1');
  const bandEnds = [ranges[0], ranges[1], 1].map((fraction) => fraction * max);
  const bandWidths = bandEnds.map((end, index) => end - (index === 0
    ? 0
    : bandEnds[index - 1] ?? 0));
  const top = Math.max(0, Math.round((height - TRACK_HEIGHT - AXIS_LABEL_ROOM) / 2));
  const middle = top + TRACK_HEIGHT / 2;
  const valueText = { type: 'text' as const, silent: true, style: { text: format(value), fill: paint(tokens, 'ink'), fontSize: 20, fontWeight: 600, align: 'right' as const } };
  const labelText = { type: 'text' as const, silent: true, style: { text: label, fill: paint(tokens, 'muted'), fontSize: TICK_FONT_SIZE, align: 'right' as const } };
  const track = [label];

  const bands: BarSeriesOption[] = bandWidths.map((width, index) => ({
    type: 'bar',
    name: `band-${index}`,
    stack: 'bands',
    yAxisIndex: 0,
    barWidth: '100%',
    silent: true,
    itemStyle: { color: paint(tokens, 'grid'), opacity: BAND_OPACITY[index] ?? 1 },
    data: [width],
  }));
  const reading: BarSeriesOption = {
    type: 'bar',
    name: label,
    yAxisIndex: 1,
    barWidth: VALUE_BAR_HEIGHT,
    itemStyle: { color: valueColour, borderRadius: [0, 2, 2, 0] },
    data: [Math.min(value, max)],
    markLine: {
      silent: true,
      symbol: 'none',
      animation: false,
      label: { show: false },
      lineStyle: { color: paint(tokens, 'ink'), width: 2, type: 'solid' },
      data: [{ xAxis: target }],
    },
  };

  return {
    // A filling chart's height is unknown here, so ECharts centres the track.
    grid: { top: fill
      ? 'middle'
      : top, height: TRACK_HEIGHT, left: 4, right: TEXT_ROOM },
    xAxis: {
      type: 'value',
      min: 0,
      max,
      splitLine: { show: false },
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: paint(tokens, 'muted'), fontSize: TICK_FONT_SIZE, formatter: (tick: number) => format(tick) },
    },
    // Two hidden category axes in one grid: the bands fill the track, the
    // reading bar centres in it at its own thickness.
    yAxis: [
      categoryAxis(tokens, track, { showLine: false, showLabels: false }),
      categoryAxis(tokens, track, { showLine: false, showLabels: false }),
    ],
    tooltip: {
      ...tooltipChrome('item'),
      formatter: () => tooltipNode(label, [
        { value: format(value), label: 'value', colour: valueColour, key: 'dot' },
        { value: format(target), label: 'target' },
      ]),
    },
    graphic: fill
      ? [{ type: 'group', right: 4, top: 'middle', children: [{ ...valueText, y: 0 }, { ...labelText, y: VALUE_TO_LABEL }] }]
      : [
        { ...valueText, right: 4, top: middle - 18 },
        { ...labelText, right: 4, top: middle + 6 },
      ],
    series: [...bands, reading],
  };
}
