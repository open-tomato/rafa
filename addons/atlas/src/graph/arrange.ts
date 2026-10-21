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
  readonly kind: 'plot' | 'entity' | 'column' | 'lane' | 'lifeline' | 'month' | 'cell' | 'span';
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
// Timeline sizes.
const WEEK_W = 7;
const PLANNED_W = 18;
const MONTH_BAND = 2.6;
const WEEK_HEADER = 3.2;
const TIME_CARD = 2.3;
const CELL_H = 1.6;
const LANE_MIN_H = 5;
const SPAN_H = 0.8;
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

const DAY_MS = 86_400_000;
const mondayOf = (iso: string): string => {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};
const addWeeks = (monday: string, n: number): string => new Date(Date.parse(monday) + n * 7 * DAY_MS).toISOString().slice(0, 10);
const weekLabel = (monday: string): string => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(monday));
const monthLabel = (monday: string): string => new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(monday));

/** A roadmap: weeks left to right under month boxes, a lane per group, undated cards in a Planned column. */
function timeline(spec: Extract<ArrangeSpec, { kind: 'timeline' }>, view: View, nodes: readonly GraphNode[], now: Date): Arrangement {
  const pick = (node: GraphNode, binding: string): unknown => binding.split('.').reduce<unknown>((acc, k) => (acc !== null && typeof acc === 'object' ? (acc as Record<string, unknown>)[k] : undefined), node);
  const heads = nodes.filter((n) => view.matches(spec.laneHeads, n));
  const cards = nodes.filter((n) => !view.matches(spec.laneHeads, n));
  const dateOf = (n: GraphNode): string | null => {
    const v = pick(n, spec.date);
    return typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : null;
  };
  const laneOf = (n: GraphNode): string => String(pick(n, spec.lane) ?? '');
  const cellsOf = (h: GraphNode): Record<string, { done: number; active: number }> => {
    const v = spec.cells ? pick(h, spec.cells) : null;
    return v !== null && typeof v === 'object' ? (v as Record<string, { done: number; active: number }>) : {};
  };
  const spanOf = (h: GraphNode): { first: string; last: string } | null => {
    const v = spec.span ? pick(h, spec.span) : null;
    return v !== null && typeof v === 'object' && 'first' in v ? (v as { first: string; last: string }) : null;
  };
  // The weeks run from the earliest date anything carries to the current week.
  const mondays = [
    mondayOf(now.toISOString()),
    ...cards.map(dateOf).filter((d): d is string => !!d).map(mondayOf),
    ...heads.flatMap((h) => Object.keys(cellsOf(h))),
    ...heads.flatMap((h) => {
      const s = spanOf(h);
      return s ? [mondayOf(s.first), mondayOf(s.last)] : [];
    }),
  ].sort();
  const firstWeek = mondays[0] ?? mondayOf(now.toISOString());
  const thisWeek = mondayOf(now.toISOString());
  const weeks: string[] = [];
  for (let w = firstWeek; w <= thisWeek; w = addWeeks(w, 1)) weeks.push(w);
  const xOf = (monday: string): number => LANE_HEAD_W + weeks.indexOf(monday) * WEEK_W;
  const plannedX = LANE_HEAD_W + weeks.length * WEEK_W;
  const top = MONTH_BAND + WEEK_HEADER;

  const laneIds = [...new Set([...heads.map((h) => h.id), ...cards.map(laneOf)])];
  const startOf = (lane: string): string => {
    const head = view.index.byId.get(lane);
    return (head && spanOf(head)?.first) ?? '9999';
  };
  laneIds.sort((a, b) => startOf(a).localeCompare(startOf(b)) || a.localeCompare(b));

  const positions = new Map<string, Point2>();
  const boxes: Box[] = [];
  let y = top;
  const perPlannedRow = Math.floor((PLANNED_W - 1) / TIME_CARD);
  for (const lane of laneIds) {
    const head = view.index.byId.get(lane);
    const inLane = cards.filter((c) => laneOf(c) === lane);
    const byWeek = new Map<string, GraphNode[]>();
    const planned: GraphNode[] = [];
    for (const card of inLane) {
      const d = dateOf(card);
      if (d && weeks.includes(mondayOf(d))) byWeek.set(mondayOf(d), [...(byWeek.get(mondayOf(d)) ?? []), card]);
      else planned.push(card);
    }
    const perWeekRow = Math.max(1, Math.floor((WEEK_W - 1) / TIME_CARD));
    const rows = Math.max(1, Math.ceil(planned.length / perPlannedRow), ...[...byWeek.values()].map((cs) => Math.ceil(cs.length / perWeekRow)));
    const h = Math.max(LANE_MIN_H, SPAN_H + 1 + rows * TIME_CARD + CELL_H + 0.6);
    const color = head ? view.color(head) : '#6b7280';
    boxes.push({ id: `lane:${lane}`, kind: 'lane', title: head?.label ?? (lane === 'epic:none' ? 'no epic' : lane), subtitle: `${planned.length} planned`, x: 0, y, w: plannedX + PLANNED_W, h, color });
    if (head) {
      positions.set(head.id, [LANE_HEAD_W / 2, y + h / 2 + 0.6]);
      const span = spanOf(head);
      if (span) {
        const from = xOf(mondayOf(span.first));
        const to = xOf(mondayOf(span.last)) + WEEK_W;
        boxes.push({ id: `span:${lane}`, kind: 'span', title: '', x: from + 0.3, y: y + 0.5, w: to - from - 0.6, h: SPAN_H, color });
      }
      for (const [monday, counts] of Object.entries(cellsOf(head))) {
        if (!weeks.includes(monday) || (counts.done === 0 && counts.active === 0)) continue;
        const parts = [counts.done > 0 ? `✓ ${counts.done}` : '', counts.active > 0 ? `● ${counts.active}` : ''].filter(Boolean);
        boxes.push({ id: `cell:${lane}:${monday}`, kind: 'cell', title: parts.join('  '), x: xOf(monday) + 0.4, y: y + h - CELL_H - 0.3, w: WEEK_W - 0.8, h: CELL_H, color });
      }
    }
    for (const [monday, cs] of byWeek) {
      cs.forEach((card, i) => positions.set(card.id, [xOf(monday) + TIME_CARD * 0.75 + (i % perWeekRow) * TIME_CARD, y + SPAN_H + 1 + TIME_CARD / 2 + Math.floor(i / perWeekRow) * TIME_CARD]));
    }
    planned.forEach((card, i) => positions.set(card.id, [plannedX + TIME_CARD * 0.75 + (i % perPlannedRow) * TIME_CARD, y + SPAN_H + 1 + TIME_CARD / 2 + Math.floor(i / perPlannedRow) * TIME_CARD]));
    y += h;
  }
  // Week columns, month boxes over them, and the Planned column.
  weeks.forEach((monday) => {
    boxes.push({ id: `week:${monday}`, kind: 'column', title: weekLabel(monday), subtitle: monday === thisWeek ? 'now' : undefined, x: xOf(monday), y: MONTH_BAND, w: WEEK_W, h: y - MONTH_BAND, color: monday === thisWeek ? '#ff6b4a' : '#8892a6' });
  });
  const months = [...new Set(weeks.map((w) => w.slice(0, 7)))];
  for (const month of months) {
    const inMonth = weeks.filter((w) => w.startsWith(month));
    const x = xOf(inMonth[0]!);
    boxes.push({ id: `month:${month}`, kind: 'month', title: monthLabel(inMonth[0]!), x, y: 0, w: inMonth.length * WEEK_W, h: y, color: '#c0c9d8' });
  }
  boxes.push({ id: 'week:planned', kind: 'column', title: 'Planned', subtitle: `${cards.filter((c) => !dateOf(c)).length}`, x: plannedX, y: MONTH_BAND, w: PLANNED_W, h: y - MONTH_BAND, color: '#8892a6' });
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
    case 'timeline': return timeline(spec, view, nodes, new Date());
  }
}
