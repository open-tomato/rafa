import { cva } from 'class-variance-authority';

/** The contained modal: a panel over the card's own area, inside its ring. */
export const cardModalVariants: (props?: Record<string, never>) => string = cva(
  'absolute inset-2 z-10 flex flex-col gap-2 rounded-lg bg-surface/95 p-3 text-xs ring-1 ring-ring backdrop-blur-sm',
);

/** The modal's header row: title and close. */
export const cardModalHeaderVariants: (props?: Record<string, never>) => string = cva('flex items-start justify-between gap-3');

/** The header's end: the modal's own actions, then close. */
export const cardModalHeaderEndVariants: (props?: Record<string, never>) => string = cva('flex flex-wrap items-center justify-end gap-2');

/** The modal's title. */
export const cardModalTitleVariants: (props?: Record<string, never>) => string = cva('text-sm font-semibold text-ink');

/** The modal's body, scrolling inside the card. */
export const cardModalBodyVariants: (props?: Record<string, never>) => string = cva('min-h-0 flex-1 overflow-auto leading-snug text-ink-2');
