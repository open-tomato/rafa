/**
 * The aggregates over one group's values of one field, with SQL's reading
 * of NULL: `count` counts the values that are not NULL, and every other
 * aggregate leaves NULL out and answers NULL when nothing is left. `min`
 * and `max` order numbers as numbers and anything else as text; `sum`,
 * `mean` and the quantiles read numbers only.
 */
import type { Aggregate, Scalar } from '../contract/types.js';

import { compareCells } from './order.js';
import { nearestRank, QUANTILES } from './quantile.js';

function presentOf(values: readonly Scalar[]): Exclude<Scalar, null>[] {
  return values.filter((value): value is Exclude<Scalar, null> => value !== null);
}

function numbersOf(values: readonly Scalar[]): number[] {
  return values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
}

function extreme(values: readonly Scalar[], dir: 'asc' | 'desc'): Scalar {
  const present = presentOf(values);
  if (present.length === 0) return null;
  return [...present].sort((left, right) => compareCells(left, right, dir))[0] ?? null;
}

function sumOf(values: readonly Scalar[]): number | null {
  const numbers = numbersOf(values);
  return numbers.length === 0
    ? null
    : numbers.reduce((sum, value) => sum + value, 0);
}

function meanOf(values: readonly Scalar[]): number | null {
  const numbers = numbersOf(values);
  return numbers.length === 0
    ? null
    : numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

/** `agg` over `values`, one group's cells of one field. */
export function aggregate(values: readonly Scalar[], agg: Aggregate): Scalar {
  switch (agg) {
    case 'count':
      return presentOf(values).length;
    case 'count_distinct':
      return new Set(presentOf(values)).size;
    case 'sum':
      return sumOf(values);
    case 'mean':
      return meanOf(values);
    case 'min':
      return extreme(values, 'asc');
    case 'max':
      return extreme(values, 'desc');
    case 'p50':
    case 'p90':
    case 'p99':
      return nearestRank(numbersOf(values), QUANTILES[agg]);
  }
}
