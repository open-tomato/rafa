import { cva } from 'class-variance-authority';

/** The picker's lines of text around the table. */
export const indexPickerTextVariants: (props?: IndexPickerTextVariantProps) => string = cva('text-xs', {
  variants: {
    tone: { muted: 'text-muted', ink: 'text-ink-2' },
  },
  defaultVariants: { tone: 'muted' },
});

/** The table's frame, scrolling sideways on a narrow card. */
export const indexPickerFrameVariants: (props?: Record<string, never>) => string = cva('my-2 overflow-x-auto');

/** The table. */
export const indexPickerTableVariants: (props?: Record<string, never>) => string = cva('w-full text-xs');

/** The caption, for assistive technology only. */
export const indexPickerCaptionVariants: (props?: Record<string, never>) => string = cva('sr-only');

/** The header row. */
export const indexPickerHeadRowVariants: (props?: Record<string, never>) => string = cva('text-left text-muted');

/** A header cell. */
export const indexPickerHeadVariants: (props?: IndexPickerCellVariantProps) => string = cva('border-b border-grid py-1 font-medium', {
  variants: {
    align: { start: 'pr-3', end: 'pr-3 text-right', last: '' },
  },
  defaultVariants: { align: 'start' },
});

/** One index's row: muted while switched off. */
export const indexPickerRowVariants: (props?: IndexPickerRowVariantProps) => string = cva('border-b border-grid/60', {
  variants: {
    on: { true: '', false: 'text-muted' },
  },
  defaultVariants: { on: true },
});

/** A body cell. */
export const indexPickerCellVariants: (props?: IndexPickerCellVariantProps) => string = cva('py-1.5', {
  variants: {
    align: { start: 'pr-3', end: 'pr-3 text-right tabular-nums', last: 'leading-snug' },
    emphasis: { name: 'text-ink', pole: 'whitespace-nowrap', none: '' },
  },
  defaultVariants: { align: 'start', emphasis: 'none' },
});

/** The variant props `indexPickerTextVariants` takes. */
export interface IndexPickerTextVariantProps {
  readonly tone?: 'muted' | 'ink' | null;
}

/** The variant props of the header and body cells. */
export interface IndexPickerCellVariantProps {
  readonly align?: 'start' | 'end' | 'last' | null;
  readonly emphasis?: 'name' | 'pole' | 'none' | null;
}

/** The variant props `indexPickerRowVariants` takes. */
export interface IndexPickerRowVariantProps {
  readonly on?: boolean | null;
}
