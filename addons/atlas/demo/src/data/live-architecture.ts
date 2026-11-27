/**
 * The mappers of the three architect cards (spec C6, C7 and C8), each from
 * one `QueryResult` of the Atlas API into the `workspace` fields its card
 * reads. `live-sources.ts` registers their metrics, and `live.ts` lays
 * `architectureOf` over the live workspace.
 *
 * - `sizeRoseOf` reads `arch.composition` (C6): one slice per module
 *   folder of `ROSE_MIN_LINES` lines or more, its radius the five kinds of
 *   lines summed, the largest first.
 * - `compositionOf` reads the same answer (C7): the module folders on the
 *   inner ring, each one's kinds on the outer ring in `COMPONENT_KINDS`
 *   order, a kind with no line left out and a folder with no line at all
 *   too. The spec cuts only the rose at 1,000 lines, so the sunburst keeps
 *   the smaller folders. The table rows (`PackageComposition`) carry
 *   `deps` as null: the module scan counts no external dependency.
 * - `importFlowOf` reads `arch.import-flow` (C8): one node per module,
 *   keyed by its package (its path when it has none), in the column of
 *   its layer, and one link per import of another module's package, from
 *   the dependency to the dependent. The columns are the layers in
 *   `layer_rank` order, `UNASSIGNED` last for a folder no layer of
 *   `atlas.layers` lists. A link whose dependent sits in an earlier column
 *   than its dependency is marked `upward`. The lint and TypeScript config
 *   packages (`CONFIG_PACKAGES`) are left out, as the mock leaves them out,
 *   since every package imports them.
 *
 * Each slice and node is toned by its layer (`layerTonesOf`): a layer the
 * mock names keeps the mock's tone, any other takes the next series tone
 * no layer holds, and `UNASSIGNED` draws muted. A rose or sunburst slice
 * carries its tone; a flow node names its layer as its group, the key of
 * `layerTones`, as `GraphNode` holds no tone. A replica with no layers
 * draws every folder in the one `unassigned` column.
 */
import type { ComponentKind, PackageComposition } from './composition.js';
import type { MeasuredWorkspace } from './source.js';
import type { QueryResult, Scalar } from '@open-tomato/atlas-data/contract';
import type { ChartTone, GraphNode, RoseSlice, SunburstNode } from '@open-tomato/charts';

import { COMPONENT_KINDS, COMPONENT_TONES } from './composition.js';
import { type FlowLink, LAYER_TONES } from './graph.js';
import { columnOf, numberOf, stringListOf, textOf, UNKNOWN } from './live-read.js';

/** The column of a module folder no layer of `atlas.layers` lists: the last one. */
export const UNASSIGNED = 'unassigned';

/** The fewest lines, the five kinds summed, a folder needs for a slice of the rose (C6). */
export const ROSE_MIN_LINES = 1_000;

/** The lint and TypeScript config packages, left out of the import flow: every package imports them. */
export const CONFIG_PACKAGES: ReadonlySet<string> = new Set(['@open-tomato/eslint-config', '@open-tomato/typescript-config']);

/** The tones a layer the mock does not name takes, in column order. */
const SERIES_TONES: readonly ChartTone[] = ['series-1', 'series-2', 'series-3', 'series-4', 'series-5', 'series-6', 'series-7', 'series-8'];

/** The tone of a layer past the eighth series tone, and of `UNASSIGNED`. */
const SPARE_TONE: ChartTone = 'muted';

/** The column of `arch.composition` each kind of line (`COMPONENT_KINDS`) is read from. */
export const KIND_COLUMNS: Readonly<Record<ComponentKind, string>> = {
  source: 'loc',
  tests: 'test_loc',
  docs: 'docs_loc',
  config: 'config_loc',
  fixtures: 'fixtures_loc',
};

/** The workspace fields this module fills. */
export type ArchitectureFields = Pick<MeasuredWorkspace, 'composition' | 'sizeRose' | 'compositionSunburst' | 'sankeyNodes' | 'sankeyLinks' | 'layerOrder' | 'layerTones'>;

/** One module folder's place: its layer's name, or `UNASSIGNED`, and the layer's rank, or null. */
interface Place {
  readonly layer: string;
  readonly rank: number | null;
}

/** One module folder of `arch.composition`: its path, place and five line counts. */
interface FolderLines extends Place {
  readonly path: string;
  readonly lines: PackageComposition;
}

