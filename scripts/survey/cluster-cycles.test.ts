import type { GraphEdge } from './graph-algorithms';

import { describe, expect, it } from 'bun:test';

import { crossClusterCycles } from './cluster-cycles';

/** The edges of one ring through `files`, each importing the next and the last the first. */
function ring(files: readonly string[]): GraphEdge[] {
  return files.map((from, index) => ({ from, to: files[(index + 1) % files.length] ?? '' }));
}

/** A map of two clusters: `c1` holds `src/board/`, `c2` holds `src/commands/`. */
const CLUSTER_OF: ReadonlyMap<string, string> = new Map([
  ['src/board/place.ts', 'c1'],
  ['src/board/rows.ts', 'c1'],
  ['src/commands/doctor.ts', 'c2'],
  ['src/commands/show.ts', 'c2'],
]);

describe('crossClusterCycles', () => {
  it('answers nothing for a cycle inside one cluster', () => {
    const files = ['src/board/place.ts', 'src/board/rows.ts'];

    const reading = crossClusterCycles({ clusterOf: CLUSTER_OF, graph: { edges: ring(files), nodes: files } });

    expect(reading).toEqual({ cycles: [], placedByFolder: [], unplaced: [] });
  });

  it('answers a cycle across two clusters with its files and its clusters', () => {
    const files = ['src/commands/show.ts', 'src/board/place.ts', 'src/board/rows.ts'];

    const reading = crossClusterCycles({
      clusterOf: CLUSTER_OF,
      graph: { edges: ring(files), nodes: [...files, 'src/commands/doctor.ts'] },
    });

    expect(reading).toEqual({
      cycles: [
        {
          clusters: ['c1', 'c2'],
          files: ['src/board/place.ts', 'src/board/rows.ts', 'src/commands/show.ts'],
        },
      ],
      placedByFolder: [],
      unplaced: [],
    });
  });

  it('answers nothing when two clusters are linked one way only', () => {
    const nodes = ['src/board/place.ts', 'src/commands/show.ts'];

    const reading = crossClusterCycles({
      clusterOf: CLUSTER_OF,
      graph: { edges: [{ from: 'src/board/place.ts', to: 'src/commands/show.ts' }], nodes },
    });

    expect(reading.cycles).toEqual([]);
  });

  it('answers each cross-cluster component apart, largest first, and leaves the one-cluster ones out', () => {
    const clusterOf = new Map([
      ...CLUSTER_OF,
      ['src/board/gate.ts', 'c1'],
      ['src/commands/next.ts', 'c2'],
      ['src/commands/epic.ts', 'c2'],
    ]);
    const pair = ['src/board/gate.ts', 'src/commands/next.ts'];
    const triple = ['src/board/place.ts', 'src/commands/show.ts', 'src/commands/doctor.ts'];
    const inside = ['src/board/rows.ts', 'src/board/place.ts'];

    const reading = crossClusterCycles({
      clusterOf,
      graph: {
        edges: [...ring(pair), ...ring(triple), ...ring(inside), { from: 'src/commands/epic.ts', to: 'src/board/gate.ts' }],
        nodes: [...clusterOf.keys()],
      },
    });

    expect(reading.cycles).toEqual([
      {
        clusters: ['c1', 'c2'],
        files: ['src/board/place.ts', 'src/board/rows.ts', 'src/commands/doctor.ts', 'src/commands/show.ts'],
      },
      { clusters: ['c1', 'c2'], files: ['src/board/gate.ts', 'src/commands/next.ts'] },
    ]);
  });

  it('places an unmapped file by the cluster most of its folder\'s mapped files hold', () => {
    const clusterOf = new Map([...CLUSTER_OF, ['src/board/stray.ts', 'c2']]);
    const files = ['src/board/now-epic.ts', 'src/commands/show.ts'];

    const reading = crossClusterCycles({ clusterOf, graph: { edges: ring(files), nodes: files } });

    expect(reading).toEqual({
      cycles: [{ clusters: ['c1', 'c2'], files: ['src/board/now-epic.ts', 'src/commands/show.ts'] }],
      placedByFolder: [{ cluster: 'c1', file: 'src/board/now-epic.ts' }],
      unplaced: [],
    });
  });

  it('reads no cross-cluster cycle when the folder places an unmapped file with the file it cycles with', () => {
    const files = ['src/board/now-epic.ts', 'src/board/place.ts'];

    const reading = crossClusterCycles({ clusterOf: CLUSTER_OF, graph: { edges: ring(files), nodes: files } });

    expect(reading).toEqual({
      cycles: [],
      placedByFolder: [{ cluster: 'c1', file: 'src/board/now-epic.ts' }],
      unplaced: [],
    });
  });

  it('gives a folder split evenly to the cluster whose name sorts first', () => {
    const clusterOf = new Map([
      ['src/mixed/b.ts', 'c7'],
      ['src/mixed/a.ts', 'c3'],
    ]);

    const reading = crossClusterCycles({ clusterOf, graph: { edges: [], nodes: ['src/mixed/new.ts'] } });

    expect(reading.placedByFolder).toEqual([{ cluster: 'c3', file: 'src/mixed/new.ts' }]);
  });

  it('counts a folder\'s mapped files from the map, whether or not the graph lists them', () => {
    const reading = crossClusterCycles({
      clusterOf: CLUSTER_OF,
      graph: { edges: [], nodes: ['src/commands/added.ts'] },
    });

    expect(reading.placedByFolder).toEqual([{ cluster: 'c2', file: 'src/commands/added.ts' }]);
  });

  it('names an unmapped file whose folder holds no mapped file as unplaced', () => {
    const reading = crossClusterCycles({
      clusterOf: CLUSTER_OF,
      graph: { edges: [], nodes: ['src/refs/check-command.ts', 'src/board/place.ts'] },
    });

    expect(reading).toEqual({ cycles: [], placedByFolder: [], unplaced: ['src/refs/check-command.ts'] });
  });

  it('reads the folder as the file\'s own directory, never an ancestor or a subfolder', () => {
    const reading = crossClusterCycles({
      clusterOf: CLUSTER_OF,
      graph: { edges: [], nodes: ['src/board/deep/inner.ts', 'src/top.ts'] },
    });

    expect(reading.unplaced).toEqual(['src/board/deep/inner.ts', 'src/top.ts']);
    expect(reading.placedByFolder).toEqual([]);
  });

  it('counts an unplaced file toward no cluster, in a cycle or out of one', () => {
    const oneCluster = ['src/refs/check-command.ts', 'src/board/place.ts'];
    const twoClusters = [...oneCluster, 'src/commands/show.ts'];

    const within = crossClusterCycles({ clusterOf: CLUSTER_OF, graph: { edges: ring(oneCluster), nodes: oneCluster } });
    const across = crossClusterCycles({ clusterOf: CLUSTER_OF, graph: { edges: ring(twoClusters), nodes: twoClusters } });

    expect(within).toEqual({ cycles: [], placedByFolder: [], unplaced: ['src/refs/check-command.ts'] });
    expect(across).toEqual({
      cycles: [
        {
          clusters: ['c1', 'c2'],
          files: ['src/board/place.ts', 'src/commands/show.ts', 'src/refs/check-command.ts'],
        },
      ],
      placedByFolder: [],
      unplaced: ['src/refs/check-command.ts'],
    });
  });

  it('refuses an edge naming a file the graph does not list', () => {
    expect(() => crossClusterCycles({
      clusterOf: CLUSTER_OF,
      graph: { edges: [{ from: 'src/board/place.ts', to: 'src/ghost.ts' }], nodes: ['src/board/place.ts'] },
    })).toThrow('names node src/ghost.ts, which the graph does not list');
  });
});
