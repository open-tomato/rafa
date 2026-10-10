/**
 * The survey's graph algorithms: Louvain clustering, Brandes betweenness
 * and Tarjan's strongly connected components, all deterministic so a
 * second run over the same graph returns equal results.
 *
 * Nothing here draws a random number. Every node list is sorted before an
 * algorithm walks it, every tie is broken by that order, and every float
 * sum is taken in the same order on each run.
 *
 * The graph is directed, the way an import graph is: an edge runs from
 * the importing file to the imported one. Each algorithm reads it in its
 * own way:
 *
 *   - `louvainClusters` reads it as undirected and weighted. Each distinct
 *     directed edge `a → b` adds 1 to the weight of the pair `{a, b}`, so a
 *     pair importing each other in both directions weighs 2. A repeated
 *     edge counts once and a self-loop is ignored.
 *   - `betweenness` follows edges in their direction only. A repeated edge
 *     counts once and a self-loop is ignored.
 *   - `stronglyConnected` follows edges in their direction only. A repeated
 *     edge counts once and a self-loop is ignored, so a node importing
 *     only itself is a component of one like any other.
 */

/** One directed edge, from the importing node to the imported one. */
export interface GraphEdge {
  /** The node the edge leaves. */
  readonly from: string;
  /** The node the edge reaches. */
  readonly to: string;
}

/**
 * A directed graph given as data. Every node is listed in `nodes`, an
 * isolated one included; an edge naming a node not listed is refused.
 * Extra fields on an edge (an import kind, say) are carried and ignored.
 */
export interface DirectedGraph {
  /** Every node, in any order; duplicates are merged. */
  readonly nodes: readonly string[];
  /** Every edge, in any order; duplicates are merged. */
  readonly edges: readonly GraphEdge[];
}

/** A float gain smaller than this is read as no gain at all. */
const GAIN_EPSILON = 1e-12;

/**
 * Compares two names by UTF-16 code unit, the order `Array.prototype.sort`
 * gives strings by default, so a tie is broken the way nodes are sorted.
 *
 * @param left - One name.
 * @param right - The other.
 * @returns A negative, zero or positive number, as `sort` expects.
 */
function compareNames(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right
    ? -1
    : 1;
}

/** The graph's nodes, sorted, with each node's index in that order. */
interface IndexedNodes {
  readonly names: readonly string[];
  readonly indexOf: ReadonlyMap<string, number>;
}

/**
 * Sorts and indexes a graph's nodes, and lists its distinct directed edges
 * by index with self-loops dropped, sorted by source then target.
 *
 * @param graph - The graph to read.
 * @returns The indexed nodes and the distinct edges between two nodes.
 * @throws When an edge names a node the graph does not list.
 */
function indexGraph(graph: DirectedGraph): {
  readonly nodes: IndexedNodes;
  readonly edges: readonly (readonly [number, number])[];
} {
  const names = [...new Set(graph.nodes)].sort();
  const indexOf = new Map(names.map((name, index) => [name, index]));
  const seen = new Set<string>();
  const edges: [number, number][] = [];
  for (const edge of graph.edges) {
    const from = indexOf.get(edge.from);
    const to = indexOf.get(edge.to);
    if (from === undefined || to === undefined) {
      const missing = from === undefined
        ? edge.from
        : edge.to;
      throw new Error(`Edge ${edge.from} -> ${edge.to} names node ${missing}, which the graph does not list`);
    }
    const key = `${from}:${to}`;
    if (from === to || seen.has(key)) {
      continue;
    }
    seen.add(key);
    edges.push([from, to]);
  }
  edges.sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  return { edges, nodes: { indexOf, names } };
}

/**
 * One level of the Louvain graph: undirected, weighted, with a self-loop
 * weight per node that holds the edges folded inside it.
 */
interface WeightedLevel {
  /** Per node, its neighbours (never itself) and the weight to each. */
  readonly adjacency: readonly ReadonlyMap<number, number>[];
  /** Per node, the weight of its self-loop. */
  readonly selfLoop: readonly number[];
}

/**
 * Each node's degree: the weight to its neighbours plus twice its
 * self-loop, the way a loop counts at both its ends.
 *
 * @param level - The level to read.
 * @returns The degree of each node, by index.
 */
function degrees(level: WeightedLevel): number[] {
  return level.adjacency.map((neighbours, node) => {
    let degree = 2 * (level.selfLoop[node] ?? 0);
    for (const weight of neighbours.values()) {
      degree += weight;
    }
    return degree;
  });
}

/**
 * Adds `weight` to the undirected pair `{a, b}` of an adjacency list.
 *
 * @param adjacency - The adjacency list to add to; changed in place.
 * @param a - One end.
 * @param b - The other end, never `a`.
 * @param weight - The weight to add.
 */
