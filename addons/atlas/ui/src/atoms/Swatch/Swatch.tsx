import type { ReactElement } from 'react';

import { cn } from '@open-tomato/charts';

import { swatchVariants, type SwatchVariants } from './Swatch.variants.js';

/** A swatch's props: its variants, the accessible label, and a layout-only passthrough class. */
export interface SwatchProps extends SwatchVariants {
  /** What the colour stands for, read by assistive technology. */
  readonly label: string;
  /** Layout context from the parent (margin, alignment); never colour or size. */
  readonly className?: string;
}

/** A colour chip in one theme tone, labelled for assistive technology. */
export function Swatch({ tone, size, label, className }: SwatchProps): ReactElement {
  return <span role="img" aria-label={label} className={cn(swatchVariants({ tone, size }), className)} />;
}
