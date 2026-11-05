import { cva } from 'class-variance-authority';

/** A thin scrollbar in the theme's baseline tone on a clear track, for every pane that scrolls inside a dialog. */
export const THIN_SCROLLBAR = '[scrollbar-color:var(--color-baseline)_transparent] [scrollbar-width:thin]';

/**
 * The native dialog: centred on the page over a dimmed backdrop. `md`,
 * `lg` and `full` are capped 1rem short of the viewport. A `fit-<n>` size
 * is sized by its content and capped at the clearance: the remaining
 * (100 - n) percent of the viewport's smaller side (`vmin`), split over
 * the two sides of each dimension. The content (the maximise view's
 * square box) decides the size under that cap, so the dialog grows
 * sideways or downwards for the extras and never past the clearance.
 */
export const dialogVariants: (props?: DialogVariantProps) => string = cva(
  'm-auto rounded-xl bg-surface p-0 text-ink shadow-xl backdrop:bg-black/40',
  {
    variants: {
      size: {
        'md': 'max-h-[calc(100vh-2rem)] w-[min(32rem,calc(100vw-2rem))]',
        'lg': 'max-h-[calc(100vh-2rem)] w-[min(56rem,calc(100vw-2rem))]',
        'full': 'h-[calc(100vh-2rem)] max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)]',
        'fit-70': 'max-h-[calc(100vh-30vmin)] w-fit max-w-[calc(100vw-30vmin)]',
        'fit-90': 'max-h-[calc(100vh-10vmin)] w-fit max-w-[calc(100vw-10vmin)]',
      },
    },
    defaultVariants: { size: 'md' },
  },
);

/** The column inside the dialog: header, then the body that scrolls. */
export const dialogFrameVariants: (props?: Record<string, never>) => string = cva('flex h-full max-h-[inherit] flex-col gap-3 p-4');

/** The header row: title, then the actions and close. */
export const dialogHeaderVariants: (props?: Record<string, never>) => string = cva('flex items-start justify-between gap-3');

/** The header's end: the dialog's own actions, then close. */
export const dialogHeaderEndVariants: (props?: Record<string, never>) => string = cva('flex flex-wrap items-center justify-end gap-2');

/** The title. */
export const dialogTitleVariants: (props?: Record<string, never>) => string = cva('text-sm font-semibold text-ink');

/** The body, scrolling when it is taller than the dialog, on a thin scrollbar in the theme's baseline tone. */
export const dialogBodyVariants: (props?: Record<string, never>) => string = cva(
  `min-h-0 flex-1 overflow-auto text-xs text-ink-2 ${THIN_SCROLLBAR}`,
);

/** A content-sized dialog kept 30 or 10 percent of the viewport's smaller side clear. */
export type DialogFitSize = 'fit-70' | 'fit-90';

/** How much of the page the dialog takes: a width (`md`, `lg`), the page (`full`), or its content under a clearance (`fit-<n>`). */
export type DialogSize = 'md' | 'lg' | 'full' | DialogFitSize;

/** The variant props `dialogVariants` takes. */
export interface DialogVariantProps {
  readonly size?: DialogSize | null;
}
