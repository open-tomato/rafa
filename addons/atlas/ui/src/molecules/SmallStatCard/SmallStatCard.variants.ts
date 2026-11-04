import type { DeltaReading } from '../../atoms/StatTile/delta.js';

import { cva, type VariantProps } from 'class-variance-authority';

/**
 * The small stat card: an at-a-glance number on a bordered surface. Its
 * rows, top to bottom: the mono uppercase title with the trend or a
 * decoration on the right; the value row, where the big number and its
 * suffix sit in one column and the `aside` graphic (a sparkline) in the
 * other, so a long delta line under them keeps the whole width and never
 * breaks; and a bottom block, the delta line and the footer (a progress
 * bar, a link, a note), pinned to the card's floor. The value row takes
 * the slack between the head and the bottom block, so tiles in a row keep
 * their text at the same heights. 18px padding, 8px gap, 130px minimum
 * height at `md`; `sm` sets none.
 */
export const smallStatCardVariants: (props?: SmallStatCardVariantProps) => string = cva(
  'relative flex flex-col gap-2 overflow-hidden rounded-lg border border-grid bg-surface p-[18px] text-ink',
  {
    variants: {
      size: {
        md: 'min-h-[130px]',
        sm: 'min-h-0',
      },
    },
    defaultVariants: { size: 'md' },
  },
);

/** The top row: the title left, the trend or decoration right. */
export const smallStatCardHeadVariants: (props?: Record<string, never>) => string = cva('flex items-center justify-between gap-2');

/** The title: small uppercase mono. */
export const smallStatCardTitleVariants: (props?: Record<string, never>) => string = cva('font-mono text-[10px] uppercase tracking-[0.1em] text-muted');

/** The body between the head and the bottom block: it takes the slack, so the bottom block sits on the card's floor whatever the row's height. */
export const smallStatCardBodyVariants: (props?: Record<string, never>) => string = cva('flex-1');

/** The value row: the number column and the aside column, bottoms aligned. */
export const smallStatCardRowVariants: (props?: Record<string, never>) => string = cva('flex items-end justify-between gap-3');

/** The number column: the value and its suffix on one baseline. */
export const smallStatCardValueVariants: (props?: Record<string, never>) => string = cva('flex min-w-0 items-baseline gap-1.5');

/** The number itself, bold and tight; never broken across lines. */
export const smallStatCardNumberVariants: (props?: SmallStatCardVariantProps) => string = cva(
  'whitespace-nowrap font-bold leading-none tracking-[-0.02em] text-ink',
  {
    variants: {
      size: {
        md: 'text-4xl',
        sm: 'text-[26px]',
      },
    },
    defaultVariants: { size: 'md' },
  },
);

/** The `/ goal` and unit suffix: small mono, greyed. */
export const smallStatCardSuffixVariants: (props?: Record<string, never>) => string = cva('whitespace-nowrap font-mono text-[13px] text-muted');

/** The aside column beside the value: a graphic that keeps its size. */
export const smallStatCardAsideVariants: (props?: Record<string, never>) => string = cva('shrink-0');

/** The delta line under the value row, the whole width, inked by how it reads. */
export const smallStatCardDeltaVariants: (props?: SmallStatCardDeltaVariantProps) => string = cva(
  'flex items-center gap-1 text-xs',
  {
    variants: {
      reading: { good: 'text-delta-up', bad: 'text-critical', flat: 'text-muted' },
    },
    defaultVariants: { reading: 'flat' },
  },
);

/** The bottom block: the delta line and the footer, pinned to the card's floor. */
export const smallStatCardBottomVariants: (props?: Record<string, never>) => string = cva('mt-auto flex flex-col gap-1');

/** The footer line: a progress bar, a link, a note. */
export const smallStatCardFooterVariants: (props?: Record<string, never>) => string = cva('text-xs text-muted');

/** The tile's scale. */
export type SmallStatCardSize = 'md' | 'sm';

/** The variant props `smallStatCardVariants` and `smallStatCardNumberVariants` take. */
export interface SmallStatCardVariantProps {
  readonly size?: SmallStatCardSize | null;
}

/** The variant props `smallStatCardDeltaVariants` takes. */
export interface SmallStatCardDeltaVariantProps {
  readonly reading?: DeltaReading | null;
}

/** The variant props, as CVA reads them off the variants function. */
export type SmallStatCardVariants = VariantProps<typeof smallStatCardVariants>;
