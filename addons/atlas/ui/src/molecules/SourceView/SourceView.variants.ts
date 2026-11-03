import { cva } from 'class-variance-authority';

/** The source view's column: the source line over the table. */
export const sourceViewVariants: (props?: Record<string, never>) => string = cva('flex flex-col gap-2');

/** The source line: where the values come from. */
export const sourceLineVariants: (props?: Record<string, never>) => string = cva('text-[11px] leading-snug text-muted');
