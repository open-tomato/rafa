import type { CardSpan } from '../../contract/schemas.js';

import { cva, type VariantProps } from 'class-variance-authority';

/**
 * The surface every card sits on. `span` places it in a page grid; the
 * base is `relative` so a contained modal can cover the card. `density`
 * is the gap rhythm between the card's rows, and `rounded` its radius.
 */
export const cardVariants: (props?: CardVariantProps) => string = cva(
  'relative flex min-w-0 flex-col text-ink',
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
        lg: 'p-5',
      },
      density: {
        comfortable: 'gap-3',
        compact: 'gap-2',
      },
      rounded: {
        md: 'rounded-md',
        lg: 'rounded-lg',
        xl: 'rounded-xl',
      },
    },
    defaultVariants: { surface: 'raised', span: 'one', padding: 'md', density: 'comfortable', rounded: 'xl' },
  },
);

/** The header slot's row, ruled below; its padding mirrors the card's gap rhythm. */
export const cardHeaderSlotVariants: (props?: CardHeaderSlotVariantProps) => string = cva(
  'flex items-center justify-between border-b border-grid',
  {
    variants: {
      density: {
        comfortable: 'pb-3',
        compact: 'pb-2',
      },
    },
    defaultVariants: { density: 'comfortable' },
  },
);

/** The card's surface treatment. */
export type CardSurface = 'raised' | 'flat' | 'sunken';

/** The card's inner padding. */
export type CardPadding = 'none' | 'sm' | 'md' | 'lg';

/** The gap rhythm between the card's rows. */
export type CardDensity = 'comfortable' | 'compact';

/** The card's corner radius. */
export type CardRounded = 'md' | 'lg' | 'xl';

/** The variant props `cardVariants` takes. */
export interface CardVariantProps {
  readonly surface?: CardSurface | null;
  readonly span?: CardSpan | null;
  readonly padding?: CardPadding | null;
  readonly density?: CardDensity | null;
  readonly rounded?: CardRounded | null;
}

/** The variant props `cardHeaderSlotVariants` takes. */
export interface CardHeaderSlotVariantProps {
  readonly density?: CardDensity | null;
}

/** The variant props, as CVA reads them off the variants function. */
export type CardVariants = VariantProps<typeof cardVariants>;
