import type { SunburstNode, SunburstProps } from '../../seam/types.js';
import type { SunburstSeriesOption } from 'echarts/charts';

import { formatCompact, formatPercent } from '../../seam/format.js';
import { plotHeightOf } from '../../seam/height.js';
import {
  firstParam,
  tooltipChrome,
  tooltipNode,
  type TooltipParams,
} from '../chrome.js';
import {
  BLUR_OPACITY,
  type ChartOption,
  paint,
  readableOn,
  type ResolvedTokens,
  TICK_FONT_SIZE,
} from '../core.js';

type SunburstItem = NonNullable<SunburstSeriesOption['data']>[number];

/** Ring one (the first level) and ring two, as shares of the radius. */
const INNER_RING: [number, number] = [0.25, 0.55];
const OUTER_RING: [number, number] = [0.57, 0.9];
/** Room left at each end of a radial label inside its ring. */
const LABEL_PADDING = 4;
/** The across-the-arc room a radial label needs: its line height plus a hair each side. */
const LABEL_HEIGHT = TICK_FONT_SIZE * 1.2 + 2;
/** No ring asks for less than this opening, however large the chart draws. */
const LABEL_MIN_ANGLE_FLOOR = 3;
const DEGREES_PER_RADIAN = 180 / Math.PI;

/**
 * The opening, in degrees, under which an arc of a ring carries no label
 * (the tooltip still names it): the arc at the ring's inner edge must be as
 * wide as the label is tall. A ring's inner edge is `inner` of the view
 * radius, so the threshold falls as the chart grows: the slice that reads
 * as a bare wedge in a card gets its label in the maximised view.
 */
export function labelMinAngle(inner: number, viewRadius: number): number {
  const innerRadius = inner * viewRadius;
  if (innerRadius <= 0) return LABEL_MIN_ANGLE_FLOOR;
  return Math.max(LABEL_MIN_ANGLE_FLOOR, (LABEL_HEIGHT / innerRadius) * DEGREES_PER_RADIAN);
}
const PATH_SEPARATOR = ' › ';

/** The ids from the root to every node, so a click can report its path. */
export function pathsById(nodes: readonly SunburstNode[], above: readonly string[] = []): Map<string, string[]> {
  return new Map(nodes.flatMap((node) => {
    const path = [...above, node.id];
    return [[node.id, path] as const, ...pathsById(node.children ?? [], path)];
  }));
}

interface TreePathStep { name: string; value?: unknown }

function treePathOf(item: unknown): TreePathStep[] {
  if (typeof item !== 'object' || item === null || !('treePathInfo' in item) || !Array.isArray(item.treePathInfo)) return [];
  return item.treePathInfo.filter((step: unknown): step is TreePathStep => typeof step === 'object' && step !== null && 'name' in step);
}

/** A share of the radius as a percent string, rounded so 0.55 reads "55%", not "55.00000000000001%". */
const percent = (share: number): string => `${Math.round(share * 10_000) / 100}%`;

/** The ECharts option for the props over the resolved tokens; pure, so it is tested without a canvas. */
/**
 * `width` is the canvas width in px, which sizes the radial labels; 0 until
 * it is measured. `measuredHeight` is the canvas height in px, read only for
 * `height: 'fill'`; 0 until measured, when the default height stands in.
 */
export function buildOption(props: SunburstProps, tokens: ResolvedTokens, width = 0, measuredHeight = 0): ChartOption {
  const { nodes, groupTones = {}, unit, onNodeClick } = props;
  const format = props.valueFormat ?? formatCompact;
  const surface = paint(tokens, 'surface');
  const fillOf = (node: SunburstNode) => paint(tokens, node.tone ?? (node.group === undefined
    ? undefined
    : groupTones[node.group]) ?? 'neutral');

  // Parents carry no value, so ECharts sums their children.
  const toItem = (node: SunburstNode): SunburstItem => {
    const fill = fillOf(node);
    return {
      id: node.id,
      name: node.label,
      value: node.children && node.children.length > 0
        ? undefined
        : node.value,
      itemStyle: { color: fill },
      label: { color: readableOn(tokens, fill) },
      children: node.children?.map(toItem),
    };
  };

  // treePathInfo runs from the virtual root (the whole) to the hovered node.
  const tooltipFormatter = (params: TooltipParams) => {
    const item = firstParam(params);
    const steps = treePathOf(item);
    const path = steps.slice(1);
    const value = Number(item?.value ?? 0);
    const parentValue = Number(steps.at(-2)?.value ?? 0);
    const colour = typeof item?.color === 'string'
      ? item.color
      : undefined;
    return tooltipNode(path.map((step) => step.name).join(PATH_SEPARATOR), [
      { value: `${format(value)} ${unit}`, label: '', colour, key: 'dot' },
      { value: formatPercent(parentValue === 0
        ? 0
        : value / parentValue), label: path.length > 1
        ? `of ${path.at(-2)?.name ?? ''}`
        : 'of the total' },
    ]);
  };

  const height = plotHeightOf(props.height, measuredHeight);
  const viewRadius = Math.min(width > 0
    ? width
    : height, height) / 2;
  const ring = ([inner, outer]: [number, number]) => ({
    radius: [percent(inner), percent(outer)],
    label: {
      rotate: 'radial' as const,
      fontSize: TICK_FONT_SIZE,
      minAngle: labelMinAngle(inner, viewRadius),
      width: Math.max(0, (outer - inner) * viewRadius - 2 * LABEL_PADDING),
      overflow: 'truncate' as const,
    },
  });

  return {
    tooltip: { ...tooltipChrome('item'), formatter: tooltipFormatter },
    series: [{
      type: 'sunburst',
      center: ['50%', '50%'],
      nodeClick: false,
      cursor: onNodeClick
        ? 'pointer'
        : 'default',
      // Keep the data order (age buckets, kinds) instead of ECharts' default descending sort.
      sort: (a, b) => a.dataIndex - b.dataIndex,
      // A 2px surface stroke reads as the gap between arcs.
      itemStyle: { borderColor: surface, borderWidth: 2 },
      emphasis: { focus: 'ancestor' },
      blur: { itemStyle: { opacity: BLUR_OPACITY } },
      levels: [
        {},
        ring(INNER_RING),
        ring(OUTER_RING),
      ],
      data: nodes.map(toItem),
    }],
  };
}
