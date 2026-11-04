import type { ButtonTone } from '../../atoms/Button/Button.variants.js';
import type { ModalPlacement } from '../../molecules/CardModal/CardModal.js';

import { AppWindow, Bug, Info, Maximize2, SlidersHorizontal, Table2, type LucideIcon } from 'lucide-react';
import { isValidElement, type ReactNode } from 'react';

import { MODAL_KEYS, type ModalKey } from '../../contract/schemas.js';

/** The card as a modal entry sees it: its title, its error, and the registry's controls. */
export interface CardHandle {
  readonly title: string;
  /** The error the boundary caught, or the one the data layer reported; `null` while all is well. */
  readonly error: Error | null;
  /** Whether the maximise entry is the open one. */
  readonly maximised: boolean;
  /** Opens another entry by key. */
  readonly open: (key: string) => void;
  /** Closes the open entry. */
  readonly close: () => void;
  /** Clears the error, re-renders the content and asks the data again. */
  readonly retry: () => void;
}

/** What a component entry receives. */
export interface ModalContext {
  readonly close: () => void;
  readonly card: CardHandle;
}

/** A component entry: it renders its own chrome, or none. */
export type ModalComponent = (context: ModalContext) => ReactNode;

/** An entry with its menu label, icon, title and placement spelled out. */
export interface ModalDefinition {
  readonly label?: string;
  readonly icon?: LucideIcon;
  /** The modal's title; the label by default. */
  readonly title?: string;
  readonly placement?: ModalPlacement;
  /** Wraps the entry in the default chrome; true unless `render` is a component. */
  readonly chrome?: boolean;
  readonly tone?: ButtonTone;
  /** Lists the entry in the card menu; false for one only the chart or the header opens. */
  readonly menu?: boolean;
  readonly render: ReactNode | ModalComponent;
}

/**
 * One entry of a card's modal registry: content (shown in the default
 * chrome), a component `({ close, card }) => ReactNode` that owns its
 * chrome, or a definition naming its label and icon. `null`, `undefined`
 * and `false` leave the key out, so `{ source: hasTable && <SourceView /> }` works.
 */
export type ModalEntry = ReactNode | ModalComponent | ModalDefinition;

/** An entry with every default filled in, ready for the menu and the modal. */
export interface ResolvedModal {
  readonly key: string;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly title: string;
  readonly placement: ModalPlacement;
  readonly chrome: boolean;
  readonly tone: ButtonTone;
  readonly menu: boolean;
  readonly render: ReactNode | ModalComponent;
}

/** A built-in key's menu label, icon, placement and tone. */
interface BuiltIn {
  readonly label: string;
  readonly icon: LucideIcon;
  readonly placement: ModalPlacement;
  readonly tone: ButtonTone;
}

/** The built-in keys' defaults; `CardLayout` adds `errors` and `maximise` itself. */
export const BUILT_IN_MODALS: Readonly<Record<ModalKey, BuiltIn>> = {
  info: { label: 'Info', icon: Info, placement: 'contained', tone: 'default' },
  source: { label: 'Source', icon: Table2, placement: 'contained', tone: 'default' },
  config: { label: 'Configure', icon: SlidersHorizontal, placement: 'contained', tone: 'default' },
  errors: { label: 'Errors', icon: Bug, placement: 'contained', tone: 'critical' },
  maximise: { label: 'Maximise', icon: Maximize2, placement: 'page', tone: 'default' },
};

/** The icon a consumer's own key gets unless its definition names one. */
const CUSTOM_ICON: LucideIcon = AppWindow;

/** Whether `key` is one of the built-in modal keys. */
export function isBuiltInKey(key: string): key is ModalKey {
  return (MODAL_KEYS as readonly string[]).includes(key);
}

/** Whether an entry is a definition object rather than content or a component. */
export function isModalDefinition(entry: ModalEntry): entry is ModalDefinition {
  return typeof entry === 'object'
    && entry !== null
    && !isValidElement(entry)
    && !(Symbol.iterator in entry)
    && 'render' in entry;
}

/** Whether an entry leaves its key out of the registry. */
function isAbsent(entry: ModalEntry): boolean {
  return entry === null || entry === undefined || entry === false;
}

/** A consumer key as a menu label: `top-models` becomes "Top models". */
export function labelOfKey(key: string): string {
  const words = key.replaceAll(/[-_]+/gu, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** One entry with its defaults filled in; `cardTitle` titles the info and maximise modals. */
export function resolveModal(key: string, entry: ModalEntry, cardTitle: string): ResolvedModal {
  const builtIn = isBuiltInKey(key)
    ? BUILT_IN_MODALS[key]
    : undefined;
  const definition: ModalDefinition = isModalDefinition(entry)
    ? entry
    : { render: entry, chrome: typeof entry !== 'function' };
  const label = definition.label ?? builtIn?.label ?? labelOfKey(key);
  const titledByCard = key === 'info' || key === 'maximise';
  return {
    key,
    label,
    icon: definition.icon ?? builtIn?.icon ?? CUSTOM_ICON,
    title: definition.title ?? (titledByCard
      ? cardTitle
      : label),
    placement: definition.placement ?? builtIn?.placement ?? 'contained',
    chrome: definition.chrome ?? true,
    tone: definition.tone ?? builtIn?.tone ?? 'default',
    menu: definition.menu ?? true,
    render: definition.render,
  };
}

/** The menu order: info, source and config, the consumer's keys in their order, then maximise and errors. */
export function orderModalKeys(keys: readonly string[]): readonly string[] {
  const head = (['info', 'source', 'config'] as const).filter((key) => keys.includes(key));
  const tail = (['maximise', 'errors'] as const).filter((key) => keys.includes(key));
  const custom = keys.filter((key) => !isBuiltInKey(key));
  return [...head, ...custom, ...tail];
}

/** The registry, resolved and in menu order, without the keys whose entry is absent. */
export function resolveModals(modals: Readonly<Record<string, ModalEntry>>, cardTitle: string): readonly ResolvedModal[] {
  const present = Object.keys(modals).filter((key) => !isAbsent(modals[key]));
  return orderModalKeys(present).map((key) => resolveModal(key, modals[key], cardTitle));
}
