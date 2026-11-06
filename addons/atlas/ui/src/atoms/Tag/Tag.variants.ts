import { cva, type VariantProps } from 'class-variance-authority';

/**
 * A classification label: a model, a tool, an id. Mono for a bare id,
 * the body face when an icon leads a word. Tones tint the fill and the
 * border from the same colour.
 */
export const tagVariants: (props?: TagVariantProps) => string = cva(
  'inline-flex items-center gap-1.5 rounded-sm border px-[9px] py-1 text-[12.5px] font-semibold',
  {
    variants: {
      tone: {
        neutral: 'border-grid bg-surface text-ink-2',
        good: 'border-good/35 bg-good/14 text-good',
        warning: 'border-warning/35 bg-warning/16 text-warning',
        critical: 'border-critical/35 bg-critical/13 text-critical',
        info: 'border-series-1/35 bg-series-1/14 text-series-1',
      },
      mono: {
        false: 'font-sans',
        true: 'font-mono',
      },
    },
    defaultVariants: { tone: 'neutral', mono: true },
  },
);

/** The tag's tone. */
export type TagTone = 'neutral' | 'good' | 'warning' | 'critical' | 'info';

/** The variant props `tagVariants` takes. */
export interface TagVariantProps {
  readonly tone?: TagTone | null;
  readonly mono?: boolean | null;
}

/** The variant props, as CVA reads them off the variants function. */
export type TagVariants = VariantProps<typeof tagVariants>;
