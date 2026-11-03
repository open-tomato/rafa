import type { CardSpan } from '../../contract/schemas.js';

import { cva, type VariantProps } from 'class-variance-authority';

/**
 * The surface every card sits on. `span` places it in a page grid; the
 * base is `relative` so a contained modal can cover the card.
 */
export const cardVariants: (props?: CardVariantProps) => string = cva(
  'relative flex min-w-0 flex-col gap-3 rounded-xl text-ink',
  {
    variants: {
      surface: {
        raised: 'bg-surface shadow-sm ring-1 ring-ring',
        flat: 'bg-surface ring-1 ring-ring',
        sunken: 'bg-plane ring-1 ring-ring',
      },
      span: {
        one: 'col-span-1',
        two: 'col-span-1 md:col-span-2',
        full: 'col-span-full',
      },
      padding: {
        none: 'p-0',
        sm: 'p-3',
        md: 'p-4',
      },
    },
    defaultVariants: { surface: 'raised', span: 'one', padding: 'md' },
  },
);

/** The card's surface treatment. */
export type CardSurface = 'raised' | 'flat' | 'sunken';

/** The card's inner padding. */
export type CardPadding = 'none' | 'sm' | 'md';

/** The variant props `cardVariants` takes. */
export interface CardVariantProps {
  readonly surface?: CardSurface | null;
  readonly span?: CardSpan | null;
  readonly padding?: CardPadding | null;
}

/** The variant props, as CVA reads them off the variants function. */
export type CardVariants = VariantProps<typeof cardVariants>;
