import type { ReactElement } from 'react';

import { cn } from '@open-tomato/charts';

import { skeletonVariants, type SkeletonVariants } from './Skeleton.variants.js';

/** A skeleton's props: its shape, width and height, and a layout-only passthrough class. */
export interface SkeletonProps extends SkeletonVariants {
  /** Layout context from the parent (margin, flex); never colour. */
  readonly className?: string;
}

/** One shimmering placeholder; hidden from assistive technology, which reads the status around it. */
export function Skeleton({ shape, width, height, className }: SkeletonProps): ReactElement {
  return <span aria-hidden="true" className={cn(skeletonVariants({ shape, width, height }), className)} />;
}
