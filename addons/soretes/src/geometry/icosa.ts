/**
 * The d20: an icosahedron of circumradius 1 whose front face looks down +Z
 * with its apex up, and the paper net it unfolds into.
 *
 * Net rows, edge length s, h = s·√3/2 (the ASCII layout from the brief):
 *   top     5 triangles pointing up,   apexes at y = h      → slots up0..up4
 *   middle 10 triangles alternating, between y = 0 and -h   → regions A (4), B (6)
 *   bottom  5 triangles pointing down, apexes at y = -2h    → slots down0..down4
 * The front face is the middle row's up triangle at i = 3, inside B, so it
 * stays where it is while the other nineteen unfold around it.
 */
import { BufferGeometry, Float32BufferAttribute, Matrix4, Quaternion, Vector3 } from 'three';

export type FaceSlot = `up${0 | 1 | 2 | 3 | 4}` | `down${0 | 1 | 2 | 3 | 4}` | 'A' | 'B';
export type CapSlot = Exclude<FaceSlot, 'A' | 'B'>;

export const CAP_SLOTS: readonly CapSlot[] = ['up0', 'up1', 'up2', 'up3', 'up4', 'down0', 'down1', 'down2', 'down3', 'down4'];

type Label = string;
type Flat = readonly [number, number];

export interface NetFace {
  readonly slot: FaceSlot;
  readonly row: 'top' | 'middle' | 'bottom';
  /** Vertex positions on the d20, front face toward +Z. */
  readonly folded: readonly [Vector3, Vector3, Vector3];
  /** Vertex positions in the net, in units of the edge length, y up. */
  readonly flat: readonly [Flat, Flat, Flat];
  readonly foldedCentroid: Vector3;
  readonly outward: Vector3;
  /** Where the face's centroid sits once flat, in the d20's local space. */
  readonly flatCentroid: Vector3;
  /** Rotation taking the folded face onto its flat place. */
  readonly flatRotation: Quaternion;
}

const TAU = Math.PI * 2;
const RING_Z = 1 / Math.sqrt(5);
const RING_R = 2 / Math.sqrt(5);
export const EDGE = RING_R * 2 * Math.sin(Math.PI / 5);
export const ROW_H = Math.sqrt(3) / 2;
const FRONT_INDEX = 3;

function rawVertex(label: Label): Vector3 {
  if (label === 'T') return new Vector3(0, 0, 1);
  if (label === 'B') return new Vector3(0, 0, -1);
  const i = Number(label.slice(1)) % 5;
  const angle = label.startsWith('U') ? (TAU * i) / 5 : (TAU * (i + 0.5)) / 5;
  return new Vector3(Math.cos(angle) * RING_R, Math.sin(angle) * RING_R, label.startsWith('U') ? RING_Z : -RING_Z);
}

interface RawFace {
  readonly slot: FaceSlot;
  readonly row: NetFace['row'];
  readonly labels: readonly [Label, Label, Label];
  readonly flat: readonly [Flat, Flat, Flat];
  readonly front: boolean;
}

function rawFaces(): RawFace[] {
  const faces: RawFace[] = [];
  for (let i = 0; i < 5; i += 1) {
    faces.push({
      slot: `up${i}` as FaceSlot, row: 'top', front: false,
      labels: [`U${i}`, `U${i + 1}`, 'T'],
      flat: [[i, 0], [i + 1, 0], [i + 0.5, ROW_H]],
    });
  }
  for (let i = 0; i < 5; i += 1) {
    const region = i < 2 ? 'A' : 'B';
    faces.push({
      slot: region, row: 'middle', front: false,
      labels: [`U${i}`, `L${i}`, `U${i + 1}`],
      flat: [[i, 0], [i + 0.5, -ROW_H], [i + 1, 0]],
    });
    faces.push({
      slot: region, row: 'middle', front: i === FRONT_INDEX,
      labels: [`U${i + 1}`, `L${i}`, `L${i + 1}`],
      flat: [[i + 1, 0], [i + 0.5, -ROW_H], [i + 1.5, -ROW_H]],
    });
  }
  for (let i = 0; i < 5; i += 1) {
    faces.push({
      slot: `down${i}` as FaceSlot, row: 'bottom', front: false,
      labels: [`L${i}`, 'B', `L${i + 1}`],
      flat: [[i + 0.5, -ROW_H], [i + 1, -2 * ROW_H], [i + 1.5, -ROW_H]],
    });
  }
  return faces;
}

