import { cva, type VariantProps } from 'class-variance-authority';

/**
 * A removable token: an active filter, an invited teammate. The one leaf
 * atom with an affordance, the remove button. Always tinted in the
 * accent; the padding tightens on the remove side to balance the round
 * button.
 */
export const chipVariants: (props?: ChipVariantProps) => string = cva(
  'inline-flex items-center gap-[7px] rounded-full border border-series-1/35 bg-series-1/11 text-[12.5px] font-semibold text-ink',
  {
    variants: {
      removable: {
        false: 'px-3 py-[5px]',
        true: 'py-1 pl-[11px] pr-1.5',
      },
    },
    defaultVariants: { removable: false },
  },
);

/** The leading icon slot, in the accent. */
export const chipIconVariants: (props?: Record<string, never>) => string = cva('shrink-0 text-series-1');

/** The round remove button. */
export const chipRemoveVariants: (props?: Record<string, never>) => string = cva(
  'inline-flex size-[17px] shrink-0 items-center justify-center rounded-full bg-series-1/22 text-series-1 hover:bg-series-1/35 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-series-1',
);

/** The variant props `chipVariants` takes. */
export interface ChipVariantProps {
  readonly removable?: boolean | null;
}

/** The variant props, as CVA reads them off the variants function. */
export type ChipVariants = VariantProps<typeof chipVariants>;
