import type { CardTone } from '../../context/types.js';

import { cva } from 'class-variance-authority';

/** The sparkline's SVG: the tone sets `color`, and the line and dot paint `currentColor`. */
export const sparklineVariants: (props?: SparklineVariantProps) => string = cva(
  'shrink-0 overflow-visible',
  {
    variants: {
      tone: {
        'series-1': 'text-series-1',
        'series-2': 'text-series-2',
        'series-3': 'text-series-3',
        'series-4': 'text-series-4',
        'series-5': 'text-series-5',
        'series-6': 'text-series-6',
        'series-7': 'text-series-7',
        'series-8': 'text-series-8',
        good: 'text-good',
        warning: 'text-warning',
        serious: 'text-serious',
        critical: 'text-critical',
        'pole-ship': 'text-pole-ship',
        'pole-ship-core': 'text-pole-ship-core',
        'pole-fail': 'text-pole-fail',
        'pole-fail-core': 'text-pole-fail-core',
        'pole-base': 'text-pole-base',
        'pole-base-core': 'text-pole-base-core',
        neutral: 'text-ink-2',
        muted: 'text-muted',
      },
    },
    defaultVariants: { tone: 'muted' },
  },
);

/** The end dot, ringed in the surface colour so it reads over the line. */
export const sparklineDotVariants: (props?: Record<string, never>) => string = cva('stroke-surface');

/** The variant props `sparklineVariants` takes. */
export interface SparklineVariantProps {
  readonly tone?: CardTone | null;
}
