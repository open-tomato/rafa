/**
 * The cut table of #905: each future package of epic #801 with the files
 * it would hold, and how many imports would point the wrong way once the
 * packages are cut. Run from the repository root,
 * `bun scripts/survey/cut-table.ts` reads `docs/survey/import-graph.json`
 * and writes `docs/survey/cut-table.json` and `docs/survey/cut-table.md`.
 *
 * The graph is read from that file and never from a build of this
 * script's own, so the table and the graph cannot disagree. A node's kind
 * (`source`, `test`, `test-support`) is the one the graph records for it.
 *
 * Where a file goes is data, {@link CUT_RULES}, read in this order
 * ({@link placeFile}):
 *
 *   1. a file a package names is that package's. A test file whose name
 *      is a named file's with `.test` before the extension follows it:
 *      `src/report/parse.test.ts` goes where `src/report/parse.ts` goes;
 *   2. otherwise the longest folder that holds it decides, among the
 *      packages' folders and the unassigned folders. `src/effort/store/`
 *      (core) is longer than `src/effort/` (`rafa-effort`);
 *   3. otherwise the file is left to place, and counts as a file of the
 *      package named under `rest`, `@open-tomato/rafa-cli`, which takes
 *      every file no line above holds.
 *
 * What the CLI holds by rule is the dispatcher (`src/cli/`, with the bin
 * entry `src/rafa.ts`), the roster (`src/commands/index.ts`) and
 * `src/schema/agent.ts`. No path in the tree is named as "the default
 * workflows", so the files that will be them are among the files left to
 * place. Inside `src/schema/` the placement is per file, as
 * `docs/survey/content-schema-importers.md` names it.
 *
 * An upward edge is an import, of kind `value` or `type`, between two
 * files neither of which is a test, from a package lower in the order
 * into a higher one. The order is the order of `CUT_RULES.packages`,
 * lowest first. A package's count is the upward edges that leave it. An
 * edge with an end in an unassigned folder has no rank on that end and is
 * never upward; it is counted on the folder instead, by the package at
 * its other end.
 *
 * An upward edge from a file under `src/core/config/` into a
 * `src/config-schema-<section>.ts` file is marked as cleared by #118,
 * which makes each package own its config section. It still counts as
 * upward: `remaining` is the count less the cleared edges.
 *
 * The files left to place are the files of step 3. Each carries the
 * number of upward edges that end on it, since placing it lower is what
 * would take them off a package's count.
 *
 * The counts rank options. They do not certify a cut: `tsc --build` with
 * project references is that gate (#807).
 */

import type { FileKind } from './files';
import type { EdgeKind, ImportEdge } from './import-graph';

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, posix } from 'node:path';

import { OUTPUT_DIR, stableJson } from './import-graph';

/** The files and folders one future package holds by rule. */
export interface PackageRule {
  /** The package's name. */
  readonly name: string;
  /** The folders it holds, each repository-relative with its closing `/`. */
  readonly folders: readonly string[];
  /** The single files it holds by name, repository-relative, sorted. */
  readonly named: readonly string[];
}

/** Where every file goes: the data the table is computed from. */
export interface CutRules {
  /** The packages, lowest in the order first. */
  readonly packages: readonly PackageRule[];
  /** The package that takes every file no rule holds. */
  readonly rest: string;
  /** The folders no package holds yet, each with its closing `/`. */
  readonly unassigned: readonly string[];
}

/** How a file was placed: by name, by folder, as what is left, or in an unassigned folder. */
export type PlacedBy = 'folder' | 'named' | 'rest' | 'unassigned';

/** Where one file goes. */
export interface FilePlace {
  /** The rule that placed it. */
  readonly by: PlacedBy;
  /** The folder that placed it; `undefined` unless `by` is `folder` or `unassigned`. */
  readonly folder: string | undefined;
  /** The package that holds it; `undefined` in an unassigned folder. */
  readonly package: string | undefined;
}

/** One node of the graph as the table reads it. */
export interface CutNode {
  readonly kind: FileKind;
  readonly path: string;
}

/** The part of `docs/survey/import-graph.json` the table reads. */
export interface CutGraph {
  readonly nodes: readonly CutNode[];
  readonly edges: readonly ImportEdge[];
}

