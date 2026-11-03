import { cva } from 'class-variance-authority';

/**
 * The native dialog: centred on the page over a dimmed backdrop. `md`,
 * `lg` and `full` are capped 1rem short of the viewport. A `fit-<n>` size
 * is a square of n% of the viewport's smaller side (`vmin`), so the
 * clearance on each side of the short dimension is half the rest; it
 * lifts the caps, the native one included, so the box stays square.
 */
export const dialogVariants: (props?: DialogVariantProps) => string = cva(
  'm-auto rounded-xl bg-surface p-0 text-ink shadow-xl backdrop:bg-black/40',
  {
    variants: {
      size: {
        'md': 'max-h-[calc(100vh-2rem)] w-[min(32rem,calc(100vw-2rem))]',
        'lg': 'max-h-[calc(100vh-2rem)] w-[min(56rem,calc(100vw-2rem))]',
        'full': 'h-[calc(100vh-2rem)] max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)]',
        'fit-70': 'h-[70vmin] max-h-none w-[70vmin] max-w-none',
        'fit-80': 'h-[80vmin] max-h-none w-[80vmin] max-w-none',
        'fit-90': 'h-[90vmin] max-h-none w-[90vmin] max-w-none',
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

/** The body, scrolling when it is taller than the dialog. */
export const dialogBodyVariants: (props?: Record<string, never>) => string = cva('min-h-0 flex-1 overflow-auto text-xs text-ink-2');

/** A square of 70, 80 or 90 percent of the viewport's smaller side. */
export type DialogFitSize = 'fit-70' | 'fit-80' | 'fit-90';

/** How much of the page the dialog takes: a width (`md`, `lg`), the page (`full`), or a square (`fit-<n>`). */
export type DialogSize = 'md' | 'lg' | 'full' | DialogFitSize;

/** The variant props `dialogVariants` takes. */
export interface DialogVariantProps {
  readonly size?: DialogSize | null;
}
