import { cva } from 'class-variance-authority';

/** A widget fills the slot the consumer gives it. */
export const widgetCardVariants: (props?: Record<string, never>) => string = cva('h-full');