/** One upward edge, with the package at each end. */
export interface UpwardEdge extends ImportEdge {
  /** The package the importing file is in, the lower one. */
  readonly fromPackage: string;
  /** The package the imported file is in, the higher one. */
  readonly toPackage: string;
  /** The issue that clears the edge, when one does. */
  readonly clearedBy?: number;
}

/** How many files of each kind a package holds. */
export interface FileCounts {
  readonly source: number;
  readonly test: number;
  readonly testSupport: number;
}

/** One package's row. */
export interface PackageRow {
  /** The package's name. */
  readonly name: string;
  /** Its place in the order, from 1, lowest first. */
  readonly rank: number;
  /** The folders it holds by rule. */
  readonly folders: readonly string[];
  /** How many files of the graph each of those folders placed. */
  readonly filesByFolder: Readonly<Record<string, number>>;
  /** The files it holds by name. */
  readonly named: readonly string[];
  /** Every file of the graph placed in it, tests included, sorted. */
  readonly files: readonly string[];
  /** Those files counted by kind. */
  readonly fileCounts: FileCounts;
  /** The upward edges that leave it, sorted by `from`, then `to`. */
  readonly edges: readonly UpwardEdge[];
  /** How many upward edges leave it: its count. */
  readonly upwardEdges: number;
  /** How many of those #118 clears. */
  readonly clearedByIssue118: number;
  /** The count less the cleared edges. */
  readonly remaining: number;
}

/** One file no rule holds. */
export interface LeftFile {
  readonly kind: FileKind;
  readonly path: string;
  /** How many upward edges end on it. */
  readonly upwardEdgesIn: number;
}

/** One folder no package holds yet. */
export interface UnassignedFolder {
  /** The folder, with its closing `/`. */
  readonly folder: string;
  /** The files of the graph under it, tests included, sorted. */
  readonly files: readonly string[];
  /**
   * The edges between two non-test files that leave the folder, counted
   * by the package they end in (by the folder, for another unassigned one).
   */
  readonly importsFrom: Readonly<Record<string, number>>;
  /** The same edges read the other way: those that end in the folder, by where they start. */
  readonly importedBy: Readonly<Record<string, number>>;
}

/** The sums the summary opens with. */
export interface CutTotals {
  /** Every file of the graph. */
  readonly files: number;
  /** The files in an unassigned folder. */
  readonly unassignedFiles: number;
  /** The files left to place. */
  readonly leftToPlace: number;
  /** The edges between two files neither of which is a test. */
  readonly nonTestEdges: number;
  /** Those of them that point upward. */
  readonly upwardEdges: number;
  /** The upward edges #118 clears. */
  readonly clearedByIssue118: number;
  /** The non-test edges with an end in an unassigned folder and the other end outside it. */
  readonly unrankedEdges: number;
}

/** The whole table: what both outputs show. */
export interface CutTable {
  /** The package names, lowest first. */
  readonly order: readonly string[];
  /** One row per package, in that order. */
  readonly packages: readonly PackageRow[];
  /** The files no rule holds, sorted by path. */
  readonly leftToPlace: readonly LeftFile[];
  /** The upward edges #118 clears, sorted by `from`, then `to`. */
  readonly clearedByIssue118: readonly UpwardEdge[];
  /** The unassigned folders, in the order of the rules. */
  readonly unassigned: readonly UnassignedFolder[];
  readonly totals: CutTotals;
}

/** A fault in a set of rules. */
export interface RuleProblem {
  /** The name, file or folder at fault. */
  readonly subject: string;
  /** What is wrong with it. */
  readonly problem: string;
}

/** The graph the table reads, relative to the repository root. */
export const GRAPH_PATH = `${OUTPUT_DIR}/import-graph.json`;

/** The issue that makes each package own its config section. */
export const SECTIONS_ISSUE = 118;

/** The folder whose imports of section files #118 clears, with its closing `/`. */
export const SECTION_IMPORTER_FOLDER = 'src/core/config/';

/** A config section file: `src/config-schema-<section>.ts`, at the top of `src/`. */
export const SECTION_FILE = /^src\/config-schema-[^/]+\.ts$/;

/** How many files the summary lists by the upward edges that end on them. */
export const TOP_TARGETS = 20;

