import type { SankeyProps } from '../../seam/types.js';

import { describe, expect, it } from 'bun:test';

import { FIXED_TOKENS, GRAPH_LINKS, GRAPH_NODES, LAYER_ORDER, LAYER_TONES, seriesOf } from '../fixtures.js';

import { buildOption } from './Sankey.option.js';

const base: SankeyProps = { ariaLabel: 'Imports', nodes: GRAPH_NODES, links: GRAPH_LINKS, groupTones: LAYER_TONES, groupOrder: LAYER_ORDER };

type Node = { name: string; depth: number; itemStyle: { color: string }; label: { position: string } };

const nodesOf = (props: SankeyProps): Node[] => seriesOf(buildOption(props, FIXED_TOKENS))[0]?.data as Node[];
const depthOf = (nodes: Node[], id: string): number | undefined => nodes.find((node) => node.name === id)?.depth;

describe('Sankey option', () => {
  it('draws one sankey series with a node per member and a link per dependency', () => {
    const [sankey] = seriesOf(buildOption(base, FIXED_TOKENS));

    expect(sankey?.type).toBe('sankey');
    expect(sankey?.data).toHaveLength(GRAPH_NODES.length);
    expect(sankey?.links).toHaveLength(GRAPH_LINKS.length);
  });

  it('puts a node in the column of its layer, spread over the longest path', () => {
    const nodes = nodesOf(base);

    // The longest path is six edges (core to run) over five layers: 1.5 columns per layer.
    expect(depthOf(nodes, 'core')).toBe(0);
    expect(depthOf(nodes, 'inventory')).toBe(1.5);
    expect(depthOf(nodes, 'run')).toBe(3);
    expect(depthOf(nodes, 'visualization')).toBe(4.5);
    expect(depthOf(nodes, 'demo')).toBe(6);
  });

  it('gives every node of one layer the same column', () => {
    const nodes = nodesOf(base);

    expect(depthOf(nodes, 'release')).toBe(depthOf(nodes, 'run'));
    expect(depthOf(nodes, 'effort')).toBe(depthOf(nodes, 'board'));
  });

  it('leaves no empty column for a layer without nodes', () => {
    const noAddons = GRAPH_NODES.filter((node) => node.group !== 'addon');
    const links = GRAPH_LINKS.filter((link) => noAddons.some((node) => node.id === link.source) && noAddons.some((node) => node.id === link.target));
    const nodes = nodesOf({ ...base, nodes: noAddons, links });

    // Four layers over a six-edge path: two columns per step.
    expect(depthOf(nodes, 'platform')).toBeUndefined();
    expect(depthOf(nodes, 'inventory')).toBe(2);
    expect(depthOf(nodes, 'run')).toBe(4);
  });

  it('labels the last column on its left so the text stays in the plot', () => {
    const nodes = nodesOf(base);

    expect(nodes.find((node) => node.name === 'demo')?.label.position).toBe('left');
    expect(nodes.find((node) => node.name === 'core')?.label.position).toBe('right');
  });

  it('paints a node with its layer tone', () => {
    const nodes = nodesOf(base);

    expect(nodes.find((node) => node.name === 'core')?.itemStyle.color).toBe(FIXED_TOKENS['series-1']);
    expect(nodes.find((node) => node.name === 'run')?.itemStyle.color).toBe(FIXED_TOKENS['series-2']);
  });
});
