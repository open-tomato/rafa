/**
 * The import graph of rafa's own sources: `bun scripts/survey/import-graph.ts`
 * from the repository root writes `.rafa/survey/import-graph.json` and
 * `.rafa/survey/import-graph.md` through `survey-io.ts`.
 *
 * ## What it reads
 *
 * Every tracked non-test source file under `src/` and `packages/`
 * ({@link isSurveyedSource}) is an entry point of one
 * `bun build --metafile` run, and the metafile's imports are the graph's
 * edges, one per importing file and imported file. What the metafile
 * holds decides what an edge is:
 *
 * - **Type-only imports are not edges.** Bun erases `import type` before
 *   it records imports, so a file that only borrows another's types shows
 *   no edge to it. The graph is the runtime graph.
 * - **An import between two entry points keeps its raw specifier** in
 *   `path` (`./parse.js`), and a dynamic import carries it in `original`,
 *   so {@link edgesFromMetafile} resolves each one from the importing
 *   file's folder with `Bun.resolveSync`, which also follows the
 *   `@open-tomato/rafa/store` and `/ports` paths a package imports core
 *   through. An absolute `path` is already resolved and taken as it is.
 * - **One unparseable file fails the whole build** and no metafile is
 *   written, so {@link runMetafileBuild} drops every file the build's
 *   errors name and builds again. A dropped file is a build failure, and
 *   the coverage line names it as missed.
 *
 * ## Clusters
 *
 * Clusters come from the edges, never from folder names: Louvain
 * community detection over the undirected graph, seeded so two runs over
 * one tree agree. Louvain can find more than eight communities, so
 * {@link capCommunities} merges the smallest community beyond the eighth
 * into the neighbour it shares the most edges with, until eight are left
 * or none beyond the eighth has an edge to another. The ones left are
 * ranked `c1` to `c8` by size. A file with no edge at all is `isolated`,
 * and a file in a community beyond the eighth with no edge out of it is
 * `detached`: neither is in a cluster, and the summary lists both.
 *
 * Betweenness is scored per file over the directed graph, normalized, so
 * a file many import chains pass through scores high. Each cluster's
 * folder spread lists the folders its files sit in, each with how many of
 * that folder's files the cluster holds.
 */
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative } from 'node:path';

import { DirectedGraph, UndirectedGraph } from 'graphology';
import louvain from 'graphology-communities-louvain';
import betweennessCentrality from 'graphology-metrics/centrality/betweenness';

import { listTrackedFiles, measureCoverage, writeSurvey } from './survey-io.js';

/** The tracked folders the graph reads. */
export const SURVEY_SCOPE: readonly string[] = ['src', 'packages'];

/** The most clusters a reading ranks, `c1` to `c8`. */
export const MAX_CLUSTERS = 8;

/** The Louvain seed, fixed so two runs over one tree cluster it alike. */
export const LOUVAIN_SEED = 801;

/** How many files the summary's betweenness table lists. */
const TOP_BETWEENNESS = 20;

/** Decimal places betweenness keeps in the reading. */
const BETWEENNESS_DIGITS = 6;

const SOURCE_FILE = /\.[cm]?[jt]sx?$/;
const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;
const DECLARATION_FILE = /\.d\.[cm]?ts$/;
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/;
const ERROR_LINE = /^error: (.*)$/;
const LOCATION_LINE = /^\s*at (.+?):\d+:\d+\s*$/;

/** Whether an import arrived through a static import or `require`, or through `import()`. */
export type ImportKind = 'static' | 'dynamic';

/** One import of one surveyed file by another, deduplicated per pair. */
export interface ImportEdge {
  readonly from: string;
  readonly to: string;
  /** `static` when any import of the pair is, `dynamic` when every one is `import()`. */
  readonly kind: ImportKind;
}

/** One import as `bun build --metafile` records it. */
export interface MetafileImport {
  readonly path: string;
  readonly kind: string;
  readonly original?: string;
  readonly external?: boolean;
}

