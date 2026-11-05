import type { ReactElement, ReactNode } from 'react';

import { cn } from '@open-tomato/charts';

import { badgeDotVariants, badgeVariants, type BadgeVariants } from './Badge.variants.js';

/** A badge's props: its tone and size, the dot, the children and a layout-only passthrough class. */
export interface BadgeProps extends BadgeVariants {
  /** A leading 6px dot in the tone's colour. */
  readonly dot?: boolean;
  readonly children?: ReactNode;
  /** Layout context from the parent (margin, alignment); never colour or size. */
  readonly className?: string;
}

/** A status pill. */
export function Badge({ tone, size, dot = false, children, className }: BadgeProps): ReactElement {
  return (
    <span className={cn(badgeVariants({ tone, size }), className)}>
      {dot && <span className={badgeDotVariants()} aria-hidden="true" />}
      {children}
    </span>
  );
}
