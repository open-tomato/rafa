/**
 * Fixed 2D arrangements for the traditional views. Each returns where every
 * node stands (world x, y on the z = 0 plane, y up), the boxes to draw behind
 * them, and, for plots, the right-angle routes ELK found for the links.
 */
import ELK from 'elkjs/lib/elk.bundled.js';
import type { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api';

import { readItems, viewItem } from '../contract/bind.ts';
import type { ArrangeSpec, GraphEdge, GraphNode, Scenario } from '../contract/types.ts';
import type { View } from '../view.tsx';

export type Point2 = readonly [number, number];

export interface Box {
  readonly id: string;
  readonly kind: 'plot' | 'entity' | 'column' | 'lane' | 'lifeline';
  readonly title: string;
  readonly subtitle?: string;
  /** Top-left corner, world units, y up. */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly color: string;
  readonly rows?: readonly { readonly text: string; readonly tag?: string }[];
}

export interface Route {
  readonly kind: string;
  readonly source: string;
  readonly target: string;
  readonly points: readonly Point2[];
}

export interface Arrangement {
  readonly positions: ReadonlyMap<string, Point2>;
  readonly boxes: readonly Box[];
  readonly routes: readonly Route[];
}

// Plot sizes, world units: a die is about 2 across, a label wants about 7.
const LEAF_W = 8;
const LEAF_H = 4.4;
const ENTITY_W = 19;
const ENTITY_HEADER = 4.2;
const ENTITY_ROW = 1.15;
const PLOT_PADDING = '[top=5.5,left=1.6,bottom=1.6,right=1.6]';
// Board sizes.
const LANE_HEAD_W = 12;
const COLUMN_W = 12;
const CARD = 2.6;
const CARDS_PER_ROW = 4;
const LANE_PAD = 2.2;
const COLUMN_HEADER = 4;
// Sequence sizes.
const LIFELINE_GAP = 13;
const LIFELINE_H = 36;

const elk = new ELK();

/** Shifts every point so the arrangement's bounding box is centred on the origin, and flips y up. */
function centred(positions: Map<string, Point2>, boxes: Box[], routes: Route[]): Arrangement {
  const xs = [...[...positions.values()].map((p) => p[0]), ...boxes.flatMap((b) => [b.x, b.x + b.w])];
  const ys = [...[...positions.values()].map((p) => p[1]), ...boxes.flatMap((b) => [b.y, b.y + b.h])];
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const at = ([x, y]: Point2): Point2 => [x - cx, -(y - cy)];
  return {
    positions: new Map([...positions].map(([id, p]) => [id, at(p)])),
    boxes: boxes.map((b) => ({ ...b, x: b.x - cx, y: -(b.y - cy) })),
    routes: routes.map((r) => ({ ...r, points: r.points.map(at) })),
  };
}

async function plots(spec: Extract<ArrangeSpec, { kind: 'plots' }>, view: View, nodes: readonly GraphNode[], keep: (edge: GraphEdge) => boolean): Promise<Arrangement> {
  const ids = new Set(nodes.map((n) => n.id));
  const parentOf = new Map<string, string>();
  if (spec.contains) {
    for (const e of view.index.edges) {
      if (e.kind === spec.contains && ids.has(e.source) && ids.has(e.target) && !parentOf.has(e.target)) parentOf.set(e.target, e.source);
    }
  }
  const containers = new Set(parentOf.values());
  const label = (id: string): string => view.index.byId.get(id)?.label ?? id;
  const rowsOf = (node: GraphNode): { text: string; tag?: string }[] =>
    spec.rows ? readItems(spec.rows, { node, index: view.index }).map((item) => viewItem(item, spec.rowShape, label)).map((v) => ({ text: v.text, tag: v.tag })) : [];

  const elkNode = (node: GraphNode): ElkNode => {
    if (containers.has(node.id)) {
      return {
        id: node.id,
        layoutOptions: { 'elk.padding': PLOT_PADDING },
        children: nodes.filter((n) => parentOf.get(n.id) === node.id).map(elkNode),
      };
    }
    const rows = rowsOf(node).length;
    return spec.rows ? { id: node.id, width: ENTITY_W, height: ENTITY_HEADER + rows * ENTITY_ROW } : { id: node.id, width: LEAF_W, height: LEAF_H };
  };

  const edges: ElkExtendedEdge[] = view.index.edges
    .filter((e) => spec.routed.includes(e.kind) && keep(e) && ids.has(e.source) && ids.has(e.target) && e.source !== e.target && !containers.has(e.source) && !containers.has(e.target))
    .map((e, i) => ({ id: `e${i}|${e.kind}|${e.source}|${e.target}`, sources: [e.source], targets: [e.target] }));

  const graph: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': spec.direction ?? 'RIGHT',
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.spacing.nodeNode': '2.4',
      'elk.layered.spacing.nodeNodeBetweenLayers': '5',
      'elk.spacing.edgeNode': '1.2',
      'elk.spacing.edgeEdge': '0.6',
    },
    children: nodes.filter((n) => !parentOf.has(n.id)).map(elkNode),
    edges,
  };
  const laid = await elk.layout(graph);

  const positions = new Map<string, Point2>();
  const boxes: Box[] = [];
  const offsets = new Map<string, Point2>([['root', [0, 0]]]);
  const walk = (n: ElkNode, ox: number, oy: number): void => {
    const x = ox + (n.x ?? 0);
    const y = oy + (n.y ?? 0);
    offsets.set(n.id, [x, y]);
    const node = view.index.byId.get(n.id);
    if (node) {
      const w = n.width ?? LEAF_W;
      const h = n.height ?? LEAF_H;
      if (containers.has(n.id)) {
        boxes.push({ id: n.id, kind: 'plot', title: node.label, subtitle: node.legend, x, y, w, h, color: view.color(node) });
        positions.set(n.id, [x + 2.2, y + 2.4]);
      } else if (spec.rows) {
        boxes.push({ id: n.id, kind: 'entity', title: node.label, subtitle: node.legend, x, y, w, h, color: view.color(node), rows: rowsOf(node) });
        positions.set(n.id, [x + 1.9, y + 2.1]);
      } else {
        positions.set(n.id, [x + w / 2, y + h / 2 - 0.7]);
      }
    }
    for (const child of n.children ?? []) walk(child, x, y);
  };
  for (const child of laid.children ?? []) walk(child, 0, 0);

  const routes: Route[] = (laid.edges ?? []).flatMap((e) => {
    const [, kind = '', source = '', target = ''] = e.id.split('|');
    const container = (e as ElkExtendedEdge & { container?: string }).container ?? 'root';
    const [ox, oy] = offsets.get(container) ?? [0, 0];
    return (e.sections ?? []).map((s) => ({
      kind, source, target,
      points: [s.startPoint, ...(s.bendPoints ?? []), s.endPoint].map((p): Point2 => [p.x + ox, p.y + oy]),
    }));
  });
  return centred(positions, boxes, routes);
}

