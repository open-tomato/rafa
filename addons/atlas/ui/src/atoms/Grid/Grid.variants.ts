import { cva, type VariantProps } from 'class-variance-authority';

/**
 * A grid of cards or tiles: a fixed column count, or `auto`, which fills
 * the row with as many 180px-minimum tracks as fit. `GridItem` places the
 * odd child that spans or aligns itself.
 */
export const gridVariants: (props?: GridVariantProps) => string = cva('grid', {
  variants: {
    cols: {
      '1': 'grid-cols-1',
      '2': 'grid-cols-2',
      '3': 'grid-cols-3',
      '4': 'grid-cols-4',
      auto: 'grid-cols-[repeat(auto-fill,minmax(180px,1fr))]',
    },
    gap: {
      sm: 'gap-3',
      md: 'gap-4',
      lg: 'gap-6',
    },
  },
  defaultVariants: { cols: 'auto', gap: 'md' },
});

/** The column count, or `auto` for as many 180px tracks as fit. */
export type GridCols = '1' | '2' | '3' | '4' | 'auto';

/** The gap between tracks. */
export type GridGap = 'sm' | 'md' | 'lg';

/** The variant props `gridVariants` takes. */
export interface GridVariantProps {
  readonly cols?: GridCols | null;
  readonly gap?: GridGap | null;
}

/** The variant props, as CVA reads them off the variants function. */
export type GridVariants = VariantProps<typeof gridVariants>;
