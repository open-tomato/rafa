import { cva } from 'class-variance-authority';

/** The variant props `balanceCardBodyVariants` takes. */
export interface BalanceCardBodyVariantProps {
  readonly fill?: boolean | null;
}

/**
 * The radar and its reading side by side from the md breakpoint, stacked
 * below it. `fill` (the maximise modal) makes the grid as tall as the box,
 * so a radar drawn at `height: 'fill'` has a height to take.
 */
export const balanceCardBodyVariants: (props?: BalanceCardBodyVariantProps) => string = cva('grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(14rem,1fr)]', {
  variants: {
    fill: { true: 'h-full', false: '' },
  },
  defaultVariants: { fill: false },
});

/** The paragraphs of the card's info entry. */
export const balanceInfoVariants: (props?: Record<string, never>) => string = cva('flex flex-col gap-2 leading-snug text-ink-2');
