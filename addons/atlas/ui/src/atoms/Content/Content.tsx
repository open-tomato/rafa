import type { ReactElement, ReactNode } from 'react';

import { cn } from '@open-tomato/charts';

import { contentVariants, type ContentVariants } from './Content.variants.js';

/** A content stack's props: its flex variants, the children and a layout-only passthrough class. */
export interface ContentProps extends ContentVariants {
  readonly children?: ReactNode;
  /** Layout context from the parent (margin, placement); never colour or size. */
  readonly className?: string;
}

/** A flex stack: the workhorse that arranges children in a column or a row. */
export function Content({ direction, gap, align, justify, wrap, children, className }: ContentProps): ReactElement {
  return <div className={cn(contentVariants({ direction, gap, align, justify, wrap }), className)}>{children}</div>;
}
