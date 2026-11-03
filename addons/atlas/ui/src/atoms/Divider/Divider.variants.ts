import { cva, type VariantProps } from 'class-variance-authority';

/**
 * A horizontal rule. Plain, it is one hairline in the grid tone; with a
 * label, two hairlines flank a small uppercase mono label.
 */
export const dividerVariants: (props?: DividerVariantProps) => string = cva('w-full', {
  variants: {
    labeled: {
      false: 'h-px bg-grid',
      true: 'flex items-center gap-3',
    },
  },
  defaultVariants: { labeled: false },
});

/** One of the two hairlines beside the label. */
export const dividerRuleVariants: (props?: Record<string, never>) => string = cva('h-px flex-1 bg-grid');

/** The label between the hairlines. */
export const dividerLabelVariants: (props?: Record<string, never>) => string = cva('font-mono text-[10px] uppercase tracking-[0.1em] text-muted');

/** The variant props `dividerVariants` takes. */
export interface DividerVariantProps {
  readonly labeled?: boolean | null;
}

/** The variant props, as CVA reads them off the variants function. */
export type DividerVariants = VariantProps<typeof dividerVariants>;
