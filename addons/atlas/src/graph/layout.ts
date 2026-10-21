/**
 * A small 3D force layout: nodes push each other apart, springs pull, and
 * nodes drift toward their group. Only the nodes a lens lets take part move
 * or push; the rest wait where they were. It writes into typed arrays in
 * place on every frame, the one deliberate exception to the project's
 * immutability rule, because a copy per frame per node is the cost the
 * frame budget cannot pay.
 */
import type { EdgeKind, GraphEdge, GraphNode } from '../types.ts';

/** Spring length and pull per edge kind; the config's edge kinds supply them. */
export type SpringOf = (kind: EdgeKind) => { readonly rest: number; readonly stiffness: number };

const DEFAULT_REST = 10;
const DEFAULT_STIFFNESS = 0.004;

export const springFrom = (specs: Readonly<Record<string, { readonly rest?: number; readonly stiffness?: number }>>): SpringOf => (kind) => ({
  rest: specs[kind]?.rest ?? DEFAULT_REST,
  stiffness: specs[kind]?.stiffness ?? DEFAULT_STIFFNESS,
});

const REPULSION = 40;
const GRAVITY = 0.004;
const GROUP_PULL = 0.006;
const FRICTION = 0.62;
const ALPHA_DECAY = 0.985;
const ALPHA_MIN = 0.004;
const MAX_SPEED = 2;
const WARMUP_STEPS = 260;
/** How hot a lens switch makes the layout, so it rearranges in view. */
const SWITCH_ALPHA = 0.7;
const ARRIVAL_JITTER = 3;
/** How hard a flat lens pulls each node onto the z = 0 plane. */
const FLAT_PULL = 0.08;

/** Adds to one slot of a typed array, which noUncheckedIndexedAccess will not let `+=` do. */
function bump(array: Float32Array, at: number, by: number): void {
  array[at] = (array[at] ?? 0) + by;
}

export interface Spring {
  readonly a: number;
  readonly b: number;
  readonly rest: number;
  readonly strength: number;
}

/** A pull a lens adds between two nodes that no edge joins: a gravity well's holder and member. */
export interface Pull {
  readonly from: string;
  readonly to: string;
  readonly rest: number;
  readonly stiffness: number;
}

export interface Layout {
  readonly ids: readonly string[];
  readonly positions: Float32Array;
  readonly velocities: Float32Array;
  /** 1 where a node is held by a drag and the forces leave it alone. */
  readonly fixed: Uint8Array;
  /** 1 where the lens lets a node take part. */
  readonly active: Uint8Array;
  /** 1 once a node has had a place worked out, so a later lens does not drop it from far away. */
  readonly placed: Uint8Array;
  alpha: number;
}

function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

/** The springs between active nodes: the edges `include` keeps, and the lens's pulls. */
export function springsFor(nodes: readonly GraphNode[], edges: readonly GraphEdge[], springOf: SpringOf, include: (edge: GraphEdge) => boolean, pulls: readonly Pull[]): Spring[] {
  const index = new Map(nodes.map((n, i) => [n.id, i]));
  const fromEdges = edges.filter(include).flatMap((e) => {
    const a = index.get(e.source);
    const b = index.get(e.target);
    if (a === undefined || b === undefined) return [];
    const { rest, stiffness } = springOf(e.kind);
    return [{ a, b, rest, strength: stiffness * Math.log2(1 + Math.max(1, e.weight)) }];
  });
  const fromPulls = pulls.flatMap((p) => {
    const a = index.get(p.from);
    const b = index.get(p.to);
    return a === undefined || b === undefined ? [] : [{ a, b, rest: p.rest, strength: p.stiffness }];
  });
  return [...fromEdges, ...fromPulls];
}

export function createLayout(nodes: readonly GraphNode[], springs: readonly Spring[], active: readonly boolean[]): Layout {
  const random = seeded(20261020);
  const groups = [...new Set(nodes.map((n) => n.group))];
  const positions = new Float32Array(nodes.length * 3);
  nodes.forEach((node, i) => {
    const g = groups.indexOf(node.group);
    const angle = (g / groups.length) * Math.PI * 2;
    positions[i * 3] = Math.cos(angle) * 18 + (random() - 0.5) * 12;
    positions[i * 3 + 1] = (random() - 0.5) * 16;
    positions[i * 3 + 2] = Math.sin(angle) * 18 + (random() - 0.5) * 12;
  });
  const layout: Layout = {
    ids: nodes.map((n) => n.id),
    positions,
    velocities: new Float32Array(nodes.length * 3),
    fixed: new Uint8Array(nodes.length),
    active: Uint8Array.from(active, (on) => (on ? 1 : 0)),
    placed: Uint8Array.from(active, (on) => (on ? 1 : 0)),
    alpha: 1,
  };
  const step = stepper(nodes, springs);
  for (let i = 0; i < WARMUP_STEPS; i += 1) {
    layout.alpha = 1;
    step(layout);
  }
  layout.alpha = 0.3;
  return layout;
}

