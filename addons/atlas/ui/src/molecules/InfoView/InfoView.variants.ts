import { cva } from 'class-variance-authority';

/** The info view's column. */
export const infoViewVariants: (props?: Record<string, never>) => string = cva('flex flex-col gap-2 leading-snug text-ink-2');

/** A secondary line: the subtitle, the source. */
export const infoMutedVariants: (props?: Record<string, never>) => string = cva('text-muted');

/** The lead word of the note. */
export const infoLeadVariants: (props?: Record<string, never>) => string = cva('font-medium text-ink');
