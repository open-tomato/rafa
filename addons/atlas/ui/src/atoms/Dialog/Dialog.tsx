import { cn } from '@open-tomato/charts';
import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactElement, type ReactNode } from 'react';

import { Button } from '../Button/Button.js';

import {
  dialogBodyVariants,
  dialogFrameVariants,
  dialogHeaderEndVariants,
  dialogHeaderVariants,
  dialogTitleVariants,
  dialogVariants,
  type DialogSize,
} from './Dialog.variants.js';

/** The close icon's size, in pixels. */
const CLOSE_ICON_SIZE = 16;

/** A dialog's props: whether it is open, its title, the close handler and the body. */
export interface DialogProps {
  readonly open: boolean;
  readonly title: string;
  /** Called when the reader closes it: the close button, or Escape (the native `close` event). */
  readonly onClose: () => void;
  readonly size?: DialogSize;
  /** Controls in the header, before the close button (a view's own toggles). */
  readonly actions?: ReactNode;
  readonly children?: ReactNode;
  /** Layout context from the parent; never colour or size. */
  readonly className?: string;
}

/**
 * A modal on the native `<dialog>`: `showModal()` puts it in the top
 * layer, traps focus and makes Escape close it; the `close` event tells
 * the owner. The effect only mirrors `open` onto the element.
 */
export function Dialog({ open, title, onClose, size, actions, children, className }: DialogProps): ReactElement {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const node = ref.current;
    if (node === null) return;
    if (open && !node.open) node.showModal();
    if (!open && node.open) node.close();
  }, [open]);

  return (
    <dialog ref={ref} aria-labelledby={titleId} onClose={onClose} className={cn(dialogVariants({ size }), className)}>
      <div className={dialogFrameVariants()}>
        <header className={dialogHeaderVariants()}>
          <h2 id={titleId} className={dialogTitleVariants()}>{title}</h2>
          <div className={dialogHeaderEndVariants()}>
            {actions}
            <Button variant="icon" aria-label="Close" onClick={onClose}>
              <X size={CLOSE_ICON_SIZE} aria-hidden="true" />
            </Button>
          </div>
        </header>
        <div className={dialogBodyVariants()}>{children}</div>
      </div>
    </dialog>
  );
}
