/**
 * The board's 2D viewport: world units to screen pixels, y up in the world
 * and down on screen, the way a drawing board's sheet sits under the pen.
 */
export interface Viewport {
  /** Screen position of the world origin. */
  readonly x: number;
  readonly y: number;
  /** Pixels per world unit. */
  readonly k: number;
}

export type Point = readonly [number, number];

export interface Bounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

/** The smallest span a fit works with, so one node alone still gets a sane zoom. */
const MIN_SPAN = 10;
export const MIN_K = 0.2;
export const MAX_K = 80;

export const toScreen = (v: Viewport, [wx, wy]: Point): [number, number] => [v.x + wx * v.k, v.y - wy * v.k];

export const toWorld = (v: Viewport, [sx, sy]: Point): [number, number] => [(sx - v.x) / v.k, (v.y - sy) / v.k];

/** Scales by `factor` and keeps the world point under `cursor` where it is. */
export function zoomAt(v: Viewport, factor: number, cursor: Point): Viewport {
  const k = Math.min(MAX_K, Math.max(MIN_K, v.k * factor));
  const [wx, wy] = toWorld(v, cursor);
  return { x: cursor[0] - wx * k, y: cursor[1] + wy * k, k };
}

/** The viewport that shows `bounds` centred in `box`, leaving `margin` (a share of the box) free. */
export function fitTo(bounds: Bounds, box: { readonly width: number; readonly height: number }, margin: number): Viewport {
  const w = Math.max(MIN_SPAN, bounds.maxX - bounds.minX);
  const h = Math.max(MIN_SPAN, bounds.maxY - bounds.minY);
  const k = Math.min(MAX_K, Math.max(MIN_K, Math.min((box.width * (1 - margin)) / w, (box.height * (1 - margin)) / h)));
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  return { x: box.width / 2 - cx * k, y: box.height / 2 + cy * k, k };
}

/** The bounds of a set of points, or null when there are none. */
export function boundsOf(points: Iterable<Point>): Bounds | null {
  let b: Bounds | null = null;
  for (const [x, y] of points) {
    b = b ? { minX: Math.min(b.minX, x), maxX: Math.max(b.maxX, x), minY: Math.min(b.minY, y), maxY: Math.max(b.maxY, y) } : { minX: x, maxX: x, minY: y, maxY: y };
  }
  return b;
}
