import type { ReactElement, ReactNode } from 'react';

import { cn } from '@open-tomato/charts';

import { gridVariants, type GridVariants } from './Grid.variants.js';

/** A grid's props: its column and gap variants, the children and a layout-only passthrough class. */
export interface GridProps extends GridVariants {
  readonly children?: ReactNode;
  /** Layout context from the parent (margin, placement); never colour or size. */
  readonly className?: string;
}

/** A grid of cards or tiles; see `gridVariants` for the tracks it lays. */
export function Grid({ cols, gap, children, className }: GridProps): ReactElement {
  return <div className={cn(gridVariants({ cols, gap }), className)}>{children}</div>;
}
