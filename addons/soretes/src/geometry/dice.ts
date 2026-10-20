/**
 * The dice: each shape as a solid of circumradius 1 whose front face looks
 * down +Z, and what it opens into.
 *   net      faces move rigidly onto a flat layout (d4, d6, d8, d10, d20)
 *   explode  faces lift outward along their normals and reveal what is inside (d12)
 *   unroll   the side unrolls into a rectangle, the caps swing beside it (cylinder)
 *
 * A net is built from the solid itself: faces are laid flat one by one, each
 * attached to a placed neighbour along their shared edge (a hinge) or slid
 * into place by a shared vertex, so every face keeps its true shape.
 * The overlay reads `cells` (where widgets go) and `regions` (the node's own
 * text), all in the die's local units on the front face's plane.
 */
import { BufferGeometry, Float32BufferAttribute, Matrix4, Quaternion, Vector3 } from 'three';

import { NET_CENTER, NET_FACES, NET_HEIGHT, NET_WIDTH, EDGE as D20_EDGE, FRONT_Z as D20_FRONT_Z, ROW_H, netToLocal } from './icosa.ts';

export type ShapeId = 'd4' | 'd6' | 'd8' | 'd10' | 'd12' | 'd20' | 'cylinder';
export type Point = readonly [number, number];
export type Tint = 'up' | 'down' | 'self' | 'parent' | 'band';

export interface ShapeFace {
  readonly tint: Tint;
  readonly folded: readonly Vector3[];
  readonly foldedCentroid: Vector3;
  readonly outward: Vector3;
  /** Where the face's centroid sits once open, and the turn that takes it there (net dice only). */
  readonly flatCentroid: Vector3;
  readonly flatRotation: Quaternion;
}

/** A widget's place on the open die: its outline, the vertex its icon points to, and its wide side. */
export interface Cell {
  readonly slot: string;
  readonly polygon: readonly Point[];
  readonly apex: Point;
  readonly baseMid: Point;
}

/** The node's own text on the open die: its card (`self`), its parent, or one line along a band. */
export interface Region {
  readonly kind: 'self' | 'parent' | 'band';
  readonly polygon: readonly Point[];
  readonly rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
}

export interface DieShape {
  readonly id: ShapeId;
  readonly unfold: 'net' | 'explode' | 'unroll';
  readonly faces: readonly ShapeFace[];
  readonly cells: readonly Cell[];
  readonly regions: readonly Region[];
  /** Widget slots in reading order; a template's widgets fill them in this order when it names no slot. */
  readonly slots: readonly string[];
  /** The open die's bounding-box centre (local, z on the front plane), width and height. */
  readonly netCenter: Vector3;
  readonly netWidth: number;
  readonly netHeight: number;
  /** A typical face size: the camera keeps it from drawing larger than the text was made for. */
  readonly refEdge: number;
  /** The front face's distance from the centre, where the icon sits. */
  readonly frontZ: number;
  readonly iconSize: number;
}

// ── small vector helpers ───────────────────────────────────────────────────────

