import { cva, type VariantProps } from 'class-variance-authority';

/**
 * A status pill: a state, a priority, a count. Pure content with a tone,
 * a size and an optional leading dot; nothing interactive. It never wraps,
 * because a broken status pill reads wrong.
 */
export const badgeVariants: (props?: BadgeVariantProps) => string = cva(
  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-semibold leading-tight',
  {
    variants: {
      tone: {
        neutral: 'border border-grid bg-surface text-ink-2',
        good: 'bg-good/15 text-good',
        warning: 'bg-warning/20 text-warning',
        critical: 'bg-critical/15 text-critical',
        info: 'bg-series-1/15 text-series-1',
        accent: 'bg-series-1 text-surface',
      },
      size: {
        sm: 'px-2 py-0.5 text-xs',
        md: 'px-2.5 py-1 text-xs',
      },
    },
    defaultVariants: { tone: 'good', size: 'md' },
  },
);

/** The leading dot, in the pill's own colour. */
export const badgeDotVariants: (props?: Record<string, never>) => string = cva('size-1.5 rounded-full bg-current');

/** The pill's tone. */
export type BadgeTone = 'neutral' | 'good' | 'warning' | 'critical' | 'info' | 'accent';

/** The pill's size. */
export type BadgeSize = 'sm' | 'md';

/** The variant props `badgeVariants` takes. */
export interface BadgeVariantProps {
  readonly tone?: BadgeTone | null;
  readonly size?: BadgeSize | null;
}

/** The variant props, as CVA reads them off the variants function. */
export type BadgeVariants = VariantProps<typeof badgeVariants>;
