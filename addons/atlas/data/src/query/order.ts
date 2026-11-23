/**
 * The order the engine sorts cells in: NULL after every value in either
 * direction, then booleans, numbers and strings, each by its own rule.
 * Strings compare by code unit, not by locale, so an order never depends on
 * the machine.
 */
import type { Scalar } from '../contract/types.js';

/** Where a cell's type sorts among the others. */
function rankOf(value: Scalar): number {
  if (typeof value === 'boolean') return 0;
  if (typeof value === 'number') return 1;
  return 2;
}

/** Ascending order of two non-null cells. */
function compareValues(left: Exclude<Scalar, null>, right: Exclude<Scalar, null>): number {
  const byRank = rankOf(left) - rankOf(right);
  if (byRank !== 0) return byRank;
  if (left === right) return 0;
  return left < right
    ? -1
    : 1;
}

/** Order two cells in `dir`, with NULL last either way. */
export function compareCells(left: Scalar, right: Scalar, dir: 'asc' | 'desc'): number {
  if (left === null || right === null) {
    if (left === right) return 0;
    return left === null
      ? 1
      : -1;
  }
  const order = compareValues(left, right);
  return dir === 'asc'
    ? order
    : -order;
}
