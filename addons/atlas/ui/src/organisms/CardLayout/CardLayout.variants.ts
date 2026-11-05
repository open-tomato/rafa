import { cva } from 'class-variance-authority';

/** The top row: the header slot, then the menu in the corner. */
export const cardLayoutTopVariants: (props?: Record<string, never>) => string = cva('flex items-start gap-2');

/** The header slot, taking the row's free width. */
export const cardLayoutHeaderVariants: (props?: Record<string, never>) => string = cva('flex min-w-0 flex-1');

/** The content slot: the chart, filling what the card has left. */
export const cardLayoutContentVariants: (props?: CardLayoutContentVariantProps) => string = cva(
  'min-h-0 min-w-0 flex-1',
  {
    variants: {
      maximised: { true: 'h-full', false: '' },
    },
    defaultVariants: { maximised: false },
  },
);

/** The footer slot: a ruled line of small print. */
export const cardLayoutFooterVariants: (props?: Record<string, never>) => string = cva('border-t border-grid pt-2 text-[11px] text-muted');

/** The variant props `cardLayoutContentVariants` takes. */
export interface CardLayoutContentVariantProps {
  readonly maximised?: boolean | null;
}
