/**
 * The coupling reading: how many of the runtime imports between the
 * feature packages run against the order they move in, and how many of
 * the files that import a feature package from outside still take it by
 * relative path rather than from its facade.
 *
 * From the repository root:
 *
 *     bun scripts/survey/coupling.ts [--graph=<file>] [--map=<file>] [--max=<percent>]
 *
 * reads the import graph (`docs/survey/import-graph.json` unless
 * `--graph=` names another) and the cut table (`docs/survey/cut-table.json`
 * unless `--map=` names another, read through `cut-map.ts`'s `unitOf`).
 * It writes nothing.
 *
 * The back-edge line. Which edges count: those of kind `value` whose two
 * ends are not tests (`classifyFile` of `scripts/survey/files.ts` answers
 * `test` for neither; a test-support file is read) and lie in two
 * different packages of {@link MOVE_ORDER}. An edge with an end in core,
 * in the CLI, in a package outside the order or placed nowhere is not
 * counted at all. A back edge is one from a package earlier in
 * {@link MOVE_ORDER} into a later one: moved first, the earlier package
 * would import one not yet moved. The script prints the back edges by
 * package pair, then one line
 * `back <n> of <total> value imports between feature packages, <percent>%`.
 *
 * The kept line. An importer pair is a file that is no test (under `src/`
 * and `packages/`, `classifyFile` answers `source`; under `scripts/`, its
 * name is no test: the rule `isImporterCandidate` of
 * `scripts/codemod/rewire-groups.ts` reads) and a package of
 * {@link MOVE_ORDER} it is not placed in by `unitOf`, which it imports by
 * an edge of either kind, `value` or `type`; a file counts once per
 * package however many of the package's files it imports. A pair is kept
 * when the file imports the package by relative path. The graph records
 * no specifier, so the kept pairs are read off the files `git ls-files`
 * lists (tracked, and untracked ones not ignored, as the rewire codemod
 * reads them): for each package, `readPackageFiles` and `readImporters` of
 * `rewire-groups.ts`, the importers the codemod's dry run prints in its
 * four groups together. `rewire-groups.ts` imports this module, so this
 * one loads it only by a dynamic `import()` in {@link loadKeptReader},
 * which the `import.meta.main` block alone calls, and {@link main} takes
 * the reader as a parameter. The script prints one line after the
 * back-edge line, `kept <k> of <n> importers on relative paths, <percent>%`.
 *
 * It exits 1 when `--max` is given and either line's printed percent is
 * above it. A refused command line, or a graph, table or tree it cannot
 * read, prints the reason and exits 2.
 */

import type { CutMap } from './cut-map';
import type { EdgeKind } from './import-graph';

import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

import { readCutMap } from './cut-map';
import { classifyFile } from './files';

/**
 * The feature packages in the order they move, as the spec names it (not
 * the cut table's rank order). Inventory moves before effort by the
 * decision of 23 October 2026: with inventory first, one edge is left to
 * cut before the first move, inventory's one import of effort, against
 * five with effort first, the four value edges and one type edge of
 * effort's skills report into inventory.
 */
export const MOVE_ORDER: readonly string[] = [
  'rafa-inventory',
  'rafa-effort',
  'rafa-board',
  'rafa-release',
  'rafa-pr',
  'rafa-run',
];

/** The graph read unless `--graph=` names another. */
export const DEFAULT_GRAPH = 'docs/survey/import-graph.json';

/** The cut table read unless `--map=` names another. */
export const DEFAULT_MAP = 'docs/survey/cut-table.json';

/** The usage line a refused command line prints. */
export const USAGE = 'usage: bun scripts/survey/coupling.ts [--graph=<file>] [--map=<file>] [--max=<percent>]';

/** One edge of the graph as the coupling reads it. */
export interface CouplingEdge {
  /** The importing file, repository-relative. */
  readonly from: string;
  /** The imported file, repository-relative. */
  readonly to: string;
  /** Whether the import runs (`value`) or only the type checker reads it (`type`). */
  readonly kind: EdgeKind;
}

/** The back edges from one package into one later in the order. */
export interface BackPair {
  /** The importing package, earlier in {@link MOVE_ORDER}. */
  readonly from: string;
  /** The imported package, later in {@link MOVE_ORDER}. */
  readonly to: string;
  /** The back edges of the pair, sorted by importer then target. */
  readonly edges: readonly CouplingEdge[];
}

