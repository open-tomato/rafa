/**
 * Tests for the trend statistics (`trend-stats.ts`): the quantiles, mean and
 * spread over hand-picked lists, the outlier line against a worked example,
 * and the Mann-Kendall reading against series whose score is computed by hand.
 */
import { describe, expect, it } from 'bun:test';

import {
  MAD_TO_SD,
  mannKendall,
  mean,
  MIN_OUTLIER_BASELINE,
  outlierLimit,
  quantile,
  roundFigure,
  spreadOf,
  Z_95,
} from './trend-stats.js';

describe('roundFigure', () => {
  it('rounds to three decimals', () => {
    expect(roundFigure(1.23456)).toBe(1.235);
    expect(roundFigure(2.0004)).toBe(2);
  });
});

describe('quantile', () => {
  it('answers null for an empty list', () => {
    expect(quantile([], 0.5)).toBeNull();
  });

  it('reads the minimum at 0, the median at 0.5, the p90 at 0.9 and the maximum at 1 by nearest rank', () => {
    const values = [5, 1, 3, 2, 4];

    expect(quantile(values, 0)).toBe(1);
    expect(quantile(values, 0.5)).toBe(3);
    // round(0.9 * 4) = round(3.6) = 4, the fifth value.
    expect(quantile(values, 0.9)).toBe(5);
    expect(quantile(values, 1)).toBe(5);
  });

  it('answers a value the list holds, never an interpolation, and rounds a half rank up', () => {
    // Even length: round(0.5 * 3) = round(1.5) = 2, the third value.
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(3);
    expect(quantile([10, 20], 0.5)).toBe(20);
  });

  it('answers the only value of a one-value list at every p', () => {
    expect(quantile([7], 0)).toBe(7);
    expect(quantile([7], 0.9)).toBe(7);
    expect(quantile([7], 1)).toBe(7);
  });

  it('clamps a p above one to the last value', () => {
    expect(quantile([1, 2, 3], 5)).toBe(3);
  });

  it('leaves the list it reads in its order', () => {
    const values = [3, 1, 2];

    quantile(values, 0.5);

    expect(values).toEqual([3, 1, 2]);
  });

  it('sorts numerically, not as text', () => {
    expect(quantile([10, 9, 100, 1], 1)).toBe(100);
  });
});

describe('mean', () => {
  it('answers null for an empty list', () => {
    expect(mean([])).toBeNull();
  });

  it('answers the arithmetic mean', () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
    expect(mean([-2, 2])).toBe(0);
  });
});

describe('spreadOf', () => {
  it('answers null in every field for an empty list', () => {
    expect(spreadOf([])).toEqual({ min: null, max: null, avg: null, p50: null });
  });

  it('answers the minimum, maximum, mean and median of a list', () => {
    // Sorted 1, 2, 3, 10: the median is the third value by nearest rank.
    expect(spreadOf([3, 1, 2, 10])).toEqual({ min: 1, max: 10, avg: 4, p50: 3 });
  });

  it('rounds the mean to three decimals', () => {
    expect(spreadOf([1, 2, 2]).avg).toBe(1.667);
  });
});

describe('outlierLimit', () => {
  it('answers null for an empty baseline', () => {
    expect(outlierLimit([])).toBeNull();
  });

  it('answers null under the minimum baseline and a limit at it', () => {
    const nine = Array.from({ length: MIN_OUTLIER_BASELINE - 1 }, () => 10);
    const ten = Array.from({ length: MIN_OUTLIER_BASELINE }, () => 10);

    expect(MIN_OUTLIER_BASELINE).toBe(10);
    expect(outlierLimit(nine)).toBeNull();
    expect(outlierLimit(ten)).toBe(10);
  });

  it('answers the median plus three robust SDs, worked by hand', () => {
    // Sorted 10, 10, 11, 11, 12, 12, 12, 13, 13, 50: median is the sixth value, 12.
    // Deviations 2, 2, 1, 1, 0, 0, 0, 1, 1, 38 sort to 0, 0, 0, 1, 1, 1, 1, 2, 2, 38:
    // MAD is the sixth, 1. Limit 12 + 3 * 1.4826 * 1 = 16.4478.
    expect(outlierLimit([10, 12, 11, 13, 50, 12, 11, 10, 13, 12])).toBe(16.448);
    expect(MAD_TO_SD).toBe(1.4826);
  });

  it('is not moved by one long task in the baseline', () => {
    const withFifty = [10, 12, 11, 13, 50, 12, 11, 10, 13, 12];
    const withFiveThousand = [10, 12, 11, 13, 5000, 12, 11, 10, 13, 12];

    expect(outlierLimit(withFiveThousand)).toBe(outlierLimit(withFifty));
  });

  it('answers the median itself when the baseline has no spread', () => {
    expect(outlierLimit(Array.from({ length: 12 }, () => 5))).toBe(5);
  });

  it('does not change the baseline it reads', () => {
    const baseline = [12, 10, 11, 13, 50, 12, 11, 10, 13, 12];

    outlierLimit(baseline);

    expect(baseline).toEqual([12, 10, 11, 13, 50, 12, 11, 10, 13, 12]);
  });
});

