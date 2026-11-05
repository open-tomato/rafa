/** A point on the sparkline, in SVG user units. */
export interface SparkPoint {
  readonly x: number;
  readonly y: number;
}

/** The polyline points and the last point (the dot), or `null` under two values. */
export interface SparkPath {
  readonly points: string;
  readonly last: SparkPoint;
}

/** Room kept above and below the line so the stroke and the dot are never clipped. */
const INSET = 2;

/** Rounds a coordinate to one decimal, so the markup stays short and stable. */
function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * The sparkline's geometry: `values` spread evenly across `width`, scaled
 * between their own min and max inside `height`. A flat series draws at
 * the bottom inset. Pure, so the server and the tests read the same path.
 */
export function sparkPath(values: readonly number[], width: number, height: number): SparkPath | null {
  if (values.length < 2) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const step = width / (values.length - 1);
  const coordinates = values.map((value, index) => ({
    x: round(index * step),
    y: round(height - INSET - ((value - min) / span) * (height - 2 * INSET)),
  }));
  const last = coordinates[coordinates.length - 1] ?? { x: 0, y: 0 };
  return { points: coordinates.map(({ x, y }) => `${x},${y}`).join(' '), last };
}
