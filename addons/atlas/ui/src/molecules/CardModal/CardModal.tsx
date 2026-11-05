import type { DialogSize } from '../../atoms/Dialog/Dialog.variants.js';

import { cn } from '@open-tomato/charts';
import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactElement, type ReactNode } from 'react';

import { Button } from '../../atoms/Button/Button.js';
import { Dialog } from '../../atoms/Dialog/Dialog.js';

import {
  cardModalBodyVariants,
  cardModalHeaderEndVariants,
  cardModalHeaderVariants,
  cardModalTitleVariants,
  cardModalVariants,
} from './CardModal.variants.js';

/** The close icon's size, in pixels. */
const CLOSE_ICON_SIZE = 16;

/** Where a modal opens: over the card that owns it, or over the whole page. */
export type ModalPlacement = 'contained' | 'page';

/** A card modal's props: title, close handler, placement and body. */
export interface CardModalProps {
  readonly title: string;
  readonly onClose: () => void;
  /** `contained` (the default) covers the card; `page` is a native modal dialog over the page. */
  readonly placement?: ModalPlacement;
  /** The page dialog's size: `full` by default, or a `fit-<n>` square; the contained placement ignores it. */
  readonly size?: DialogSize;
  /** Controls in the header, before the close button. */
  readonly actions?: ReactNode;
  readonly children?: ReactNode;
  /** Layout context from the parent; never colour or size. */
  readonly className?: string;
}

/** The contained placement: a dialog panel over the card; Escape closes it and focus starts on Close. */
function ContainedModal({ title, onClose, actions, children, className }: Omit<CardModalProps, 'placement' | 'size'>): ReactElement {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div role="dialog" aria-labelledby={titleId} className={cn(cardModalVariants(), className)}>
      <header className={cardModalHeaderVariants()}>
        <h4 id={titleId} className={cardModalTitleVariants()}>{title}</h4>
        <div className={cardModalHeaderEndVariants()}>
          {actions}
          <Button ref={closeRef} variant="icon" aria-label="Close" onClick={onClose}>
            <X size={CLOSE_ICON_SIZE} aria-hidden="true" />
          </Button>
        </div>
      </header>
      <div className={cardModalBodyVariants()}>{children}</div>
    </div>
  );
}

/**
 * The default modal chrome a card's registry renders an entry in: a
 * title, a close button and a body that scrolls. Contained in the card by
 * default; `page` opens a native dialog, full-size unless `size` names a
 * `fit-<n>` square (the maximise view). `actions` sit in the header before
 * Close. The owner mounts it only while open, so each opening starts fresh.
 */
export function CardModal({ title, onClose, placement = 'contained', size = 'full', actions, children, className }: CardModalProps): ReactElement {
  if (placement === 'page') {
    return <Dialog open title={title} onClose={onClose} size={size} actions={actions} className={className}>{children}</Dialog>;
  }
  return <ContainedModal title={title} onClose={onClose} actions={actions} className={className}>{children}</ContainedModal>;
}
