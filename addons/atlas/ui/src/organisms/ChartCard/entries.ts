import type { MenuItem } from '../../contract/schemas.js';

import { isModalDefinition, type ModalDefinition, type ModalEntry } from '../CardLayout/registry.js';

/**
 * An entry relabelled by a config menu item: the item's label wins over
 * the built-in or derived one. Absent entries stay absent.
 */
export function relabel(entry: ModalEntry, item: MenuItem | undefined): ModalEntry {
  if (item === undefined || entry === null || entry === undefined || entry === false) return entry;
  const definition: ModalDefinition = isModalDefinition(entry)
    ? entry
    : { render: entry, chrome: typeof entry !== 'function' };
  return { ...definition, label: item.label };
}

/** The registry with every entry a config menu item names relabelled. */
export function relabelAll(
  entries: Readonly<Record<string, ModalEntry>>,
  menu: readonly MenuItem[] | undefined,
): Readonly<Record<string, ModalEntry>> {
  if (menu === undefined || menu.length === 0) return entries;
  return Object.fromEntries(Object.entries(entries).map(([key, entry]) => [key, relabel(entry, menu.find((item) => item.key === key))]));
}

/** The resolved list a render-prop chart reads: hidden series only when the legend toggles. */
export const NO_HIDDEN: ReadonlySet<string> = new Set();