/** The name of the core package. */
export const CORE_PACKAGE = '@open-tomato/rafa';

/** The name of the CLI package, which takes every file no rule holds. */
export const CLI_PACKAGE = '@open-tomato/rafa-cli';

/**
 * The fifteen `src/board/` files `docs/survey/cluster-map.json` puts in
 * cluster c6, named as assigned to `rafa-board`. They keep their path.
 */
export const BOARD_FILES_OF_C6: readonly string[] = [
  'src/board/flags.ts',
  'src/board/gate.ts',
  'src/board/issue.ts',
  'src/board/leak.ts',
  'src/board/naming.ts',
  'src/board/plan-field.ts',
  'src/board/plan-spec.ts',
  'src/board/previous-copy.ts',
  'src/board/readiness.ts',
  'src/board/review-comment.ts',
  'src/board/review-stamp.ts',
  'src/board/snapshot-settle.ts',
  'src/board/spec-review.ts',
  'src/board/spec-source.ts',
  'src/board/trust.ts',
];

/**
 * The ten packages, lowest first, seeded from the survey's cluster order,
 * with the three folders left for the second architect pass.
 */
export const CUT_RULES: CutRules = {
  packages: [
    {
      folders: ['src/core/', 'src/effort/store/', 'src/ports/'],
      name: CORE_PACKAGE,
      named: ['src/report/parse.ts', 'src/report/record.ts', 'src/schema/project-id.ts', 'src/schema/tiers.ts'],
    },
    {
      folders: [
        'src/agents/',
        'src/backfill/',
        'src/bundled/',
        'src/check/',
        'src/demote/',
        'src/inventory/',
        'src/learning/',
        'src/schema/',
        'src/task/',
        'src/tiers/',
      ],
      name: 'rafa-inventory',
      named: [],
    },
    {
      folders: [
        'src/adapters/tracker/',
        'src/board/',
        'src/board/project/',
        'src/commands/board/',
        'src/commands/epic/',
        'src/commands/issue/',
        'src/refs/',
      ],
      name: 'rafa-board',
      named: BOARD_FILES_OF_C6,
    },
    {
      folders: ['src/commands/pr/', 'src/pr/', 'src/triage/'],
      name: 'rafa-pr',
      named: ['src/pr/index.ts'],
    },
    {
      folders: ['src/claims/', 'src/commands/claim/', 'src/preflight/', 'src/start/', 'src/suite/'],
      name: 'rafa-run',
      named: ['src/start/branch-decision.ts'],
    },
    {
      folders: ['src/commands/release/', 'src/release/'],
      name: 'rafa-release',
      named: [],
    },
    {
      folders: ['src/effort/'],
      name: 'rafa-effort',
      named: ['src/schema/frontmatter.ts'],
    },
    {
      folders: ['packages/rafa-hub/'],
      name: 'rafa-hub',
      named: [],
    },
    {
      folders: ['packages/rafa-sync-service/'],
      name: 'rafa-sync-service',
      named: [],
    },
    {
      folders: ['src/cli/'],
      name: CLI_PACKAGE,
      named: ['src/commands/index.ts', 'src/rafa.ts', 'src/schema/agent.ts'],
    },
  ],
  rest: CLI_PACKAGE,
  unassigned: ['src/ci/', 'src/commands/stretch/', 'src/stretch/'],
};

const TEST_INFIX = /\.test(\.[a-z]+)$/;
const FILE_KINDS: ReadonlySet<string> = new Set(['source', 'test', 'test-support']);
const EDGE_KINDS: ReadonlySet<string> = new Set(['type', 'value']);

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
 * The faults in a set of rules: a package named twice, a `rest` that is no
 * package, a folder with no closing `/`, a folder held twice (by two
 * packages, twice by one, or by a package and the unassigned list), and a
 * file named twice. Pure: it reads the rules handed in and never the tree.
 *
 * @param rules - The rules to check.
 * @returns One entry per fault, sorted by subject; empty when the rules hold.
 */
