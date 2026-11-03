import type { NightingaleProps, RoseSlice } from '../../seam/types.js';

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
  TICK_FONT_SIZE,
} from '../core.js';

/** The rose's inner hole and outer edge; the outer edge leaves room for the outside labels. */
const RADIUS: [string, string] = ['8%', '68%'];
/** Slices under this share of the total carry no label (the tooltip still names them). */
const LABEL_MIN_SHARE = 0.04;
const LABEL_LINE_HEIGHT = 14;

/** The ECharts option for the props over the resolved tokens; pure, so it is tested without a canvas. */
export function buildOption(props: NightingaleProps, tokens: ResolvedTokens): ChartOption {
  const { slices, groupTones = {}, unit } = props;
  const format = props.valueFormat ?? formatCompact;
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const shareOf = (value: number) => (total === 0
    ? 0
    : value / total);
  const toneOf = (slice: RoseSlice) => paint(tokens, slice.tone ?? (slice.group === undefined
    ? undefined
    : groupTones[slice.group]) ?? 'neutral');

  const tooltipFormatter = (params: TooltipParams) => {
    const slice = slices[firstParam(params)?.dataIndex ?? -1];
    if (!slice) return tooltipNode(undefined, []);
    return tooltipNode(slice.label, [
      { value: `${format(slice.value)} ${unit}`, label: slice.group ?? '', colour: toneOf(slice), key: 'dot' },
      { value: formatPercent(shareOf(slice.value)), label: 'of the total' },
    ]);
  };

  return {
    tooltip: { ...tooltipChrome('item'), formatter: tooltipFormatter },
    series: [{
      type: 'pie',
      // `area` gives every slice the same angle and lets the radius carry the value; `radius` would size the angles too.
      roseType: 'area',
      radius: RADIUS,
      center: ['50%', '50%'],
      cursor: 'default',
      // A 2px surface stroke reads as the gap between slices.
      itemStyle: { borderColor: paint(tokens, 'surface'), borderWidth: 2 },
      label: {
        show: true,
        position: 'outside',
        color: paint(tokens, 'ink-2'),
        fontSize: TICK_FONT_SIZE,
        lineHeight: LABEL_LINE_HEIGHT,
        formatter: (params: { name: string; value: unknown }) => `${params.name}\n${format(Number(params.value))}`,
      },
      labelLine: { show: true, length: 6, length2: 6, lineStyle: { color: paint(tokens, 'grid'), width: 1 } },
      ...markHover,
      emphasis: { ...markHover.emphasis, scale: false },
      data: slices.map((slice) => {
        const labelled = shareOf(slice.value) >= LABEL_MIN_SHARE;
        return {
          id: slice.id,
          name: slice.label,
          value: slice.value,
          itemStyle: { color: toneOf(slice) },
          label: { show: labelled },
          labelLine: { show: labelled },
        };
      }),
    }],
  };
}
