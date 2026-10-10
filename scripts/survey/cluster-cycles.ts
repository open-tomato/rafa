/**
 * The cycle reading behind the import-cycle sweep: which import cycles of
 * a graph span two clusters of a file-to-cluster map. A package line cut
 * between two clusters that share a cycle is a package cycle, so every
 * component answered here is one to break before the cut.
 *
 * Each file of the graph is placed in a cluster one of two ways:
 *
 *   - by the map, when the map names it;
 *   - by its folder otherwise: it takes the cluster most of the map's
 *     files in the same folder hold, and the cluster whose name sorts
 *     first when two tie. The folder is the file's own directory, never
 *     an ancestor or a subfolder, and its mapped files are counted from
 *     the map alone, whether or not the graph still lists them. A file
 *     added since the map was exported lands with its neighbours this way.
 *
 * A file the map does not name, in a folder holding no mapped file, is
 * placed nowhere and named under `unplaced`; nothing is thrown, so the
 * caller decides what an unplaced file costs. It stays a node of the
 * graph, so a cycle through it is still found, but it counts toward no
 * cluster: a cycle is answered when its placed files hold two clusters or
 * more.
 *
 * The graph is read as given, edge kinds and all: a caller wanting runtime
 * cycles only hands in the value edges.
 */

import type { DirectedGraph } from './graph-algorithms';

import { posix } from 'node:path';

import { stronglyConnected } from './graph-algorithms';

/** What `crossClusterCycles` reads. */
export interface ClusterCyclesInput {
  /** The import graph, an edge running from the importing file to the imported one. */
  readonly graph: DirectedGraph;
  /** The map: each mapped file's cluster, keyed by the path the graph names it by. */
  readonly clusterOf: ReadonlyMap<string, string>;
}

/** One file the map does not name, with the cluster its folder gave it. */
export interface FolderPlacement {
  /** The unmapped file. */
  readonly file: string;
  /** The cluster most of its folder's mapped files hold. */
  readonly cluster: string;
}

/** One strongly connected component whose placed files hold two clusters or more. */
export interface CrossClusterCycle {
  /** Every file of the component, sorted, an unplaced one included. */
  readonly files: readonly string[];
  /** The clusters its placed files hold, sorted; never fewer than two. */
  readonly clusters: readonly string[];
}

/** What `crossClusterCycles` answers. */
export interface ClusterCycles {
  /** The components spanning two clusters, largest first, then by first file. */
  readonly cycles: readonly CrossClusterCycle[];
  /** The graph's unmapped files placed by their folder, sorted by file. */
  readonly placedByFolder: readonly FolderPlacement[];
  /** The graph's unmapped files whose folder holds no mapped file, sorted. */
  readonly unplaced: readonly string[];
}

/**
 * Each folder's majority cluster: the one most of the map's files directly
 * in that folder hold, and the one whose name sorts first on a tie.
 *
 * @param clusterOf - The map.
 * @returns The majority cluster of every folder holding a mapped file.
 */
function folderMajorities(clusterOf: ReadonlyMap<string, string>): Map<string, string> {
  const counts = new Map<string, Map<string, number>>();
  for (const [file, cluster] of clusterOf) {
    const folder = posix.dirname(file);
    const held = counts.get(folder) ?? new Map<string, number>();
    held.set(cluster, (held.get(cluster) ?? 0) + 1);
    counts.set(folder, held);
  }
  const majorities = new Map<string, string>();
  for (const [folder, held] of counts) {
    // Names first, in the order `sort` gives strings; the stable sort by
    // count then leaves the first-sorting name ahead on a tie.
    const [first] = [...held.keys()]
      .sort()
      .sort((left, right) => (held.get(right) ?? 0) - (held.get(left) ?? 0));
    if (first !== undefined) {
      majorities.set(folder, first);
    }
  }
  return majorities;
}

/**
 * Reads which import cycles of a graph span two clusters, placing each
 * file by the map or by its folder's majority cluster (see the module
 * note).
 *
 * @param input - The graph and the file-to-cluster map.
 * @returns The cycles spanning two clusters, the files placed by folder,
 *   and the files placed nowhere.
 * @throws When an edge names a node the graph does not list.
 */
export function crossClusterCycles(input: ClusterCyclesInput): ClusterCycles {
  const { clusterOf, graph } = input;
  const majorities = folderMajorities(clusterOf);
  const placed = new Map<string, string>();
  const placedByFolder: FolderPlacement[] = [];
  const unplaced: string[] = [];
  for (const file of [...new Set(graph.nodes)].sort()) {
    const mapped = clusterOf.get(file);
    const cluster = mapped ?? majorities.get(posix.dirname(file));
    if (cluster === undefined) {
      unplaced.push(file);
      continue;
    }
    placed.set(file, cluster);
    if (mapped === undefined) {
      placedByFolder.push({ cluster, file });
    }
  }
  const cycles = stronglyConnected(graph).flatMap((files): CrossClusterCycle[] => {
    const held = files.flatMap((file) => placed.get(file) ?? []);
    const clusters = [...new Set(held)].sort();
    return clusters.length < 2
      ? []
      : [{ clusters, files }];
  });
  return { cycles, placedByFolder, unplaced };
}
