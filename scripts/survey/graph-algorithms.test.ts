import type { DirectedGraph, GraphEdge } from './graph-algorithms';

import { describe, expect, it } from 'bun:test';

import { betweenness, louvainClusters } from './graph-algorithms';

/** Every ordered pair of distinct nodes in `names`, as edges both ways. */
function clique(names: readonly string[]): GraphEdge[] {
  return names.flatMap((from) => names.filter((to) => to !== from).map((to) => ({ from, to })));
}

const LEFT = ['a1', 'a2', 'a3', 'a4'];
const RIGHT = ['b1', 'b2', 'b3', 'b4'];

/** Two four-node cliques joined by the single edge `a4 -> b1`. */
const BRIDGED: DirectedGraph = {
  edges: [...clique(LEFT), ...clique(RIGHT), { from: 'a4', to: 'b1' }],
  nodes: [...LEFT, ...RIGHT],
};

const LEAVES = ['leaf1', 'leaf2', 'leaf3', 'leaf4'];

/** A centre linked to four leaves, each link both ways. */
const STAR: DirectedGraph = {
  edges: LEAVES.flatMap((leaf) => [
    { from: 'centre', to: leaf },
    { from: leaf, to: 'centre' },
  ]),
  nodes: ['centre', ...LEAVES],
};

/** A ring of five three-node cliques, each joined to the next by one edge, plus an isolated node. */
function ringOfCliques(): DirectedGraph {
  const groups = Array.from({ length: 5 }, (_, group) => [0, 1, 2].map((member) => `g${group}-n${member}`));
  const bridges = groups.map((group, index) => ({
    from: group[2] ?? '',
    to: groups[(index + 1) % groups.length]?.[0] ?? '',
  }));
  return {
    edges: [...groups.flatMap(clique), ...bridges],
    nodes: [...groups.flat(), 'lonely'],
  };
}

/** The nodes holding the highest score, sorted. */
function topScorers(scores: ReadonlyMap<string, number>): string[] {
  const top = Math.max(...scores.values());
  return [...scores]
    .filter(([, score]) => score === top)
    .map(([node]) => node)
    .sort();
}

describe('louvainClusters', () => {
  it('splits two cliques joined by one bridge into two clusters', () => {
    expect(louvainClusters(BRIDGED)).toEqual([LEFT, RIGHT]);
  });

  it('keeps a single clique whole, so the split above is read and not given', () => {
    expect(louvainClusters({ edges: clique(LEFT), nodes: LEFT })).toEqual([LEFT]);
  });

  it('gives an isolated node a cluster of its own and orders clusters largest first', () => {
    const clusters = louvainClusters(ringOfCliques());
    expect(clusters).toHaveLength(6);
    expect(clusters.at(-1)).toEqual(['lonely']);
    expect(clusters.slice(0, 5).map((cluster) => cluster.length)).toEqual([3, 3, 3, 3, 3]);
  });

  it('leaves every node a singleton when the graph has no edge', () => {
    expect(louvainClusters({ edges: [], nodes: ['b', 'a'] })).toEqual([['a'], ['b']]);
  });

  it('refuses an edge naming a node the graph does not list', () => {
    expect(() => louvainClusters({ edges: [{ from: 'a', to: 'ghost' }], nodes: ['a'] })).toThrow(
      'names node ghost',
    );
  });
});

describe('betweenness', () => {
  it('puts the bridge ends at the top for two cliques joined by one bridge', () => {
    const scores = betweenness(BRIDGED);
    expect(topScorers(scores)).toEqual(['a4', 'b1']);
    // a4 carries a1..a3 -> b1..b4, b1 carries a1..a4 -> b2..b4.
    expect(scores.get('a4')).toBe(12);
    expect(scores.get('b1')).toBe(12);
    for (const node of ['a1', 'a2', 'a3', 'b2', 'b3', 'b4']) {
      expect(scores.get(node)).toBe(0);
    }
  });

  it('gives a star\'s centre all the betweenness', () => {
    const scores = betweenness(STAR);
    // Every ordered pair of distinct leaves crosses the centre: 4 * 3.
    expect(scores.get('centre')).toBe(12);
    for (const leaf of LEAVES) {
      expect(scores.get(leaf)).toBe(0);
    }
  });

  it('follows edges in their direction only', () => {
    const chain: DirectedGraph = {
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
      ],
      nodes: ['a', 'b', 'c'],
    };
    expect([...betweenness(chain)]).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 0],
    ]);
    const reversedMiddle: DirectedGraph = {
      edges: [
        { from: 'a', to: 'b' },
        { from: 'c', to: 'b' },
      ],
      nodes: ['a', 'b', 'c'],
    };
    expect(betweenness(reversedMiddle).get('b')).toBe(0);
  });

  it('splits a pair\'s share between equally short paths', () => {
    const diamond: DirectedGraph = {
      edges: [
        { from: 's', to: 'x' },
        { from: 's', to: 'y' },
        { from: 'x', to: 't' },
        { from: 'y', to: 't' },
      ],
      nodes: ['s', 't', 'x', 'y'],
    };
    const scores = betweenness(diamond);
    expect(scores.get('x')).toBe(0.5);
    expect(scores.get('y')).toBe(0.5);
  });
});

describe('determinism', () => {
  it('returns equal results on two runs over one graph', () => {
    const graph = ringOfCliques();
    expect(louvainClusters(graph)).toEqual(louvainClusters(graph));
    expect([...betweenness(graph)]).toEqual([...betweenness(graph)]);
  });

  it('returns equal results whatever order the graph lists its nodes and edges in', () => {
    const graph = ringOfCliques();
    const shuffled: DirectedGraph = {
      edges: [...graph.edges].reverse(),
      nodes: [...graph.nodes].reverse(),
    };
    expect(louvainClusters(shuffled)).toEqual(louvainClusters(graph));
    expect([...betweenness(shuffled)]).toEqual([...betweenness(graph)]);
  });
});
