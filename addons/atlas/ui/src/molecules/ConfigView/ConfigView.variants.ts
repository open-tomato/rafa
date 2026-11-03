import { cva } from 'class-variance-authority';

/** The form's column. */
export const configFormVariants: (props?: Record<string, never>) => string = cva('flex flex-col gap-3');

/** One field: its label above its control. */
export const configFieldVariants: (props?: Record<string, never>) => string = cva('flex flex-col gap-1');

/** A field's label. */
export const configLabelVariants: (props?: Record<string, never>) => string = cva('text-xs font-medium text-ink');

/** A text input, a text area or a select, ringed red when invalid. */
export const configControlVariants: (props?: ConfigControlVariantProps) => string = cva(
  'w-full rounded-md bg-surface px-2 py-1 text-xs text-ink ring-1 focus-visible:outline-2 focus-visible:outline-series-1',
  {
    variants: {
      invalid: { true: 'ring-critical', false: 'ring-ring' },
    },
    defaultVariants: { invalid: false },
  },
);

/** A field's error line. */
export const configErrorVariants: (props?: Record<string, never>) => string = cva('text-[11px] text-critical');

/** The row of form actions. */
export const configActionsVariants: (props?: Record<string, never>) => string = cva('flex items-center justify-end gap-2');

/** The variant props `configControlVariants` takes. */
export interface ConfigControlVariantProps {
  readonly invalid?: boolean | null;
}