/** What {@link readCoupling} answers. */
export interface Coupling {
  /** The value edges between two feature packages, back or not. */
  readonly total: number;
  /** The back edges among them. */
  readonly back: number;
  /** `back` of `total` as a percent, `0` when `total` is `0`. */
  readonly percent: number;
  /** The back edges by pair, in the order of the importer then the target in {@link MOVE_ORDER}. */
  readonly pairs: readonly BackPair[];
}

/** A file and a feature package it imports from outside. */
export interface KeptPair {
  /** The importing file, repository-relative. */
  readonly file: string;
  /** The imported package, one of {@link MOVE_ORDER}. */
  readonly package: string;
}

/** What {@link readKept} answers. */
export interface Kept {
  /** The importer pairs, kept or not. */
  readonly total: number;
  /** The pairs among them whose file takes the package by relative path. */
  readonly kept: number;
  /** `kept` of `total` as a percent, `0` when `total` is `0`. */
  readonly percent: number;
}

/**
 * Reads the kept pairs of a tree: each file that imports a package of
 * {@link MOVE_ORDER} by relative path, with the package.
 */
export type KeptReader = (root: string) => readonly KeptPair[];

/** What a command line asks for. */
export interface CouplingArgs {
  /** The graph's path, absolute or relative to the root. */
  readonly graph: string;
  /** The cut table's path, absolute or relative to the root. */
  readonly map: string;
  /** The highest percent that passes, when given. */
  readonly max: number | undefined;
}

/** A pair's key, one string per ordered pair of packages. */
function pairKey(from: string, to: string): string {
  return `${from}\u0000${to}`;
}

/** Orders two edges by importer, then by target. */
function byEnds(left: CouplingEdge, right: CouplingEdge): number {
  return left.from.localeCompare(right.from) || left.to.localeCompare(right.to);
}

/**
 * Reads the coupling of a graph under a cut map (see the module note).
 * Pure: the caller hands in the edges and the map.
 *
 * @param edges - The graph's edges, an edge running from importer to imported.
 * @param unitOf - The unit of a file, as `CutMap.unitOf` answers it.
 * @returns The value edges counted, the back edges and their pairs, and the percent.
 */
export function readCoupling(
  edges: readonly CouplingEdge[],
  unitOf: (file: string) => string | undefined,
): Coupling {
  const rank = new Map(MOVE_ORDER.map((name, index) => [name, index]));
  const byPair = new Map<string, CouplingEdge[]>();
  let total = 0;
  for (const edge of edges) {
    if (edge.kind !== 'value' || classifyFile(edge.from) === 'test' || classifyFile(edge.to) === 'test') {
      continue;
    }
    const fromUnit = unitOf(edge.from);
    const toUnit = unitOf(edge.to);
    const fromRank = fromUnit === undefined
      ? undefined
      : rank.get(fromUnit);
    const toRank = toUnit === undefined
      ? undefined
      : rank.get(toUnit);
    if (fromRank === undefined || toRank === undefined || fromRank === toRank) {
      continue;
    }
    total += 1;
    if (fromRank < toRank) {
      const key = pairKey(MOVE_ORDER[fromRank] ?? '', MOVE_ORDER[toRank] ?? '');
      byPair.set(key, [...(byPair.get(key) ?? []), edge]);
    }
  }
  const pairs = MOVE_ORDER.flatMap((from) => MOVE_ORDER.flatMap((to): BackPair[] => {
    const held = byPair.get(pairKey(from, to));
    return held === undefined
      ? []
      : [{ edges: [...held].sort(byEnds), from, to }];
  }));
  const back = pairs.reduce((sum, pair) => sum + pair.edges.length, 0);
  const percent = total === 0
    ? 0
    : (back / total) * 100;
  return { back, pairs, percent, total };
}

const CODE_EXTENSION = /\.(?:ts|tsx|mts|js|mjs)$/;
const TEST_NAME = /\.test\.(?:ts|tsx|mts|js|mjs)$/;
const IMPORTER_ROOTS: readonly string[] = ['src/', 'packages/', 'scripts/'];

/**
 * Whether a file may be the importer of a pair: a code file under
 * `src/`, `packages/` or `scripts/` that is no test. Under `src/` and
 * `packages/`, `classifyFile` answers `source`; under `scripts/`, the name
 * is no test. The same rule as `isImporterCandidate` of
 * `scripts/codemod/rewire-groups.ts`, spelled here because that module
 * imports this one.
 *
 * @param path - A repository-relative path.
 * @returns `true` when the file counts as an importer.
 */
