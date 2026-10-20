/** Lookups over a snapshot: nodes by id and who links to whom. */
import type { Scenario } from '../contract/types.ts';
import type { GraphEdge, GraphNode, Snapshot } from '../types.ts';

export interface GraphIndex {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly byId: ReadonlyMap<string, GraphNode>;
  readonly position: ReadonlyMap<string, number>;
  readonly scenarios: readonly Scenario[];
  /** Nodes with an import or depends edge into `id`. */
  readonly callers: (id: string) => readonly string[];
  /** Nodes `id` has an import or depends edge to. */
  readonly callees: (id: string) => readonly string[];
  /** Ids within `depth` hops of `from` over the edges `follows` keeps, `from` included. */
  readonly within: (from: string, depth: number, direction: 'both' | 'upstream' | 'downstream', follows: (edge: GraphEdge) => boolean) => ReadonlySet<string>;
}

/** `callKinds`: the edge kinds that mean "calls" (the config's `calls: true`), for callers and callees. */
export function indexSnapshot(snapshot: Snapshot, callKinds: ReadonlySet<string>): GraphIndex {
  const byId = new Map(snapshot.nodes.map((n) => [n.id, n]));
  const position = new Map(snapshot.nodes.map((n, i) => [n.id, i]));
  const callEdges = snapshot.edges.filter((e) => callKinds.has(e.kind));
  return {
    nodes: snapshot.nodes,
    edges: snapshot.edges,
    byId,
    position,
    scenarios: snapshot.scenarios ?? [],
    callers: (id) => [...new Set(callEdges.filter((e) => e.target === id).map((e) => e.source))],
    callees: (id) => [...new Set(callEdges.filter((e) => e.source === id).map((e) => e.target))],
    within: (from, depth, direction, follows) => {
      const kept = snapshot.edges.filter(follows);
      const reached = new Set([from]);
      let frontier = [from];
      for (let hop = 0; hop < depth && frontier.length > 0; hop += 1) {
        const next = new Set<string>();
        for (const edge of kept) {
          if (direction !== 'upstream' && frontier.includes(edge.source) && !reached.has(edge.target)) next.add(edge.target);
          if (direction !== 'downstream' && frontier.includes(edge.target) && !reached.has(edge.source)) next.add(edge.source);
        }
        for (const id of next) reached.add(id);
        frontier = [...next];
      }
      return reached;
    },
  };
}