function board(spec: Extract<ArrangeSpec, { kind: 'board' }>, view: View, nodes: readonly GraphNode[]): Arrangement {
  const ctx = (node: GraphNode) => ({ node, index: view.index });
  const heads = nodes.filter((n) => view.matches(spec.laneHeads, n));
  const cards = nodes.filter((n) => !view.matches(spec.laneHeads, n));
  const laneOf = (n: GraphNode): string => String(readItems(spec.lane, ctx(n))[0] ?? (view.index.byId.get(n.id)?.[spec.lane] ?? ''));
  const columnOf = (n: GraphNode): string => String(view.index.byId.get(n.id)?.[spec.column] ?? '');
  const laneIds = [...new Set([...heads.map((h) => h.id), ...cards.map(laneOf)])];
  const sizeOfLane = (lane: string): number => cards.filter((c) => laneOf(c) === lane).length;
  laneIds.sort((a, b) => (heads.some((h) => h.id === b) ? 1 : 0) - (heads.some((h) => h.id === a) ? 1 : 0) || sizeOfLane(b) - sizeOfLane(a));

  const positions = new Map<string, Point2>();
  const boxes: Box[] = [];
  let y = COLUMN_HEADER;
  for (const lane of laneIds) {
    const inLane = cards.filter((c) => laneOf(c) === lane);
    const rowsNeeded = Math.max(1, ...spec.columns.map((col) => Math.ceil(inLane.filter((c) => columnOf(c) === col.id).length / CARDS_PER_ROW)));
    const h = rowsNeeded * CARD + LANE_PAD * 2;
    const head = view.index.byId.get(lane);
    boxes.push({ id: `lane:${lane}`, kind: 'lane', title: head?.label ?? (lane === 'epic:none' ? 'no epic' : lane), subtitle: `${inLane.length}`, x: 0, y, w: LANE_HEAD_W + spec.columns.length * COLUMN_W, h, color: head ? view.color(head) : '#6b7280' });
    if (head) positions.set(head.id, [LANE_HEAD_W / 2, y + h / 2 + 0.6]);
    spec.columns.forEach((col, c) => {
      inLane.filter((card) => columnOf(card) === col.id).forEach((card, i) => {
        const gx = LANE_HEAD_W + c * COLUMN_W + CARD * 0.9 + (i % CARDS_PER_ROW) * CARD;
        const gy = y + LANE_PAD + CARD / 2 + Math.floor(i / CARDS_PER_ROW) * CARD;
        positions.set(card.id, [gx, gy]);
      });
    });
    y += h;
  }
  spec.columns.forEach((col, c) => {
    const count = cards.filter((card) => columnOf(card) === col.id).length;
    boxes.push({ id: `column:${col.id}`, kind: 'column', title: col.title, subtitle: `${count}`, x: LANE_HEAD_W + c * COLUMN_W, y: 0, w: COLUMN_W, h: y, color: '#8892a6' });
  });
  return centred(positions, boxes, []);
}

/** The ids a scenario passes through, in the order they first appear. */
export function participants(scenario: Scenario): string[] {
  return [...new Set(scenario.steps.flatMap((s) => [s.from, s.to]))];
}

function sequence(view: View, scenario: Scenario | undefined): Arrangement {
  if (!scenario) return { positions: new Map(), boxes: [], routes: [] };
  const positions = new Map<string, Point2>();
  const boxes: Box[] = participants(scenario).map((id, i) => {
    const node = view.index.byId.get(id);
    positions.set(id, [i * LIFELINE_GAP, 0]);
    return { id: `life:${id}`, kind: 'lifeline' as const, title: node?.label ?? id, x: i * LIFELINE_GAP - 0.4, y: 2.5, w: 0.8, h: LIFELINE_H, color: node ? view.color(node) : '#888' };
  });
  return centred(positions, boxes, []);
}

/** `keep` filters the links plots route (the weight slider); the other arrangements route none. */
export async function arrange(spec: ArrangeSpec, view: View, nodes: readonly GraphNode[], scenario: Scenario | undefined, keep: (edge: GraphEdge) => boolean): Promise<Arrangement> {
  switch (spec.kind) {
    case 'plots': return plots(spec, view, nodes, keep);
    case 'board': return board(spec, view, nodes);
    case 'sequence': return sequence(view, scenario);
  }
}