export function isImporterFile(path: string): boolean {
  if (!CODE_EXTENSION.test(path) || !IMPORTER_ROOTS.some((folder) => path.startsWith(folder))) {
    return false;
  }
  return path.startsWith('scripts/')
    ? !TEST_NAME.test(path)
    : classifyFile(path) === 'source';
}

/**
 * Reads the share of importer pairs kept on relative paths (see the
 * module note). Pure: the caller hands in the edges, the map and the kept
 * pairs. A kept pair the graph does not hold is not counted, so `kept`
 * never exceeds `total`.
 *
 * @param edges - The graph's edges, of either kind.
 * @param unitOf - The unit of a file, as `CutMap.unitOf` answers it.
 * @param keptPairs - The pairs whose file imports the package by relative path.
 * @returns The pairs counted, the kept among them, and the percent.
 */
export function readKept(
  edges: readonly CouplingEdge[],
  unitOf: (file: string) => string | undefined,
  keptPairs: readonly KeptPair[],
): Kept {
  const features = new Set(MOVE_ORDER);
  const pairs = new Set<string>();
  for (const edge of edges) {
    const toUnit = unitOf(edge.to);
    if (toUnit === undefined || !features.has(toUnit) || unitOf(edge.from) === toUnit || !isImporterFile(edge.from)) {
      continue;
    }
    pairs.add(pairKey(edge.from, toUnit));
  }
  const kept = new Set(keptPairs.map((pair) => pairKey(pair.file, pair.package)).filter((key) => pairs.has(key))).size;
  const percent = pairs.size === 0
    ? 0
    : (kept / pairs.size) * 100;
  return { kept, percent, total: pairs.size };
}

/**
 * The percent as the summary line spells it, to one decimal place.
 *
 * @param percent - A percent.
 * @returns It with one decimal, `18.6` for `18.614…`.
 */
export function formatPercent(percent: number): string {
  return percent.toFixed(1);
}

/**
 * The lines the script prints: each pair's header and its edges, then the
 * summary line.
 *
 * @param coupling - A reading of {@link readCoupling}.
 * @returns The lines, with no closing newline.
 */
export function renderCoupling(coupling: Coupling): string[] {
  const pairLines = coupling.pairs.flatMap((pair) => [
    `${pair.from} -> ${pair.to}: ${pair.edges.length}`,
    ...pair.edges.map((edge) => `  ${edge.from} -> ${edge.to}`),
  ]);
  const summary = `back ${coupling.back} of ${coupling.total} value imports between feature packages, ${formatPercent(coupling.percent)}%`;
  return [...pairLines, summary];
}

/**
 * The kept line the script prints after the back-edge line.
 *
 * @param kept - A reading of {@link readKept}.
 * @returns `kept <k> of <n> importers on relative paths, <percent>%`.
 */
export function renderKept(kept: Kept): string {
  return `kept ${kept.kept} of ${kept.total} importers on relative paths, ${formatPercent(kept.percent)}%`;
}

/**
 * Whether a reading, either line's, is above the gate. The percent
 * compared is the one the line prints, so a line reading `20.0%` passes
 * `--max=20`.
 *
 * @param reading - A reading of {@link readCoupling} or {@link readKept}.
 * @param max - The highest percent that passes, or `undefined` for no gate.
 * @returns `true` when `max` is given and the printed percent is above it.
 */
export function isAboveMax(reading: Pick<Coupling | Kept, 'percent'>, max: number | undefined): boolean {
  return max !== undefined && Number(formatPercent(reading.percent)) > max;
}

/** The value after `flag` in `arg`, when `arg` opens with it and holds one. */
function flagValue(arg: string, flag: string): string | undefined {
  return arg.startsWith(flag) && arg.length > flag.length
    ? arg.slice(flag.length)
    : undefined;
}

/**
 * Reads the arguments after the script's path, each flag at most once.
 *
 * @param args - The arguments.
 * @returns The graph, the map and the gate asked for.
 * @throws When an argument is none of the three flags, a flag is passed
 *   twice, or `--max` is not a number of zero or more; the message holds
 *   {@link USAGE}.
 */
