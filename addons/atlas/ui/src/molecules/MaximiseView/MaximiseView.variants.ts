import type { MaximiseSize } from '../../contract/schemas.js';

import { cva } from 'class-variance-authority';

import { THIN_SCROLLBAR } from '../../atoms/Dialog/Dialog.variants.js';

/** The variant props `maximiseChartVariants` and `maximiseExtrasVariants` take. */
export interface MaximiseSizeVariantProps {
  readonly size?: MaximiseSize | null;
}

/**
 * The view inside the dialog's body: the chart box, then the extras the
 * toggles turned on. On a landscape viewport the extras stand beside the
 * box, so the dialog grows sideways; on a portrait one they go under it,
 * so the dialog grows downwards and its body scrolls past the clearance.
 */
export const maximiseViewVariants: (props?: Record<string, never>) => string = cva('flex min-h-0 flex-col gap-4 landscape:flex-row');

/**
 * The chart's box: a square of the size's share of the viewport's smaller
 * side (medium 70%, large 90%), less the dialog's chrome (its padding,
 * header and gap: 5rem), so the whole dialog is that share tall. The box
 * clips, so a canvas rounded up to the next pixel never gives the body a
 * scrollbar.
 */
export const maximiseChartVariants: (props?: MaximiseSizeVariantProps) => string = cva('shrink-0 overflow-hidden', {
  variants: {
    size: {
      medium: 'size-[calc(70vmin-5rem)]',
      large: 'size-[calc(90vmin-5rem)]',
    },
  },
  defaultVariants: { size: 'medium' },
});

/**
 * The legend and the table: on a landscape viewport a column beside the
 * chart's box, as tall as the box and as wide as its content up to 24rem,
 * giving way (never the box) when the dialog meets its clearance, and
 * scrolling inside on a thin scrollbar; under the box, as tall as it
 * needs, on a portrait one.
 */
export const maximiseExtrasVariants: (props?: MaximiseSizeVariantProps) => string = cva(
  `flex min-h-0 shrink-0 flex-col gap-3 landscape:min-w-0 landscape:max-w-96 landscape:shrink landscape:overflow-auto ${THIN_SCROLLBAR}`,
  {
    variants: {
      size: {
        medium: 'landscape:h-[calc(70vmin-5rem)]',
        large: 'landscape:h-[calc(90vmin-5rem)]',
      },
    },
    defaultVariants: { size: 'medium' },
  },
);

/** The header's controls: the box size, then the toggles. */
export const maximiseControlsVariants: (props?: Record<string, never>) => string = cva('flex flex-wrap items-center gap-2');
