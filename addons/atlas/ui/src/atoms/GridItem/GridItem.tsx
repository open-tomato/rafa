import type { ReactElement, ReactNode } from 'react';

import { cn } from '@open-tomato/charts';

import { gridItemVariants, type GridItemVariants } from './GridItem.variants.js';

/** A grid item's props: its span and alignment, the children and a layout-only passthrough class. */
export interface GridItemProps extends GridItemVariants {
  readonly children?: ReactNode;
  /** Layout context from the parent (margin); never colour or size. */
  readonly className?: string;
}

/** One `Grid` child placed by hand: a span over columns, or its own alignment. */
export function GridItem({ span, align, children, className }: GridItemProps): ReactElement {
  return <div className={cn(gridItemVariants({ span, align }), className)}>{children}</div>;
}
