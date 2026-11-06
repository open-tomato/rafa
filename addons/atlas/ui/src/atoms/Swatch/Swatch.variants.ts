import { cva, type VariantProps } from 'class-variance-authority';

/**
 * A colour chip in one theme tone. The tones are the theme's series,
 * status and pole tokens, so a swatch beside a legend label matches the
 * mark, and a pole's dot matches its core colour on the radar.
 */
export const swatchVariants: (props?: SwatchVariantProps) => string = cva(
  'inline-block shrink-0 ring-1 ring-ring',
  {
    variants: {
      tone: {
        'series-1': 'bg-series-1',
        'series-2': 'bg-series-2',
        'series-3': 'bg-series-3',
        'series-4': 'bg-series-4',
        'series-5': 'bg-series-5',
        'series-6': 'bg-series-6',
        'series-7': 'bg-series-7',
        'series-8': 'bg-series-8',
        good: 'bg-good',
        warning: 'bg-warning',
        serious: 'bg-serious',
        critical: 'bg-critical',
        'pole-ship': 'bg-pole-ship',
        'pole-ship-core': 'bg-pole-ship-core',
        'pole-fail': 'bg-pole-fail',
        'pole-fail-core': 'bg-pole-fail-core',
        'pole-base': 'bg-pole-base',
        'pole-base-core': 'bg-pole-base-core',
      },
      shape: {
        square: 'rounded-sm',
        circle: 'rounded-full',
      },
      size: {
        sm: 'size-2.5',
        md: 'size-3.5',
        lg: 'size-5',
      },
    },
    defaultVariants: { tone: 'series-1', shape: 'square', size: 'md' },
  },
);

/** The tone a swatch paints. */
export type SwatchTone =
  | 'series-1' | 'series-2' | 'series-3' | 'series-4'
  | 'series-5' | 'series-6' | 'series-7' | 'series-8'
  | 'good' | 'warning' | 'serious' | 'critical'
  | 'pole-ship' | 'pole-ship-core' | 'pole-fail' | 'pole-fail-core' | 'pole-base' | 'pole-base-core';

/** The chip's outline: a rounded square for a series or status, a circle for a pole's dot. */
export type SwatchShape = 'square' | 'circle';

/** The swatch's size. */
export type SwatchSize = 'sm' | 'md' | 'lg';

/** The variant props `swatchVariants` takes. */
export interface SwatchVariantProps {
  readonly tone?: SwatchTone | null;
  readonly shape?: SwatchShape | null;
  readonly size?: SwatchSize | null;
}

/** The variant props, as CVA reads them off the variants function. */
export type SwatchVariants = VariantProps<typeof swatchVariants>;
