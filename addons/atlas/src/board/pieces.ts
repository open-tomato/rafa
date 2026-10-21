/**
 * A die as flat wireframe pieces for the 2D board: each piece has its outline
 * on the closed die, seen straight from the front (a front elevation), and
 * its outline once open, both in the die's local units. Opening the die is a
 * plain 2D morph from one outline to the other, vertex for vertex.
 *   net      each face moves to its place in the flat net
 *   explode  each face slides out along its own outward direction (d12)
 *   unroll   the side's cells wrap around the front, the caps sit flat as ellipses (cylinder)
 * A piece that looks away from the viewer is `back`: the board draws it dashed,
 * like a hidden line on a technical drawing.
 */
import { Vector3 } from 'three';

import { CYL_H, CYL_R, EXPLODE, type DieShape, type Point } from '../geometry/dice.ts';

export interface Piece {
  readonly folded: readonly Point[];
  readonly open: readonly Point[];
  readonly back: boolean;
}

/** A face this far toward −z counts as looking away; edge-on faces stay solid. */
const BACK_Z = -0.02;
/** How round a cylinder cap reads from the front: the ellipse's height over its width. */
const CAP_SQUASH = 0.22;

const xy = (v: Vector3): Point => [v.x, v.y];

function netPieces(shape: DieShape): Piece[] {
  return shape.faces.map((face) => ({
    folded: face.folded.map(xy),
    open: face.folded.map((v) => xy(v.clone().sub(face.foldedCentroid).applyQuaternion(face.flatRotation).add(face.flatCentroid))),
    back: face.outward.z < BACK_Z,
  }));
}

function explodePieces(shape: DieShape): Piece[] {
  return shape.faces.map((face) => {
    const lift = face.outward.clone().multiplyScalar(EXPLODE);
    return { folded: face.folded.map(xy), open: face.folded.map((v) => xy(v.clone().add(lift))), back: face.outward.z < BACK_Z };
  });
}

function unrollPieces(shape: DieShape): Piece[] {
  // A cell at unrolled x sits at angle x / R around the axis; from the front it shows at R·sin(angle).
  const wrap = ([x, y]: Point): Point => [CYL_R * Math.sin(x / CYL_R), y];
  const cells = shape.cells.map((cell) => {
    const mid = cell.polygon.reduce((acc, p) => acc + p[0], 0) / cell.polygon.length;
    return { folded: cell.polygon.map(wrap), open: cell.polygon, back: Math.cos(mid / CYL_R) < 0 };
  });
  const caps = shape.regions.map((region) => {
    const cy = region.polygon.reduce((acc, p) => acc + p[1], 0) / region.polygon.length;
    const rim = region.kind === 'self' ? CYL_H / 2 : -CYL_H / 2;
    return { folded: region.polygon.map(([x, y]): Point => [x, rim + (y - cy) * CAP_SQUASH]), open: region.polygon, back: region.kind !== 'self' };
  });
  return [...cells, ...caps];
}

const cache = new Map<string, readonly Piece[]>();

export function piecesOf(shape: DieShape): readonly Piece[] {
  const cached = cache.get(shape.id);
  if (cached) return cached;
  const pieces = shape.unfold === 'net' ? netPieces(shape) : shape.unfold === 'explode' ? explodePieces(shape) : unrollPieces(shape);
  cache.set(shape.id, pieces);
  return pieces;
}

/** The piece's outline `t` of the way from folded (0) to open (1). */
export function morph(piece: Piece, t: number): Point[] {
  return piece.folded.map(([x, y], i) => {
    const [ox, oy] = piece.open[i]!;
    return [x + (ox - x) * t, y + (oy - y) * t];
  });
}