function addPairWeight(adjacency: Map<number, number>[], a: number, b: number, weight: number): void {
  const fromA = adjacency[a];
  const fromB = adjacency[b];
  if (fromA === undefined || fromB === undefined) {
    throw new Error(`Pair {${a}, ${b}} lies outside a graph of ${adjacency.length} nodes`);
  }
  fromA.set(b, (fromA.get(b) ?? 0) + weight);
  fromB.set(a, (fromB.get(a) ?? 0) + weight);
}

/**
 * Builds the first Louvain level from the distinct directed edges.
 *
 * @param size - The number of nodes.
 * @param edges - The distinct directed edges, by index, with no self-loop.
 * @returns The undirected, weighted level.
 */
function firstLevel(size: number, edges: readonly (readonly [number, number])[]): WeightedLevel {
  const adjacency = Array.from({ length: size }, () => new Map<number, number>());
  for (const [from, to] of edges) {
    addPairWeight(adjacency, from, to, 1);
  }
  return { adjacency, selfLoop: new Array<number>(size).fill(0) };
}

/** What one Louvain pass reads while it moves nodes between communities. */
interface PassState {
  /** The level being clustered. */
  readonly level: WeightedLevel;
  /** Each node's degree, by index. */
  readonly degree: readonly number[];
  /** Twice the level's total edge weight. */
  readonly twiceTotal: number;
  /** Each node's community label, by index; changed in place. */
  readonly community: number[];
  /** Each community's total degree, by label; changed in place. */
  readonly communityDegree: number[];
}

/**
 * The community a node does best in, with the node taken out of its own
 * first: the neighbouring community whose modularity gain is highest. A
 * tie keeps the node where it is, or else goes to the lower label.
 *
 * @param state - The pass's state; the node's degree is taken out of its
 *   own community's total and is not put back.
 * @param node - The node to place.
 * @returns The label of the community the node belongs in.
 */
function bestCommunity(state: PassState, node: number): number {
  const own = state.community[node] ?? node;
  const nodeDegree = state.degree[node] ?? 0;
  const neighbours = [...(state.level.adjacency[node] ?? new Map<number, number>())];
  const linkTo = new Map<number, number>();
  for (const [neighbour, weight] of neighbours.sort((left, right) => left[0] - right[0])) {
    const label = state.community[neighbour] ?? neighbour;
    linkTo.set(label, (linkTo.get(label) ?? 0) + weight);
  }
  state.communityDegree[own] = (state.communityDegree[own] ?? 0) - nodeDegree;
  const gainOf = (label: number): number => {
    const pull = ((state.communityDegree[label] ?? 0) * nodeDegree) / state.twiceTotal;
    return (linkTo.get(label) ?? 0) - pull;
  };
  let best = own;
  let bestGain = gainOf(own);
  for (const label of [...linkTo.keys()].sort((left, right) => left - right)) {
    const gain = gainOf(label);
    if (gain > bestGain + GAIN_EPSILON) {
      best = label;
      bestGain = gain;
    }
  }
  return best;
}

/**
 * Louvain's first phase over one level: each node, visited in index order,
 * moves to the community `bestCommunity` names, pass after pass until a
 * whole pass moves nothing.
 *
 * @param level - The level to cluster.
 * @returns Each node's community label, by index, and whether any node moved.
 */
function moveNodes(level: WeightedLevel): { readonly community: number[]; readonly moved: boolean } {
  const size = level.adjacency.length;
  const degree = degrees(level);
  const twiceTotal = degree.reduce((sum, value) => sum + value, 0);
  const state: PassState = {
    community: Array.from({ length: size }, (_, node) => node),
    communityDegree: [...degree],
    degree,
    level,
    twiceTotal,
  };
  if (twiceTotal === 0) {
    return { community: state.community, moved: false };
  }
  let moved = false;
  let movedThisPass = true;
  while (movedThisPass) {
    movedThisPass = false;
    for (let node = 0; node < size; node += 1) {
      const best = bestCommunity(state, node);
      state.communityDegree[best] = (state.communityDegree[best] ?? 0) + (degree[node] ?? 0);
      if (best !== state.community[node]) {
        state.community[node] = best;
        moved = true;
        movedThisPass = true;
      }
    }
  }
  return { community: state.community, moved };
}

/**
 * Renumbers community labels `0, 1, …` in the order each first appears
 * when the nodes are read by index.
 *
 * @param community - Each node's community label, by index.
 * @returns The renumbered labels and the number of communities.
 */
function renumber(community: readonly number[]): { readonly labels: number[]; readonly count: number } {
  const next = new Map<number, number>();
  const labels = community.map((label) => {
    const known = next.get(label);
    if (known !== undefined) {
      return known;
    }
    next.set(label, next.size);
    return next.size - 1;
  });
  return { count: next.size, labels };
}

