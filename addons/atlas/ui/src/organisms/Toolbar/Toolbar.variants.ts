import { cva, type VariantProps } from 'class-variance-authority';

/**
 * The toolbar over a table: a controls band (search, filter dropdowns, a
 * density switch) and a summary band (the count, the active-filter chips,
 * clear all). It owns the query, never the data: the parent derives the
 * rows and the table stays a pure function of them. Detached, the
 * toolbar and the table each own a frame; attached, this surface owns
 * the frame and the table renders `frame={false}` inside it, under a
 * divided summary.
 */
export const toolbarVariants: (props?: Record<string, never>) => string = cva('overflow-hidden rounded-lg border border-grid bg-surface shadow-xs');

/** The controls band, on the plane. */
export const toolbarControlsVariants: (props?: Record<string, never>) => string = cva('flex flex-wrap items-center gap-2.5 border-b border-grid bg-plane px-4 py-[13px]');

/** The summary band: the count, the chips, clear all; ruled below when a table follows inside. */
export const toolbarSummaryVariants: (props?: ToolbarSummaryVariantProps) => string = cva('flex flex-wrap items-center gap-2 px-4 py-[11px]', {
  variants: {
    divided: {
      false: 'border-b-0',
      true: 'border-b border-grid',
    },
  },
  defaultVariants: { divided: false },
});

/** The vertical hairline between control clusters. */
export const toolbarSeparatorVariants: (props?: Record<string, never>) => string = cva('mx-0.5 w-px self-stretch bg-grid');

/** The count in the summary band. */
export const toolbarCountVariants: (props?: Record<string, never>) => string = cva('font-mono text-xs font-semibold text-ink');

/** The noun after the count. */
export const toolbarNounVariants: (props?: Record<string, never>) => string = cva('text-[12.5px] text-muted');

/** The short hairline between the count and the chips. */
export const toolbarSummaryRuleVariants: (props?: Record<string, never>) => string = cva('mx-1 h-4 w-px bg-grid');

/** The filter trigger: tinted in the accent while any value is selected. */
export const filterTriggerVariants: (props?: FilterTriggerVariantProps) => string = cva(
  'inline-flex h-[38px] cursor-pointer items-center gap-2 rounded-md border px-3 text-[13.5px] font-semibold focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-series-1',
  {
    variants: {
      active: {
        false: 'border-baseline bg-surface text-ink [&_svg]:text-muted',
        true: 'border-series-1/40 bg-series-1/12 text-series-1 [&_svg]:text-series-1',
      },
    },
    defaultVariants: { active: false },
  },
);

/** The count badge on an active filter trigger. */
export const filterCountVariants: (props?: Record<string, never>) => string = cva(
  'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-series-1 px-[5px] font-mono text-[11px] font-bold text-surface',
);

/** The filter's anchor: the trigger and the panel under it. */
export const filterDropdownVariants: (props?: Record<string, never>) => string = cva('relative');

/** The panel of options, 224px wide, floating under the trigger. */
export const filterPanelVariants: (props?: Record<string, never>) => string = cva(
  'absolute left-0 top-full z-20 mt-1 w-56 rounded-lg bg-surface p-1 text-[13.5px] shadow-lg ring-1 ring-ring',
);

/** One option row: its label on the left, the check box on the right. */
export const filterOptionVariants: (props?: Record<string, never>) => string = cva(
  'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-ink hover:bg-grid/60 focus-visible:bg-grid/60 focus-visible:outline-none',
);

/** The option's label with its swatch. */
export const filterOptionLabelVariants: (props?: Record<string, never>) => string = cva('inline-flex items-center gap-2');

/** The option's check box, filled in the accent while on. */
export const filterCheckVariants: (props?: FilterCheckVariantProps) => string = cva(
  'inline-flex size-[17px] shrink-0 items-center justify-center rounded-[5px] border-[1.5px] transition-colors',
  {
    variants: {
      on: {
        false: 'border-baseline bg-transparent',
        true: 'border-series-1 bg-series-1 text-surface',
      },
    },
    defaultVariants: { on: false },
  },
);

/** The rule above the clear entry. */
export const filterRuleVariants: (props?: Record<string, never>) => string = cva('my-1 h-px bg-grid');

/** The search field's wrap: the icon, the input and the clear button over each other. */
export const searchFieldVariants: (props?: Record<string, never>) => string = cva('relative flex min-w-[190px] flex-[1_1_230px] items-center');

/** The search icon, pinned left. */
export const searchIconVariants: (props?: Record<string, never>) => string = cva('pointer-events-none absolute left-3 text-muted');

/** The search input, with room for its clear button when there is text. */
export const searchInputVariants: (props?: SearchInputVariantProps) => string = cva(
  'h-[38px] w-full rounded-md border border-baseline bg-surface text-sm text-ink outline-none placeholder:text-muted focus-visible:border-series-1 focus-visible:ring-2 focus-visible:ring-series-1/40',
  {
    variants: {
      clearable: {
        false: 'pl-9 pr-3',
        true: 'px-9',
      },
    },
    defaultVariants: { clearable: false },
  },
);

/** The clear button, pinned right. */
export const searchClearVariants: (props?: Record<string, never>) => string = cva(
  'absolute right-2 inline-flex size-6 items-center justify-center rounded-sm text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-series-1',
);

/** The variant props `toolbarSummaryVariants` takes. */
export interface ToolbarSummaryVariantProps {
  readonly divided?: boolean | null;
}

/** The variant props `filterTriggerVariants` takes. */
export interface FilterTriggerVariantProps {
  readonly active?: boolean | null;
}

/** The variant props `filterCheckVariants` takes. */
export interface FilterCheckVariantProps {
  readonly on?: boolean | null;
}

/** The variant props `searchInputVariants` takes. */
export interface SearchInputVariantProps {
  readonly clearable?: boolean | null;
}

/** The summary variants, as CVA reads them off the variants function. */
export type ToolbarSummaryVariants = VariantProps<typeof toolbarSummaryVariants>;
