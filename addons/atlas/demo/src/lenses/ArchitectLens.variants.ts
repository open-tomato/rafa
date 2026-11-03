import { cva } from 'class-variance-authority';

/** A paragraph of the halts dialog or an info entry: small, muted. */
export const lensNoteVariants: (props?: Record<string, never>) => string = cva('text-xs leading-snug text-muted');

/** The paragraphs of a rich info entry. */
export const lensInfoVariants: (props?: Record<string, never>) => string = cva('flex flex-col gap-2 leading-snug text-ink-2');

/** The dialog's action row, aligned to the end. */
export const lensActionsVariants: (props?: Record<string, never>) => string = cva('mt-3 flex justify-end gap-2');
