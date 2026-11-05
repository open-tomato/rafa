import type { ReactElement, ReactNode } from 'react';

import { cn } from '@open-tomato/charts';

import {
  cardHeaderActionsVariants,
  cardHeaderTextVariants,
  cardHeaderVariants,
  cardSubtitleVariants,
  cardTitleVariants,
  type CardTitleSize,
} from './CardHeader.variants.js';

/** A card header's props: the title, a subtitle, and the actions slot. */
export interface CardHeaderProps {
  readonly title: string;
  /** The unit or the period, in one short phrase. */
  readonly subtitle?: string;
  /** Extra controls beside the title: a picker, a zoom reset. */
  readonly actions?: ReactNode;
  readonly size?: CardTitleSize;
  /** The title's element id, for a container that names itself by it. */
  readonly titleId?: string;
  /** Layout context from the parent; never colour or size. */
  readonly className?: string;
}

/** The top of a card: title and subtitle on the left, the actions slot on the right. */
export function CardHeader({ title, subtitle, actions, size, titleId, className }: CardHeaderProps): ReactElement {
  return (
    <header className={cn(cardHeaderVariants(), className)}>
      <div className={cardHeaderTextVariants()}>
        <h3 id={titleId} className={cardTitleVariants({ size })}>{title}</h3>
        {subtitle && <p className={cardSubtitleVariants()}>{subtitle}</p>}
      </div>
      {actions !== undefined && <div className={cardHeaderActionsVariants()}>{actions}</div>}
    </header>
  );
}
