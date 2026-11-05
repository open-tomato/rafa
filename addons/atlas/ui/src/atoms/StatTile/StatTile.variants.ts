import type { DeltaReading } from './delta.js';

import { cva } from 'class-variance-authority';

/** The tile's row: the reading on the left, the trend at the bottom right. */
export const statTileVariants: (props?: Record<string, never>) => string = cva('flex-row items-end justify-between gap-3');

/** The column holding the label, value, delta and note. */
export const statTileBodyVariants: (props?: Record<string, never>) => string = cva('min-w-0');

/** The label above the value. */
export const statTileLabelVariants: (props?: Record<string, never>) => string = cva('text-xs leading-snug text-ink-2');

/** The value: the lens's hero number is drawn larger. */
export const statTileValueVariants: (props?: StatTileValueVariantProps) => string = cva(
  'mt-1 font-semibold leading-none text-ink tabular-nums',
  {
    variants: {
      hero: { true: 'text-4xl', false: 'text-2xl' },
    },
    defaultVariants: { hero: false },
  },
);

/** The delta line, inked by how it reads. */
export const statTileDeltaVariants: (props?: StatTileDeltaVariantProps) => string = cva(
  'mt-1.5 flex items-center gap-1 text-xs',
  {
    variants: {
      reading: { good: 'text-delta-up', bad: 'text-critical', flat: 'text-muted' },
    },
    defaultVariants: { reading: 'flat' },
  },
);

/** The small note under the delta. */
export const statTileNoteVariants: (props?: Record<string, never>) => string = cva('mt-1 text-[11px] text-muted');

/** The variant props `statTileValueVariants` takes. */
export interface StatTileValueVariantProps {
  readonly hero?: boolean | null;
}

/** The variant props `statTileDeltaVariants` takes. */
export interface StatTileDeltaVariantProps {
  readonly reading?: DeltaReading | null;
}
