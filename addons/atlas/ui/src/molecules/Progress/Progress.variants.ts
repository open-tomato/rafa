import { cva, type VariantProps } from 'class-variance-authority';

/**
 * A progress bar: a bordered track on the plane and a rounded fill in a
 * tone. The threshold that turns a fill critical is the caller's
 * decision; the tone is the mechanism. The fill is an SVG rect whose
 * width is the fraction, so no element carries an inline style.
 */
export const progressTrackVariants: (props?: Record<string, never>) => string = cva(
  'block h-2 w-full overflow-hidden rounded-full border border-grid bg-plane',
);

/** The fill, painted `currentColor` in its tone; indeterminate sweeps across the track. */
export const progressBarVariants: (props?: ProgressBarVariantProps) => string = cva('', {
  variants: {
    tone: {
      'series-1': 'text-series-1',
      good: 'text-good',
      warning: 'text-warning',
      critical: 'text-critical',
    },
    indeterminate: {
      false: '',
      true: 'animate-indeterminate motion-reduce:animate-none motion-reduce:opacity-50',
    },
  },
  defaultVariants: { tone: 'series-1', indeterminate: false },
});

/** The fill's tone. */
export type ProgressTone = 'series-1' | 'good' | 'warning' | 'critical';

/** The variant props `progressBarVariants` takes. */
export interface ProgressBarVariantProps {
  readonly tone?: ProgressTone | null;
  readonly indeterminate?: boolean | null;
}

/** The variant props, as CVA reads them off the variants function. */
export type ProgressBarVariants = VariantProps<typeof progressBarVariants>;
