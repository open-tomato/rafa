/**
 * The view: one config read against one snapshot. Every colour, icon, size,
 * template and widget the UI draws is asked of it, so swapping the config
 * swaps the whole look without touching a component.
 */
import { createContext, useContext } from 'react';

import { readNumber } from './contract/bind.ts';
import type { DiceTemplate, EdgeKindSpec, EntityTypeSpec, FaceWidgetSpec, GraphNode, LensSpec, RelationRole, SoretesConfig } from './contract/types.ts';
import { templateFor } from './configs/index.ts';
import { SHAPES, type DieShape } from './geometry/dice.ts';
import type { GraphIndex } from './graph/index.ts';

/** The lens a config without lenses gets: every node, every link a line. */
const SHOW_ALL: LensSpec = { title: 'All', icon: '🌐', description: 'Every node, every link.' };
const MIN_RADIUS = 0.6;
const RADIUS_SPAN = 0.9;
const GROUP_RADIUS = 1.5;
const UNSIZED_RADIUS = 1.15;

export interface View {
  readonly config: SoretesConfig;
  readonly index: GraphIndex;
  readonly entityTypes: readonly string[];
  readonly edgeKinds: readonly string[];
  readonly groups: readonly string[];
  type: (type: string) => EntityTypeSpec;
  edge: (kind: string) => EdgeKindSpec;
  icon: (node: GraphNode) => string;
  color: (node: GraphNode) => string;
  radius: (node: GraphNode) => number;
  template: (node: GraphNode) => DiceTemplate;
  widget: (id: string) => FaceWidgetSpec | undefined;
  shape: (node: GraphNode) => DieShape;
  groupLabel: (group: string) => string;
  readonly lenses: readonly (readonly [string, LensSpec])[];
  lens: (id: string) => LensSpec;
  /** What a relation does under a lens; a kind the lens does not list is a line. */
  role: (lens: LensSpec, kind: string) => RelationRole;
  /** Whether a node's type or id is in a lens's (or a cloud's, a well's) list. */
  matches: (list: readonly string[] | undefined, node: GraphNode) => boolean;
}

/** A stable colour for a group the config gives none: its name hashed to a hue. */
function hashedColor(key: string): string {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h}, 55%, 52%)`;
}

export function makeView(config: SoretesConfig, index: GraphIndex): View {
  const holders = new Set(index.nodes.filter((n) => n.group === n.id).map((n) => n.id));
  const sizeOf = (node: GraphNode): number | null => (config.size ? readNumber(config.size, { node, index }) : null);
  const largest = Math.max(1, ...index.nodes.map((n) => sizeOf(n) ?? 0));
  const seen = (values: readonly string[]): string[] => [...new Set(values)];
  return {
    config,
    index,
    entityTypes: seen([...Object.keys(config.entityTypes).filter((t) => index.nodes.some((n) => n.type === t)), ...index.nodes.map((n) => n.type)]),
    edgeKinds: seen([...Object.keys(config.edgeKinds).filter((k) => index.edges.some((e) => e.kind === k)), ...index.edges.map((e) => e.kind)]),
    groups: seen(index.nodes.map((n) => n.group)),
    type: (type) => config.entityTypes[type] ?? { name: type, icon: '◆', stroke: '#d8dee9', help: `Nodes of type ${type}; the config has no entry for it.` },
    edge: (kind) => config.edgeKinds[kind] ?? { label: kind, color: '#8fa3bf', dash: 0, help: `Links of kind ${kind}; the config has no entry for it.` },
    icon: (node) => config.nodeStyle?.[node.id]?.icon ?? config.entityTypes[node.type]?.icon ?? '◆',
    color: (node) => config.nodeStyle?.[node.id]?.color ?? config.groupColors?.[node.group] ?? hashedColor(node.group),
    radius: (node) => {
      const fixed = config.entityTypes[node.type]?.radius;
      if (fixed !== undefined) return fixed;
      if (holders.has(node.id)) return GROUP_RADIUS;
      const size = sizeOf(node);
      return size === null ? UNSIZED_RADIUS : MIN_RADIUS + RADIUS_SPAN * Math.log10(1 + (9 * size) / largest);
    },
    template: (node) => templateFor(config, node),
    widget: (id) => config.widgets[id],
    shape: (node) => SHAPES[config.entityTypes[node.type]?.shape ?? 'd20'],
    groupLabel: (group) => index.byId.get(group)?.label ?? group,
    lenses: Object.entries(config.lenses ?? { all: SHOW_ALL }),
    lens: (id) => config.lenses?.[id] ?? Object.values(config.lenses ?? {})[0] ?? SHOW_ALL,
    role: (lens, kind) => lens.relations?.[kind] ?? 'line',
    matches: (list, node) => !list || list.includes(node.type) || list.includes(node.id),
  };
}

const ViewContext = createContext<View | null>(null);

export const ViewProvider = ViewContext.Provider;

export function useView(): View {
  const view = useContext(ViewContext);
  if (!view) throw new Error('useView outside ViewProvider');
  return view;
}
