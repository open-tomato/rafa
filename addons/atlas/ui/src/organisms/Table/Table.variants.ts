import { cva, type VariantProps } from 'class-variance-authority';

/**
 * The data table with fixed tracks. The structure is the point: the
 * header and the footer are tables of their own outside the scroll
 * element, so only the body scrolls; a 10px gutter, the body's
 * always-shown scrollbar, keeps the three column groups aligned; every
 * table is `table-fixed`, so `<col>` widths hold and a cell can clip.
 */
export const tableFrameVariants: (props?: TableFrameVariantProps) => string = cva('overflow-hidden', {
  variants: {
    frame: {
      true: 'rounded-lg border border-grid bg-surface shadow-xs',
      false: 'rounded-none border-none bg-transparent shadow-none',
    },
  },
  defaultVariants: { frame: true },
});

/** A header or footer band: its own table, gutter-reserved to match the body. */
export const tableBandVariants: (props?: TableBandVariantProps) => string = cva('overflow-hidden bg-plane', {
  variants: {
    edge: {
      header: 'border-b border-baseline',
      footer: 'border-t border-baseline',
    },
    gutter: {
      true: 'pr-[10px]',
      false: 'pr-0',
    },
  },
  defaultVariants: { gutter: false },
});

/** The body wrap: the only scrolling element, its scrollbar always shown. */
export const tableScrollVariants: (props?: TableScrollVariantProps) => string = cva('', {
  variants: {
    layout: {
      fit: 'overflow-visible',
      scroll: 'overflow-x-hidden overflow-y-scroll [scrollbar-color:var(--color-baseline)_transparent] [scrollbar-width:thin]',
    },
  },
  defaultVariants: { layout: 'fit' },
});

/** Every inner table: fixed tracks, collapsed spacing, full width. */
export const tableElementVariants: (props?: Record<string, never>) => string = cva('w-full table-fixed border-separate border-spacing-0');

/** A header cell: small uppercase mono, tinted while its column leads the sort. */
export const tableHeadVariants: (props?: TableHeadVariantProps) => string = cva(
  'whitespace-nowrap text-left font-mono text-[11px] font-semibold uppercase tracking-[0.06em]',
  {
    variants: {
      density: {
        comfortable: 'px-4 py-[11px]',
        compact: 'px-3.5 py-2',
      },
      active: {
        true: 'bg-series-1/12 text-series-1',
        false: 'bg-plane text-muted',
      },
      sortable: {
        true: 'group/head cursor-pointer select-none',
        false: '',
      },
    },
    defaultVariants: { density: 'comfortable', active: false, sortable: false },
  },
);

/** The header cell's inner row: the label and its sort glyph, justified by the column's alignment. */
export const tableHeadLabelVariants: (props?: TableAlignVariantProps) => string = cva('inline-flex w-full items-center gap-[5px]', {
  variants: {
    align: {
      start: 'justify-start',
      center: 'justify-center',
      end: 'justify-end',
    },
  },
  defaultVariants: { align: 'start' },
});

/** The sort glyph: a faint hint that brightens with the header, or the accent arrow while active. */
export const tableSortGlyphVariants: (props?: TableSortGlyphVariantProps) => string = cva('inline-flex', {
  variants: {
    active: {
      true: 'text-series-1',
      false: 'opacity-25 transition-opacity group-hover/head:opacity-100',
    },
  },
  defaultVariants: { active: false },
});

/** A body cell: ruled below except on the last row, washed on row hover. */
export const tableCellVariants: (props?: TableDensityVariantProps) => string = cva(
  'max-w-0 border-b border-grid text-[13.5px] text-ink transition-[background-color] group-last/row:border-b-0 group-hover/row:bg-grid/40',
  {
    variants: {
      density: {
        comfortable: 'px-4 py-[13px]',
        compact: 'px-3.5 py-2',
      },
    },
    defaultVariants: { density: 'comfortable' },
  },
);

/** The block inside a body cell that clips: one line, N lines, or a wrapping flex row. */
export const tableCellContentVariants: (props?: TableCellContentVariantProps) => string = cva('', {
  variants: {
    mode: {
      wrap: 'flex',
      truncate: 'truncate',
      clamp: 'overflow-hidden [display:-webkit-box] [-webkit-box-orient:vertical]',
    },
    align: {
      start: 'justify-start text-left',
      center: 'justify-center text-center',
      end: 'justify-end text-right',
    },
  },
  defaultVariants: { mode: 'wrap', align: 'start' },
});

/** A footer cell: a mono summary on the plane band. */
export const tableFootVariants: (props?: TableFootVariantProps) => string = cva('whitespace-nowrap bg-plane font-mono text-xs text-ink-2', {
  variants: {
    density: {
      comfortable: 'px-4 py-[11px]',
      compact: 'px-3.5 py-2',
    },
    align: {
      start: 'text-left',
      center: 'text-center',
      end: 'text-right',
    },
  },
  defaultVariants: { density: 'comfortable', align: 'start' },
});

/** A body row: striped on even rows, an insert line while a drop hovers it, dimmed while dragged. */
export const tableRowVariants: (props?: TableRowVariantProps) => string = cva('group/row', {
  variants: {
    striped: {
      false: '',
      true: 'even:bg-grid/30',
    },
    drop: {
      none: '',
      above: '[&>td]:shadow-[inset_0_2px_0_0_var(--color-series-1)]',
      below: '[&>td]:shadow-[inset_0_-2px_0_0_var(--color-series-1)]',
    },
    dragging: {
      false: '',
      true: 'opacity-40',
    },
  },
  defaultVariants: { striped: false, drop: 'none', dragging: false },
});

