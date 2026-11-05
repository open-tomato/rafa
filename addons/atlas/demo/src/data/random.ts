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