function frame(a: Vector3, b: Vector3, c: Vector3): Matrix4 {
  const e1 = b.clone().sub(a).normalize();
  const n = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
  const e2 = n.clone().cross(e1);
  return new Matrix4().makeBasis(e1, e2, n);
}

const centroid = (p: readonly Vector3[]): Vector3 => p.reduce((acc, v) => acc.add(v), new Vector3()).divideScalar(p.length);

function build(): { faces: NetFace[]; netCenter: Vector3; frontZ: number; toLocal: (p: Flat) => Vector3 } {
  const raw = rawFaces();
  // Wind every face outward, swapping the same two labels in the flat triangle.
  const wound = raw.map((f) => {
    const [a, b, c] = f.labels.map(rawVertex) as [Vector3, Vector3, Vector3];
    const outward = b.clone().sub(a).cross(c.clone().sub(a)).dot(centroid([a, b, c])) > 0;
    return outward ? f : { ...f, labels: [f.labels[0], f.labels[2], f.labels[1]] as const, flat: [f.flat[0], f.flat[2], f.flat[1]] as const };
  });
  const front = wound.find((f) => f.front) ?? wound[0]!;
  const [fa, fb, fc] = front.labels.map(rawVertex) as [Vector3, Vector3, Vector3];
  const frontCentroid = centroid([fa, fb, fc]);
  const apexLabel = front.labels.find((l) => l.startsWith('U')) ?? front.labels[0];
  // Turn the solid so the front face's normal is +Z and its apex points +Y.
  const normal = frontCentroid.clone().normalize();
  const apexDir = rawVertex(apexLabel).sub(frontCentroid).normalize();
  const basis = new Matrix4().makeBasis(apexDir.clone().cross(normal), apexDir, normal);
  const toFront = basis.clone().invert();
  const vertex = (label: Label): Vector3 => rawVertex(label).applyMatrix4(toFront);

  const frontZ = frontCentroid.length();
  const frontFlat = front.flat.reduce<[number, number]>((acc, [x, y]) => [acc[0] + x / 3, acc[1] + y / 3], [0, 0]);
  const flatLocal = ([x, y]: Flat): Vector3 => new Vector3((x - frontFlat[0]) * EDGE, (y - frontFlat[1]) * EDGE, frontZ);

  const faces = wound.map((f): NetFace => {
    const folded = f.labels.map(vertex) as [Vector3, Vector3, Vector3];
    const flat3 = f.flat.map(flatLocal) as [Vector3, Vector3, Vector3];
    const rotation = frame(...flat3).multiply(frame(...folded).transpose());
    return {
      slot: f.slot,
      row: f.row,
      folded,
      flat: f.flat,
      foldedCentroid: centroid(folded),
      outward: centroid(folded).normalize(),
      flatCentroid: centroid(flat3),
      flatRotation: new Quaternion().setFromRotationMatrix(rotation),
    };
  });
  const netCenter = flatLocal([2.75, -ROW_H / 2]);
  return { faces, netCenter, frontZ, toLocal: flatLocal };
}

const built = build();

export const NET_FACES: readonly NetFace[] = built.faces;
/** The net's bounding-box centre in the d20's local space. */
export const NET_CENTER: Vector3 = built.netCenter;
/** A point of the net (edge units) in the d20's local space, on the front face's plane. */
export const netToLocal = (p: readonly [number, number]): Vector3 => built.toLocal(p);
export const FRONT_Z: number = built.frontZ;
/** Net size in local units (circumradius 1). */
export const NET_WIDTH = 5.5 * EDGE;
export const NET_HEIGHT = 3 * ROW_H * EDGE;

/** One mesh for a folded d20, flat-shaded. */
export function foldedGeometry(): BufferGeometry {
  const positions = NET_FACES.flatMap((f) => f.folded.flatMap((v) => [v.x, v.y, v.z]));
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** One face's triangle around its own folded centroid, for the unfold rig. */
export function faceGeometry(face: NetFace): BufferGeometry {
  const positions = face.folded.flatMap((v) => {
    const local = v.clone().sub(face.foldedCentroid);
    return [local.x, local.y, local.z];
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}
