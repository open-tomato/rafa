import { cva, type VariantProps } from 'class-variance-authority';

/**
 * The section card: the shell a dashboard section or a chart sits in. A
 * bordered surface with an optional header row (title and subtitle on
 * the left, an action slot on the right, a rule under it), an 18px-padded
 * body (`padded: false` for a full-bleed list) and a small footer line
 * with an optional rule above it.
 */
export const sectionCardVariants: (props?: Record<string, never>) => string = cva(
  'flex flex-col overflow-hidden rounded-lg border border-grid bg-surface',
);

/** The header row, ruled below. */
export const sectionCardHeaderVariants: (props?: Record<string, never>) => string = cva(
  'flex items-center justify-between gap-3 border-b border-grid bg-surface px-[18px] py-3.5',
);

/** The title: 15px bold, tight tracking. */
export const sectionCardTitleVariants: (props?: Record<string, never>) => string = cva('text-[15px] font-bold tracking-[-0.01em] text-ink');

/** The subtitle under the title. */
export const sectionCardSubtitleVariants: (props?: Record<string, never>) => string = cva('mt-0.5 text-xs text-muted');

/** The action slot on the right of the header. */
export const sectionCardActionVariants: (props?: Record<string, never>) => string = cva('flex gap-2');

/** The body: padded by default, full-bleed for row lists. */
export const sectionCardBodyVariants: (props?: SectionCardBodyVariantProps) => string = cva('flex-1', {
  variants: {
    padded: {
      false: 'p-0',
      true: 'p-[18px]',
    },
  },
  defaultVariants: { padded: true },
});

/** The footer line: small text, optionally ruled above. */
export const sectionCardFooterVariants: (props?: SectionCardFooterVariantProps) => string = cva('px-[18px] pb-3.5 text-xs text-muted', {
  variants: {
    divider: {
      false: '',
      true: 'border-t border-grid pt-3',
    },
  },
  defaultVariants: { divider: false },
});

/** The variant props `sectionCardBodyVariants` takes. */
export interface SectionCardBodyVariantProps {
  readonly padded?: boolean | null;
}

/** The variant props `sectionCardFooterVariants` takes. */
export interface SectionCardFooterVariantProps {
  readonly divider?: boolean | null;
}

/** The body variants, as CVA reads them off the variants function. */
export type SectionCardBodyVariants = VariantProps<typeof sectionCardBodyVariants>;