export function findRuleProblems(rules: CutRules): readonly RuleProblem[] {
  const problems: RuleProblem[] = [];
  const count = (values: readonly string[]): Map<string, number> => {
    const counts = new Map<string, number>();
    values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
    return counts;
  };
  const twice = (values: readonly string[], problem: string): void => {
    for (const [subject, times] of count(values)) {
      if (times > 1) {
        problems.push({ problem, subject });
      }
    }
  };
  const names = rules.packages.map((rule) => rule.name);
  const folders = [...rules.packages.flatMap((rule) => rule.folders), ...rules.unassigned];
  twice(names, 'package listed more than once');
  twice(folders, 'folder held more than once');
  twice(rules.packages.flatMap((rule) => rule.named), 'file named more than once');
  if (!names.includes(rules.rest)) {
    problems.push({ problem: 'the rest goes to a package that is not listed', subject: rules.rest });
  }
  for (const folder of new Set(folders)) {
    if (!folder.endsWith('/')) {
      problems.push({ problem: 'folder has no closing /', subject: folder });
    }
  }
  return problems.sort(
    (left, right) => compareText(left.subject, right.subject) || compareText(left.problem, right.problem),
  );
}

/**
 * Where one file goes (see the module note for the three steps).
 *
 * @param path - A repository-relative path.
 * @param rules - The rules to read; {@link CUT_RULES} unless a test plants its own.
 * @returns The package that holds it, or the unassigned folder it lies in, and the rule that said so.
 */
export function placeFile(path: string, rules: CutRules = CUT_RULES): FilePlace {
  const subject = path.replace(TEST_INFIX, '$1');
  const namedBy = rules.packages.find((rule) => rule.named.includes(path) || rule.named.includes(subject));
  if (namedBy !== undefined) {
    return { by: 'named', folder: undefined, package: namedBy.name };
  }
  const holders: readonly { readonly folder: string; readonly package: string | undefined }[] = [
    ...rules.packages.flatMap((rule) => rule.folders.map((folder) => ({ folder, package: rule.name }))),
    ...rules.unassigned.map((folder) => ({ folder, package: undefined })),
  ];
  const holder = holders
    .filter((candidate) => path.startsWith(candidate.folder))
    .sort((left, right) => right.folder.length - left.folder.length)[0];
  if (holder === undefined) {
    return { by: 'rest', folder: undefined, package: rules.rest };
  }
  return holder.package === undefined
    ? { by: 'unassigned', folder: holder.folder, package: undefined }
    : { by: 'folder', folder: holder.folder, package: holder.package };
}

/**
 * Whether #118 clears an upward edge: it leaves a file under
 * `src/core/config/` and ends on a config section file.
 *
 * @param edge - An upward edge.
 * @returns `true` when #118 clears it.
 */
export function isClearedBySections(edge: ImportEdge): boolean {
  return edge.from.startsWith(SECTION_IMPORTER_FOLDER) && SECTION_FILE.test(edge.to);
}

/**
 * Sorts edges by `from`, then `to`.
 *
 * @param edges - The edges, in any order.
 * @returns A sorted copy.
 */
function sortEdges(edges: readonly UpwardEdge[]): readonly UpwardEdge[] {
  return [...edges].sort((left, right) => compareText(left.from, right.from) || compareText(left.to, right.to));
}

/**
 * Adds one to a counter's key.
 *
 * @param counts - The counter; changed in place.
 * @param key - The key to count.
 */
