import type { ReactElement, ReactNode } from 'react';

import { cn } from '@open-tomato/charts';
import { X } from 'lucide-react';

import { chipIconVariants, chipRemoveVariants, chipVariants } from './Chip.variants.js';

/** The remove glyph's size, in pixels. */
const REMOVE_ICON_SIZE = 11;

/** A chip's props: a leading icon, the remove handler, the children and a layout-only passthrough class. */
export interface ChipProps {
  /** A leading 13px icon, in the accent. */
  readonly icon?: ReactNode;
  /** Renders the remove button and tightens the padding beside it. */
  readonly onRemove?: () => void;
  readonly children?: ReactNode;
  /** Layout context from the parent (margin, alignment); never colour or size. */
  readonly className?: string;
}

/** A removable token. */
export function Chip({ icon, onRemove, children, className }: ChipProps): ReactElement {
  return (
    <span className={cn(chipVariants({ removable: onRemove !== undefined }), className)}>
      {icon !== undefined && <span className={chipIconVariants()}>{icon}</span>}
      {children}
      {onRemove !== undefined && (
        <button type="button" aria-label="Remove" onClick={onRemove} className={chipRemoveVariants()}>
          <X size={REMOVE_ICON_SIZE} aria-hidden="true" />
        </button>
      )}
    </span>
  );
}