describe('mannKendall', () => {
  it('reads a strictly rising series of 8 as rising, with tau 1', () => {
    // s = 28 pairs rising; variance 8 * 7 * 21 / 18 = 65.333; z = 27 / 8.0829.
    const reading = mannKendall([1, 2, 3, 4, 5, 6, 7, 8]);

    expect(reading.direction).toBe('rising');
    expect(reading.n).toBe(8);
    expect(reading.s).toBe(28);
    expect(reading.tau).toBe(1);
    expect(reading.z).toBeCloseTo(27 / Math.sqrt(65.3333333), 2);
    expect(reading.z ?? 0).toBeGreaterThanOrEqual(Z_95);
  });

  it('reads a strictly falling series of 8 as falling, with tau -1', () => {
    const reading = mannKendall([8, 7, 6, 5, 4, 3, 2, 1]);

    expect(reading.direction).toBe('falling');
    expect(reading.s).toBe(-28);
    expect(reading.tau).toBe(-1);
    expect(reading.z ?? 0).toBeLessThanOrEqual(-Z_95);
  });

  it('reads a shuffled series as no steady trend', () => {
    // Per value, later-higher minus later-lower: +5, -4, +5, -4, +3, -2, +1.
    // So 16 pairs rise and 12 fall, s = 4, and z = 3 / 8.0829 is far under 1.96.
    const reading = mannKendall([2, 7, 1, 8, 3, 6, 4, 5]);

    expect(reading.s).toBe(4);
    expect(reading.direction).toBe('no steady trend');
    expect(Math.abs(reading.z ?? 99)).toBeLessThan(Z_95);
  });

  it('reads a flat series as no steady trend with tau 0 and z 0', () => {
    const reading = mannKendall([5, 5, 5, 5, 5]);

    expect(reading).toMatchObject({ n: 5, s: 0, tau: 0, z: 0, direction: 'no steady trend' });
  });

  it('answers too few values, with no tau and no z, below four values', () => {
    expect(mannKendall([1, 2, 3])).toEqual({ n: 3, s: 3, tau: null, z: null, direction: 'too few values' });
    expect(mannKendall([])).toEqual({ n: 0, s: 0, tau: null, z: null, direction: 'too few values' });
    expect(mannKendall([4])).toMatchObject({ tau: null, z: null, direction: 'too few values' });
  });

  it('reads four values, the minimum, but names no direction a line of four cannot clear', () => {
    // s = 6, variance 4 * 3 * 13 / 18 = 8.667, z = 5 / 2.944 = 1.698 < 1.96.
    const reading = mannKendall([1, 2, 3, 4]);

    expect(reading.tau).toBe(1);
    expect(reading.z).toBeCloseTo(1.698, 3);
    expect(reading.direction).toBe('no steady trend');
  });

  it('corrects the variance for tied values', () => {
    // Pairs of 1, 2, 2, 3: five rise, the 2-2 pair is tied, so s = 5 and
    // tau = 5 / 6. Variance (4 * 3 * 13 - 2 * 1 * 9) / 18 = 138 / 18 = 7.667,
    // so z = 4 / 2.769 = 1.445. Without the correction the variance would be
    // 156 / 18 = 8.667 and z 1.359.
    const reading = mannKendall([1, 2, 2, 3]);

    expect(reading.s).toBe(5);
    expect(reading.tau).toBe(0.833);
    expect(reading.z).toBeCloseTo(4 / Math.sqrt(138 / 18), 3);
    expect(reading.z).toBeCloseTo(1.445, 3);
    expect(reading.z).not.toBeCloseTo(4 / Math.sqrt(156 / 18), 2);
  });

  it('applies a continuity correction of one toward zero for a falling score too', () => {
    // [3, 2, 2, 1] mirrors the tied series above: s = -5, z = -4 / sqrt(7.667).
    const reading = mannKendall([3, 2, 2, 1]);

    expect(reading.s).toBe(-5);
    expect(reading.z).toBeCloseTo(-1.445, 3);
  });

  it('reads a constant series of four, every value tied, as z 0', () => {
    // Variance (156 - 4 * 3 * 11) / 18 = 1.333, still positive; s = 0.
    expect(mannKendall([3, 3, 3, 3])).toMatchObject({ s: 0, tau: 0, z: 0, direction: 'no steady trend' });
  });
});
