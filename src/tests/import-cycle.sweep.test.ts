/**
 * The cycle sweep: fails on any non-test runtime import cycle that spans
 * two clusters of `docs/survey/cluster-map.json`. A package line cut
 * through a component the map's clusters disagree on is a package cycle
 * (epic #801's acceptance criteria), so a cycle this test finds is one to
 * break before any file crosses a package boundary.
 *
 * The map it reads is `docs/survey/cluster-map.json`: the eight-cluster,
 * non-test run exported once at base commit `102d26c` (see
 * `docs/survey/README.md`). The tracked `docs/survey/import-graph.json`
 * is a different, 32-cluster run that includes test files, made to chart
 * betweenness and folder spread rather than to anchor a package cut; this
 * sweep does not read it.
 *
 * "Runtime" and "non-test" are both filters on the graph the sweep walks,
 * read the way `scripts/survey/import-graph.ts` reads it
 * (`readMetafile`, `buildImportGraph`, the file set from
 * `scripts/survey/files.ts`):
 *
 *   - only `value` edges are kept, the ones `bun build --metafile` records
 *     (a dynamic `import()` included). A `type` edge — `import type`, a
 *     type-only re-export, or an import used only as a type — is dropped,
 *     so a cycle held together by type-only imports alone passes this
 *     sweep. `tsc --build` with project references (#807) is the gate for
 *     those;
 *   - a file `scripts/survey/files.ts` classifies as `test` (a
 *     `.test.ts`, a `.sweep.test.ts` included) is dropped from both the
 *     node set and the edge set. A test-support file (a fixture, a
 *     fake) stays in, matching what the map itself covers.
 *
 * A file the map does not name is placed by its folder's majority
 * cluster (`crossClusterCycles`, `scripts/survey/cluster-cycles.ts`); the
 * count placed this way is printed below, alongside the coverage line, so
 * a run that read nothing cannot pass silently.
 *
 * Once #905's cut table exists, clusters stop being the boundary a
 * package line must respect — packages are — so this sweep is meant to
 * read that table instead of `cluster-map.json` once it lands, keeping
 * the same value-edge, non-test graph underneath.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'bun:test';

import { crossClusterCycles } from '../../scripts/survey/cluster-cycles.js';
import { classifyFile, coverageLine, listTrackedFiles } from '../../scripts/survey/files.js';
import { buildImportGraph, bunResolver, readMetafile } from '../../scripts/survey/import-graph.js';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CLUSTER_MAP_PATH = join(REPO_ROOT, 'docs', 'survey', 'cluster-map.json');
const SWEEP_TIMEOUT = 150_000;

/** The shape of `docs/survey/cluster-map.json`. */
interface ClusterMap {
  readonly base: string;
  readonly clusters: Readonly<Record<string, string>>;
  readonly outside: readonly string[];
}

/**
 * Reads the tracked cluster map.
 *
 * @returns The parsed map.
 */
function readClusterMap(): ClusterMap {
  return JSON.parse(readFileSync(CLUSTER_MAP_PATH, 'utf8')) as ClusterMap;
}

/**
 * One line per cross-cluster cycle: its clusters, then its files.
 *
 * @param cycles - The cycles `crossClusterCycles` answered.
 * @returns A multi-line description, empty when there are none.
 */
function describeCycles(cycles: readonly { readonly clusters: readonly string[]; readonly files: readonly string[] }[]): string {
  return cycles
    .map((cycle) => `${cycle.clusters.join('/')}: ${cycle.files.join(', ')}`)
    .join('\n');
}

describe('the import cycle sweep', () => {
  it(
    'holds no non-test runtime import cycle across two clusters of docs/survey/cluster-map.json',
    async () => {
      const tracked = listTrackedFiles(REPO_ROOT);
      const metafile = await readMetafile(REPO_ROOT, tracked.all);
      const sources = new Map<string, string>();
      for (const path of tracked.all) {
        sources.set(path, readFileSync(join(REPO_ROOT, path), 'utf8'));
      }
      const graph = buildImportGraph({
        files: tracked.all,
        metafile,
        resolve: bunResolver(REPO_ROOT),
        root: REPO_ROOT,
        sources,
      });

      console.log(coverageLine(graph.read, tracked.all));

      const nonTestFiles = new Set(tracked.all.filter((path) => classifyFile(path) !== 'test'));
      const runtimeGraph = {
        edges: graph.edges.filter(
          (edge) => edge.kind === 'value' && nonTestFiles.has(edge.from) && nonTestFiles.has(edge.to),
        ),
        nodes: [...nonTestFiles].sort(),
      };

      const map = readClusterMap();
      const clusterOf = new Map(Object.entries(map.clusters));
      expect(clusterOf.size).toBeGreaterThan(0);

      const { cycles, placedByFolder, unplaced } = crossClusterCycles({ clusterOf, graph: runtimeGraph });

      console.log(
        `placed ${placedByFolder.length} unmapped file(s) by their folder's majority cluster; `
        + `${unplaced.length} unmapped file(s) whose folder holds no mapped file`,
      );

      expect(cycles, describeCycles(cycles)).toEqual([]);
    },
    SWEEP_TIMEOUT,
  );
});
