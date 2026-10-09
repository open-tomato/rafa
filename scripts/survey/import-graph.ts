/**
 * The survey's import graph: one node per tracked file in scope, one edge
 * per import between two of them, the clusters the graph falls into, and
 * each file's betweenness. Run from the repository root,
 * `bun scripts/survey/import-graph.ts` writes `docs/survey/import-graph.json`
 * and `docs/survey/import-graph.md`.
 *
 * Edges come from two readings of each file, and carry the kind each gives:
 *
 *   - `value`: an import `bun build --metafile` records, a dynamic
 *     `import()` included. Bun drops an import whose bindings are only
 *     ever used as types before it bundles, so this is what runs.
 *   - `type`: an import `ts.preProcessFile` finds in the source text that
 *     the metafile does not record for the same pair of files: an
 *     `import type`, an `export type … from`, or an import whose bindings
 *     are used as types only.
 *
 * `main` passes every file in scope to `bun build` as an entry, so the
 * metafile lists them all. A file it does not list (no entry reaches it)
 * is still a node, but its own imports are unknown: its value imports were
 * never recorded, so its type imports cannot be told apart from them. It
 * adds no edge of its own, is named under `unreached`, and counts as not
 * read in the coverage line.
 *
 * Bun records an import between two entries by the specifier as written
 * (`./plan.js`), not by the file it reaches, and one into a file that is
 * not an entry by its absolute path; both are brought to repository-relative
 * paths here. A target outside the scope (a package, `package.json`, a
 * script) adds no edge. A specifier that resolves to nothing is named under
 * `unresolved`.
 *
 * Clusters come from `louvainClusters` over every edge of either kind;
 * folders play no part. A cluster is named `c<NN>-<stem>`: `NN` its rank by
 * file count, largest first, from `01`, and `<stem>` the file name, less
 * its extension, of the member with the most edges to other members (the
 * first in path order on a tie). Betweenness is `betweenness` over the
 * same edges, rounded to six decimals.
 */

import type { FileKind } from './files';
import type { DirectedGraph } from './graph-algorithms';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix } from 'node:path';

import ts from 'typescript';

import { classifyFile, coverageLine, listTrackedFiles } from './files';
import { betweenness, louvainClusters } from './graph-algorithms';

/** The kind of an import edge: what runs, or what only the type checker reads. */
export type EdgeKind = 'type' | 'value';

/** One import recorded under an input of a `bun build` metafile. */
export interface MetafileImport {
  /** The absolute path imported, or the specifier as written when the target is an entry. */
  readonly path: string;
  /** How it is imported: `import-statement`, `dynamic-import`, … */
  readonly kind: string;
  /** Set when bun left the import out of the bundle (a package, `bun:test`). */
  readonly external?: boolean;
}

/** The part of a `bun build --metafile` file the graph reads. */
export interface Metafile {
  /** Each input, keyed by its path relative to the build's working folder. */
  readonly inputs: Readonly<Record<string, { readonly imports: readonly MetafileImport[] }>>;
}

/**
 * Resolves an import specifier the way bun does.
 *
 * @param specifier - The specifier as written.
 * @param from - The repository-relative path of the importing file.
 * @returns The repository-relative path it reaches (or a name such as
 *   `bun:test` for a target outside the repository), or `undefined` when it
 *   reaches nothing.
 */
export type ResolveImport = (specifier: string, from: string) => string | undefined;

/** What the graph is built from, all of it passed in as data. */
export interface ImportGraphInput {
  /** The tracked files in scope; each is a node. */
  readonly files: readonly string[];
  /** The metafile of a `bun build` run in `root`. */
  readonly metafile: Metafile;
  /** The repository root, which absolute metafile paths are made relative to. */
  readonly root: string;
  /** The source text of each file, for `ts.preProcessFile`. */
  readonly sources: ReadonlyMap<string, string>;
  /** The resolver for specifiers bun left unresolved and for type imports. */
  readonly resolve: ResolveImport;
}

/** One edge of the graph, from the importing file to the imported one. */
export interface ImportEdge {
  readonly from: string;
  readonly kind: EdgeKind;
  readonly to: string;
}

