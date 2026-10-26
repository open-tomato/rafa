/**
 * The coupling reading: how many of the runtime imports between the
 * feature packages run against the order they move in.
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
 * Which edges count: those of kind `value` whose two ends are not tests
 * (`classifyFile` of `scripts/survey/files.ts` answers `test` for
 * neither; a test-support file is read) and lie in two different packages
 * of {@link MOVE_ORDER}. An edge with an end in core, in the CLI, in a
 * package outside the order or placed nowhere is not counted at all.
 *
 * A back edge is one from a package earlier in {@link MOVE_ORDER} into a
 * later one: moved first, the earlier package would import one not yet
 * moved. The script prints the back edges by package pair, then one line
 * `back <n> of <total> value imports between feature packages, <percent>%`,
 * and exits 1 when `--max` is given and the percent is above it. A refused
 * command line, or a graph or table it cannot read, prints the reason and
 * exits 2.
 */

import type { CutMap } from './cut-map';
import type { EdgeKind } from './import-graph';

import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

import { readCutMap } from './cut-map';
import { classifyFile } from './files';

/**
 * The feature packages in the order they move, as the spec names it (not
 * the cut table's rank order).
 */
export const MOVE_ORDER: readonly string[] = [
  'rafa-effort',
  'rafa-inventory',
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
 * Whether a reading is above the gate. The percent compared is the one
 * the summary line prints, so a line reading `20.0%` passes `--max=20`.
 *
 * @param coupling - A reading of {@link readCoupling}.
 * @param max - The highest percent that passes, or `undefined` for no gate.
 * @returns `true` when `max` is given and the printed percent is above it.
 */
export function isAboveMax(coupling: Coupling, max: number | undefined): boolean {
  return max !== undefined && Number(formatPercent(coupling.percent)) > max;
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
 * Reads the graph and the map a command line names and answers its lines
 * and exit code.
 *
 * @param root - The repository root relative paths are read against.
 * @param args - The arguments after the script's path.
 * @returns The lines to print and the exit code: 1 above `--max`, else 0.
 * @throws When the arguments are refused, or a file cannot be read or parsed.
 */
export function main(root: string, args: readonly string[]): { lines: string[]; exitCode: number } {
  const parsed = parseCouplingArgs(args);
  const graphPath = isAbsolute(parsed.graph)
    ? parsed.graph
    : join(root, parsed.graph);
  const edges = parseGraphEdges(readFileSync(graphPath, 'utf8'), parsed.graph);
  const map: CutMap = readCutMap(root, parsed.map);
  const coupling = readCoupling(edges, map.unitOf);
  return {
    exitCode: isAboveMax(coupling, parsed.max)
      ? 1
      : 0,
    lines: renderCoupling(coupling),
  };
}

if (import.meta.main) {
  try {
    const { exitCode, lines } = main(process.cwd(), process.argv.slice(2));
    for (const line of lines) {
      console.log(line);
    }
    process.exit(exitCode);
  } catch (err) {
    console.error(err instanceof Error
      ? err.message
      : String(err));
    process.exit(2);
  }
}