/**
 * Louvain's second phase: folds each community into one node of a new
 * level. An edge inside a community becomes part of its self-loop; edges
 * between two communities add up into one.
 *
 * @param level - The level the communities were found in.
 * @param labels - Each node's community, numbered from 0.
 * @param count - The number of communities.
 * @returns The folded level.
 */
function aggregate(level: WeightedLevel, labels: readonly number[], count: number): WeightedLevel {
  const adjacency = Array.from({ length: count }, () => new Map<number, number>());
  const selfLoop = new Array<number>(count).fill(0);
  level.adjacency.forEach((neighbours, node) => {
    const own = labels[node] ?? 0;
    selfLoop[own] = (selfLoop[own] ?? 0) + (level.selfLoop[node] ?? 0);
    for (const [neighbour, weight] of neighbours) {
      const other = labels[neighbour] ?? 0;
      if (other === own) {
        // Each undirected pair is read from both ends: half a weight each.
        selfLoop[own] = (selfLoop[own] ?? 0) + weight / 2;
      } else if (node < neighbour) {
        addPairWeight(adjacency, own, other, weight);
      }
    }
  });
  return { adjacency, selfLoop };
}

/**
 * Clusters a graph with the Louvain method, deterministically: nodes are
 * visited in sorted order, ties are broken by that order, and nothing is
 * random. The graph is read as undirected (see the module note).
 *
 * @param graph - The graph to cluster.
 * @returns The clusters, each sorted, largest first and, between two of one
 *   size, the one whose first member sorts first. Every node is in exactly
 *   one cluster; an isolated node is a cluster of its own.
 * @throws When an edge names a node the graph does not list.
 */
export function louvainClusters(graph: DirectedGraph): string[][] {
  const { edges, nodes } = indexGraph(graph);
  let level = firstLevel(nodes.names.length, edges);
  let membership = nodes.names.map((_, index) => index);
  let moved = true;
  while (moved) {
    const pass = moveNodes(level);
    moved = pass.moved;
    if (!moved) {
      break;
    }
    const { count, labels } = renumber(pass.community);
    if (count === level.adjacency.length) {
      break;
    }
    membership = membership.map((node) => labels[node] ?? 0);
    level = aggregate(level, labels, count);
  }
  const clusters = new Map<number, string[]>();
  nodes.names.forEach((name, index) => {
    const label = membership[index] ?? index;
    clusters.set(label, [...(clusters.get(label) ?? []), name]);
  });
  return [...clusters.values()].sort(
    (left, right) => right.length - left.length || compareNames(left[0] ?? '', right[0] ?? ''),
  );
}

/**
 * Brandes betweenness over a directed, unweighted graph: for each node,
 * the sum over every ordered pair `(s, t)` of other nodes of the share of
 * shortest `s → t` paths that pass through it. Scores are raw, not
 * normalised: a star of `n` leaves linked both ways gives its centre
 * `n·(n-1)`. Sources are walked in sorted order, so the float sums repeat
 * exactly from run to run.
 *
 * @param graph - The graph to score.
 * @returns Each node's betweenness, its keys in sorted node order.
 * @throws When an edge names a node the graph does not list.
 */
export function betweenness(graph: DirectedGraph): Map<string, number> {
  const { edges, nodes } = indexGraph(graph);
  const size = nodes.names.length;
  const successors = Array.from({ length: size }, () => [] as number[]);
  for (const [from, to] of edges) {
    successors[from]?.push(to);
  }
  const score = new Array<number>(size).fill(0);
  for (let source = 0; source < size; source += 1) {
    const dependency = singleSourceDependency(source, successors);
    dependency.forEach((value, node) => {
      if (node !== source) {
        score[node] = (score[node] ?? 0) + value;
      }
    });
  }
  return new Map(nodes.names.map((name, index) => [name, score[index] ?? 0]));
}

/**
 * Brandes's single-source step: a breadth-first walk from `source`
 * counting shortest paths, then the dependencies accumulated back from
 * the farthest node.
 *
 * @param source - The node the walk starts at.
 * @param successors - Each node's successors, by index, sorted.
 * @returns Each node's dependency on `source`, by index.
 */
