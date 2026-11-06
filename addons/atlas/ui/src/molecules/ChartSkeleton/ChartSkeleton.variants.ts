import { cva, type VariantProps } from 'class-variance-authority';

/**
 * The outline a card shows in place of its chart while the data loads:
 * one shape per chart family, drawn from skeleton atoms in the chart's
 * box so nothing jumps when the chart arrives.
 */
export const chartSkeletonVariants: (props?: Record<string, never>) => string = cva('flex w-full flex-col justify-end');

/** The bars family: a row of bars of varied heights, bottoms aligned. */
export const chartSkeletonBarsVariants: (props?: Record<string, never>) => string = cva('flex h-full items-end gap-2 px-2');

/** One bar, at one of five heights. */
export const chartSkeletonBarVariants: (props?: ChartSkeletonBarVariantProps) => string = cva('flex-1', {
  variants: {
    level: {
      '1': 'h-[30%]',
      '2': 'h-[48%]',
      '3': 'h-[62%]',
      '4': 'h-[80%]',
      '5': 'h-[95%]',
    },
  },
  defaultVariants: { level: '3' },
});

/** The line family: a faint stroke over the box. */
export const chartSkeletonLineVariants: (props?: Record<string, never>) => string = cva('h-full w-full text-grid');

/** The ring family: a disc with a hole, centred. */
export const chartSkeletonRingVariants: (props?: Record<string, never>) => string = cva(
  'mx-auto aspect-square h-full max-w-full animate-pulse rounded-full border-[22px] border-grid motion-reduce:animate-none',
);

/** The rows family: table rows, each a short, a long and a short line. */
export const chartSkeletonRowsVariants: (props?: Record<string, never>) => string = cva('flex h-full flex-col justify-around gap-3');

/** One row. */
export const chartSkeletonRowVariants: (props?: Record<string, never>) => string = cva('flex items-center gap-3');

/** The tile family: a title line, a value block and a trend block, as a stat tile lays them. */
export const chartSkeletonTileVariants: (props?: Record<string, never>) => string = cva('flex h-full flex-col justify-between gap-2');

/** The status text, read by assistive technology only. */
export const chartSkeletonLabelVariants: (props?: Record<string, never>) => string = cva('sr-only');

/** The variant props `chartSkeletonBarVariants` takes. */
export interface ChartSkeletonBarVariantProps {
  readonly level?: '1' | '2' | '3' | '4' | '5' | null;
}

/** The bar variants, as CVA reads them off the variants function. */
export type ChartSkeletonBarVariants = VariantProps<typeof chartSkeletonBarVariants>;
