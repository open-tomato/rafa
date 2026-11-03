import { cva } from 'class-variance-authority';

/** A snapshot's place on a printed or exported page: it never splits across a page break. */
export const snapshotCardVariants: (props?: Record<string, never>) => string = cva('break-inside-avoid');
