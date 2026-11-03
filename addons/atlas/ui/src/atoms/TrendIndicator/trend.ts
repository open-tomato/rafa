import type { TrendDirection } from './TrendIndicator.variants.js';

import { DEFAULT_FORMAT_CONTEXT } from '@open-tomato/charts';

/** Reads a ratio's direction: positive up, negative down, zero flat. */
export function trendDirection(trend: number): TrendDirection {
  if (trend > 0) return 'up';
  if (trend < 0) return 'down';
  return 'flat';
}

/** A ratio as a signed percentage: 0.12 → "+12%", -0.3 → "-30%", 0 → "0%". */
export function formatSignedPercent(trend: number, precision = 0): string {
  return new Intl.NumberFormat(DEFAULT_FORMAT_CONTEXT.locale, {
    style: 'percent',
    maximumFractionDigits: precision,
    signDisplay: 'exceptZero',
  }).format(trend);
}
