import { cva } from 'class-variance-authority';

/** The reading beside the radar: a column of small text. */
export const balancePanelVariants: (props?: Record<string, never>) => string = cva('flex flex-col gap-3 text-xs');

/** The list of poles. */
export const balancePoleListVariants: (props?: Record<string, never>) => string = cva('flex flex-col gap-1.5');

/** One pole's row: its name on the left, its mean and level on the right. */
export const balancePoleRowVariants: (props?: Record<string, never>) => string = cva('flex items-center justify-between gap-2');

/** A pole's dot and name. */
export const balancePoleNameVariants: (props?: Record<string, never>) => string = cva('flex items-center gap-1.5 text-ink');

/** The dot in the pole's core colour. */
export const balancePoleDotVariants: (props?: BalancePoleDotVariantProps) => string = cva('inline-block size-2.5 shrink-0 rounded-full', {
  variants: {
    tone: {
      'pole-ship-core': 'bg-pole-ship-core',
      'pole-fail-core': 'bg-pole-fail-core',
      'pole-base-core': 'bg-pole-base-core',
    },
  },
});

/** The pole's mean. */
export const balancePoleValueVariants: (props?: Record<string, never>) => string = cva('tabular-nums text-ink-2');

/** The level chip: muted while the pole is as usual. */
export const balanceLevelVariants: (props?: BalanceLevelVariantProps) => string = cva('ml-1 rounded px-1 py-px ring-1 ring-ring', {
  variants: {
    usual: { true: 'text-muted', false: 'text-ink' },
  },
  defaultVariants: { usual: false },
});

/** The box naming the week. */
export const balanceReadingVariants: (props?: Record<string, never>) => string = cva('rounded-lg bg-plane p-2.5');

/** The week's name. */
export const balanceReadingNameVariants: (props?: Record<string, never>) => string = cva('text-sm font-semibold text-ink');

/** The week's text. */
export const balanceReadingTextVariants: (props?: Record<string, never>) => string = cva('mt-0.5 leading-snug text-ink-2');

/** The notes under the reading. */
export const balanceNotesVariants: (props?: Record<string, never>) => string = cva('mt-1.5 flex flex-col gap-1 leading-snug text-ink-2');

/** The level legend: a term and its band per row. */
export const balanceLegendVariants: (props?: Record<string, never>) => string = cva('grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-muted');

/** One legend row, laid out by the grid. */
export const balanceLegendRowVariants: (props?: Record<string, never>) => string = cva('contents');

/** A legend term. */
export const balanceLegendTermVariants: (props?: Record<string, never>) => string = cva('text-ink-2');

/** The closing line on the history. */
export const balanceHistoryVariants: (props?: Record<string, never>) => string = cva('leading-snug text-muted');

/** The pole tones a dot can take. */
export type BalancePoleDotTone = 'pole-ship-core' | 'pole-fail-core' | 'pole-base-core';

/** The variant props `balancePoleDotVariants` takes. */
export interface BalancePoleDotVariantProps {
  readonly tone?: BalancePoleDotTone | null;
}

/** The variant props `balanceLevelVariants` takes. */
export interface BalanceLevelVariantProps {
  readonly usual?: boolean | null;
}
