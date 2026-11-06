import { cva } from 'class-variance-authority';

/** The menu's anchor: the trigger, and the list positioned under it. */
export const cardMenuVariants: (props?: Record<string, never>) => string = cva('relative shrink-0');

/** The list of entries, floating over the card under the trigger. */
export const cardMenuListVariants: (props?: Record<string, never>) => string = cva(
  'absolute right-0 top-full z-20 mt-1 min-w-40 rounded-lg bg-surface p-1 text-xs shadow-lg ring-1 ring-ring',
);