export function parseCouplingArgs(args: readonly string[]): CouplingArgs {
  const seen = new Map<string, string>();
  for (const arg of args) {
    const flag = ['--graph=', '--map=', '--max='].find((name) => flagValue(arg, name) !== undefined);
    if (flag === undefined || seen.has(flag)) {
      throw new Error(`refused argument ${arg}\n${USAGE}`);
    }
    seen.set(flag, flagValue(arg, flag) ?? '');
  }
  const maxText = seen.get('--max=');
  const max = maxText === undefined
    ? undefined
    : Number(maxText);
  if (max !== undefined && (!Number.isFinite(max) || max < 0)) {
    throw new Error(`--max must be a percent of zero or more, not ${maxText}\n${USAGE}`);
  }
  return { graph: seen.get('--graph=') ?? DEFAULT_GRAPH, map: seen.get('--map=') ?? DEFAULT_MAP, max };
}

/**
 * Reads the `edges` of an import graph file's text.
 *
 * @param text - The graph file's text.
 * @param path - The file's path, for the messages.
 * @returns Its edges.
 * @throws When the text is not JSON, holds no `edges` array, or an edge
 *   is not a `from` and `to` string with a `kind` of `type` or `value`.
 */
export function parseGraphEdges(text: string, path: string): CouplingEdge[] {
  let graph: unknown;
  try {
    graph = JSON.parse(text);
  } catch (error) {
    throw new Error(`${path}: the import graph is not JSON (${(error as Error).message})`);
  }
  const edges = typeof graph === 'object' && graph !== null && 'edges' in graph
    ? graph.edges
    : undefined;
  if (!Array.isArray(edges)) {
    throw new Error(`${path}: the import graph holds no edges array`);
  }
  return edges.map((edge: unknown, index): CouplingEdge => {
    const { from, kind, to } = (typeof edge === 'object' && edge !== null
      ? edge
      : {}) as Record<string, unknown>;
    if (typeof from !== 'string' || typeof to !== 'string' || (kind !== 'type' && kind !== 'value')) {
      throw new Error(`${path}: edge ${index} is not a from, a to and a kind of type or value`);
    }
    return { from, kind, to };
  });
}

/**
 * The kept-pair reader the `import.meta.main` block hands {@link main}:
 * for each package of {@link MOVE_ORDER}, `readPackageFiles` and
 * `readImporters` of `scripts/codemod/rewire-groups.ts` over
 * `committableFiles` of `scripts/codemod/core-package-tree.ts`, the file
 * list the rewire codemod reads. Both modules are loaded here by dynamic
 * `import()`, since `rewire-groups.ts` imports this module statically.
 *
 * @returns The reader.
 */
export async function loadKeptReader(): Promise<KeptReader> {
  const [groups, tree] = await Promise.all([import('../codemod/rewire-groups'), import('../codemod/core-package-tree')]);
  return (root) => {
    const paths = tree.committableFiles(root);
    return MOVE_ORDER.flatMap((name) => groups
      .readImporters(root, paths, groups.readPackageFiles(paths, name))
      .map((importer): KeptPair => ({ file: importer.path, package: name })));
  };
}

/**
 * Reads the graph and the map a command line names, and the kept pairs
 * of the tree, and answers its lines and exit code.
 *
 * @param root - The repository root relative paths are read against.
 * @param args - The arguments after the script's path.
 * @param readKeptPairs - Reads the kept pairs of `root`; the
 *   `import.meta.main` block hands the reader {@link loadKeptReader} answers.
 * @returns The lines to print and the exit code: 1 when either line is above `--max`, else 0.
 * @throws When the arguments are refused, or a file cannot be read or parsed.
 */
export function main(
  root: string,
  args: readonly string[],
  readKeptPairs: KeptReader,
): { lines: string[]; exitCode: number } {
  const parsed = parseCouplingArgs(args);
  const graphPath = isAbsolute(parsed.graph)
    ? parsed.graph
    : join(root, parsed.graph);
  const edges = parseGraphEdges(readFileSync(graphPath, 'utf8'), parsed.graph);
  const map: CutMap = readCutMap(root, parsed.map);
  const coupling = readCoupling(edges, map.unitOf);
  const kept = readKept(edges, map.unitOf, readKeptPairs(root));
  return {
    exitCode: isAboveMax(coupling, parsed.max) || isAboveMax(kept, parsed.max)
      ? 1
      : 0,
    lines: [...renderCoupling(coupling), renderKept(kept)],
  };
}

if (import.meta.main) {
  loadKeptReader()
    .then((readKeptPairs) => {
      const { exitCode, lines } = main(process.cwd(), process.argv.slice(2), readKeptPairs);
      for (const line of lines) {
        console.log(line);
      }
      process.exit(exitCode);
    })
    .catch((err: unknown) => {
      console.error(err instanceof Error
        ? err.message
        : String(err));
      process.exit(2);
    });
}