/** A specifier that resolved to nothing. */
export interface UnresolvedImport {
  readonly from: string;
  readonly specifier: string;
}

/** The graph before clustering. */
export interface ImportGraph {
  /** Every file in scope, sorted. */
  readonly nodes: readonly string[];
  /** Every edge, sorted by `from`, then `to`. */
  readonly edges: readonly ImportEdge[];
  /** The files whose imports were read: listed in the metafile, text in hand. */
  readonly read: readonly string[];
  /** The files the metafile does not list, sorted. */
  readonly unreached: readonly string[];
  /** The specifiers that resolved to nothing, sorted. */
  readonly unresolved: readonly UnresolvedImport[];
}

/** One named cluster. */
export interface NamedCluster {
  /** `c<NN>-<stem>`. */
  readonly name: string;
  /** The member the stem is taken from. */
  readonly hub: string;
  /** The members, sorted. */
  readonly members: readonly string[];
  /** Each folder the members lie in, with how many lie there. */
  readonly folders: Readonly<Record<string, number>>;
}

/** The graph with its clusters and its betweenness: what both outputs show. */
export interface ImportGraphSurvey extends ImportGraph {
  /** The clusters, by rank. */
  readonly clusters: readonly NamedCluster[];
  /** Each file's betweenness, rounded to six decimals. */
  readonly betweenness: ReadonlyMap<string, number>;
}

/** How many files the summary lists by betweenness. */
export const TOP_BETWEENNESS = 30;

/** Where the two outputs are written, relative to the repository root. */
export const OUTPUT_DIR = 'docs/survey';

const CODE_EXTENSION = /\.(?:ts|tsx|mts|js|mjs)$/;
const DECIMALS = 1e6;

/**
 * The file name of a path, less its code extension: `src/plan/parse.ts`
 * gives `parse`, `src/a.test.ts` gives `a.test`.
 *
 * @param path - A repository-relative path.
 * @returns Its stem.
 */
export function fileStem(path: string): string {
  return posix.basename(path).replace(CODE_EXTENSION, '');
}

/**
 * The specifiers a source text imports, read by `ts.preProcessFile`:
 * static imports and re-exports of either kind, `import()` and `require`.
 *
 * @param text - A TypeScript or JavaScript source text.
 * @returns Each specifier, in source order, duplicates kept.
 */
export function textImports(text: string): string[] {
  return ts.preProcessFile(text, true, true).importedFiles.map((file) => file.fileName);
}

/**
 * Brings a metafile path to a repository-relative one. An absolute path
 * under `root` loses its prefix; anything else is returned as it is.
 *
 * @param path - A metafile path.
 * @param root - The repository root.
 * @returns The path relative to `root`, or `path` itself.
 */
function relativeToRoot(path: string, root: string): string {
  const prefix = root.endsWith('/')
    ? root
    : `${root}/`;
  return path.startsWith(prefix)
    ? path.slice(prefix.length)
    : path;
}

/** Collects the edges and unresolved specifiers while the graph is read. */
interface EdgeSink {
  readonly inScope: ReadonlySet<string>;
  readonly edges: Map<string, ImportEdge>;
  readonly unresolved: Map<string, UnresolvedImport>;
}

/**
 * Adds an edge when its target is a file in scope, and never replaces a
 * `value` edge between the same pair by a `type` one.
 *
 * @param sink - Where edges are collected; changed in place.
 * @param edge - The edge to add.
 */
function addEdge(sink: EdgeSink, edge: ImportEdge): void {
  if (edge.from === edge.to || !sink.inScope.has(edge.to)) {
    return;
  }
  const key = `${edge.from}\0${edge.to}`;
  if (sink.edges.get(key)?.kind !== 'value') {
    sink.edges.set(key, edge);
  }
}

/**
 * Resolves a specifier, or names it under `unresolved` when it reaches
 * nothing.
 *
 * @param input - The graph's input.
 * @param sink - Where unresolved specifiers are collected; changed in place.
 * @param specifier - The specifier as written.
 * @param from - The importing file.
 * @returns The target, or `undefined`.
 */
