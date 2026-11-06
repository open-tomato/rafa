import { cva } from 'class-variance-authority';

/** The status box that stands in for a chart: loading, empty or failed. */
export const cardStatusVariants: (props?: CardStatusVariantProps) => string = cva(
  'flex min-h-24 flex-col items-center justify-center gap-1 rounded-md px-6 py-4 text-center',
  {
    variants: {
      kind: {
        loading: 'bg-plane/60',
        empty: 'border border-dashed border-grid bg-plane/60',
        error: 'border border-dashed border-critical/50 bg-plane/60',
      },
    },
    defaultVariants: { kind: 'loading' },
  },
);

/** The status line. */
export const cardStatusTitleVariants: (props?: Record<string, never>) => string = cva('flex items-center gap-1.5 text-sm font-medium text-ink-2');

/** The detail under the status line. */
export const cardStatusDetailVariants: (props?: Record<string, never>) => string = cva('text-xs text-muted');

/** What the status says. */
export type CardStatusKind = 'loading' | 'empty' | 'error';

/** The variant props `cardStatusVariants` takes. */
export interface CardStatusVariantProps {
  readonly kind?: CardStatusKind | null;
}
