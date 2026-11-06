import { cva } from 'class-variance-authority';

/** The scroll box around the table, so a wide table scrolls inside the card. */
export const dataTableVariants: (props?: Record<string, never>) => string = cva('overflow-x-auto');

/** The table itself. */
export const dataTableTableVariants: (props?: Record<string, never>) => string = cva('w-full border-collapse text-xs');

/** The caption, read by assistive technology only. */
export const dataTableCaptionVariants: (props?: Record<string, never>) => string = cva('sr-only');

/** A header cell: the first column is a label, the rest are values aligned right. */
export const dataTableHeadVariants: (props?: DataTableCellVariantProps) => string = cva(
  'border-b border-grid py-1 pr-3 font-medium text-muted',
  {
    variants: {
      align: { start: 'text-left', end: 'text-right' },
    },
    defaultVariants: { align: 'start' },
  },
);

/** A body cell: the label column in ink, value columns right-aligned with tabular figures. */
export const dataTableCellVariants: (props?: DataTableCellVariantProps) => string = cva(
  'py-1 pr-3',
  {
    variants: {
      align: { start: 'text-left text-ink', end: 'text-right text-ink-2 tabular-nums' },
    },
    defaultVariants: { align: 'start' },
  },
);

/** A body row, ruled below except for the last. */
export const dataTableRowVariants: (props?: Record<string, never>) => string = cva('border-b border-grid/60 last:border-0');

/** A sortable header's button, inked while its column leads the sort. */
export const dataTableSortVariants: (props?: DataTableSortVariantProps) => string = cva(
  'inline-flex items-center gap-1 rounded hover:text-ink focus-visible:outline-2 focus-visible:outline-series-1',
  {
    variants: {
      active: { true: 'text-ink', false: '' },
    },
    defaultVariants: { active: false },
  },
);

/** The line under a cut table saying how many rows are not shown. */
export const dataTableFootnoteVariants: (props?: Record<string, never>) => string = cva('pt-1 text-[11px] text-muted');

/** Where a cell's content aligns. */
export type DataTableAlign = 'start' | 'end';

/** The variant props the head and body cell variants take. */
export interface DataTableCellVariantProps {
  readonly align?: DataTableAlign | null;
}

/** The variant props `dataTableSortVariants` takes. */
export interface DataTableSortVariantProps {
  readonly active?: boolean | null;
}
