import { cva } from 'class-variance-authority';

/** The header row: the titles on the left, the actions on the right. */
export const cardHeaderVariants: (props?: Record<string, never>) => string = cva('flex min-w-0 flex-1 items-start justify-between gap-3');

/** The column holding the title and the subtitle. */
export const cardHeaderTextVariants: (props?: Record<string, never>) => string = cva('min-w-0');

/** The card title: small on a card, larger at full size. */
export const cardTitleVariants: (props?: CardTitleVariantProps) => string = cva(
  'font-semibold text-ink',
  {
    variants: {
      size: { sm: 'text-sm', md: 'text-base' },
    },
    defaultVariants: { size: 'sm' },
  },
);

/** The subtitle: the unit or the period, in one short phrase. */
export const cardSubtitleVariants: (props?: Record<string, never>) => string = cva('text-xs text-muted');

/** The actions slot: extra controls beside the title. */
export const cardHeaderActionsVariants: (props?: Record<string, never>) => string = cva('flex shrink-0 items-center gap-2');

/** The title's size. */
export type CardTitleSize = 'sm' | 'md';

/** The variant props `cardTitleVariants` takes. */
export interface CardTitleVariantProps {
  readonly size?: CardTitleSize | null;
}