/** The part of a metafile the graph reads: each input file, keyed relative to the build's folder. */
export interface Metafile {
  readonly inputs: Readonly<Record<string, { readonly imports: readonly MetafileImport[] }>>;
}

/** A file the build refused, with the first error it printed for it. */
export interface BuildFailure {
  readonly path: string;
  readonly message: string;
}

/** An import the build accepted that {@link edgesFromMetafile} could not resolve again. */
export interface UnresolvedImport {
  readonly from: string;
  readonly specifier: string;
}

/** What one `bun build --metafile` run answered. */
export interface BuildRun {
  readonly exitCode: number;
  /** Stdout and stderr together, where bun prints its errors. */
  readonly output: string;
  /** The metafile's text, or `null` when the build wrote none. */
  readonly metafile: string | null;
}

/** Runs `bun build --metafile` over `entries` in `repoRoot`. */
export type BuildRunner = (repoRoot: string, entries: readonly string[]) => Promise<BuildRun>;

/** Resolves `specifier` from the folder `fromDir`, as `Bun.resolveSync` does. */
export type Resolver = (specifier: string, fromDir: string) => string;

/** One folder's share of a cluster. */
export interface ClusterFolder {
  readonly folder: string;
  /** The cluster's files in this folder. */
  readonly files: number;
  /** Every graph file in this folder, in any cluster or none. */
  readonly folderTotal: number;
}

/** One ranked cluster. */
export interface Cluster {
  /** `c1` for the largest, up to `c8`. */
  readonly id: string;
  readonly files: readonly string[];
  readonly folders: readonly ClusterFolder[];
  /** Edges with both ends in the cluster. */
  readonly internalEdges: number;
  /** Edges with one end in the cluster and the other anywhere else. */
  readonly crossEdges: number;
}

/** One file of the graph. */
export interface FileReading {
  readonly path: string;
  /** Its cluster's id, or `null` when it is isolated or detached. */
  readonly cluster: string | null;
  readonly betweenness: number;
  /** How many graph files it imports. */
  readonly imports: number;
  /** How many graph files import it. */
  readonly importedBy: number;
}

/** How the files fell into clusters. */
export interface Clustering {
  readonly clusters: readonly (readonly string[])[];
  readonly isolated: readonly string[];
  readonly detached: readonly string[];
  readonly modularity: number;
  /** How many communities Louvain found, before {@link capCommunities} merged them. */
  readonly communities: number;
}

/** The reading written under `data` in `import-graph.json`. */
export interface ImportGraphData {
  readonly modularity: number;
  /** How many communities Louvain found before the cap. */
  readonly communities: number;
  readonly files: readonly FileReading[];
  readonly edges: readonly ImportEdge[];
  readonly clusters: readonly Cluster[];
  readonly isolated: readonly string[];
  readonly detached: readonly string[];
  readonly failures: readonly BuildFailure[];
  readonly unresolved: readonly UnresolvedImport[];
}

/** Whether `path` is a source file the graph reads: code, neither a test nor a declaration. */
export function isSurveyedSource(path: string): boolean {
  return SOURCE_FILE.test(path) && !TEST_FILE.test(path) && !DECLARATION_FILE.test(path);
}

/** A seeded generator of numbers in `[0, 1)` (mulberry32), so Louvain picks alike on every run. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The files a failed build's `output` names, each with the error printed
 * just before its location, keeping only paths in `entries`. Locations are
 * absolute, so they are read against `realRoot`, the repository root with
 * its links resolved, as bun prints it.
 */
export function parseBuildFailures(output: string, realRoot: string, entries: ReadonlySet<string>): BuildFailure[] {
  const failures = new Map<string, string>();
  let message = '';
  for (const line of output.split('\n')) {
    const error = ERROR_LINE.exec(line);
    if (error) {
      message = error[1] ?? '';
      continue;
    }
    const location = LOCATION_LINE.exec(line);
    const path = location?.[1] === undefined
      ? null
      : relative(realRoot, location[1]);
    if (path !== null && entries.has(path) && !failures.has(path)) {
      failures.set(path, message);
    }
  }
  return [...failures].map(([path, text]) => ({ path, message: text })).sort((a, b) => a.path.localeCompare(b.path));
}

