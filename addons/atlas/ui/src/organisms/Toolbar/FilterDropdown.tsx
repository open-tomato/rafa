import type { ReactElement, ReactNode } from 'react';

import { cn } from '@open-tomato/charts';
import { Check, ChevronDown, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import {
  filterCheckVariants,
  filterCountVariants,
  filterDropdownVariants,
  filterOptionLabelVariants,
  filterOptionVariants,
  filterPanelVariants,
  filterRuleVariants,
  filterTriggerVariants,
} from './Toolbar.variants.js';

/** The glyph sizes, in pixels. */
const CHEVRON_SIZE = 15;
const CHECK_SIZE = 12;
const CLEAR_SIZE = 16;

/** One option of a filter. */
export interface FilterOption {
  readonly value: string;
  readonly label: ReactNode;
  /** A small leading swatch: a status dot. */
  readonly swatch?: ReactNode;
}

/** A filter dropdown's props: its label and icon, the options, the selection and its handlers. */
export interface FilterDropdownProps {
  readonly label: string;
  readonly icon?: ReactNode;
  readonly options: readonly FilterOption[];
  readonly selected: readonly string[];
  readonly onToggle: (value: string) => void;
  readonly onClear: () => void;
  /** Layout context from the parent (margin); never colour or size. */
  readonly className?: string;
}

/**
 * A multi-select checklist under a trigger. The trigger tints in the
 * accent and grows a count while any value is selected; a toggle keeps
 * the panel open, the clear entry closes it, as do Escape and a pointer
 * down outside.
 */
export function FilterDropdown({ label, icon, options, selected, onToggle, onClear, className }: FilterDropdownProps): ReactElement {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const active = selected.length > 0;

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent): void => {
      if (!(event.target instanceof Node) || !rootRef.current?.contains(event.target)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={cn(filterDropdownVariants(), className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open
          ? panelId
          : undefined}
        onClick={() => setOpen((current) => !current)}
        className={filterTriggerVariants({ active })}
      >
        {icon}
        {label}
        {active && <span className={filterCountVariants()}>{selected.length}</span>}
        <ChevronDown size={CHEVRON_SIZE} aria-hidden="true" />
      </button>
      {open && (
        <div id={panelId} role="group" aria-label={label} className={filterPanelVariants()}>
          {options.map((option) => {
            const on = selected.includes(option.value);
            return (
              <button key={option.value} type="button" role="checkbox" aria-checked={on} onClick={() => onToggle(option.value)} className={filterOptionVariants()}>
                <span className={filterOptionLabelVariants()}>
                  {option.swatch}
                  {option.label}
                </span>
                <span aria-hidden="true" className={filterCheckVariants({ on })}>
                  {on && <Check size={CHECK_SIZE} aria-hidden="true" />}
                </span>
              </button>
            );
          })}
          {active && (
            <>
              <div aria-hidden="true" className={filterRuleVariants()} />
              <button
                type="button"
                onClick={() => {
                  onClear();
                  setOpen(false);
                }}
                className={filterOptionVariants()}
              >
                <span className={filterOptionLabelVariants()}>
                  <X size={CLEAR_SIZE} aria-hidden="true" />
                  Clear {label.toLowerCase()}
                </span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
