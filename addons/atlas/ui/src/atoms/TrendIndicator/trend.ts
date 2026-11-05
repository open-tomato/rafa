import type { TrendDirection } from './TrendIndicator.variants.js';

import { formatterFor } from '@open-tomato/charts';

/** Reads a ratio's direction: positive up, negative down, zero flat. */
export function trendDirection(trend: number): TrendDirection {
  if (trend > 0) return 'up';
  if (trend < 0) return 'down';
  return 'flat';
}

/** A ratio as a signed percentage through the formatting layer: 0.12 → "+12%", -0.3 → "-30%", 0 → "0%". */
export function formatSignedPercent(trend: number, precision = 0): string {
  return formatterFor({ kind: 'percent', signed: true, digits: precision })(trend);
}
