import { cva, type VariantProps } from 'class-variance-authority';

/**
 * The placement of one `Grid` child that breaks the rhythm: it spans
 * columns, or aligns itself in its row. Most children need neither.
 */
export const gridItemVariants: (props?: GridItemVariantProps) => string = cva('', {
  variants: {
    span: {
      '1': 'col-span-1',
      '2': 'col-span-2',
      '3': 'col-span-3',
      full: 'col-span-full',
    },
    align: {
      auto: 'self-auto',
      start: 'self-start',
      center: 'self-center',
      stretch: 'self-stretch',
    },
  },
  defaultVariants: { span: '1', align: 'auto' },
});

/** How many columns the item spans. */
export type GridItemSpan = '1' | '2' | '3' | 'full';

/** How the item aligns in its row. */
export type GridItemAlign = 'auto' | 'start' | 'center' | 'stretch';

/** The variant props `gridItemVariants` takes. */
export interface GridItemVariantProps {
  readonly span?: GridItemSpan | null;
  readonly align?: GridItemAlign | null;
}

/** The variant props, as CVA reads them off the variants function. */
export type GridItemVariants = VariantProps<typeof gridItemVariants>;
