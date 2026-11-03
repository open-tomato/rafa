import type { CardTone, LegendMark } from '../../context/types.js';

import { cva, type VariantProps } from 'class-variance-authority';

/** The legend's list: wrapped items in small secondary ink. */
export const legendVariants: (props?: LegendVariantProps) => string = cva(
  'flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2',
);

/** The variant props `legendVariants` takes (none yet). */
export type LegendVariantProps = Record<string, never>;

/** One legend entry: static text, or a toggle button that strikes through a hidden series. */
export const legendEntryVariants: (props?: LegendEntryVariantProps) => string = cva(
  'flex items-center gap-1.5',
  {
    variants: {
      interactive: {
        true: '-mx-1 rounded px-1 hover:bg-grid/60 focus-visible:outline-2 focus-visible:outline-series-1',
        false: '',
      },
      hidden: {
        true: 'text-muted line-through',
        false: '',
      },
    },
    defaultVariants: { interactive: false, hidden: false },
  },
);

/** The variant props `legendEntryVariants` takes. */
export interface LegendEntryVariantProps {
  readonly interactive?: boolean | null;
  readonly hidden?: boolean | null;
}

/** The mark beside a label: the series tone as a square or a stroke, faded when hidden. */
export const legendMarkVariants: (props?: LegendMarkVariantProps) => string = cva(
  'inline-block shrink-0',
  {
    variants: {
      mark: {
        rect: 'size-2.5 rounded-sm',
        line: 'h-0.5 w-4 rounded-full',
      },
      tone: {
        'series-1': 'bg-series-1',
        'series-2': 'bg-series-2',
        'series-3': 'bg-series-3',
        'series-4': 'bg-series-4',
        'series-5': 'bg-series-5',
        'series-6': 'bg-series-6',
        'series-7': 'bg-series-7',
        'series-8': 'bg-series-8',
        good: 'bg-good',
        warning: 'bg-warning',
        serious: 'bg-serious',
        critical: 'bg-critical',
        'pole-ship': 'bg-pole-ship',
        'pole-ship-core': 'bg-pole-ship-core',
        'pole-fail': 'bg-pole-fail',
        'pole-fail-core': 'bg-pole-fail-core',
        'pole-base': 'bg-pole-base',
        'pole-base-core': 'bg-pole-base-core',
        neutral: 'bg-ink-2',
        muted: 'bg-muted',
      },
      hidden: {
        true: 'opacity-30',
        false: '',
      },
    },
    defaultVariants: { mark: 'rect', tone: 'series-1', hidden: false },
  },
);

/** The variant props `legendMarkVariants` takes. */
export interface LegendMarkVariantProps {
  readonly mark?: LegendMark | null;
  readonly tone?: CardTone | null;
  readonly hidden?: boolean | null;
}

/** The entry variants, as CVA reads them off the variants function. */
export type LegendEntryVariants = VariantProps<typeof legendEntryVariants>;

/** The mark variants, as CVA reads them off the variants function. */
export type LegendMarkVariants = VariantProps<typeof legendMarkVariants>;