/** A modifier cell (the checkbox or the grip): a narrow leading track with its own padding. */
export const tableModifierCellVariants: (props?: TableDensityVariantProps) => string = cva(
  'border-b border-grid align-middle transition-[background-color] group-last/row:border-b-0 group-hover/row:bg-grid/40',
  {
    variants: {
      density: {
        comfortable: 'py-[13px] pl-3.5 pr-0',
        compact: 'py-2 pl-3 pr-0',
      },
    },
    defaultVariants: { density: 'comfortable' },
  },
);

/** A modifier header cell. */
export const tableModifierHeadVariants: (props?: TableDensityVariantProps) => string = cva('bg-plane align-middle', {
  variants: {
    density: {
      comfortable: 'py-[11px] pl-3.5 pr-0',
      compact: 'py-2 pl-3 pr-0',
    },
  },
  defaultVariants: { density: 'comfortable' },
});

/** The row checkbox: a 19px box, filled in ink while checked or mixed. */
export const tableCheckboxVariants: (props?: TableCheckboxVariantProps) => string = cva('flex border-none bg-transparent p-0', {
  variants: {
    disabled: {
      false: 'cursor-pointer',
      true: 'cursor-not-allowed opacity-40',
    },
  },
  defaultVariants: { disabled: false },
});

/** The checkbox's box. */
export const tableCheckboxBoxVariants: (props?: TableCheckboxBoxVariantProps) => string = cva(
  'mt-px inline-flex size-[19px] shrink-0 items-center justify-center rounded-[5px] border-[1.5px] transition-colors',
  {
    variants: {
      checked: {
        false: 'border-baseline bg-surface',
        true: 'border-ink bg-ink text-surface',
      },
    },
    defaultVariants: { checked: false },
  },
);

/** The grip for row reordering. */
export const tableSortHandleVariants: (props?: TableSortHandleVariantProps) => string = cva(
  'inline-flex cursor-grab select-none items-center justify-center rounded-sm p-0.5 text-muted hover:text-ink-2 active:cursor-grabbing',
  {
    variants: {
      disabled: {
        false: '',
        true: 'cursor-not-allowed opacity-40 hover:text-muted',
      },
    },
    defaultVariants: { disabled: false },
  },
);

/** The clipped-cell tooltip, fixed over the page; its coordinates are measured, so they are set at the site. */
export const tableTipVariants: (props?: Record<string, never>) => string = cva(
  'pointer-events-none fixed z-[100] max-w-[360px] -translate-x-1/2 -translate-y-full rounded-md bg-ink px-[11px] py-2 text-[12.5px] leading-[1.45] text-surface shadow-lg',
);

/** How the body is sized: at its natural height, or capped and scrolling. */
export type TableLayout = 'fit' | 'scroll';

/** The row rhythm. */
export type TableDensity = 'comfortable' | 'compact';

/** How a cell's content aligns. */
export type TableAlign = 'start' | 'center' | 'end';

/** How a cell clips: wrap, one line with a tip, or N lines with a tip. */
export type TableOverflow = 'wrap' | 'truncate' | 'clamp';

/** Where the insert line sits while a drop hovers a row. */
export type TableRowDrop = 'none' | 'above' | 'below';

/** The variant props `tableFrameVariants` takes. */
export interface TableFrameVariantProps {
  readonly frame?: boolean | null;
}

/** The variant props `tableBandVariants` takes. */
export interface TableBandVariantProps {
  readonly edge?: 'header' | 'footer' | null;
  readonly gutter?: boolean | null;
}

/** The variant props `tableScrollVariants` takes. */
export interface TableScrollVariantProps {
  readonly layout?: TableLayout | null;
}

/** The variant props the density-only variants take. */
export interface TableDensityVariantProps {
  readonly density?: TableDensity | null;
}

/** The variant props `tableHeadVariants` takes. */
export interface TableHeadVariantProps extends TableDensityVariantProps {
  readonly active?: boolean | null;
  readonly sortable?: boolean | null;
}

/** The variant props the alignment-only variants take. */
export interface TableAlignVariantProps {
  readonly align?: TableAlign | null;
}

/** The variant props `tableSortGlyphVariants` takes. */
export interface TableSortGlyphVariantProps {
  readonly active?: boolean | null;
}

/** The variant props `tableCellContentVariants` takes. */
export interface TableCellContentVariantProps extends TableAlignVariantProps {
  readonly mode?: TableOverflow | null;
}

/** The variant props `tableFootVariants` takes. */
export interface TableFootVariantProps extends TableDensityVariantProps, TableAlignVariantProps {}

/** The variant props `tableRowVariants` takes. */
export interface TableRowVariantProps {
  readonly striped?: boolean | null;
  readonly drop?: TableRowDrop | null;
  readonly dragging?: boolean | null;
}

/** The variant props `tableCheckboxVariants` takes. */
export interface TableCheckboxVariantProps {
  readonly disabled?: boolean | null;
}

/** The variant props `tableCheckboxBoxVariants` takes. */
export interface TableCheckboxBoxVariantProps {
  readonly checked?: boolean | null;
}

/** The variant props `tableSortHandleVariants` takes. */
export interface TableSortHandleVariantProps {
  readonly disabled?: boolean | null;
}

/** The frame variants, as CVA reads them off the variants function. */
export type TableFrameVariants = VariantProps<typeof tableFrameVariants>;
