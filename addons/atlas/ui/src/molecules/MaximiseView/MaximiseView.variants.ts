import { cva } from 'class-variance-authority';

/**
 * The view inside the dialog's scrolling body: the chart box as tall as the
 * body, then the extras the toggles turned on, which add below it and make
 * the body scroll.
 */
export const maximiseViewVariants: (props?: Record<string, never>) => string = cva('flex h-full min-h-0 flex-col gap-3');

/** The chart's box: the body's full height, never squeezed by the extras under it. */
export const maximiseChartVariants: (props?: Record<string, never>) => string = cva('h-full min-h-0 w-full shrink-0');

/** The legend and the table under the chart. */
export const maximiseExtrasVariants: (props?: Record<string, never>) => string = cva('flex shrink-0 flex-col gap-3');

/** The header's controls: the box size, then the toggles. */
export const maximiseControlsVariants: (props?: Record<string, never>) => string = cva('flex flex-wrap items-center gap-2');
