import type { NetworkGraphProps } from '../../seam/types.js';

import { describe, expect, it } from 'bun:test';

import { FIXED_TOKENS, GRAPH_LINKS, GRAPH_NODES, LAYER_TONES, seriesOf } from '../fixtures.js';

import { buildOption } from './NetworkGraph.option.js';

const base: NetworkGraphProps = { ariaLabel: 'Workspace', nodes: GRAPH_NODES, links: GRAPH_LINKS, groupTones: LAYER_TONES };

type GraphDatum = { id: string; symbolSize: number; itemStyle: { color: string } };

describe('NetworkGraph option', () => {
  it('draws one graph series with a node per member and a link per dependency', () => {
    const [graph] = seriesOf(buildOption(base, FIXED_TOKENS));

    expect(graph?.type).toBe('graph');
    expect(graph?.data).toHaveLength(GRAPH_NODES.length);
    expect(graph?.links).toHaveLength(GRAPH_LINKS.length);
  });

  it('sizes a node by its weight and paints it with its group tone', () => {
    const [graph] = seriesOf(buildOption(base, FIXED_TOKENS));
    const core = (graph?.data as GraphDatum[]).find((node) => node.id === 'core');
    const weight = GRAPH_NODES.find((node) => node.id === 'core')?.value ?? 0;

    expect(core?.symbolSize).toBe(8 + weight * 3);
    expect(core?.itemStyle.color).toBe(FIXED_TOKENS['series-1']);
  });

  it('runs the force layout animated unless told not to', () => {
    const layoutOf = (props: NetworkGraphProps): unknown => (seriesOf(buildOption(props, FIXED_TOKENS))[0]?.force as { layoutAnimation: boolean }).layoutAnimation;

    expect(layoutOf(base)).toBe(true);
    expect(layoutOf({ ...base, animate: false })).toBe(false);
  });

  it('shows the pointer only when a node click is wired', () => {
    const cursorOf = (props: NetworkGraphProps): unknown => seriesOf(buildOption(props, FIXED_TOKENS))[0]?.cursor;

    expect(cursorOf(base)).toBe('default');
    expect(cursorOf({ ...base, onNodeClick: () => undefined })).toBe('pointer');
  });
});
