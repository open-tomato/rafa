/**
 * The statistics `rafa effort report --trend` reads its figures through:
 * quantiles, a mean, the outlier line and the Mann-Kendall trend test.
 *
 * Pure over number lists, with no store and no clock, so every figure the
 * trend report prints can be checked by hand against a planted list.
 *
 * ## Why a robust outlier line
 *
 * Task minutes are skewed: most tasks take minutes and a few take half an
 * hour. A mean plus standard deviations is pulled up by those few, so the
 * line would move whenever one long task lands in the baseline. The
 * median absolute deviation (MAD) ignores the tail it measures from, and
 * scaled by {@link MAD_TO_SD} it estimates one standard deviation of a
 * normal distribution, so "median + 3 robust SD" reads as the familiar
 * three-sigma line.
 *
 * ## Why Mann-Kendall
 *
 * The drift question is "does this ratio keep rising across loops in the
 * order they ran", with no claim about how fast or in what shape. The
 * Mann-Kendall test answers exactly that: it counts, over every pair of
 * loops, whether the later one is higher or lower, so one outlier moves
 * the answer by at most its own pairs. {@link MannKendall.tau} is that
 * count as a share of all pairs, from -1 (always falling) to 1 (always
 * rising), and {@link MannKendall.z} is its normal score with the tie
 * correction, read against {@link Z_95}.
 */

/** Scales a median absolute deviation to one normal standard deviation. */
export const MAD_TO_SD = 1.4826;

/** Robust standard deviations above the median the outlier line sits. */
export const OUTLIER_ROBUST_SD = 3;

/** The two-sided normal score of the 5% level. */
export const Z_95 = 1.96;

/** Fewest ordered values the trend test is read on. */
export const MIN_TREND_VALUES = 4;

/** Decimal places a derived figure is rounded to. */
const FIGURE_DECIMALS = 3;

/** Rounds a derived figure so the JSON carries no float noise. */
export function roundFigure(value: number): number {
  return Number(value.toFixed(FIGURE_DECIMALS));
}

/**
 * The value at quantile `p` (0 to 1) by nearest rank over a sorted copy,
 * or null for an empty list. Nearest rank rather than interpolation, so
 * every quantile is a value some session actually had.
 */
export function quantile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.round(p * (sorted.length - 1)));
  return sorted[index] ?? null;
}

/** The arithmetic mean, or null for an empty list. */
export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** The smallest, largest, mean and median of a list, each null when empty. */
export interface Spread {
  min: number | null;
  max: number | null;
  avg: number | null;
  p50: number | null;
}

/** The {@link Spread} of a list, each figure rounded. */
export function spreadOf(values: readonly number[]): Spread {
  const round = (value: number | null): number | null => (value === null
    ? null
    : roundFigure(value));
  return {
    min: round(values.length === 0
      ? null
      : Math.min(...values)),
    max: round(values.length === 0
      ? null
      : Math.max(...values)),
    avg: round(mean(values)),
    p50: round(quantile(values, 0.5)),
  };
}

/**
 * Fewest baseline values the outlier line is drawn from. A handful of
 * sessions, or a run of equal ones, has a MAD of zero, which would put the
 * line on the median and call every longer session an outlier.
 */
export const MIN_OUTLIER_BASELINE = 10;

/**
 * The outlier line of a baseline: its median plus
 * {@link OUTLIER_ROBUST_SD} robust standard deviations, or null for a
 * baseline under {@link MIN_OUTLIER_BASELINE} values. See the module note.
 */
export function outlierLimit(baseline: readonly number[]): number | null {
  if (baseline.length < MIN_OUTLIER_BASELINE) return null;
  const median = quantile(baseline, 0.5);
  if (median === null) return null;

  const mad = quantile(baseline.map((value) => Math.abs(value - median)), 0.5) ?? 0;
  return roundFigure(median + OUTLIER_ROBUST_SD * MAD_TO_SD * mad);
}

/** Which way an ordered series moves, as the test reads it. */
export type TrendDirection = 'rising' | 'falling' | 'no steady trend' | 'too few values';

/** The Mann-Kendall reading of one ordered series. */
export interface MannKendall {
  /** How many values the test read. */
  n: number;
  /** Pairs rising minus pairs falling. */
  s: number;
  /** `s` as a share of all pairs, -1 to 1; null below the minimum. */
  tau: number | null;
  /** The normal score of `s`, tie-corrected; null below the minimum. */
  z: number | null;
  direction: TrendDirection;
}

/** The sign of a difference as -1, 0 or 1. */
function signOf(value: number): number {
  if (value > 0) return 1;
  return value < 0
    ? -1
    : 0;
}

/** The variance of `s` under no trend, less the share tied values remove. */
function varianceOfS(values: readonly number[]): number {
  const n = values.length;
  const ties = new Map<number, number>();
  for (const value of values) ties.set(value, (ties.get(value) ?? 0) + 1);

  let tied = 0;
  for (const count of ties.values()) tied += count * (count - 1) * (2 * count + 5);
  return (n * (n - 1) * (2 * n + 5) - tied) / 18;
}

/**
 * The Mann-Kendall test over values in the order they happened.
 *
 * Below {@link MIN_TREND_VALUES} values, three or fewer, it answers
 * `too few values` with no score. The score carries the usual continuity
 * correction of one, and a direction is named only when it clears
 * {@link Z_95}; four values score at most 1.70, so the first series that
 * can read `rising` or `falling` has five.
 */
export function mannKendall(values: readonly number[]): MannKendall {
  const n = values.length;
  let s = 0;
  for (let i = 0; i < n - 1; i += 1) {
    for (let j = i + 1; j < n; j += 1) s += signOf((values[j] ?? 0) - (values[i] ?? 0));
  }
  if (n < MIN_TREND_VALUES) return { n, s, tau: null, z: null, direction: 'too few values' };

  const variance = varianceOfS(values);
  const corrected = s - signOf(s);
  const z = variance > 0
    ? corrected / Math.sqrt(variance)
    : 0;
  let direction: TrendDirection = 'no steady trend';
  if (z >= Z_95) direction = 'rising';
  if (z <= -Z_95) direction = 'falling';
  return { n, s, tau: roundFigure(s / (n * (n - 1) / 2)), z: roundFigure(z), direction };
}
