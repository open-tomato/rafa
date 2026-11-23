import type { BoxGroup } from '@open-tomato/charts';

/** Deterministic pseudo-random numbers, so every engine draws the same data. */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function between(random: () => number, min: number, max: number): number {
  return min + random() * (max - min);
}

/** A log-normal-ish positive value around `median` (task minutes, cycle times). */
export function skewed(random: () => number, median: number, spread = 0.6): number {
  const u = random() || 1e-9;
  const v = random();
  const gaussian = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return median * Math.exp(gaussian * spread);
}

export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.max(1, Math.ceil(q * sorted.length));
  return sorted[rank - 1] ?? 0;
}

/** How many interquartile ranges past the third quartile a value sits to be drawn as an outlier. */
const OUTLIER_FENCE = 1.5;

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * The box statistics of `values`, to one decimal: the quartiles and the
 * median by `quantile`, the whiskers at the smallest and the largest value
 * inside the fence (`OUTLIER_FENCE` interquartile ranges past q3), and
 * every value past it as an outlier. No value gives a box of zeros.
 */
export function boxOf(label: string, values: readonly number[]): BoxGroup {
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const fence = q3 + OUTLIER_FENCE * (q3 - q1);
  const inside = sorted.filter((value) => value <= fence);
  return {
    label,
    min: round1(inside[0] ?? 0),
    q1: round1(q1),
    median: round1(quantile(sorted, 0.5)),
    q3: round1(q3),
    max: round1(inside.at(-1) ?? 0),
    outliers: sorted.filter((value) => value > fence).map(round1),
  };
}
