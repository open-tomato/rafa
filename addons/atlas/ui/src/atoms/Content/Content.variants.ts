import { cva, type VariantProps } from 'class-variance-authority';

/**
 * A flex stack with its spacing and nothing else: no decoration, no
 * interaction. As a block it fills its parent, so there is no `w-full`.
 */
export const contentVariants: (props?: ContentVariantProps) => string = cva('flex', {
  variants: {
    direction: {
      col: 'flex-col',
      row: 'flex-row',
    },
    gap: {
      none: 'gap-0',
      sm: 'gap-2',
      md: 'gap-3',
      lg: 'gap-4',
      xl: 'gap-6',
    },
    align: {
      start: 'items-start',
      center: 'items-center',
      end: 'items-end',
      stretch: 'items-stretch',
    },
    justify: {
      start: 'justify-start',
      center: 'justify-center',
      between: 'justify-between',
      end: 'justify-end',
    },
    wrap: {
      false: 'flex-nowrap',
      true: 'flex-wrap',
    },
  },
  defaultVariants: { direction: 'col', gap: 'md', align: 'stretch', justify: 'start', wrap: false },
});

/** The stack's direction. */
export type ContentDirection = 'col' | 'row';

/** The gap between children. */
export type ContentGap = 'none' | 'sm' | 'md' | 'lg' | 'xl';

/** The cross-axis alignment. */
export type ContentAlign = 'start' | 'center' | 'end' | 'stretch';

/** The main-axis distribution. */
export type ContentJustify = 'start' | 'center' | 'between' | 'end';

/** The variant props `contentVariants` takes. */
export interface ContentVariantProps {
  readonly direction?: ContentDirection | null;
  readonly gap?: ContentGap | null;
  readonly align?: ContentAlign | null;
  readonly justify?: ContentJustify | null;
  readonly wrap?: boolean | null;
}

/** The variant props, as CVA reads them off the variants function. */
export type ContentVariants = VariantProps<typeof contentVariants>;