/** The last segment of a module's path: its own folder's name. */
function folderOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** The place of a row from its `layer` and `layer_rank` cells: unassigned when either is NULL. */
function placeOf(layer: Scalar | undefined, rank: Scalar | undefined): Place {
  return typeof layer === 'string' && typeof rank === 'number'
    ? { layer, rank }
    : { layer: UNASSIGNED, rank: null };
}

/**
 * The columns, left to right: the layers `places` hold in `layer_rank`
 * order (ties by name), then `UNASSIGNED` when a place has no layer.
 */
export function layerOrderOf(places: readonly Place[]): string[] {
  const ranked = new Map<string, number>();
  for (const place of places) {
    if (place.rank !== null && !ranked.has(place.layer)) ranked.set(place.layer, place.rank);
  }
  const layers = [...ranked.entries()]
    .sort(([a, x], [b, y]) => x - y || a.localeCompare(b))
    .map(([layer]) => layer);
  return places.some((place) => place.rank === null)
    ? [...layers, UNASSIGNED]
    : layers;
}

/**
 * The tone of each layer of `order`: the mock's tone for a layer it names,
 * the next series tone no layer holds for any other (muted past the
 * eighth), and muted for `UNASSIGNED`.
 */
export function layerTonesOf(order: readonly string[]): Record<string, ChartTone> {
  const mockTones: Readonly<Record<string, ChartTone>> = LAYER_TONES;
  const named = new Set(order.flatMap((layer) => {
    const tone = mockTones[layer];
    return tone === undefined
      ? []
      : [tone];
  }));
  const spare = SERIES_TONES.filter((tone) => !named.has(tone));
  let next = 0;
  return Object.fromEntries(order.map((layer) => {
    if (layer === UNASSIGNED) return [layer, SPARE_TONE];
    const own = mockTones[layer];
    if (own !== undefined) return [layer, own];
    const tone = spare[next] ?? SPARE_TONE;
    next += 1;
    return [layer, tone];
  }));
}

/** The places of every row of `result`, an answer holding `layer` and `layer_rank` columns. */
function placesOf(result: QueryResult): Place[] {
  const layer = columnOf(result, 'layer');
  const rank = columnOf(result, 'layer_rank');
  return result.rows.map((row) => placeOf(row[layer], row[rank]));
}

/** The tones of the layers `results` hold together, in their column order. */
export function answerTonesOf(...results: readonly QueryResult[]): Record<string, ChartTone> {
  return layerTonesOf(layerOrderOf(results.flatMap(placesOf)));
}

/** The folders of `arch.composition`'s `path`, `layer`, `layer_rank` and line count rows. */
function foldersOf(result: QueryResult): FolderLines[] {
  const path = columnOf(result, 'path');
  const layer = columnOf(result, 'layer');
  const rank = columnOf(result, 'layer_rank');
  const kinds = COMPONENT_KINDS.map((kind) => [kind, columnOf(result, KIND_COLUMNS[kind])] as const);
  return result.rows.map((row) => {
    const id = textOf(row[path], UNKNOWN);
    const counts = Object.fromEntries(kinds.map(([kind, column]) => [kind, numberOf(row[column])])) as Record<ComponentKind, number>;
    return { path: id, ...placeOf(row[layer], row[rank]), lines: { id, ...counts, deps: null } };
  });
}

/** The five kinds of a folder's lines summed. */
function totalOf(folder: FolderLines): number {
  return COMPONENT_KINDS.reduce((sum, kind) => sum + folder.lines[kind], 0);
}

/** `folders` the most lines first, ties by path. */
function largestFirst(folders: readonly FolderLines[]): FolderLines[] {
  return [...folders].sort((a, b) => totalOf(b) - totalOf(a) || a.path.localeCompare(b.path));
}

/** The tone of `layer` in `tones`, muted for a layer it does not hold. */
function toneOf(tones: Readonly<Record<string, ChartTone>>, layer: string): ChartTone {
  return tones[layer] ?? SPARE_TONE;
}

/**
 * The rose (C6) from `arch.composition`'s rows: one slice per folder of
 * `ROSE_MIN_LINES` lines or more, the five kinds summed, the largest
 * first, grouped and toned by its layer.
 */
export function sizeRoseOf(result: QueryResult, tones: Readonly<Record<string, ChartTone>> = answerTonesOf(result)): RoseSlice[] {
  const folders = foldersOf(result);
  return largestFirst(folders)
    .filter((folder) => totalOf(folder) >= ROSE_MIN_LINES)
    .map((folder) => ({ id: folder.path, label: folderOf(folder.path), value: totalOf(folder), group: folder.layer, tone: toneOf(tones, folder.layer) }));
}