function resolveOrRecord(input: ImportGraphInput, sink: EdgeSink, specifier: string, from: string): string | undefined {
  const target = input.resolve(specifier, from);
  if (target === undefined) {
    sink.unresolved.set(`${from}\0${specifier}`, { from, specifier });
  }
  return target;
}

/**
 * Builds the import graph from a metafile and the source texts. Pure: the
 * caller runs `bun build` and reads the files (see `main`).
 *
 * @param input - The files, the metafile, the texts and a resolver.
 * @returns The graph, every list sorted.
 */
export function buildImportGraph(input: ImportGraphInput): ImportGraph {
  const nodes = [...new Set(input.files)].sort();
  const sink: EdgeSink = { edges: new Map(), inScope: new Set(nodes), unresolved: new Map() };
  const read: string[] = [];
  const unreached: string[] = [];
  for (const from of nodes) {
    const entry = input.metafile.inputs[from];
    if (entry === undefined) {
      unreached.push(from);
      continue;
    }
    for (const value of entry.imports) {
      if (value.external === true) {
        continue;
      }
      const target = value.path.startsWith('/')
        ? relativeToRoot(value.path, input.root)
        : resolveOrRecord(input, sink, value.path, from);
      if (target !== undefined) {
        addEdge(sink, { from, kind: 'value', to: target });
      }
    }
    const text = input.sources.get(from);
    if (text === undefined) {
      continue;
    }
    read.push(from);
    for (const specifier of textImports(text)) {
      const target = resolveOrRecord(input, sink, specifier, from);
      if (target !== undefined) {
        addEdge(sink, { from, kind: 'type', to: target });
      }
    }
  }
  const edges = [...sink.edges.values()].sort(
    (left, right) => compareText(left.from, right.from) || compareText(left.to, right.to),
  );
  const unresolved = [...sink.unresolved.values()].sort(
    (left, right) => compareText(left.from, right.from) || compareText(left.specifier, right.specifier),
  );
  return { edges, nodes, read, unreached, unresolved };
}

/**
 * Compares two strings by UTF-16 code unit, the order `sort` gives.
 *
 * @param left - One string.
 * @param right - The other.
 * @returns A negative, zero or positive number.
 */
function compareText(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right
    ? -1
    : 1;
}

/**
 * Names clusters `c<NN>-<stem>` and counts the folders each spans. `NN` is
 * the rank in the order given, padded to two digits (more when there are
 * a hundred clusters or more, so names still sort by rank).
 *
 * @param clusters - The clusters, largest first, each sorted.
 * @param edges - The graph's edges; those inside a cluster give its hub.
 * @returns The named clusters, in the order given.
 */
export function nameClusters(clusters: readonly (readonly string[])[], edges: readonly ImportEdge[]): NamedCluster[] {
  const clusterOf = new Map<string, number>();
  clusters.forEach((members, index) => {
    members.forEach((member) => clusterOf.set(member, index));
  });
  const degree = new Map<string, number>();
  for (const edge of edges) {
    if (clusterOf.get(edge.from) === clusterOf.get(edge.to)) {
      degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
      degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
    }
  }
  const width = Math.max(2, String(clusters.length).length);
  return clusters.map((members, index) => {
    const sorted = [...members].sort();
    const hub = sorted.reduce((best, member) => ((degree.get(member) ?? 0) > (degree.get(best) ?? 0)
      ? member
      : best), sorted[0] ?? '');
    const folders: Record<string, number> = {};
    for (const member of sorted) {
      const folder = posix.dirname(member);
      folders[folder] = (folders[folder] ?? 0) + 1;
    }
    const rank = String(index + 1).padStart(width, '0');
    return { folders, hub, members: sorted, name: `c${rank}-${fileStem(hub)}` };
  });
}

/**
 * Clusters the graph, names the clusters and scores each file's
 * betweenness.
 *
 * @param graph - The graph `buildImportGraph` returned.
 * @returns The graph with its clusters and betweenness.
 */
export function surveyImportGraph(graph: ImportGraph): ImportGraphSurvey {
  const directed: DirectedGraph = { edges: graph.edges, nodes: graph.nodes };
  const clusters = nameClusters(louvainClusters(directed), graph.edges);
  const scores = new Map(
    [...betweenness(directed)].map(([node, score]) => [node, Math.round(score * DECIMALS) / DECIMALS]),
  );
  return { ...graph, betweenness: scores, clusters };
}

