import type { TreemapProps } from '../../seam/types.js';
import type { LabelLayoutOptionCallbackParams } from 'echarts';

import { format as echartsFormat } from 'echarts/core';

import { formatCompact } from '../../seam/format.js';
import {
  firstParam,
  tooltipChrome,
  tooltipNode,
  type TooltipParams,
} from '../chrome.js';
import {
  type ChartOption,
  paint,
  readableOn,
  readFontFamily,
  type ResolvedTokens,
  withAlpha,
} from '../core.js';

const NODE_ALPHA = 0.85;
const LABEL_FONT_SIZE = 12;
const LABEL_LINE_HEIGHT = 16;
/** A label shows only when it fits with this padding on every side. */
const LABEL_PADDING = 6;
/** Where a label that does not fit is parked: outside the canvas. */
const OFF_CANVAS = -10_000;

/**
 * Hides the label of a node too small to hold it whole. ECharts' own treemap
 * label truncates instead ("Mod…"), and its label formatter cannot see the
 * node size, so the label layout hook (which receives the node rect) parks
 * such labels off the canvas.
 */
function hideUnfitLabel(fontFamily: string) {
  return (params: LabelLayoutOptionCallbackParams) => {
    const textWidth = echartsFormat.getTextRect(params.text, `${LABEL_FONT_SIZE}px ${fontFamily}`).width;
    const fitsWidth = textWidth + 2 * LABEL_PADDING <= params.rect.width;
    const fitsHeight = LABEL_LINE_HEIGHT + 2 * LABEL_PADDING <= params.rect.height;
    return fitsWidth && fitsHeight
      ? {}
      : { x: OFF_CANVAS, y: OFF_CANVAS };
  };
}

/** The ECharts option for the props over the resolved tokens; pure, so it is tested without a canvas. */
export function buildOption(props: TreemapProps, tokens: ResolvedTokens): ChartOption {
  const { nodes, groupTones, unit } = props;
  const format = props.valueFormat ?? formatCompact;
  const surface = paint(tokens, 'surface');
  const fontFamily = readFontFamily();
  const fillOf = (group: string) => paint(tokens, groupTones[group] ?? 'neutral');

  const tooltipFormatter = (params: TooltipParams) => {
    const item = firstParam(params);
    const data: unknown = item?.data;
    const id = typeof data === 'object' && data !== null && 'id' in data
      ? String(data.id)
      : undefined;
    const match = nodes.find((entry) => entry.id === id) ?? nodes.find((entry) => entry.label === item?.name);
    if (!match) return tooltipNode(undefined, []);
    return tooltipNode(match.label, [
      { value: `${format(match.value)} ${unit}`, label: match.group, colour: fillOf(match.group), key: 'dot' },
    ]);
  };

  return {
    tooltip: { ...tooltipChrome('item'), formatter: tooltipFormatter },
    series: [{
      type: 'treemap',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      roam: false,
      nodeClick: false,
      breadcrumb: { show: false },
      leafDepth: 1,
      // The gap between nodes shows the parent's border colour: the surface.
      itemStyle: { borderColor: surface, borderWidth: 0, gapWidth: 2 },
      levels: [{ itemStyle: { borderColor: surface, borderWidth: 0, gapWidth: 2 } }],
      label: {
        show: true,
        position: 'insideTopLeft',
        padding: LABEL_PADDING,
        fontSize: LABEL_FONT_SIZE,
        lineHeight: LABEL_LINE_HEIGHT,
        formatter: (params: { name: string }) => params.name,
      },
      labelLayout: hideUnfitLabel(fontFamily),
      emphasis: { focus: 'self', itemStyle: { borderColor: surface } },
      blur: { itemStyle: { opacity: 0.85 } },
      data: nodes.map((node) => {
        const fill = withAlpha(fillOf(node.group), NODE_ALPHA);
        return {
          id: node.id,
          name: node.label,
          value: node.value,
          itemStyle: { color: fill },
          label: { color: readableOn(tokens, fillOf(node.group)) },
        };
      }),
    }],
  };
}
