/**
 * The nearest-rank quantile, the rule rafa-effort's `quantile` keeps: the
 * value at index `Math.min(n - 1, Math.round(p * (n - 1)))` of a sorted
 * copy. Nearest rank rather than interpolation, so every quantile is a
 * value some row actually had.
 */

/** The quantile aggregates and the fraction each one reads. */
export const QUANTILES: Readonly<Record<'p50' | 'p90' | 'p99', number>> = {
  p50: 0.5,
  p90: 0.9,
  p99: 0.99,
};

/** The value at quantile `p` (0 to 1) of `values`, or null for an empty list. */
export function nearestRank(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.round(p * (sorted.length - 1)));
  return sorted[index] ?? null;
}
