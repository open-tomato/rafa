import { cva } from 'class-variance-authority';

/** The page column. */
export const shellVariants: (props?: Record<string, never>) => string = cva('mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6');

/** The header row: the title on the left, the controls on the right. */
export const shellHeaderVariants: (props?: Record<string, never>) => string = cva('flex flex-wrap items-center justify-between gap-3');

/** The page title. */
export const shellTitleVariants: (props?: Record<string, never>) => string = cva('text-lg font-semibold');

/** The line under the title. */
export const shellSubtitleVariants: (props?: Record<string, never>) => string = cva('text-xs text-muted');

/** The controls: range, lens tabs and theme. */
export const shellControlsVariants: (props?: Record<string, never>) => string = cva('flex flex-wrap items-center gap-2');

/** The lens tab list, drawn as one pill. */
export const lensTabsVariants: (props?: Record<string, never>) => string = cva('inline-flex items-center gap-0.5 rounded-lg bg-grid/60 p-0.5');

/** One lens tab: an icon, raised while selected. */
export const lensTabVariants: (props?: LensTabVariantProps) => string = cva(
  'rounded-md px-2.5 py-1 transition-colors focus-visible:outline-2 focus-visible:outline-series-1',
  {
    variants: {
      selected: {
        true: 'bg-surface text-ink shadow-sm ring-1 ring-ring',
        false: 'text-ink-2 hover:text-ink',
      },
    },
    defaultVariants: { selected: false },
  },
);

/** The variant props `lensTabVariants` takes. */
export interface LensTabVariantProps {
  readonly selected?: boolean | null;
}