/** The real {@link BuildRunner}: `bun build --metafile` into a temporary folder it removes after. */
export const runBunBuild: BuildRunner = async (repoRoot, entries) => {
  const outDir = mkdtempSync(join(tmpdir(), 'rafa-import-graph-'));
  const metaPath = join(outDir, 'meta.json');
  try {
    const result = await Bun.$`bun build ${[...entries]} --target=bun --packages=external --outdir=${join(outDir, 'out')} --metafile=${metaPath}`
      .cwd(repoRoot)
      .quiet()
      .nothrow();
    const meta = Bun.file(metaPath);
    return {
      exitCode: result.exitCode,
      output: `${result.stdout.toString()}\n${result.stderr.toString()}`,
      metafile: await meta.exists()
        ? await meta.text()
        : null,
    };
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
};

/**
 * The metafile of one build over `entries`, building again without every
 * file a failed build names until one succeeds, and the files dropped on
 * the way. Throws when a build fails naming no entry, or succeeds writing
 * no metafile.
 */
export async function runMetafileBuild(
  repoRoot: string,
  entries: readonly string[],
  build: BuildRunner = runBunBuild,
): Promise<{ metafile: Metafile; failures: BuildFailure[] }> {
  const realRoot = realpathSync(repoRoot);
  const failures: BuildFailure[] = [];
  let remaining = [...entries];
  while (remaining.length > 0) {
    const run = await build(repoRoot, remaining);
    if (run.exitCode === 0) {
      if (run.metafile === null) {
        throw new Error('bun build succeeded but wrote no metafile');
      }
      return { metafile: JSON.parse(run.metafile) as Metafile, failures };
    }
    const named = parseBuildFailures(run.output, realRoot, new Set(remaining));
    if (named.length === 0) {
      throw new Error(`bun build failed naming no surveyed file:\n${run.output.trim()}`);
    }
    failures.push(...named);
    const dropped = new Set(named.map((failure) => failure.path));
    remaining = remaining.filter((path) => !dropped.has(path));
  }
  return { metafile: { inputs: {} }, failures };
}

/** The specifier to resolve for `entry`, or `null` when it names a builtin or a scheme such as `bun:`. */
function specifierOf(entry: MetafileImport): string | null {
  const specifier = entry.original ?? entry.path;
  return isBuiltin(specifier) || URL_SCHEME.test(specifier)
    ? null
    : specifier;
}

/**
 * The edges between `files` the metafile records, deduplicated per pair
 * and sorted, and the imports that could not be resolved again. An import
 * reaching outside `files`, such as a package or a JSON file, is no edge.
 */
export function edgesFromMetafile(
  metafile: Metafile,
  repoRoot: string,
  files: ReadonlySet<string>,
  resolve: Resolver = Bun.resolveSync,
): { edges: ImportEdge[]; unresolved: UnresolvedImport[] } {
  const kinds = new Map<string, ImportEdge>();
  const unresolved: UnresolvedImport[] = [];
  for (const [from, input] of Object.entries(metafile.inputs)) {
    if (!files.has(from)) {
      continue;
    }
    for (const entry of input.imports) {
      const target = targetOf(entry, from, repoRoot, resolve);
      if (target === 'unresolved') {
        unresolved.push({ from, specifier: entry.original ?? entry.path });
        continue;
      }
      if (target === null || target === from || !files.has(target)) {
        continue;
      }
      const kind: ImportKind = entry.kind === 'dynamic-import'
        ? 'dynamic'
        : 'static';
      const key = `${from}\0${target}`;
      const known = kinds.get(key);
      if (known === undefined || (known.kind === 'dynamic' && kind === 'static')) {
        kinds.set(key, { from, to: target, kind });
      }
    }
  }
  const edges = [...kinds.values()].sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  return { edges, unresolved };
}

/** The repository-relative file `entry` imports, `null` for a builtin, or `unresolved`. */
function targetOf(entry: MetafileImport, from: string, repoRoot: string, resolve: Resolver): string | null {
  if (isAbsolute(entry.path)) {
    return relative(repoRoot, entry.path);
  }
  const specifier = specifierOf(entry);
  if (specifier === null) {
    return null;
  }
  try {
    return relative(repoRoot, resolve(specifier, dirname(join(repoRoot, from))));
  } catch {
    return 'unresolved';
  }
}

/** Ranks groups largest first, the group holding the earlier first path first on a tie. */
function rankGroups(groups: readonly (readonly string[])[]): string[][] {
  return groups
    .map((group) => [...group].sort())
    .sort((a, b) => b.length - a.length || (a[0] ?? '').localeCompare(b[0] ?? ''));
}

/** The edges between each pair of groups, by group index. */
function weightsBetween(groups: readonly (readonly string[])[], edges: readonly ImportEdge[]): Map<number, Map<number, number>> {
  const groupOf = new Map<string, number>();
  groups.forEach((group, index) => group.forEach((path) => groupOf.set(path, index)));
  const weights = new Map<number, Map<number, number>>();
  for (const edge of edges) {
    const a = groupOf.get(edge.from);
    const b = groupOf.get(edge.to);
    if (a === undefined || b === undefined || a === b) {
      continue;
    }
    for (const [x, y] of [[a, b], [b, a]] as const) {
      const row = weights.get(x) ?? new Map<number, number>();
      row.set(y, (row.get(y) ?? 0) + 1);
      weights.set(x, row);
    }
  }
  return weights;
}

/**
 * Merges ranked `groups` down to `cap`: while more than `cap` are left,
 * the lowest-ranked group beyond the cap that shares an edge with another
 * joins the one it shares the most with, the higher-ranked on a tie.
 * Returns the ranked groups kept and, flattened and sorted, the files of
 * groups beyond the cap that share no edge with any other.
 */
export function capCommunities(
  groups: readonly (readonly string[])[],
  edges: readonly ImportEdge[],
  cap: number = MAX_CLUSTERS,
): { kept: string[][]; detached: string[] } {
  let ranked = rankGroups(groups);
  while (ranked.length > cap) {
    const weights = weightsBetween(ranked, edges);
    let source = -1;
    for (let index = ranked.length - 1; index >= cap && source < 0; index -= 1) {
      if ((weights.get(index)?.size ?? 0) > 0) {
        source = index;
      }
    }
    if (source < 0) {
      break;
    }
    const neighbours = [...(weights.get(source) ?? new Map<number, number>())]
      .sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    const target = neighbours[0]?.[0] ?? 0;
    const merged = ranked.map((group, index) => index === target
      ? [...group, ...(ranked[source] ?? [])]
      : group);
    ranked = rankGroups(merged.filter((_, index) => index !== source));
  }
  const detached = ranked.slice(cap).flat();
  return { kept: ranked.slice(0, cap), detached: detached.sort() };
}

/**
 * Clusters `files` by Louvain community detection over `edges`, read as
 * undirected with a pair imported both ways weighing two, seeded with
 * `seed`, then capped at `cap` by {@link capCommunities}.
 */
export function clusterFiles(
  files: readonly string[],
  edges: readonly ImportEdge[],
  cap: number = MAX_CLUSTERS,
  seed: number = LOUVAIN_SEED,
): Clustering {
  const graph = new UndirectedGraph();
  for (const edge of edges) {
    graph.mergeNode(edge.from);
    graph.mergeNode(edge.to);
    graph.updateEdge(edge.from, edge.to, (attributes) => ({ weight: ((attributes['weight'] as number | undefined) ?? 0) + 1 }));
  }
  const isolated = files.filter((path) => !graph.hasNode(path)).sort();
  if (graph.size === 0) {
    return { clusters: [], isolated, detached: [], modularity: 0, communities: 0 };
  }
  const detailed = louvain.detailed(graph, { getEdgeWeight: 'weight', rng: seededRandom(seed) });
  const byCommunity = new Map<number, string[]>();
  for (const [path, community] of Object.entries(detailed.communities)) {
    byCommunity.set(community, [...(byCommunity.get(community) ?? []), path]);
  }
  const { kept, detached } = capCommunities([...byCommunity.values()], edges, cap);
  return { clusters: kept, isolated, detached, modularity: detailed.modularity, communities: detailed.count };
}

/** Each file's normalized betweenness over the directed graph of `files` and `edges`. */
export function betweennessOf(files: readonly string[], edges: readonly ImportEdge[]): Map<string, number> {
  const graph = new DirectedGraph();
  for (const path of files) {
    graph.mergeNode(path);
  }
  for (const edge of edges) {
    graph.mergeEdge(edge.from, edge.to);
  }
  const scores = betweennessCentrality(graph, { normalized: true });
  const scale = 10 ** BETWEENNESS_DIGITS;
  return new Map(files.map((path) => [path, Math.round((scores[path] ?? 0) * scale) / scale]));
}

/** The folders `clusterFiles` sit in, most files first, each against every file of `allFiles` in it. */
export function folderSpread(clusterFiles: readonly string[], allFiles: readonly string[]): ClusterFolder[] {
  const count = (paths: readonly string[]): Map<string, number> => {
    const counts = new Map<string, number>();
    paths.forEach((path) => counts.set(dirname(path), (counts.get(dirname(path)) ?? 0) + 1));
    return counts;
  };
  const totals = count(allFiles);
  return [...count(clusterFiles)]
    .map(([folder, files]) => ({ folder, files, folderTotal: totals.get(folder) ?? files }))
    .sort((a, b) => b.files - a.files || a.folder.localeCompare(b.folder));
}

/** The whole reading over the graph of `files` and `edges`. */
export function readImportGraph(
  files: readonly string[],
  edges: readonly ImportEdge[],
  failures: readonly BuildFailure[] = [],
  unresolved: readonly UnresolvedImport[] = [],
): ImportGraphData {
  const sorted = [...files].sort();
  const clustering = clusterFiles(sorted, edges);
  const clusterOf = new Map<string, string>();
  const clusters: Cluster[] = clustering.clusters.map((members, index) => {
    const id = `c${index + 1}`;
    const inside = new Set(members);
    members.forEach((path) => clusterOf.set(path, id));
    return {
      id,
      files: members,
      folders: folderSpread(members, sorted),
      internalEdges: edges.filter((edge) => inside.has(edge.from) && inside.has(edge.to)).length,
      crossEdges: edges.filter((edge) => inside.has(edge.from) !== inside.has(edge.to)).length,
    };
  });
  const betweenness = betweennessOf(sorted, edges);
  const fileReadings = sorted.map((path) => ({
    path,
    cluster: clusterOf.get(path) ?? null,
    betweenness: betweenness.get(path) ?? 0,
    imports: edges.filter((edge) => edge.from === path).length,
    importedBy: edges.filter((edge) => edge.to === path).length,
  }));
  return {
    modularity: clustering.modularity,
    communities: clustering.communities,
    files: fileReadings,
    edges,
    clusters,
    isolated: clustering.isolated,
    detached: clustering.detached,
    failures,
    unresolved,
  };
}

/** `none`, or each path as inline code joined by commas. */
function pathList(paths: readonly string[]): string {
  return paths.length === 0
    ? 'none'
    : paths.map((path) => `\`${path}\``).join(', ');
}

/** The markdown summary's body, written after the coverage line. */
export function renderImportGraph(data: ImportGraphData): string {
  const dynamic = data.edges.filter((edge) => edge.kind === 'dynamic').length;
  const ranked = [...data.files].sort((a, b) => b.betweenness - a.betweenness || a.path.localeCompare(b.path));
  const lines = [
    '# Import graph',
    '',
    `${data.files.length} files and ${data.edges.length} import edges (${data.edges.length - dynamic} static, `
      + `${dynamic} dynamic) from \`bun build --metafile\`. Type-only imports are erased before the metafile `
      + `and are no edges. Louvain found ${data.communities} communities, modularity ${data.modularity.toFixed(3)}, `
      + `capped at ${MAX_CLUSTERS}.`,
    '',
    `Build failures: ${data.failures.length === 0
      ? 'none'
      : data.failures.map((failure) => `\`${failure.path}\` (${failure.message})`).join(', ')}`,
    '',
    `Unresolved imports: ${data.unresolved.length === 0
      ? 'none'
      : data.unresolved.map((entry) => `\`${entry.from}\` → \`${entry.specifier}\``).join(', ')}`,
    '',
    '## Clusters',
    '',
    '| Cluster | Files | Folders | Internal edges | Cross edges | Highest betweenness |',
    '| --- | --- | --- | --- | --- | --- |',
    ...data.clusters.map((cluster) => {
      const top = ranked.find((file) => file.cluster === cluster.id);
      const topCell = top === undefined
        ? 'none'
        : `\`${top.path}\` (${top.betweenness})`;
      return `| ${cluster.id} | ${cluster.files.length} | ${cluster.folders.length} | ${cluster.internalEdges} `
        + `| ${cluster.crossEdges} | ${topCell} |`;
    }),
    '',
    `Isolated, no runtime import edge (${data.isolated.length}): ${pathList(data.isolated)}`,
    '',
    `Detached, beyond c${MAX_CLUSTERS} with no edge out (${data.detached.length}): ${pathList(data.detached)}`,
    '',
    '## Folder spread',
    ...data.clusters.flatMap((cluster) => [
      '',
      `### ${cluster.id} (${cluster.files.length} files)`,
      '',
      ...cluster.folders.map((folder) => `- \`${folder.folder}/\` ${folder.files} of ${folder.folderTotal}`),
    ]),
    '',
    '## Betweenness',
    '',
    '| File | Cluster | Betweenness | Imports | Imported by |',
    '| --- | --- | --- | --- | --- |',
    ...ranked.slice(0, TOP_BETWEENNESS).map((file) => `| \`${file.path}\` | ${file.cluster ?? 'none'} `
      + `| ${file.betweenness} | ${file.imports} | ${file.importedBy} |`),
  ];
  return lines.join('\n');
}

