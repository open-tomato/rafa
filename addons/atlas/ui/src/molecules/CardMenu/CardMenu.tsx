import type { ButtonTone } from '../../atoms/Button/Button.variants.js';

import { cn } from '@open-tomato/charts';
import { EllipsisVertical, type LucideIcon } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';

import { Button } from '../../atoms/Button/Button.js';

import { cardMenuListVariants, cardMenuVariants } from './CardMenu.variants.js';

/** The size of the trigger and entry icons, in pixels. */
const ICON_SIZE = 16;

/** One menu entry: a key, a label, a lucide icon and what picking it does. */
export interface CardMenuItem {
  readonly key: string;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly onSelect: () => void;
  /** `critical` inks the entry, as the Errors entry is. */
  readonly tone?: ButtonTone;
}

/** A card menu's props: the entries and the trigger's accessible name. */
export interface CardMenuProps {
  readonly items: readonly CardMenuItem[];
  /** Names the trigger: "Options for <card title>". */
  readonly label?: string;
  /** Layout context from the parent; never colour or size. */
  readonly className?: string;
}

/** The entry buttons inside a menu element, in order. */
function entriesOf(menu: HTMLElement | null): HTMLButtonElement[] {
  return menu === null
    ? []
    : [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
}

/**
 * The ⋮ button in a card's corner and the menu it opens. Opening moves
 * focus to the first entry; the arrow keys, Home and End move between
 * entries; Escape closes and returns focus to the trigger; a pick or a
 * pointer down outside closes it.
 */
export function CardMenu({ items, label = 'Card options', className }: CardMenuProps): ReactElement {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return undefined;
    entriesOf(menuRef.current)[0]?.focus();
    const onPointerDown = (event: PointerEvent): void => {
      if (!(event.target instanceof Node) || !rootRef.current?.contains(event.target)) setOpen(false);
    };
    const onKey = (event: globalThis.KeyboardEvent): void => {
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

  const onMenuKeyDown = (event: KeyboardEvent<HTMLUListElement>): void => {
    const entries = entriesOf(menuRef.current);
    if (entries.length === 0) return;
    const at = entries.findIndex((entry) => entry === document.activeElement);
    const targets: Readonly<Record<string, number>> = {
      ArrowDown: (at + 1) % entries.length,
      ArrowUp: (at - 1 + entries.length) % entries.length,
      Home: 0,
      End: entries.length - 1,
    };
    const target = targets[event.key];
    if (target === undefined) return;
    event.preventDefault();
    entries[target]?.focus();
  };

  const pick = (item: CardMenuItem): void => {
    setOpen(false);
    item.onSelect();
  };

  return (
    <div ref={rootRef} className={cn(cardMenuVariants(), className)}>
      <Button
        ref={triggerRef}
        variant="icon"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open
          ? menuId
          : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        <EllipsisVertical size={ICON_SIZE} aria-hidden="true" />
      </Button>
      {open && (
        <ul ref={menuRef} id={menuId} role="menu" aria-label={label} className={cardMenuListVariants()} onKeyDown={onMenuKeyDown}>
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.key} role="none">
                <Button variant="menuitem" tone={item.tone} role="menuitem" tabIndex={-1} onClick={() => pick(item)}>
                  <Icon size={ICON_SIZE} aria-hidden="true" />
                  {item.label}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