function countOne(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

/**
 * A counter as a plain record with sorted keys.
 *
 * @param counts - The counter.
 * @returns The record.
 */
function asRecord(counts: ReadonlyMap<string, number>): Readonly<Record<string, number>> {
  return Object.fromEntries([...counts].sort(([left], [right]) => compareText(left, right)));
}

/** What reading the edges gives, before the rows are built. */
interface EdgeReading {
  readonly upward: readonly UpwardEdge[];
  readonly nonTestEdges: number;
  readonly unrankedEdges: number;
  /** Per unassigned folder, the edges that leave it, by where they end. */
  readonly importsFrom: ReadonlyMap<string, Map<string, number>>;
  /** Per unassigned folder, the edges that end in it, by where they start. */
  readonly importedBy: ReadonlyMap<string, Map<string, number>>;
}

/**
 * Reads every edge between two non-test files: the upward ones, and those
 * with an end in an unassigned folder.
 *
 * @param graph - The graph.
 * @param places - Where each node goes.
 * @param rankOf - Each package's place in the order.
 * @param unassigned - The unassigned folders.
 * @returns The reading.
 * @throws When an edge names a file that is no node of the graph.
 */
function readEdges(
  graph: CutGraph,
  places: ReadonlyMap<string, FilePlace>,
  rankOf: ReadonlyMap<string, number>,
  unassigned: readonly string[],
): EdgeReading {
  const kindOf = new Map(graph.nodes.map((node) => [node.path, node.kind]));
  const importsFrom = new Map(unassigned.map((folder) => [folder, new Map<string, number>()]));
  const importedBy = new Map(unassigned.map((folder) => [folder, new Map<string, number>()]));
  const upward: UpwardEdge[] = [];
  let nonTestEdges = 0;
  let unrankedEdges = 0;
  for (const edge of graph.edges) {
    const from = places.get(edge.from);
    const to = places.get(edge.to);
    if (from === undefined || to === undefined) {
      const stray = from === undefined
        ? edge.from
        : edge.to;
      throw new Error(`the edge ${edge.from} -> ${edge.to} names ${stray}, which is no node of the graph`);
    }
    if (kindOf.get(edge.from) === 'test' || kindOf.get(edge.to) === 'test') {
      continue;
    }
    nonTestEdges += 1;
    if (from.package === undefined || to.package === undefined) {
      const fromKey = from.package ?? from.folder ?? '';
      const toKey = to.package ?? to.folder ?? '';
      if (fromKey === toKey) {
        continue;
      }
      unrankedEdges += 1;
      const leaving = importsFrom.get(fromKey);
      const entering = importedBy.get(toKey);
      if (leaving !== undefined) {
        countOne(leaving, toKey);
      }
      if (entering !== undefined) {
        countOne(entering, fromKey);
      }
      continue;
    }
    if ((rankOf.get(from.package) ?? 0) < (rankOf.get(to.package) ?? 0)) {
      upward.push({
        ...edge,
        fromPackage: from.package,
        toPackage: to.package,
        ...(isClearedBySections(edge)
          ? { clearedBy: SECTIONS_ISSUE }
          : {}),
      });
    }
  }
  return { importedBy, importsFrom, nonTestEdges, unrankedEdges, upward: sortEdges(upward) };
}

/**
 * One package's row.
 *
 * @param rule - The package's rule.
 * @param rank - Its place in the order, from 1.
 * @param nodes - The graph's nodes, sorted by path.
 * @param places - Where each node goes.
 * @param upward - Every upward edge of the graph.
 * @returns The row.
 */
function packageRow(
  rule: PackageRule,
  rank: number,
  nodes: readonly CutNode[],
  places: ReadonlyMap<string, FilePlace>,
  upward: readonly UpwardEdge[],
): PackageRow {
  const held = nodes.filter((node) => places.get(node.path)?.package === rule.name);
  const byFolder = new Map(rule.folders.map((folder) => [folder, 0]));
  for (const node of held) {
    const folder = places.get(node.path)?.folder;
    if (folder !== undefined) {
      countOne(byFolder, folder);
    }
  }
  const edges = upward.filter((edge) => edge.fromPackage === rule.name);
  const cleared = edges.filter((edge) => edge.clearedBy !== undefined).length;
  return {
    clearedByIssue118: cleared,
    edges,
    fileCounts: {
      source: held.filter((node) => node.kind === 'source').length,
      test: held.filter((node) => node.kind === 'test').length,
      testSupport: held.filter((node) => node.kind === 'test-support').length,
    },
    files: held.map((node) => node.path),
    filesByFolder: asRecord(byFolder),
    folders: [...rule.folders],
    name: rule.name,
    named: [...rule.named],
    rank,
    remaining: edges.length - cleared,
    upwardEdges: edges.length,
  };
}

/**
 * Computes the cut table from the graph. Pure: the caller reads the graph
 * file (see `main`).
 *
 * @param graph - The nodes and edges of `docs/survey/import-graph.json`.
 * @param rules - The rules to read; {@link CUT_RULES} unless a test plants its own.
 * @returns The table, every list sorted.
 * @throws When the rules hold a fault, or an edge names a file that is no node.
 */
export function buildCutTable(graph: CutGraph, rules: CutRules = CUT_RULES): CutTable {
  const faults = findRuleProblems(rules);
  if (faults.length > 0) {
    const lines = faults.map((fault) => `${fault.subject}: ${fault.problem}`);
    throw new Error(`the cut rules do not hold: ${lines.join('; ')}`);
  }
  const nodes = [...graph.nodes].sort((left, right) => compareText(left.path, right.path));
  const places = new Map(nodes.map((node) => [node.path, placeFile(node.path, rules)]));
  const order = rules.packages.map((rule) => rule.name);
  const rankOf = new Map(order.map((name, index) => [name, index + 1]));
  const reading = readEdges(graph, places, rankOf, rules.unassigned);
  const upwardIn = new Map<string, number>();
  reading.upward.forEach((edge) => countOne(upwardIn, edge.to));
  const leftToPlace = nodes
    .filter((node) => places.get(node.path)?.by === 'rest')
    .map((node) => ({ kind: node.kind, path: node.path, upwardEdgesIn: upwardIn.get(node.path) ?? 0 }));
  const unassigned = rules.unassigned.map((folder) => ({
    files: nodes.filter((node) => places.get(node.path)?.folder === folder).map((node) => node.path),
    folder,
    importedBy: asRecord(reading.importedBy.get(folder) ?? new Map()),
    importsFrom: asRecord(reading.importsFrom.get(folder) ?? new Map()),
  }));
  const clearedByIssue118 = reading.upward.filter((edge) => edge.clearedBy !== undefined);
  return {
    clearedByIssue118,
    leftToPlace,
    order,
    packages: rules.packages.map((rule, index) => packageRow(rule, index + 1, nodes, places, reading.upward)),
    totals: {
      clearedByIssue118: clearedByIssue118.length,
      files: nodes.length,
      leftToPlace: leftToPlace.length,
      nonTestEdges: reading.nonTestEdges,
      unassignedFiles: unassigned.reduce((sum, entry) => sum + entry.files.length, 0),
      unrankedEdges: reading.unrankedEdges,
      upwardEdges: reading.upward.length,
    },
    unassigned,
  };
}

/**
 * Whether a value is an object with string keys.
 *
 * @param value - Anything.
 * @returns `true` for a plain object, `false` for an array or `null`.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads the text of `docs/survey/import-graph.json` into the nodes and
 * edges the table needs, refusing a shape it does not know rather than
 * counting from half a graph.
 *
 * @param text - The file's text.
 * @returns The nodes and edges.
 * @throws When the text is not JSON, or a node or an edge is not shaped as the graph script writes it.
 */
export function parseCutGraph(text: string): CutGraph {
  const data: unknown = JSON.parse(text);
  if (!isRecord(data) || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
    throw new Error('the import graph holds no `nodes` array or no `edges` array');
  }
  const nodes = data.nodes.map((node: unknown, index): CutNode => {
    if (!isRecord(node) || typeof node.path !== 'string' || typeof node.kind !== 'string' || !FILE_KINDS.has(node.kind)) {
      throw new Error(`node ${index} of the import graph is not a path with a kind: ${JSON.stringify(node)}`);
    }
    return { kind: node.kind as FileKind, path: node.path };
  });
  const edges = data.edges.map((edge: unknown, index): ImportEdge => {
    if (
      !isRecord(edge)
      || typeof edge.from !== 'string'
      || typeof edge.to !== 'string'
      || typeof edge.kind !== 'string'
      || !EDGE_KINDS.has(edge.kind)
    ) {
      throw new Error(`edge ${index} of the import graph is not a from, a to and a kind: ${JSON.stringify(edge)}`);
    }
    return { from: edge.from, kind: edge.kind as EdgeKind, to: edge.to };
  });
  return { edges, nodes };
}

/**
 * The table as `docs/survey/cut-table.json` holds it, with the graph file
 * it was read from.
 *
 * @param table - The table.
 * @returns The JSON text: sorted keys, two-space indent, a closing newline.
 */
export function renderCutTableJson(table: CutTable): string {
  return stableJson({ ...table, graph: GRAPH_PATH });
}

/**
 * A list of paths as one markdown cell, each in backticks.
 *
 * @param paths - The paths.
 * @returns The cell, or a dash when there is none.
 */
function pathCell(paths: readonly string[]): string {
  return paths.length === 0
    ? '-'
    : paths.map((path) => `\`${path}\``).join(', ');
}

/**
 * A counter as one markdown cell: `name` (count), most first, then by name.
 *
 * @param counts - The counter.
 * @returns The cell, or a dash when it is empty.
 */
function countCell(counts: Readonly<Record<string, number>>): string {
  const entries = Object.entries(counts).sort(
    ([leftName, left], [rightName, right]) => right - left || compareText(leftName, rightName),
  );
  return entries.length === 0
    ? '-'
    : entries.map(([name, count]) => `\`${name}\` (${count})`).join(', ');
}

/**
 * The rows of the pair table: how many upward edges run from each package
 * into each higher one.
 *
 * @param table - The table.
 * @returns One markdown row per pair that holds an edge, in the order of the packages.
 */
function pairRows(table: CutTable): readonly string[] {
  return table.packages.flatMap((row) => {
    const byTarget = new Map<string, number>();
    row.edges.forEach((edge) => countOne(byTarget, edge.toPackage));
    return table.order
      .filter((name) => byTarget.has(name))
      .map((name) => `| \`${row.name}\` | \`${name}\` | ${byTarget.get(name) ?? 0} |`);
  });
}

/**
 * The files most upward edges end on, with the package each is counted in
 * and whether it is left to place.
 *
 * @param table - The table.
 * @returns One markdown row per file, most edges first, {@link TOP_TARGETS} at most.
 */
function targetRows(table: CutTable): readonly string[] {
  const left = new Set(table.leftToPlace.map((file) => file.path));
  const byTarget = new Map<string, { readonly count: number; readonly toPackage: string }>();
  for (const edge of table.packages.flatMap((row) => row.edges)) {
    byTarget.set(edge.to, { count: (byTarget.get(edge.to)?.count ?? 0) + 1, toPackage: edge.toPackage });
  }
  return [...byTarget]
    .sort(([leftPath, leftEntry], [rightPath, rightEntry]) => rightEntry.count - leftEntry.count || compareText(leftPath, rightPath))
    .slice(0, TOP_TARGETS)
    .map(([path, entry]) => {
      const placed = left.has(path)
        ? 'left to place'
        : 'by rule';
      return `| \`${path}\` | ${entry.count} | \`${entry.toPackage}\` | ${placed} |`;
    });
}

/**
 * The files left to place by folder: how many lie there, how many of them
 * are not tests, and how many upward edges end on them.
 *
 * @param table - The table.
 * @returns One markdown row per folder, most upward edges first, then by name.
 */
function leftRows(table: CutTable): readonly string[] {
  const folders = new Map<string, { files: number; nonTest: number; upwardEdgesIn: number }>();
  for (const file of table.leftToPlace) {
    const folder = `${posix.dirname(file.path)}/`;
    const entry = folders.get(folder) ?? { files: 0, nonTest: 0, upwardEdgesIn: 0 };
    folders.set(folder, {
      files: entry.files + 1,
      nonTest: entry.nonTest + (file.kind === 'test'
        ? 0
        : 1),
      upwardEdgesIn: entry.upwardEdgesIn + file.upwardEdgesIn,
    });
  }
  return [...folders]
    .sort(([leftName, left], [rightName, right]) => right.upwardEdgesIn - left.upwardEdgesIn || compareText(leftName, rightName))
    .map(([folder, entry]) => `| \`${folder}\` | ${entry.files} | ${entry.nonTest} | ${entry.upwardEdgesIn} |`);
}

/**
 * The table as `docs/survey/cut-table.md` holds it: the sums, the
 * packages with their counts, what each holds by rule, the upward edges
 * by pair of packages, the edges #118 clears, the files left to place by
 * folder, and the unassigned folders.
 *
 * @param table - The table.
 * @returns The markdown text, ending in a newline.
 */
export function renderCutTableMarkdown(table: CutTable): string {
  const { totals } = table;
  const placed = totals.files - totals.unassignedFiles;
  const lines = [
    '# Cut table',
    '',
    `Read from \`${GRAPH_PATH}\`: ${totals.files} files, ${placed} of them in ${table.packages.length} packages `
    + `(${totals.leftToPlace} left to place) and ${totals.unassignedFiles} in ${table.unassigned.length} unassigned `
    + `folders. Of the ${totals.nonTestEdges} edges between two files neither of which is a test, value and type `
    + `alike, ${totals.upwardEdges} point upward, ${totals.clearedByIssue118} of them cleared by #${SECTIONS_ISSUE}, `
    + `and ${totals.unrankedEdges} have an end in an unassigned folder and no rank.`,
    '',
    'The counts rank options. They do not certify a cut: `tsc --build` with project references is that gate (#807).',
    '',
    '## Packages, lowest first',
    '',
    'An upward edge leaves a package for one further down this table. A file left to place counts as a file of '
    + `\`${table.order.at(-1) ?? ''}\`.`,
    '',
    `| Rank | Package | Files | Source | Test | Test support | Upward edges | Cleared by #${SECTIONS_ISSUE} | Remaining |`,
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...table.packages.map((row) => `| ${row.rank} | \`${row.name}\` | ${row.files.length} | ${row.fileCounts.source} | `
      + `${row.fileCounts.test} | ${row.fileCounts.testSupport} | ${row.upwardEdges} | ${row.clearedByIssue118} | `
      + `${row.remaining} |`),
    '',
    '## What each package holds by rule',
    '',
    'A folder is followed by the files of the graph it placed. A named file is placed by name, whatever its folder.',
    '',
    '| Package | Folders | Named files |',
    '| --- | --- | --- |',
    ...table.packages.map((row) => `| \`${row.name}\` | ${countCell(row.filesByFolder)} | ${pathCell(row.named)} |`),
    '',
    '## Upward edges by pair of packages',
    '',
    '| From | Into | Edges |',
    '| --- | --- | --- |',
    ...pairRows(table),
    '',
    `## The ${TOP_TARGETS} files most upward edges end on`,
    '',
    '| File | Upward edges in | Counted in | Placed |',
    '| --- | --- | --- | --- |',
    ...targetRows(table),
    '',
    `## Edges #${SECTIONS_ISSUE} clears`,
    '',
    `Issue #${SECTIONS_ISSUE} makes each package own its config section, so these imports of a section file from `
    + `\`${SECTION_IMPORTER_FOLDER}\` go with it.`,
    '',
    ...(table.clearedByIssue118.length === 0
      ? ['None.']
      : table.clearedByIssue118.map((edge) => `- \`${edge.from}\` imports \`${edge.to}\` (${edge.kind})`)),
    '',
    '## Files left to place',
    '',
    `No rule holds these ${totals.leftToPlace} files. By folder, with the upward edges that end on its files:`,
    '',
    '| Folder | Files | Not tests | Upward edges in |',
    '| --- | --- | --- | --- |',
    ...leftRows(table),
    '',
    '## Unassigned folders',
    '',
    'Left for the second architect pass. A file here has no rank, so no edge that touches it is upward; the edges '
    + 'are counted by the package at their other end.',
    '',
    '| Folder | Files | Imports from | Imported by |',
    '| --- | --- | --- | --- |',
    ...table.unassigned.map((entry) => `| \`${entry.folder}\` | ${entry.files.length} | ${countCell(entry.importsFrom)} | `
      + `${countCell(entry.importedBy)} |`),
  ];
  return `${lines.join('\n')}\n`;
}

/**
 * Reads `docs/survey/import-graph.json` under `root` and writes both
 * outputs beside it.
 *
 * @param root - The repository root.
 * @returns The paths written, relative to `root`.
 * @throws When the graph file is missing or is not shaped as the graph script writes it.
 */
export async function main(root: string): Promise<string[]> {
  const graphFile = Bun.file(join(root, GRAPH_PATH));
  if (!(await graphFile.exists())) {
    throw new Error(`${GRAPH_PATH} is missing under ${root}: run \`bun scripts/survey/import-graph.ts\` first`);
  }
  const table = buildCutTable(parseCutGraph(await graphFile.text()));
  mkdirSync(join(root, OUTPUT_DIR), { recursive: true });
  const jsonPath = `${OUTPUT_DIR}/cut-table.json`;
  const markdownPath = `${OUTPUT_DIR}/cut-table.md`;
  writeFileSync(join(root, jsonPath), renderCutTableJson(table));
  writeFileSync(join(root, markdownPath), renderCutTableMarkdown(table));
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
