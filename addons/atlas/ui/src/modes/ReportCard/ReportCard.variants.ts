import { cva } from 'class-variance-authority';

/** A report card keeps to one printed page and fills its grid row on screen. */
export const reportCardVariants: (props?: Record<string, never>) => string = cva('h-full break-inside-avoid');
