import { cva } from 'class-variance-authority';

/** The range selector's place in a page toolbar; it paints nothing of its own. */
export const rangeSelectorVariants: (props?: Record<string, never>) => string = cva('shrink-0');
