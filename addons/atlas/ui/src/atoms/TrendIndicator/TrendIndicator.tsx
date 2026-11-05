import type { ReactElement } from 'react';

import { cn } from '@open-tomato/charts';
import { ArrowDown, ArrowUp, Minus } from 'lucide-react';

import { formatSignedPercent, trendDirection } from './trend.js';
import { trendIndicatorVariants, type TrendDirection } from './TrendIndicator.variants.js';

/** The glyph's size and stroke, in pixels. */
const GLYPH_SIZE = 11;
const GLYPH_STROKE = 2;

/** A trend indicator's props: the ratio, whether to write it, the flat case, precision and the name. */
export interface TrendIndicatorProps {
  /** A ratio: 0.1 is +10%, -0.3 is -30%, 0 is flat. */
  readonly trend: number;
  /** Write the signed percentage beside the glyph. */
  readonly showValue?: boolean;
  /** Draw the flat state as a dash; `false` renders nothing on a flat trend. */
  readonly showZero?: boolean;
  /** Fraction digits of the written value. */
  readonly precision?: number;
  /** The accessible name; without one it is made from the direction and the value. */
  readonly label?: string;
  /** Layout context from the parent (margin, alignment); never colour or size. */
  readonly className?: string;
}

/** The glyph for a direction. */
function Glyph({ direction }: { readonly direction: TrendDirection }): ReactElement {
  if (direction === 'up') return <ArrowUp size={GLYPH_SIZE} strokeWidth={GLYPH_STROKE} aria-hidden="true" />;
  if (direction === 'down') return <ArrowDown size={GLYPH_SIZE} strokeWidth={GLYPH_STROKE} aria-hidden="true" />;
  return <Minus size={GLYPH_SIZE} strokeWidth={GLYPH_STROKE} aria-hidden="true" />;
}

/** An arrow up, an arrow down or a dash from a ratio, with the signed percentage when asked. */
export function TrendIndicator({ trend, showValue = false, showZero = true, precision, label, className }: TrendIndicatorProps): ReactElement | null {
  const direction = trendDirection(trend);
  if (direction === 'flat' && !showZero) return null;
  const value = formatSignedPercent(trend, precision);
  const name = label ?? (direction === 'flat'
    ? 'no change'
    : `trending ${direction} ${value}`);
  return (
    <span role="img" aria-label={name} className={cn(trendIndicatorVariants({ direction }), className)}>
      <Glyph direction={direction} />
      {showValue && direction !== 'flat' && <span aria-hidden="true">{value}</span>}
    </span>
  );
}
