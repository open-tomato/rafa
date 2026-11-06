import { cva } from 'class-variance-authority';

/** A dashboard card stretches to its grid row, so a row of cards lines up. */
export const dashboardCardVariants: (props?: Record<string, never>) => string = cva('h-full');