/**
 * Serialises a value as JSON with every object's keys sorted and a
 * two-space indent, ending in a newline, so equal data gives equal bytes.
 *
 * @param value - Plain data: objects, arrays, strings, numbers, booleans, `null`.
 * @returns The JSON text.
 */
export function stableJson(value: unknown): string {
  const sortKeys = (node: unknown): unknown => {
    if (Array.isArray(node)) {
      return node.map(sortKeys);
    }
    if (node !== null && typeof node === 'object') {
      const entries = Object.entries(node as Record<string, unknown>).sort(([left], [right]) => compareText(left, right));
      return Object.fromEntries(entries.map(([key, child]) => [key, sortKeys(child)]));
    }
    return node;
  };
  return `${JSON.stringify(sortKeys(value), null, 2)}\n`;
}

/**
 * The survey as `docs/survey/import-graph.json` holds it: nodes with their
 * kind and cluster, edges with their kind, the clusters, each file's
 * betweenness, and what could not be read.
 *
 * @param survey - The surveyed graph.
 * @returns The JSON text.
 */
export function renderImportGraphJson(survey: ImportGraphSurvey): string {
  const clusterOf = new Map<string, string>();
  for (const cluster of survey.clusters) {
    cluster.members.forEach((member) => clusterOf.set(member, cluster.name));
  }
  return stableJson({
    betweenness: Object.fromEntries(survey.betweenness),
    clusters: survey.clusters.map((cluster) => ({ ...cluster, size: cluster.members.length })),
    edges: survey.edges,
    nodes: survey.nodes.map((path) => ({
      cluster: clusterOf.get(path) ?? '',
      kind: classifyFile(path) satisfies FileKind,
      path,
    })),
    unreached: survey.unreached,
    unresolved: survey.unresolved,
  });
}

/**
 * A cluster's folders, most members first, then by name.
 *
 * @param folders - Each folder with its member count.
 * @returns The folders as one markdown cell.
 */
function folderCell(folders: Readonly<Record<string, number>>): string {
  return Object.entries(folders)
    .sort(([leftName, left], [rightName, right]) => right - left || compareText(leftName, rightName))
    .map(([folder, count]) => `\`${folder}\` (${count})`)
    .join(', ');
}

/**
 * The survey as `docs/survey/import-graph.md` holds it: the coverage line,
 * the counts, the clusters by size with the folders they span, the files of
 * highest betweenness, and what could not be read.
 *
 * @param survey - The surveyed graph.
 * @param tracked - The tracked files in scope, for the coverage line.
 * @returns The markdown text, ending in a newline.
 */