/**
 * Hands the layout to a new lens: sets who takes part, drops each newcomer
 * next to a placed spring partner (it arrives from its cluster, not from the
 * edge of space), and heats the layout so it rearranges in view.
 */
export function activate(layout: Layout, springs: readonly Spring[], active: readonly boolean[]): void {
  const p = layout.positions;
  active.forEach((on, i) => {
    layout.active[i] = on ? 1 : 0;
    if (!on || layout.placed[i]) return;
    const partner = springs.find((s) => (s.a === i && layout.placed[s.b]) || (s.b === i && layout.placed[s.a]));
    if (partner) {
      const other = partner.a === i ? partner.b : partner.a;
      for (let k = 0; k < 3; k += 1) p[i * 3 + k] = p[other * 3 + k]! + (Math.random() - 0.5) * ARRIVAL_JITTER;
    }
    layout.placed[i] = 1;
  });
  layout.alpha = Math.max(layout.alpha, SWITCH_ALPHA);
}

/** Returns a step function bound to these springs; call it once per frame. `flat` presses the layout onto one plane. */
export function stepper(nodes: readonly GraphNode[], springs: readonly Spring[], flat = false): (layout: Layout) => boolean {
  const groupOf = nodes.map((n) => n.group);
  const n = nodes.length;
  const force = new Float32Array(n * 3);

  return (layout) => {
    if (layout.alpha < ALPHA_MIN) return false;
    const p = layout.positions;
    const v = layout.velocities;
    const on = layout.active;
    force.fill(0);
    for (let i = 0; i < n; i += 1) {
      if (!on[i]) continue;
      for (let j = i + 1; j < n; j += 1) {
        if (!on[j]) continue;
        const dx = p[i * 3]! - p[j * 3]!;
        const dy = p[i * 3 + 1]! - p[j * 3 + 1]!;
        const dz = p[i * 3 + 2]! - p[j * 3 + 2]!;
        const d2 = Math.max(dx * dx + dy * dy + dz * dz, 0.25);
        const f = REPULSION / (d2 * Math.sqrt(d2));
        bump(force, i * 3, dx * f); bump(force, i * 3 + 1, dy * f); bump(force, i * 3 + 2, dz * f);
        bump(force, j * 3, -(dx * f)); bump(force, j * 3 + 1, -(dy * f)); bump(force, j * 3 + 2, -(dz * f));
      }
    }
    for (const { a, b, rest, strength } of springs) {
      if (!on[a] || !on[b]) continue;
      const dx = p[b * 3]! - p[a * 3]!;
      const dy = p[b * 3 + 1]! - p[a * 3 + 1]!;
      const dz = p[b * 3 + 2]! - p[a * 3 + 2]!;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.01;
      const f = ((d - rest) * strength) / d;
      bump(force, a * 3, dx * f); bump(force, a * 3 + 1, dy * f); bump(force, a * 3 + 2, dz * f);
      bump(force, b * 3, -(dx * f)); bump(force, b * 3 + 1, -(dy * f)); bump(force, b * 3 + 2, -(dz * f));
    }
    const centroids = new Map<string, [number, number, number, number]>();
    for (let i = 0; i < n; i += 1) {
      if (!on[i]) continue;
      const c = centroids.get(groupOf[i]!) ?? [0, 0, 0, 0];
      centroids.set(groupOf[i]!, [c[0] + p[i * 3]!, c[1] + p[i * 3 + 1]!, c[2] + p[i * 3 + 2]!, c[3] + 1]);
    }
    for (let i = 0; i < n; i += 1) {
      if (!on[i]) continue;
      if (layout.fixed[i]) {
        v[i * 3] = 0; v[i * 3 + 1] = 0; v[i * 3 + 2] = 0;
        continue;
      }
      const c = centroids.get(groupOf[i]!)!;
      for (let k = 0; k < 3; k += 1) {
        const press = flat && k === 2 ? -p[i * 3 + k]! * FLAT_PULL : 0;
        const pull = (c[k]! / c[3] - p[i * 3 + k]!) * GROUP_PULL - p[i * 3 + k]! * GRAVITY + press;
        const vel = (v[i * 3 + k]! + (force[i * 3 + k]! + pull) * layout.alpha) * FRICTION;
        v[i * 3 + k] = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, vel));
        bump(p, i * 3 + k, v[i * 3 + k]!);
      }
    }
    layout.alpha *= ALPHA_DECAY;
    return true;
  };
}
