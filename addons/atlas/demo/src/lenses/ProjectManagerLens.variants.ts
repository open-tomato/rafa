import { cva } from 'class-variance-authority';

/** The line under the zoomable chart naming the range it shows. */
export const zoomFooterVariants: (props?: Record<string, never>) => string = cva('text-xs text-muted');
