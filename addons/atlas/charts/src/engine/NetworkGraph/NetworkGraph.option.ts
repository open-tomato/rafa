import type { GraphNode, NetworkGraphProps } from '../../seam/types.js';

import {
  firstParam,
  tooltipChrome,
  tooltipNode,
  type TooltipParams,
} from '../chrome.js';
import {
  type ChartOption,
  paint,
  type ResolvedTokens,
  TICK_FONT_SIZE,
  withAlpha,
} from '../core.js';

/** What the option reads; narrower than the component's props so a parent's new object does not restart the force layout. */
export type NetworkOptionProps = Pick<NetworkGraphProps, 'nodes' | 'links' | 'groupTones' | 'onNodeClick' | 'animate'>;

/** Node diameter: a floor plus a step per unit of weight. */
const SIZE_FLOOR = 8;
const SIZE_STEP = 3;
const EDGE_ALPHA = 0.55;
const ARROW_SIZE = 6;

function sizeOf(node: GraphNode): number {
  return SIZE_FLOOR + (node.value ?? 1) * SIZE_STEP;
}

/** The id an ECharts graph event names, from its node data. */
export function nodeIdOf(data: unknown): string | undefined {
  return typeof data === 'object' && data !== null && 'id' in data
    ? String(data.id)
    : undefined;
}

/** The ECharts option for the props over the resolved tokens; pure, so it is tested without a canvas. */
export function buildOption(props: NetworkOptionProps, tokens: ResolvedTokens): ChartOption {
  const { nodes, links, groupTones } = props;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const labelOf = (id: string) => byId.get(id)?.label ?? id;
  const toneOf = (node: GraphNode) => paint(tokens, groupTones[node.group] ?? 'neutral');
  const dependents = (id: string) => links.filter((link) => link.source === id).length;
  const edgeColour = withAlpha(paint(tokens, 'muted'), EDGE_ALPHA);

  const tooltipFormatter = (params: TooltipParams) => {
    const item = firstParam(params);
    const data: unknown = item?.data;
    if (item?.dataType === 'edge' && typeof data === 'object' && data !== null && 'source' in data && 'target' in data) {
      return tooltipNode(undefined, [{ value: labelOf(String(data.source)), label: `→ ${labelOf(String(data.target))}` }]);
    }
    const node = byId.get(nodeIdOf(data) ?? '');
    if (!node) return tooltipNode(undefined, []);
    return tooltipNode(node.label, [
      { value: String(dependents(node.id)), label: 'dependents', colour: toneOf(node), key: 'dot' },
      { value: node.group, label: 'layer' },
    ]);
  };

  return {
    tooltip: { ...tooltipChrome('item'), formatter: tooltipFormatter },
    series: [{
      type: 'graph',
      layout: 'force',
      top: 16,
      bottom: 16,
      left: 16,
      right: 96,
      roam: false,
      draggable: false,
      cursor: props.onNodeClick
        ? 'pointer'
        : 'default',
      // A circle seed keeps the layout the same on every load; `animate: false` settles it in one go.
      force: {
        initLayout: 'circular',
        repulsion: 420,
        edgeLength: [80, 150],
        gravity: 0.08,
        layoutAnimation: props.animate !== false,
      },
      edgeSymbol: ['none', 'arrow'],
      edgeSymbolSize: ARROW_SIZE,
      lineStyle: { color: edgeColour, width: 1, curveness: 0 },
      itemStyle: { borderColor: paint(tokens, 'surface'), borderWidth: 2 },
      // A 2px surface halo keeps a label legible where edges cross it.
      label: {
        show: true,
        position: 'right',
        color: paint(tokens, 'ink-2'),
        fontSize: TICK_FONT_SIZE,
        textBorderColor: paint(tokens, 'surface'),
        textBorderWidth: 2,
      },
      emphasis: { focus: 'adjacency', lineStyle: { width: 1.5, color: paint(tokens, 'ink-2') } },
      blur: { itemStyle: { opacity: 0.3 }, lineStyle: { opacity: 0.15 }, label: { opacity: 0.4 } },
      data: nodes.map((node) => ({
        id: node.id,
        name: node.label,
        value: node.value ?? 1,
        symbolSize: sizeOf(node),
        itemStyle: { color: toneOf(node) },
      })),
      links: links.map((link) => ({ source: link.source, target: link.target, value: link.value })),
    }],
  };
}
