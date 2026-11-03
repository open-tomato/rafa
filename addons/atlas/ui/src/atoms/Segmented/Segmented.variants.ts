import { cva } from 'class-variance-authority';

/** The track the options sit in. */
export const segmentedVariants: (props?: SegmentedVariantProps) => string = cva(
  'inline-flex items-center gap-0.5 rounded-lg bg-grid/60 p-0.5',
  {
    variants: {
      size: { sm: 'text-xs', md: 'text-sm' },
    },
    defaultVariants: { size: 'md' },
  },
);

/** One option: raised on the surface while checked. */
export const segmentedOptionVariants: (props?: SegmentedOptionVariantProps) => string = cva(
  'rounded-md transition-colors focus-visible:outline-2 focus-visible:outline-series-1',
  {
    variants: {
      size: { sm: 'px-2 py-0.5', md: 'px-3 py-1' },
      checked: {
        true: 'bg-surface text-ink shadow-sm ring-1 ring-ring',
        false: 'text-ink-2 hover:text-ink',
      },
    },
    defaultVariants: { size: 'md', checked: false },
  },
);

/** The control's size. */
export type SegmentedSize = 'sm' | 'md';

/** The variant props `segmentedVariants` takes. */
export interface SegmentedVariantProps {
  readonly size?: SegmentedSize | null;
}

/** The variant props `segmentedOptionVariants` takes. */
export interface SegmentedOptionVariantProps {
  readonly size?: SegmentedSize | null;
  readonly checked?: boolean | null;
}