const centroid3 = (p: readonly Vector3[]): Vector3 => p.reduce((acc, v) => acc.add(v), new Vector3()).divideScalar(p.length);
const centroid2 = (p: readonly Point[]): Point => [p.reduce((a, q) => a + q[0], 0) / p.length, p.reduce((a, q) => a + q[1], 0) / p.length];
const normalOf = (p: readonly Vector3[]): Vector3 => p[1]!.clone().sub(p[0]!).cross(p[2]!.clone().sub(p[0]!)).normalize();
const lerp2 = (a: Point, b: Point, t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

function frame(a: Vector3, b: Vector3, c: Vector3): Matrix4 {
  const e1 = b.clone().sub(a).normalize();
  const n = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
  return new Matrix4().makeBasis(e1, n.clone().cross(e1), n);
}

/** Faces wound counter-clockwise seen from outside. */
const windOutward = (verts: readonly Vector3[], faces: readonly (readonly number[])[]): number[][] =>
  faces.map((f) => {
    const pts = f.map((i) => verts[i]!);
    return normalOf(pts).dot(centroid3(pts)) > 0 ? [...f] : [...f].reverse();
  });

/** Turns the solid so `front` looks down +Z with `up` (a direction) pointing +Y, and scales it to circumradius 1. */
function orient(verts: readonly Vector3[], front: readonly number[], up: Vector3): Vector3[] {
  const pts = front.map((i) => verts[i]!);
  const n = normalOf(pts);
  const u = up.clone().sub(n.clone().multiplyScalar(up.dot(n))).normalize();
  const basis = new Matrix4().makeBasis(u.clone().cross(n), u, n).invert();
  const r = Math.max(...verts.map((v) => v.length()));
  return verts.map((v) => v.clone().applyMatrix4(basis).divideScalar(r));
}

/** The face's own outline in 2D, orientation kept, `up` toward +y, centred on its centroid. */
function shape2(pts: readonly Vector3[], up: Vector3): Point[] {
  const n = normalOf(pts);
  const c = centroid3(pts);
  const e2 = up.clone().sub(n.clone().multiplyScalar(up.dot(n))).normalize();
  const e1 = e2.clone().cross(n);
  return pts.map((p) => {
    const d = p.clone().sub(c);
    return [d.dot(e1), d.dot(e2)] as const;
  });
}

const rotate2 = (p: readonly Point[], angle: number, about: Point): Point[] => p.map(([x, y]) => {
  const dx = x - about[0];
  const dy = y - about[1];
  return [about[0] + dx * Math.cos(angle) - dy * Math.sin(angle), about[1] + dx * Math.sin(angle) + dy * Math.cos(angle)] as const;
});
const translate2 = (p: readonly Point[], dx: number, dy: number): Point[] => p.map(([x, y]) => [x + dx, y + dy] as const);

// ── nets ───────────────────────────────────────────────────────────────────────

/** How one face reaches its place in the net. */
type Placement =
  | { readonly kind: 'front' }
  /** Hinged to a placed face along their shared edge: a true unfold. */
  | { readonly kind: 'hinge'; readonly to: number }
  /** Its own outline, `up` toward +y and turned by `turn`, slid so its vertex `v` lands on that vertex of face `to`. */
  | { readonly kind: 'slide'; readonly up: Vector3; readonly turn: number; readonly v: number; readonly to: number }
  /** Its own outline, `up` toward +y and turned by `turn`, centred at `at`. */
  | { readonly kind: 'at'; readonly up: Vector3; readonly turn: number; readonly at: Point };

/** Lays the faces flat in the given order; returns each face's flat outline, vertex for vertex. */
function layNet(verts: readonly Vector3[], faces: readonly (readonly number[])[], plan: readonly (readonly [number, Placement])[]): Point[][] {
  const flat: Point[][] = faces.map(() => []);
  const where = (face: number, vertex: number): Point => {
    const k = faces[face]!.indexOf(vertex);
    const p = flat[face]![k];
    if (!p) throw new Error(`face ${face} has no placed vertex ${vertex}`);
    return p;
  };
  for (const [f, how] of plan) {
    const pts = faces[f]!.map((i) => verts[i]!);
    if (how.kind === 'front') {
      flat[f] = pts.map((p) => [p.x, p.y] as const);
      continue;
    }
    if (how.kind === 'hinge') {
      const shared = faces[f]!.filter((v) => faces[how.to]!.includes(v));
      const [a, b] = shared as [number, number];
      // Any in-plane direction will do: the hinge turns the outline onto the shared edge anyway.
      const own = shape2(pts, pts[1]!.clone().sub(pts[0]!));
      const ca = own[faces[f]!.indexOf(a)]!;
      const cb = own[faces[f]!.indexOf(b)]!;
      const pa = where(how.to, a);
      const pb = where(how.to, b);
      const angle = Math.atan2(pb[1] - pa[1], pb[0] - pa[0]) - Math.atan2(cb[1] - ca[1], cb[0] - ca[0]);
      const turned = rotate2(own, angle, ca);
      flat[f] = translate2(turned, pa[0] - ca[0], pa[1] - ca[1]);
      continue;
    }
    const own = rotate2(shape2(pts, how.up), how.turn, [0, 0]);
    if (how.kind === 'at') {
      flat[f] = translate2(own, how.at[0], how.at[1]);
      continue;
    }
    const mine = own[faces[f]!.indexOf(how.v)]!;
    const target = where(how.to, how.v);
    flat[f] = translate2(own, target[0] - mine[0], target[1] - mine[1]);
  }
  return flat;
}

/** Faces as rigid moves from the solid to the flat net on the front plane. */
function netFaces(verts: readonly Vector3[], faces: readonly (readonly number[])[], flat: readonly Point[][], tints: readonly Tint[], frontZ: number): ShapeFace[] {
  return faces.map((f, i) => {
    const folded = f.map((v) => verts[v]!);
    const flat3 = flat[i]!.map(([x, y]) => new Vector3(x, y, frontZ));
    const rotation = frame(flat3[0]!, flat3[1]!, flat3[2]!).multiply(frame(folded[0]!, folded[1]!, folded[2]!).transpose());
    return {
      tint: tints[i] ?? 'up',
      folded,
      foldedCentroid: centroid3(folded),
      outward: centroid3(folded).normalize(),
      flatCentroid: centroid3(flat3),
      flatRotation: new Quaternion().setFromRotationMatrix(rotation),
    };
  });
}

function bounds(points: readonly Point[]): { minX: number; maxX: number; minY: number; maxY: number } {
  return {
    minX: Math.min(...points.map((p) => p[0])), maxX: Math.max(...points.map((p) => p[0])),
    minY: Math.min(...points.map((p) => p[1])), maxY: Math.max(...points.map((p) => p[1])),
  };
}

/** A triangle cell: the apex is its lone vertex furthest from the side `wide` names (up: the top edge is wide). */
function triCell(slot: string, poly: readonly Point[], apexDown: boolean): Cell {
  const ys = poly.map((p) => p[1]);
  const k = ys.indexOf(apexDown ? Math.min(...ys) : Math.max(...ys));
  const apex = poly[k]!;
  return { slot, polygon: poly, apex, baseMid: centroid2(poly.filter((_, i) => i !== k)) };
}

/** A box cell: icon at the top, title at the bottom. */
function boxCell(slot: string, poly: readonly Point[]): Cell {
  const b = bounds(poly);
  return { slot, polygon: poly, apex: [(b.minX + b.maxX) / 2, b.maxY], baseMid: [(b.minX + b.maxX) / 2, b.minY] };
}

const rectRegion = (kind: Region['kind'], x: number, y: number, w: number, h: number): Region => ({
  kind, rect: { x, y, w, h }, polygon: [[x, y], [x + w, y], [x + w, y - h], [x, y - h]],
});

function finish(id: ShapeId, unfold: DieShape['unfold'], faces: ShapeFace[], cells: Cell[], regions: Region[], frontZ: number, refEdge: number, iconSize: number): DieShape {
  const points = [...cells.flatMap((c) => c.polygon), ...regions.flatMap((r) => r.polygon)];
  const b = bounds(points.length > 0 ? points : [[-1, -1], [1, 1]]);
  return {
    id, unfold, faces, cells, regions, slots: cells.map((c) => c.slot),
    netCenter: new Vector3((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, frontZ),
    netWidth: b.maxX - b.minX, netHeight: b.maxY - b.minY, refEdge, frontZ, iconSize,
  };
}

// ── d20: the original net, read into the shared form ───────────────────────────

function d20(): DieShape {
  const local = (p: Point): Point => {
    const v = netToLocal(p);
    return [v.x, v.y];
  };
  const faces: ShapeFace[] = NET_FACES.map((f) => ({
    tint: f.row === 'top' ? 'up' : f.row === 'bottom' ? 'down' : f.slot === 'A' ? 'parent' : 'self',
    folded: f.folded, foldedCentroid: f.foldedCentroid, outward: f.outward, flatCentroid: f.flatCentroid, flatRotation: f.flatRotation,
  }));
  const cells = NET_FACES.filter((f) => f.slot !== 'A' && f.slot !== 'B').map((f) => triCell(f.slot, f.flat.map(local), f.row === 'bottom'));
  const a = [[0, 0], [2, 0], [2.5, -ROW_H], [0.5, -ROW_H]].map((p) => local(p as unknown as Point));
  const b = [[2, 0], [5, 0], [5.5, -ROW_H], [2.5, -ROW_H]].map((p) => local(p as unknown as Point));
  const [ax, ay] = local([0.5, 0]);
  const [bx, by] = local([2.5, 0]);
  const regions: Region[] = [
    { kind: 'parent', polygon: a, rect: { x: ax, y: ay, w: 1.5 * D20_EDGE, h: ROW_H * D20_EDGE } },
    { kind: 'self', polygon: b, rect: { x: bx, y: by, w: 2.5 * D20_EDGE, h: ROW_H * D20_EDGE } },
  ];
  return {
    id: 'd20', unfold: 'net', faces, cells, regions, slots: cells.map((c) => c.slot),
    netCenter: NET_CENTER, netWidth: NET_WIDTH, netHeight: NET_HEIGHT, refEdge: D20_EDGE, frontZ: D20_FRONT_Z, iconSize: 0.58,
  };
}

// ── d4: a big triangle, base up: three corners around a centre ─────────────────

function d4(): DieShape {
  const raw = [new Vector3(1, 1, 1), new Vector3(1, -1, -1), new Vector3(-1, 1, -1), new Vector3(-1, -1, 1)];
  const faces0 = windOutward(raw, [[0, 1, 2], [0, 1, 3], [0, 2, 3], [1, 2, 3]]);
  const front = faces0[3]!;
  const verts = orient(raw, front, raw[front[0]!]!.clone().sub(centroid3(front.map((i) => raw[i]!))));
  const faces = faces0;
  const flat = layNet(verts, faces, [[3, { kind: 'front' }], [0, { kind: 'hinge', to: 3 }], [1, { kind: 'hinge', to: 3 }], [2, { kind: 'hinge', to: 3 }]]);
  const frontZ = centroid3(front.map((i) => verts[i]!)).z;
  const corners = [0, 1, 2].map((i) => ({ i, c: centroid2(flat[i]!) })).sort((p, q) => q.c[1] - p.c[1] || p.c[0] - q.c[0]);
  const names = ['corner0', 'corner1', 'corner2'];
  const cells: Cell[] = corners.map(({ i }, k) => triCell(names[k]!, flat[i]!, true));
  cells.push(triCell('center', flat[3]!, false));
  const b = bounds(flat.flat());
  const edge = Math.hypot(flat[3]![1]![0] - flat[3]![0]![0], flat[3]![1]![1] - flat[3]![0]![1]);
  const band = edge * 0.42;
  const regions = [rectRegion('band', b.minX, b.maxY + band, b.maxX - b.minX, band)];
  const tints: Tint[] = faces.map((_, i) => (i === 3 ? 'self' : 'down'));
  return finish('d4', 'net', netFaces(verts, faces, flat, tints, frontZ), cells, regions, frontZ, edge, 0.5);
}

// ── d6: the cross, the sixth face to the right ────────────────────────────────

function d6(): DieShape {
  const raw = [-1, 1].flatMap((x) => [-1, 1].flatMap((y) => [-1, 1].map((z) => new Vector3(x, y, z))));
  const quad = (axis: 'x' | 'y' | 'z', s: number): number[] => raw.map((v, i) => [v, i] as const).filter(([v]) => v[axis] === s).map(([, i]) => i);
  const order = (ids: number[]): number[] => {
    const c = centroid3(ids.map((i) => raw[i]!));
    const n = c.clone().normalize();
    const ref = raw[ids[0]!]!.clone().sub(c);
    return [...ids].sort((p, q) => {
      const ang = (i: number): number => {
        const d = raw[i]!.clone().sub(c);
        return Math.atan2(ref.clone().cross(d).dot(n), ref.dot(d));
      };
      return ang(p) - ang(q);
    });
  };
  const named = { front: quad('z', 1), back: quad('z', -1), top: quad('y', 1), bottom: quad('y', -1), right: quad('x', 1), left: quad('x', -1) } as const;
  const keys = Object.keys(named) as (keyof typeof named)[];
  const faces = windOutward(raw, keys.map((k) => order(named[k])));
  const verts = orient(raw, faces[0]!, new Vector3(0, 1, 0));
  const idx = (k: keyof typeof named): number => keys.indexOf(k);
  const flat = layNet(verts, faces, [
    [idx('front'), { kind: 'front' }],
    [idx('top'), { kind: 'hinge', to: idx('front') }],
    [idx('bottom'), { kind: 'hinge', to: idx('front') }],
    [idx('left'), { kind: 'hinge', to: idx('front') }],
    [idx('right'), { kind: 'hinge', to: idx('front') }],
    [idx('back'), { kind: 'hinge', to: idx('right') }],
  ]);
  const frontZ = centroid3(faces[0]!.map((i) => verts[i]!)).z;
  const cells = keys.filter((k) => k !== 'front').map((k) => boxCell(k, flat[idx(k)]!));
  const fb = bounds(flat[idx('front')]!);
  const regions: Region[] = [rectRegion('self', fb.minX, fb.maxY, fb.maxX - fb.minX, fb.maxY - fb.minY)];
  const tints: Tint[] = keys.map((k) => (k === 'front' ? 'self' : k === 'top' || k === 'left' ? 'up' : 'down'));
  return finish('d6', 'net', netFaces(verts, faces, flat, tints, frontZ), cells, regions, frontZ, fb.maxX - fb.minX, 0.6);
}

// ── d8: four diamonds, a text line along the seam ──────────────────────────────

function d8(): DieShape {
  // Poles ±Y, equator in the XZ plane; T = 0, B = 1, E0..E3 = 2..5.
  const raw = [new Vector3(0, 1, 0), new Vector3(0, -1, 0), new Vector3(1, 0, 0), new Vector3(0, 0, 1), new Vector3(-1, 0, 0), new Vector3(0, 0, -1)];
  const E = (i: number): number => 2 + (((i % 4) + 4) % 4);
  const top = [0, 1, 2, 3].map((i) => [0, E(i), E(i + 1)]);
  const bottom = [0, 1, 2, 3].map((i) => [1, E(i), E(i + 1)]);
  const faces = windOutward(raw, [...top, ...bottom]);
  const frontFace = 1;
  const verts = orient(raw, faces[frontFace]!, new Vector3(0, 1, 0));
  const up = verts[0]!.clone();
  const down = verts[1]!.clone();
  const frontZ = centroid3(faces[frontFace]!.map((i) => verts[i]!)).z;
  const edge = verts[E(0)]!.distanceTo(verts[E(1)]!);
  const gap = edge * 0.36;
  // Top triangles side by side along their bases; each bottom triangle hangs under its top one, a gap below.
  const plan: (readonly [number, Placement])[] = [[frontFace, { kind: 'front' }]];
  const front2 = layNet(verts, faces, plan)[frontFace]!;
  const baseY = Math.min(...front2.map((p) => p[1]));
  const fc = centroid2(front2);
  for (const i of [0, 2, 3]) plan.push([i, { kind: 'at', up, turn: 0, at: [fc[0] + (i - frontFace) * edge, fc[1]] }]);
  const triH = (edge * Math.sqrt(3)) / 2;
  for (let i = 0; i < 4; i += 1) plan.push([4 + i, { kind: 'at', up: down, turn: Math.PI, at: [fc[0] + (i - frontFace) * edge, baseY - gap - triH / 3] }]);
  const flat = layNet(verts, faces, plan);
  const cells: Cell[] = [
    ...[0, 1, 2, 3].map((i) => triCell(`up${i}`, flat[i]!, false)),
    ...[0, 1, 2, 3].map((i) => triCell(`down${i}`, flat[4 + i]!, true)),
  ];
  const b = bounds(flat.flat());
  const regions = [rectRegion('band', b.minX, baseY, b.maxX - b.minX, gap)];
  const tints: Tint[] = faces.map((_, i) => (i < 4 ? 'up' : 'down'));
  return finish('d8', 'net', netFaces(verts, faces, flat, tints, frontZ), cells, regions, frontZ, edge, 0.42);
}

// ── d10: ten kites in a strip; their inner halves make a zigzag text band ──────

function d10(): DieShape {
  const z0 = 0.105;
  const ring = (i: number, offset: number, z: number): Vector3 => new Vector3(Math.cos((2 * Math.PI * (i + offset)) / 5), Math.sin((2 * Math.PI * (i + offset)) / 5), z);
  // The pole height that puts each kite's four corners on one plane, found by bisection.
  const planar = (h: number): number => {
    const t = new Vector3(0, 0, h);
    const n = ring(0, 0, z0).sub(t).cross(ring(1, 0, z0).sub(t));
    return n.dot(ring(0, 0.5, -z0).sub(t));
  };
  let lo = z0 + 0.01;
  let hi = 5;
  for (let k = 0; k < 60; k += 1) {
    const mid = (lo + hi) / 2;
    if (Math.sign(planar(mid)) === Math.sign(planar(lo))) lo = mid;
    else hi = mid;
  }
  const h = (lo + hi) / 2;
  // T = 0, B = 1, U0..U4 = 2..6, L0..L4 = 7..11.
  const raw = [new Vector3(0, 0, h), new Vector3(0, 0, -h), ...[0, 1, 2, 3, 4].map((i) => ring(i, 0, z0)), ...[0, 1, 2, 3, 4].map((i) => ring(i, 0.5, -z0))];
  const U = (i: number): number => 2 + (((i % 5) + 5) % 5);
  const L = (i: number): number => 7 + (((i % 5) + 5) % 5);
  const upper = [0, 1, 2, 3, 4].map((i) => [0, U(i), L(i), U(i + 1)]);
  const lower = [0, 1, 2, 3, 4].map((i) => [1, L(i), U(i + 1), L(i + 1)]);
  const faces = windOutward(raw, [...upper, ...lower]);
  const frontFace = 2;
  const pole = raw[0]!.clone();
  const verts = orient(raw, faces[frontFace]!, pole.sub(centroid3(faces[frontFace]!.map((i) => raw[i]!))));
  const frontZ = centroid3(faces[frontFace]!.map((i) => verts[i]!)).z;
  const toT = (f: number): Vector3 => verts[0]!.clone().sub(centroid3(faces[f]!.map((i) => verts[i]!)));
  const plan: (readonly [number, Placement])[] = [[frontFace, { kind: 'front' }]];
  // Upper kites slide sideways by their shared side corner; each lower kite hinges onto the upper one beside it.
  for (const i of [3, 4]) plan.push([i, { kind: 'slide', up: toT(i), turn: 0, v: U(i), to: i - 1 }]);
  for (const i of [1, 0]) plan.push([i, { kind: 'slide', up: toT(i), turn: 0, v: U(i + 1), to: i + 1 }]);
  for (let i = 0; i < 5; i += 1) plan.push([5 + i, { kind: 'hinge', to: i }]);
  const flat = layNet(verts, faces, plan);
  const kite = (f: number, v: (i: number) => number, i: number): Point => flat[f]![faces[f]!.indexOf(v(i))]!;
  const cells: Cell[] = [
    ...[0, 1, 2, 3, 4].map((i) => triCell(`up${i}`, [kite(i, () => 0, i), kite(i, U, i), kite(i, U, i + 1)], false)),
    ...[0, 1, 2, 3, 4].map((i) => triCell(`down${i}`, [kite(5 + i, () => 1, i), kite(5 + i, L, i), kite(5 + i, L, i + 1)], true)),
  ];
  // The band: between the upper kites' side corners and the lower kites' side corners.
  const topY = kite(frontFace, U, frontFace)[1];
  const lowY = kite(5 + frontFace, L, frontFace)[1];
  const all = bounds(flat.flat());
  const regions = [rectRegion('band', all.minX, topY, all.maxX - all.minX, topY - lowY)];
  const tints: Tint[] = faces.map((_, i) => (i < 5 ? 'up' : 'down'));
  const edge = verts[U(0)]!.distanceTo(verts[U(1)]!);
  return finish('d10', 'net', netFaces(verts, faces, flat, tints, frontZ), cells, regions, frontZ, edge, 0.4);
}

// ── d12: pentagons that lift away from the centre ─────────────────────────────

function d12(): DieShape {
  const phi = (1 + Math.sqrt(5)) / 2;
  const ico = [
    [0, 1, phi], [0, -1, phi], [0, 1, -phi], [0, -1, -phi],
    [1, phi, 0], [-1, phi, 0], [1, -phi, 0], [-1, -phi, 0],
    [phi, 0, 1], [-phi, 0, 1], [phi, 0, -1], [-phi, 0, -1],
  ].map(([x, y, z]) => new Vector3(x, y, z));
  const tri: number[][] = [];
  for (let a = 0; a < 12; a += 1) for (let b = a + 1; b < 12; b += 1) for (let c = b + 1; c < 12; c += 1) {
    const e = (i: number, j: number): boolean => Math.abs(ico[i]!.distanceTo(ico[j]!) - 2) < 1e-6;
    if (e(a, b) && e(b, c) && e(a, c)) tri.push([a, b, c]);
  }
  const raw = tri.map((t) => centroid3(t.map((i) => ico[i]!)));
  const faces0 = ico.map((v, vi) => {
    const around = tri.map((t, ti) => [t, ti] as const).filter(([t]) => t.includes(vi)).map(([, ti]) => ti);
    const n = v.clone().normalize();
    const c = centroid3(around.map((i) => raw[i]!));
    const ref = raw[around[0]!]!.clone().sub(c);
    return [...around].sort((p, q) => {
      const ang = (i: number): number => {
        const d = raw[i]!.clone().sub(c);
        return Math.atan2(ref.clone().cross(d).dot(n), ref.dot(d));
      };
      return ang(p) - ang(q);
    });
  });
  const faces = windOutward(raw, faces0);
  const front = faces[0]!;
  const verts = orient(raw, front, raw[front[0]!]!.clone().sub(centroid3(front.map((i) => raw[i]!))));
  const frontZ = centroid3(front.map((i) => verts[i]!)).z;
  const shapeFaces: ShapeFace[] = faces.map((f, i) => {
    const folded = f.map((v) => verts[v]!);
    return { tint: i === 0 ? 'self' : 'up', folded, foldedCentroid: centroid3(folded), outward: centroid3(folded).normalize(), flatCentroid: centroid3(folded), flatRotation: new Quaternion() };
  });
  const span = 2 * (1 + EXPLODE) + 0.6;
  return {
    id: 'd12', unfold: 'explode', faces: shapeFaces, cells: [], regions: [], slots: [],
    netCenter: new Vector3(0, 0, 0), netWidth: span, netHeight: span, refEdge: 0.7, frontZ, iconSize: 0.5,
  };
}

/** How far a d12 face lifts from the solid, in radii. */
export const EXPLODE = 0.9;

// ── cylinder: the side unrolls into a grid of cells, the caps swing above and below ─

export const CYL_R = 0.62;
export const CYL_H = 1.25;
export const CYL_SEGMENTS = 48;

function cylinder(): DieShape {
  const width = 2 * Math.PI * CYL_R;
  const cols = 4;
  const rows = 2;
  const cw = width / cols;
  const ch = CYL_H / rows;
  const cells: Cell[] = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const x = -width / 2 + c * cw;
      const y = CYL_H / 2 - r * ch;
      cells.push(boxCell(`c${r * cols + c}`, [[x, y], [x + cw, y], [x + cw, y - ch], [x, y - ch]]));
    }
  }
  const disk = (cy: number): Point[] => Array.from({ length: 32 }, (_, i) => [Math.cos((i / 32) * Math.PI * 2) * CYL_R, cy + Math.sin((i / 32) * Math.PI * 2) * CYL_R] as const);
  const topY = CYL_H / 2 + CYL_R + 0.08;
  const lowY = -CYL_H / 2 - CYL_R - 0.08;
  const side = CYL_R * 1.42;
  const regions: Region[] = [
    { kind: 'self', polygon: disk(topY), rect: { x: -side / 2 - 0.35, y: topY + side / 2, w: side + 0.7, h: side } },
    { kind: 'parent', polygon: disk(lowY), rect: { x: -side / 2, y: lowY + side / 2, w: side, h: side } },
  ];
  return finish('cylinder', 'unroll', [], cells, regions, CYL_R, cw * 0.9, 0.5);
}

// ── folded meshes ──────────────────────────────────────────────────────────────

/** A polygon fanned into triangles, in place or around a centre. */
export function polygonGeometry(points: readonly Vector3[], around?: Vector3): BufferGeometry {
  const o = around ?? new Vector3();
  const positions: number[] = [];
  for (let i = 1; i < points.length - 1; i += 1) {
    for (const p of [points[0]!, points[i]!, points[i + 1]!]) positions.push(p.x - o.x, p.y - o.y, p.z - o.z);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

export const SHAPES: Readonly<Record<ShapeId, DieShape>> = {
  d4: d4(),
  d6: d6(),
  d8: d8(),
  d10: d10(),
  d12: d12(),
  d20: d20(),
  cylinder: cylinder(),
};

export const lerpPoint = lerp2;
