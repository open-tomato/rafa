import type { GraphLink, GraphNode, SankeyProps } from '../../seam/types.js';

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
  type ResolvedTokens,
  TICK_FONT_SIZE,
} from '../core.js';

/** What the option reads; narrower than the component's props so a parent's new object does not redraw the layout. */
export type SankeyOptionProps = Pick<SankeyProps, 'nodes' | 'links' | 'groupTones' | 'groupOrder' | 'valueFormat' | 'animate'>;

const NODE_WIDTH = 10;
const NODE_GAP = 10;
const LINK_ALPHA = 0.25;
const LINK_HOVER_ALPHA = 0.5;
/** Room beside the outer columns for their labels. */
const LABEL_GAP = 6;

/** The number of edges on the longest path: ECharts sizes its columns by it, whatever depths the nodes carry. */
function longestPath(nodes: readonly GraphNode[], links: readonly GraphLink[]): number {
  const memo = new Map<string, number>();
  const visiting = new Set<string>();
  const from = (id: string): number => {
    const known = memo.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const length = Math.max(0, ...links.filter((link) => link.source === id).map((link) => 1 + from(link.target)));
    visiting.delete(id);
    memo.set(id, length);
    return length;
  };
  return Math.max(0, ...nodes.map((node) => from(node.id)));
}

/**
 * The column of each node: its group's index among the groups that have
 * nodes (an empty layer leaves no empty column), spread over ECharts' own
 * column count so the last layer reaches the right edge.
 */
function columnsOf(nodes: readonly GraphNode[], links: readonly GraphLink[], groupOrder: readonly string[]): Map<string, number> {
  const present = groupOrder.filter((group) => nodes.some((node) => node.group === group));
  const span = Math.max(1, longestPath(nodes, links));
  const step = present.length > 1
    ? span / (present.length - 1)
    : 0;
  return new Map(nodes.map((node) => [node.id, Math.max(0, present.indexOf(node.group)) * step]));
}

/** The ECharts option for the props over the resolved tokens; pure, so it is tested without a canvas. */
export function buildOption(props: SankeyOptionProps, tokens: ResolvedTokens): ChartOption {
  const { nodes, links, groupTones, groupOrder } = props;
  const format = props.valueFormat ?? formatCompact;
  const columns = columnsOf(nodes, links, groupOrder);
  const lastColumn = Math.max(0, ...columns.values());
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const labelOf = (id: string) => byId.get(id)?.label ?? id;
  const toneOf = (node: GraphNode) => paint(tokens, groupTones[node.group] ?? 'neutral');

  const tooltipFormatter = (params: TooltipParams) => {
    const item = firstParam(params);
    const data: unknown = item?.data;
    if (item?.dataType === 'edge' && typeof data === 'object' && data !== null && 'source' in data && 'target' in data) {
      const source = String(data.source);
      const target = String(data.target);
      const value = 'value' in data
        ? Number(data.value)
        : 0;
      const sourceNode = byId.get(source);
      return tooltipNode(`${labelOf(source)} → ${labelOf(target)}`, [
        { value: format(value), label: 'dependency', colour: sourceNode
          ? toneOf(sourceNode)
          : undefined, key: 'line' },
      ]);
    }
    const id = typeof data === 'object' && data !== null && 'name' in data
      ? String(data.name)
      : '';
    const node = byId.get(id);
    if (!node) return tooltipNode(undefined, []);
    const outgoing = links.filter((link) => link.source === id).length;
    const incoming = links.filter((link) => link.target === id).length;
    return tooltipNode(node.label, [
      { value: String(outgoing), label: 'dependents', colour: toneOf(node), key: 'dot' },
      { value: String(incoming), label: 'dependencies' },
      { value: node.group, label: 'layer' },
    ]);
  };

  return {
    tooltip: { ...tooltipChrome('item'), formatter: tooltipFormatter },
    series: [{
      type: 'sankey',
      orient: 'horizontal',
      top: 8,
      bottom: 8,
      // The last column's labels sit on its left, so the plot needs no label room at its edges.
      left: 4,
      right: 4,
      nodeWidth: NODE_WIDTH,
      nodeGap: NODE_GAP,
      nodeAlign: 'justify',
      draggable: false,
      // Columns are set per node (`depth`); the iterations only relax the vertical order.
      layoutIterations: 32,
      // A 2px surface halo keeps a label legible over the links.
      label: {
        color: paint(tokens, 'ink-2'),
        fontSize: TICK_FONT_SIZE,
        position: 'right',
        distance: LABEL_GAP,
        textBorderColor: paint(tokens, 'surface'),
        textBorderWidth: 2,
      },
      itemStyle: { borderWidth: 0 },
      lineStyle: { color: 'source', opacity: LINK_ALPHA, curveness: 0.5 },
      emphasis: { focus: 'adjacency', lineStyle: { opacity: LINK_HOVER_ALPHA } },
      blur: { itemStyle: { opacity: 0.4 }, lineStyle: { opacity: 0.1 } },
      data: nodes.map((node) => {
        const column = columns.get(node.id) ?? 0;
        return {
          name: node.id,
          depth: column,
          itemStyle: { color: toneOf(node) },
          label: {
            formatter: () => node.label,
            position: column === lastColumn
              ? ('left' as const)
              : ('right' as const),
          },
        };
      }),
      links: links.map((link) => ({ source: link.source, target: link.target, value: link.value })),
    }],
  };
}
