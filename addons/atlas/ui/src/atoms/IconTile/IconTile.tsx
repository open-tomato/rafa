import type { ReactElement, ReactNode } from 'react';

import { cn } from '@open-tomato/charts';

import { iconTileRingVariants, iconTileVariants, type IconTileVariants } from './IconTile.variants.js';

/** An icon tile's props: the icon, its variants, the pulse and a layout-only passthrough class. */
export interface IconTileProps extends IconTileVariants {
  readonly icon: ReactNode;
  /** A pulsing ring, for a live state; it honours reduced motion. */
  readonly pulse?: boolean;
  /** Layout context from the parent (margin, alignment); never colour or size. */
  readonly className?: string;
}

/** A tinted tile holding one icon. */
export function IconTile({ icon, tone, size, shape, pulse = false, className }: IconTileProps): ReactElement {
  return (
    <span className={cn(iconTileVariants({ tone, size, shape }), className)}>
      {icon}
      {pulse && <span aria-hidden="true" className={iconTileRingVariants()} />}
    </span>
  );
}
