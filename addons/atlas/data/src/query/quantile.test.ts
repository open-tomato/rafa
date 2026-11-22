/**
 * Tests for `quantile.ts`: the nearest-rank index rule rafa-effort's
 * `quantile` keeps, over an unsorted list left as it was.
 */
import { describe, expect, it } from 'bun:test';

import { nearestRank, QUANTILES } from './quantile.js';

describe('nearestRank', () => {
  it('reads index round(p * (n - 1)) of a sorted copy', () => {
    const values = [10, 3, 7, 1, 9, 2, 8, 4, 6, 5];

    expect(nearestRank(values, QUANTILES.p50)).toBe(6);
    expect(nearestRank(values, QUANTILES.p90)).toBe(9);
    expect(nearestRank(values, QUANTILES.p99)).toBe(10);
    expect(values).toEqual([10, 3, 7, 1, 9, 2, 8, 4, 6, 5]);
  });

  it('answers the one value of a single list and null for an empty one', () => {
    expect(nearestRank([4], QUANTILES.p90)).toBe(4);
    expect(nearestRank([], QUANTILES.p50)).toBeNull();
  });
});
