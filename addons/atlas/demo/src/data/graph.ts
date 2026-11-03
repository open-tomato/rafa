/**
 * The workspace as a graph, read from the members' package.json on
 * 2026-11-02 (internal dependencies only). Layers are the decision the
 * Sankey needs: which package sits in which column.
 */
import type { ChartTone, GraphLink, GraphNode } from '@open-tomato/charts';

export const LAYER_ORDER = ['config', 'core', 'platform', 'feature', 'addon', 'app'] as const;
export type Layer = typeof LAYER_ORDER[number];

export const LAYER_TONES: Record<Layer, ChartTone> = {
  config: 'series-4',
  core: 'series-1',
  platform: 'series-3',
  feature: 'series-2',
  addon: 'series-7',
  app: 'series-5',
};

const MEMBERS: [string, Layer, string[]][] = [
  ['rafa-eslint-config', 'config', []],
  ['rafa-typescript-config', 'config', ['rafa-eslint-config']],
  ['rafa-core', 'core', ['rafa-eslint-config']],
  ['rafa-inventory', 'platform', ['rafa-core', 'rafa-eslint-config']],
  ['rafa-effort', 'platform', ['rafa-core', 'rafa-inventory', 'rafa-eslint-config']],
  ['rafa-board', 'platform', ['rafa-core', 'rafa-effort', 'rafa-eslint-config']],
  ['rafa-hub', 'platform', ['rafa-core', 'rafa-eslint-config']],
  ['rafa-sync-service', 'platform', ['rafa-core', 'rafa-eslint-config']],
  ['rafa-release', 'feature', ['rafa-board', 'rafa-core', 'rafa-effort', 'rafa-eslint-config']],
  ['rafa-pr', 'feature', ['rafa-board', 'rafa-core', 'rafa-inventory', 'rafa-release', 'rafa-eslint-config']],
  ['rafa-run', 'feature', ['rafa-board', 'rafa-core', 'rafa-effort', 'rafa-inventory', 'rafa-pr', 'rafa-release', 'rafa-eslint-config']],
  ['atlas-data', 'addon', ['rafa-eslint-config']],
  ['atlas-transport', 'addon', ['atlas-data', 'rafa-eslint-config']],
  ['atlas-visualization', 'addon', ['atlas-data', 'atlas-transport', 'rafa-eslint-config']],
  ['rafa-atlas', 'addon', ['atlas-data', 'atlas-transport', 'rafa-board', 'rafa-core', 'rafa-effort', 'rafa-eslint-config']],
  ['atlas-demo', 'app', ['atlas-data', 'atlas-transport', 'atlas-visualization', 'rafa-atlas', 'rafa-eslint-config']],
];

const dependents = new Map<string, number>();
for (const [, , deps] of MEMBERS) for (const dep of deps) dependents.set(dep, (dependents.get(dep) ?? 0) + 1);

/** Every member, weighted by how many members depend on it. */
export const WORKSPACE_NODES: GraphNode[] = MEMBERS.map(([id, group]) => ({
  id, label: id.replace(/^rafa-/, ''), group, value: 1 + (dependents.get(id) ?? 0),
}));

/** Every internal dependency edge, dependency → dependent (the direction code flows). */
export const WORKSPACE_LINKS: GraphLink[] = MEMBERS.flatMap(([id, , deps]) => deps.map((dep) => ({ source: dep, target: id, value: 1 })));

/** The Sankey view: the lint config reaches every package, so its edges are left out to keep the flow readable. */
export const SANKEY_NODES: GraphNode[] = WORKSPACE_NODES.filter((node) => node.id !== 'rafa-eslint-config' && node.id !== 'rafa-typescript-config');
export const SANKEY_LINKS: GraphLink[] = WORKSPACE_LINKS.filter((link) => link.source !== 'rafa-eslint-config' && link.target !== 'rafa-typescript-config');

export const LAYER_OF: Record<string, Layer> = Object.fromEntries(MEMBERS.map(([id, layer]) => [id, layer])) as Record<string, Layer>;
