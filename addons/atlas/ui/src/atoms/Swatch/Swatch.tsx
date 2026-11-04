import type { ReactElement } from 'react';

import { cn } from '@open-tomato/charts';

import { swatchVariants, type SwatchVariants } from './Swatch.variants.js';

/** A swatch's props: its variants, the accessible label, and a layout-only passthrough class. */
export interface SwatchProps extends SwatchVariants {
  /** What the colour stands for, read by assistive technology; without it the swatch is decorative, beside text that names it. */
  readonly label?: string;
  /** Layout context from the parent (margin, alignment); never colour or size. */
  readonly className?: string;
}

/** A colour chip in one theme tone: an image named by `label`, or decorative without one. */
export function Swatch({ tone, shape, size, label, className }: SwatchProps): ReactElement {
  const decorative = label === undefined;
  return (
    <span
      role={decorative
        ? undefined
        : 'img'}
      aria-label={label}
      aria-hidden={decorative
        ? 'true'
        : undefined}
      className={cn(swatchVariants({ tone, shape, size }), className)}
    />
  );
}
