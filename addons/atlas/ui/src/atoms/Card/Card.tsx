import type { ReactElement, ReactNode } from 'react';

import { cn } from '@open-tomato/charts';

import { cardVariants, type CardVariants } from './Card.variants.js';

/** A card's props: its variants, an accessible name, the children and a layout-only passthrough class. */
export interface CardProps extends CardVariants {
  /** Names the card as a region for assistive technology; usually the card title. */
  readonly label?: string;
  readonly children?: ReactNode;
  /** Layout context from the parent (grid placement, margin); never colour or size. */
  readonly className?: string;
}

/** The surface a card's header, chart and modals sit on; a named region when it has a label. */
export function Card({ surface, span, padding, label, children, className }: CardProps): ReactElement {
  return (
    <section aria-label={label} className={cn(cardVariants({ surface, span, padding }), className)}>
      {children}
    </section>
  );
}