export function renderImportGraphMarkdown(survey: ImportGraphSurvey, tracked: readonly string[]): string {
  const typeEdges = survey.edges.filter((edge) => edge.kind === 'type').length;
  const clusterOf = new Map<string, string>();
  for (const cluster of survey.clusters) {
    cluster.members.forEach((member) => clusterOf.set(member, cluster.name));
  }
  const top = [...survey.betweenness]
    .sort(([leftPath, left], [rightPath, right]) => right - left || compareText(leftPath, rightPath))
    .slice(0, TOP_BETWEENNESS);
  const lines = [
    '# Import graph',
    '',
    coverageLine(survey.read, tracked),
    '',
    `${survey.nodes.length} files, ${survey.edges.length} edges (${survey.edges.length - typeEdges} value, `
    + `${typeEdges} type), ${survey.clusters.length} clusters. Value edges are what \`bun build --metafile\` `
    + 'records; type edges are the imports `ts.preProcessFile` reads that it does not.',
    '',
    '## Clusters by size',
    '',
    '| Cluster | Files | Folders |',
    '| --- | --- | --- |',
    ...survey.clusters.map((cluster) => `| \`${cluster.name}\` | ${cluster.members.length} | ${folderCell(cluster.folders)} |`),
    '',
    `## The ${TOP_BETWEENNESS} files of highest betweenness`,
    '',
    '| Rank | File | Betweenness | Cluster |',
    '| --- | --- | --- | --- |',
    ...top.map(([path, score], index) => `| ${index + 1} | \`${path}\` | ${score} | \`${clusterOf.get(path) ?? ''}\` |`),
  ];
  if (survey.unreached.length > 0) {
    lines.push('', '## Unreached files', '', 'No `bun build` entry reached these; their imports were not read.', '');
    lines.push(...survey.unreached.map((path) => `- \`${path}\``));
  }
  if (survey.unresolved.length > 0) {
    lines.push('', '## Unresolved imports', '');
    lines.push(...survey.unresolved.map((item) => `- \`${item.from}\`: \`${item.specifier}\``));
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Runs `bun build --metafile` in `root` with every file as an entry and
 * returns the metafile. Packages stay external; the bundle is written to a
 * scratch folder and removed.
 *
 * @param root - The repository root.
 * @param files - The repository-relative entries.
 * @returns The parsed metafile.
 * @throws When `bun build` exits non-zero.
 */
export async function readMetafile(root: string, files: readonly string[]): Promise<Metafile> {
  const scratch = mkdtempSync(join(tmpdir(), 'survey-import-graph-'));
  try {
    const metafile = join(scratch, 'meta.json');
    const build = Bun.spawnSync(
      [
        process.execPath,
        'build',
        ...files,
        '--target=bun',
        '--packages=external',
        `--outdir=${join(scratch, 'out')}`,
        `--metafile=${metafile}`,
      ],
      { cwd: root, stderr: 'pipe', stdout: 'pipe' },
    );
    if (build.exitCode !== 0) {
      throw new Error(`bun build failed in ${root} (exit ${build.exitCode}): ${build.stderr.toString().trim()}`);
    }
    return (await Bun.file(metafile).json()) as Metafile;
  } finally {
    rmSync(scratch, { force: true, recursive: true });
  }
}

/**
 * A resolver that asks bun, from the importing file's folder, and returns
 * a repository-relative path for a target under `root`. Bun resolves
 * through any symlink in `root`'s path (on macOS, the OS temp directory is
 * one) inconsistently from one call to the next, so both sides of the
 * comparison are brought to their own real path here, rather than trusting
 * `Bun.resolveSync` to have done so.
 *
 * @param root - The repository root.
 * @returns The resolver.
 */
export function bunResolver(root: string): ResolveImport {
  const realRoot = realpathSync.native(root);
  return (specifier, from) => {
    try {
      const resolved = Bun.resolveSync(specifier, dirname(join(root, from)));
      const real = resolved.startsWith('/')
        ? realpathSync.native(resolved)
        : resolved;
      return relativeToRoot(real, realRoot);
    } catch {
      return undefined;
    }
  };
}

/**
 * Reads the repository at `root` and writes both outputs under
 * `docs/survey/`.
 *
 * @param root - The repository root.
 * @returns The paths written, relative to `root`.
 */
export async function main(root: string): Promise<string[]> {
  const tracked = listTrackedFiles(root);
  const metafile = await readMetafile(root, tracked.all);
  const sources = new Map<string, string>();
  for (const path of tracked.all) {
    sources.set(path, await Bun.file(join(root, path)).text());
  }
  const graph = buildImportGraph({ files: tracked.all, metafile, resolve: bunResolver(root), root, sources });
  const survey = surveyImportGraph(graph);
  mkdirSync(join(root, OUTPUT_DIR), { recursive: true });
  const jsonPath = `${OUTPUT_DIR}/import-graph.json`;
  const markdownPath = `${OUTPUT_DIR}/import-graph.md`;
  writeFileSync(join(root, jsonPath), renderImportGraphJson(survey));
  writeFileSync(join(root, markdownPath), renderImportGraphMarkdown(survey, tracked.all));
  return [jsonPath, markdownPath];
}

if (import.meta.main) {
  try {
    for (const path of await main(process.cwd())) {
      console.log(`wrote ${path}`);
    }
  } catch (err) {
    console.error(err instanceof Error
      ? err.message
      : String(err));
    process.exit(1);
  }
}
