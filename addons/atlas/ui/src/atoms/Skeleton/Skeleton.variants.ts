import { cva, type VariantProps } from 'class-variance-authority';

/**
 * A loading placeholder: a shimmering bar, block or disc in the grid
 * tone. A skeleton is layout filler, so its shape and size are variants
 * here and a card composes them into the outline of what is coming.
 */
export const skeletonVariants: (props?: SkeletonVariantProps) => string = cva(
  'block bg-[linear-gradient(90deg,var(--color-grid)_0%,var(--color-plane)_50%,var(--color-grid)_100%)] bg-[length:800px_100%] animate-shimmer motion-reduce:animate-none',
  {
    variants: {
      shape: {
        line: 'rounded-full',
        block: 'rounded-md',
        circle: 'aspect-square rounded-full',
      },
      width: {
        full: 'w-full',
        wide: 'w-[78%]',
        half: 'w-[55%]',
        short: 'w-[35%]',
        fit: 'w-auto',
      },
      height: {
        line: 'h-3',
        text: 'h-4',
        title: 'h-5',
        value: 'h-9',
        fill: 'h-full',
      },
    },
    defaultVariants: { shape: 'line', width: 'full', height: 'line' },
  },
);

/** The skeleton's shape. */
export type SkeletonShape = 'line' | 'block' | 'circle';

/** The skeleton's width, as a share of its parent. */
export type SkeletonWidth = 'full' | 'wide' | 'half' | 'short' | 'fit';

/** The skeleton's height, by what it stands in for. */
export type SkeletonHeight = 'line' | 'text' | 'title' | 'value' | 'fill';

/** The variant props `skeletonVariants` takes. */
export interface SkeletonVariantProps {
  readonly shape?: SkeletonShape | null;
  readonly width?: SkeletonWidth | null;
  readonly height?: SkeletonHeight | null;
}

/** The variant props, as CVA reads them off the variants function. */
export type SkeletonVariants = VariantProps<typeof skeletonVariants>;
