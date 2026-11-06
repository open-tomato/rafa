import type { ReactElement } from 'react';

import { cn } from '@open-tomato/charts';
import { LoaderCircle, TriangleAlert } from 'lucide-react';

import {
  cardStatusDetailVariants,
  cardStatusTitleVariants,
  cardStatusVariants,
  type CardStatusKind,
} from './CardStatus.variants.js';

/** The status icon's size, in pixels. */
const STATUS_ICON_SIZE = 14;

/** The default line for each kind. */
const DEFAULT_TITLES: Readonly<Record<CardStatusKind, string>> = {
  loading: 'Loading…',
  empty: 'No data for this range',
  error: 'This card hit an error',
};

/** A card status's props: its kind, and the line and detail to show. */
export interface CardStatusProps {
  readonly kind: CardStatusKind;
  readonly title?: string;
  readonly detail?: string;
  /** Layout context from the parent; never colour or size. */
  readonly className?: string;
}

/** The box a card shows in place of its chart while loading, when empty, or after an error; a live status region. */
export function CardStatus({ kind, title = DEFAULT_TITLES[kind], detail, className }: CardStatusProps): ReactElement {
  return (
    <div role="status" className={cn(cardStatusVariants({ kind }), className)}>
      <p className={cardStatusTitleVariants()}>
        {kind === 'error' && <TriangleAlert size={STATUS_ICON_SIZE} aria-hidden="true" />}
        {kind === 'loading' && <LoaderCircle size={STATUS_ICON_SIZE} aria-hidden="true" />}
        {title}
      </p>
      {detail && <p className={cardStatusDetailVariants()}>{detail}</p>}
    </div>
  );
}