function singleSourceDependency(source: number, successors: readonly (readonly number[])[]): number[] {
  const size = successors.length;
  const distance = new Array<number>(size).fill(-1);
  const pathCount = new Array<number>(size).fill(0);
  const predecessors = Array.from({ length: size }, () => [] as number[]);
  const visitOrder: number[] = [];
  distance[source] = 0;
  pathCount[source] = 1;
  const queue = [source];
  for (let head = 0; head < queue.length; head += 1) {
    const node = queue[head] ?? source;
    visitOrder.push(node);
    for (const next of successors[node] ?? []) {
      if (distance[next] === -1) {
        distance[next] = (distance[node] ?? 0) + 1;
        queue.push(next);
      }
      if (distance[next] === (distance[node] ?? 0) + 1) {
        pathCount[next] = (pathCount[next] ?? 0) + (pathCount[node] ?? 0);
        predecessors[next]?.push(node);
      }
    }
  }
  const dependency = new Array<number>(size).fill(0);
  for (let index = visitOrder.length - 1; index >= 0; index -= 1) {
    const node = visitOrder[index] ?? source;
    const share = (1 + (dependency[node] ?? 0)) / (pathCount[node] ?? 1);
    for (const previous of predecessors[node] ?? []) {
      dependency[previous] = (dependency[previous] ?? 0) + (pathCount[previous] ?? 0) * share;
    }
  }
  return dependency;
}

/** What Tarjan's walk keeps while it runs; every array is changed in place. */
interface TarjanState {
  /** Each node's successors, by index, sorted. */
  readonly successors: readonly (readonly number[])[];
  /** The order each node was first reached in, or -1 when it has not been. */
  readonly reached: number[];
  /** The earliest-reached node each node can get back to, by that order. */
  readonly lowest: number[];
  /** Whether each node is on the stack of nodes awaiting a component. */
  readonly onStack: boolean[];
  /** The nodes awaiting a component, in the order they were reached. */
  readonly stack: number[];
  /** The components closed so far, each as node indexes. */
  readonly components: number[][];
  /** How many nodes have been reached: the order the next one takes. */
  reachedCount: number;
}

/**
 * Tarjan's walk from one root, with its own stack of frames in place of
 * recursion, so a long chain of imports cannot overflow the call stack.
 * Every component the walk closes is added to `state.components`.
 *
 * @param state - The walk's state; changed in place.
 * @param root - The node the walk starts at, not reached before.
 */
function tarjanFrom(state: TarjanState, root: number): void {
  const { lowest, onStack, reached, stack, successors } = state;
  const enter = (node: number): void => {
    reached[node] = state.reachedCount;
    lowest[node] = state.reachedCount;
    state.reachedCount += 1;
    stack.push(node);
    onStack[node] = true;
  };
  // One frame per node on the current path: the node and its next successor.
  const frames: { readonly node: number; next: number }[] = [{ next: 0, node: root }];
  enter(root);
  for (let frame = frames.at(-1); frame !== undefined; frame = frames.at(-1)) {
    const { node } = frame;
    const successor = successors[node]?.[frame.next];
    if (successor !== undefined) {
      frame.next += 1;
      if (reached[successor] === -1) {
        enter(successor);
        frames.push({ next: 0, node: successor });
      } else if (onStack[successor]) {
        lowest[node] = Math.min(lowest[node] ?? 0, reached[successor] ?? 0);
      }
      continue;
    }
    frames.pop();
    const parent = frames.at(-1)?.node;
    if (parent !== undefined) {
      lowest[parent] = Math.min(lowest[parent] ?? 0, lowest[node] ?? 0);
    }
    if (lowest[node] === reached[node]) {
      const cut = stack.lastIndexOf(node);
      const component = stack.splice(cut);
      for (const member of component) {
        onStack[member] = false;
      }
      state.components.push(component);
    }
  }
}

/**
 * The graph's strongly connected components, by Tarjan's algorithm: the
 * largest sets of nodes in which every node reaches every other along
 * edges in their direction. Two files are in one component exactly when
 * an import cycle holds them both. Roots and successors are walked in
 * sorted order, so the result repeats from run to run.
 *
 * @param graph - The graph to read.
 * @returns The components, each sorted, largest first and, between two of
 *   one size, the one whose first member sorts first. Every node is in
 *   exactly one component; a node on no cycle is a component of its own.
 * @throws When an edge names a node the graph does not list.
 */
export function stronglyConnected(graph: DirectedGraph): string[][] {
  const { edges, nodes } = indexGraph(graph);
  const size = nodes.names.length;
  const successors = Array.from({ length: size }, () => [] as number[]);
  for (const [from, to] of edges) {
    successors[from]?.push(to);
  }
  const state: TarjanState = {
    components: [],
    lowest: new Array<number>(size).fill(-1),
    onStack: new Array<boolean>(size).fill(false),
    reached: new Array<number>(size).fill(-1),
    reachedCount: 0,
    stack: [],
    successors,
  };
  for (let root = 0; root < size; root += 1) {
    if (state.reached[root] === -1) {
      tarjanFrom(state, root);
    }
  }
  return state.components
    .map((component) => component.map((node) => nodes.names[node] ?? '').sort())
    .sort((left, right) => right.length - left.length || compareNames(left[0] ?? '', right[0] ?? ''));
}
