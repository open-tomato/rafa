/**
 * The summary numbers every reading reports over a list of minutes: the
 * count, the sum, the mean and two nearest-rank percentiles.
 *
 * @module bundled/operators/scripts/stats
 */

/** One list of minutes, summarised. */
export interface Summary {
  readonly count: number;
  readonly sum: number;
  readonly mean: number;
  readonly p50: number;
  readonly p90: number;
}

/** Rounds to one decimal. */
export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** The nearest-rank percentile `p` (0 to 100) of sorted `values`. */
function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));

  return sorted[rank - 1] ?? 0;
}

/** The median of sorted `values`: the mean of the two middle ones when even. */
function median(sorted: readonly number[]): number {
  if (sorted.length === 0) {
    return 0;
  }
  const mid = Math.floor(sorted.length / 2);
  const upper = sorted[mid] ?? 0;

  return sorted.length % 2 === 1
    ? upper
    : ((sorted[mid - 1] ?? 0) + upper) / 2;
}

/** Summarises `values`; an empty list summarises to zeros. */
export function summarise(values: readonly number[]): Summary {
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((total, value) => total + value, 0);

  return {
    count: sorted.length,
    sum: round1(sum),
    mean: sorted.length === 0
      ? 0
      : round1(sum / sorted.length),
    p50: round1(median(sorted)),
    p90: round1(percentile(sorted, 90)),
  };
}
