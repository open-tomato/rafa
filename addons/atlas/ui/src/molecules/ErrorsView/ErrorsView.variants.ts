import { cva } from 'class-variance-authority';

/** The errors view's column. */
export const errorsViewVariants: (props?: Record<string, never>) => string = cva('flex flex-col items-start gap-2 leading-snug');

/** The error's name and message. */
export const errorsMessageVariants: (props?: Record<string, never>) => string = cva('font-medium text-critical');

/** The stack, in a scrolling preformatted block. */
export const errorsStackVariants: (props?: Record<string, never>) => string = cva(
  'max-h-48 w-full overflow-auto whitespace-pre-wrap rounded-md bg-plane p-2 text-[10px] text-muted',
);
