import { cva, type VariantProps } from 'class-variance-authority';

/**
 * The trend glyph with its optional signed percentage: small mono
 * semibold text, inked good upwards, critical downwards, muted when flat.
 */
export const trendIndicatorVariants: (props?: TrendIndicatorVariantProps) => string = cva(
  'inline-flex items-center gap-0.5 font-mono text-[11px] font-semibold',
  {
    variants: {
      direction: {
        up: 'text-good',
        down: 'text-critical',
        flat: 'text-muted',
      },
    },
    defaultVariants: { direction: 'flat' },
  },
);

/** Which way the trend points. */
export type TrendDirection = 'up' | 'down' | 'flat';

/** The variant props `trendIndicatorVariants` takes. */
export interface TrendIndicatorVariantProps {
  readonly direction?: TrendDirection | null;
}

/** The variant props, as CVA reads them off the variants function. */
export type TrendIndicatorVariants = VariantProps<typeof trendIndicatorVariants>;