/** What the composition card (C7) draws: the sunburst and its table rows. */
export interface Composition {
  readonly sunburst: SunburstNode[];
  readonly rows: PackageComposition[];
}

/**
 * The composition (C7) from `arch.composition`'s rows: one inner slice
 * per folder holding a line, the most lines first, grouped and toned by
 * its layer, with its kinds holding a line on the outer ring in
 * `COMPONENT_KINDS` order, each toned by its kind; and the same folders
 * as table rows, `deps` null.
 */
export function compositionOf(result: QueryResult, tones: Readonly<Record<string, ChartTone>> = answerTonesOf(result)): Composition {
  const folders = foldersOf(result);
  const shown = largestFirst(folders).filter((folder) => totalOf(folder) > 0);
  return {
    sunburst: shown.map((folder) => ({
      id: folder.path,
      label: folderOf(folder.path),
      group: folder.layer,
      tone: toneOf(tones, folder.layer),
      children: COMPONENT_KINDS
        .filter((kind) => folder.lines[kind] > 0)
        .map((kind) => ({ id: `${folder.path}/${kind}`, label: kind, value: folder.lines[kind], group: kind, tone: COMPONENT_TONES[kind] })),
    })),
    rows: shown.map((folder) => folder.lines),
  };
}

/** What the import flow card (C8) draws: its nodes, its links and its columns in order. */
export interface ImportFlow {
  readonly nodes: GraphNode[];
  readonly links: FlowLink[];
  readonly layerOrder: string[];
}

/** One module of `arch.import-flow`: its node id, folder, place and the packages it imports. */
interface FlowModule extends Place {
  readonly id: string;
  readonly path: string;
  readonly imports: readonly string[];
}

/** The modules of `arch.import-flow`'s rows, the config packages left out. */
function flowModulesOf(result: QueryResult): FlowModule[] {
  const path = columnOf(result, 'path');
  const pkg = columnOf(result, 'package');
  const layer = columnOf(result, 'layer');
  const rank = columnOf(result, 'layer_rank');
  const imports = columnOf(result, 'imports_json');
  return result.rows
    .filter((row) => !CONFIG_PACKAGES.has(textOf(row[pkg], '')))
    .map((row) => {
      const folder = textOf(row[path], UNKNOWN);
      return { id: textOf(row[pkg], folder), path: folder, ...placeOf(row[layer], row[rank]), imports: stringListOf(row[imports], 'packages') };
    });
}

/**
 * The import flow (C8) from `path`, `package`, `layer`, `layer_rank` and
 * `imports_json` rows: the columns in `layer_rank` order with
 * `UNASSIGNED` last, one node per module in its layer's column, weighted
 * one more than its dependents in the flow, and one link per import of
 * another module's package, dependency to dependent, `upward` when the
 * dependent's column comes before the dependency's. A config package
 * draws neither a node nor a link, and a package no module carries draws
 * no link.
 */
export function importFlowOf(result: QueryResult): ImportFlow {
  const modules = flowModulesOf(result);
  const layerOrder = layerOrderOf(modules);
  const columns = new Map(modules.map((module) => [module.id, layerOrder.indexOf(module.layer)]));
  const links = modules.flatMap((module) => module.imports
    .filter((source) => columns.has(source) && source !== module.id)
    .map((source) => ({ source, target: module.id, value: 1, upward: (columns.get(module.id) ?? 0) < (columns.get(source) ?? 0) })));
  const nodes = modules.map((module) => ({
    id: module.id,
    label: folderOf(module.path),
    group: module.layer,
    value: 1 + links.filter((link) => link.source === module.id).length,
  }));
  return { nodes, links, layerOrder };
}

/**
 * The workspace fields of the three cards, from `arch.composition`'s and
 * `arch.import-flow`'s answers: one tone per layer either answer holds,
 * so a layer draws alike on the three cards, and the flow's columns.
 */
export function architectureOf(composition: QueryResult, importFlow: QueryResult): ArchitectureFields {
  const layerTones = answerTonesOf(composition, importFlow);
  const parts = compositionOf(composition, layerTones);
  const flow = importFlowOf(importFlow);
  return {
    composition: parts.rows,
    sizeRose: sizeRoseOf(composition, layerTones),
    compositionSunburst: parts.sunburst,
    sankeyNodes: flow.nodes,
    sankeyLinks: flow.links,
    layerOrder: flow.layerOrder,
    layerTones,
  };
}