/** Builds, reads and writes the import graph of the repository at `repoRoot`. */
export async function surveyImportGraph(repoRoot: string, build: BuildRunner = runBunBuild): Promise<ImportGraphData> {
  const expected = (await listTrackedFiles(repoRoot, SURVEY_SCOPE)).filter(isSurveyedSource);
  const { metafile, failures } = await runMetafileBuild(repoRoot, expected, build);
  const expectedSet = new Set(expected);
  const read = Object.keys(metafile.inputs).filter((path) => expectedSet.has(path));
  const { edges, unresolved } = edgesFromMetafile(metafile, realpathSync(repoRoot), new Set(read));
  const data = readImportGraph(read, edges, failures, unresolved);
  await writeSurvey(repoRoot, 'import-graph', {
    data,
    markdown: renderImportGraph(data),
    coverage: measureCoverage(expected, read),
  });
  return data;
}

if (import.meta.main) {
  try {
    const data = await surveyImportGraph(process.cwd());
    console.log(`[import-graph] ${data.files.length} files, ${data.edges.length} edges, `
      + `${data.clusters.length} clusters, ${data.failures.length} build failures`);
  } catch (err) {
    console.error(`[import-graph] FAIL — ${err instanceof Error
      ? err.message
      : String(err)}`);
    process.exit(1);
  }
}
