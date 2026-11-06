import type { CardSurface } from '../../atoms/Card/Card.variants.js';
import type { CardSpan, MaximiseConfig } from '../../contract/schemas.js';

import { DEFAULT_CHART_HEIGHT, type ChartHeight } from '@open-tomato/charts';
import { useCallback, useMemo, useState, type ReactElement, type ReactNode } from 'react';

import { Card } from '../../atoms/Card/Card.js';
import { CardBoundary } from '../../context/CardBoundary.js';
import { CardHeader } from '../../molecules/CardHeader/CardHeader.js';
import { CardMenu, type CardMenuItem } from '../../molecules/CardMenu/CardMenu.js';
import { CardModal } from '../../molecules/CardModal/CardModal.js';
import { ErrorsView } from '../../molecules/ErrorsView/ErrorsView.js';
import { MaximiseView, type MaximiseExtras } from '../../molecules/MaximiseView/MaximiseView.js';

import {
  cardLayoutContentVariants,
  cardLayoutFooterVariants,
  cardLayoutHeaderVariants,
  cardLayoutTopVariants,
} from './CardLayout.variants.js';
import { resolveModals, type CardHandle, type ModalComponent, type ModalEntry, type ResolvedModal } from './registry.js';

/** What the content slot is told when it renders. */
export interface ContentView {
  /** The card's handle: opens a registry entry (a detail the chart leads to), closes it, retries. */
  readonly card: CardHandle;
  /** True inside the maximise modal, where the content has the whole box. */
  readonly maximised: boolean;
  /**
   * How tall a chart in the slot draws: `'fill'` in the maximise modal, so
   * it fills the box; the charts' default px in the card, which a content
   * with a height of its own ignores.
   */
  readonly height: ChartHeight;
}

/** The content slot: a node, or a function of where it renders (the card, or the maximise modal). */
export type CardContent = ReactNode | ((view: ContentView) => ReactNode);

/** A card layout's props: the slots, the modal registry and the error wiring. */
export interface CardLayoutProps {
  /** Names the card: its region, its default header, its menu and its info and maximise modals. */
  readonly title: string;
  /** The header slot; a `CardHeader` over `title` by default, `null` for none, or a function of the card's handle (an action that opens an entry). */
  readonly header?: ReactNode | ((card: CardHandle) => ReactNode);
  /** The menu slot; a `CardMenu` over the registry by default, `false` for none. */
  readonly menu?: ReactNode;
  readonly content: CardContent;
  readonly footer?: ReactNode;
  /** The modal registry; the menu lists every entry. */
  readonly modals?: Readonly<Record<string, ModalEntry>>;
  /** Adds the `maximise` entry: the content re-rendered to fill a square page dialog (`MaximiseView`). */
  readonly maximisable?: boolean;
  /** What the maximise entry offers beside the chart: the legend, the source table. */
  readonly maximiseExtras?: MaximiseExtras;
  /** The card's maximise setup: the box size it opens at and how each extra shows. */
  readonly maximiseOptions?: MaximiseConfig;
  /** An error from outside the boundary (the data layer); it lists the Errors entry too. */
  readonly error?: Error | null;
  /** Told when the reader picks Try again, after the layout cleared what its boundary caught. */
  readonly onRetry?: () => void;
  /** Told when the content's boundary catches a throw. */
  readonly onError?: (error: Error) => void;
  readonly span?: CardSpan;
  readonly surface?: CardSurface;
  /** Layout context from the parent (grid placement); never colour or size. */
  readonly className?: string;
}

/**
 * Runs an entry's render inside a component of its own, keyed by the
 * entry, so a component entry may use hooks and keeps its state across
 * the layout's re-renders.
 */
function ModalHost({ render, card }: { readonly render: ModalComponent; readonly card: CardHandle }): ReactNode {
  return render({ close: card.close, card });
}

/**
 * Renders the content slot inside the boundary that guards it: a content
 * function runs here, in a component of its own, so a throw from it is
 * the boundary's to catch rather than the layout's.
 */
function ContentSlot({ content, view }: { readonly content: CardContent; readonly view: ContentView }): ReactNode {
  return typeof content === 'function'
    ? content(view)
    : content;
}

/** The open entry, in the default chrome unless it owns its own. */
function OpenModal({ modal, card }: { readonly modal: ResolvedModal; readonly card: CardHandle }): ReactNode {
  const body = typeof modal.render === 'function'
    ? <ModalHost render={modal.render} card={card} />
    : modal.render;
  if (!modal.chrome) return body;
  return <CardModal title={modal.title} placement={modal.placement} onClose={card.close}>{body}</CardModal>;
}

/**
 * The layout concern of the cascade: a card with four slots (header,
 * menu, content, footer) and a modal registry. The content renders inside
 * a `CardBoundary`; once it catches, or once `error` is set, the registry
 * gains the `errors` entry, whose Try again clears the error and renders
 * the content again. `maximisable` adds the `maximise` entry: a
 * `MaximiseView` titled by the card, the content filling its square box,
 * `maximiseExtras` beside it as `maximiseOptions` says. The menu lists
 * every entry with its label and lucide icon.
 */
export function CardLayout({
  title,
  header,
  menu,
  content,
  footer,
  modals,
  maximisable = false,
  maximiseExtras,
  maximiseOptions,
  error = null,
  onRetry,
  onError,
  span,
  surface,
  className,
}: CardLayoutProps): ReactElement {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [caught, setCaught] = useState<Error | null>(null);
  const [attempt, setAttempt] = useState(0);
  const shownError = caught ?? error;

  const close = useCallback(() => setOpenKey(null), []);
  const retry = useCallback(() => {
    setCaught(null);
    setAttempt((current) => current + 1);
    setOpenKey(null);
    onRetry?.();
  }, [onRetry]);
  const onCaught = useCallback((thrown: Error) => {
    setCaught(thrown);
    onError?.(thrown);
  }, [onError]);

  const resolved = useMemo(() => {
    const { errors: ownErrors, ...rest } = modals ?? {};
    const maximise: Record<string, ModalEntry> = maximisable && rest['maximise'] === undefined
      ? {
        maximise: {
          chrome: false,
          render: ({ close, card }) => (
            <MaximiseView title={card.title} onClose={close} legend={maximiseExtras?.legend} table={maximiseExtras?.table} options={maximiseOptions}>
              {({ height }) => (
                <CardBoundary onError={onCaught} resetKey={attempt}>
                  <ContentSlot content={content} view={{ card, maximised: true, height }} />
                </CardBoundary>
              )}
            </MaximiseView>
          ),
        },
      }
      : {};
    const errors: Record<string, ModalEntry> = shownError === null
      ? {}
      : { errors: ownErrors ?? <ErrorsView error={shownError} onRetry={retry} /> };
    return resolveModals({ ...rest, ...maximise, ...errors }, title);
  }, [modals, maximisable, maximiseExtras, maximiseOptions, shownError, title, retry, onCaught, attempt, content]);

  const card: CardHandle = {
    title,
    error: shownError,
    maximised: openKey === 'maximise',
    open: setOpenKey,
    close,
    retry,
  };
  const items: readonly CardMenuItem[] = resolved.filter((modal) => modal.menu).map((modal) => ({
    key: modal.key,
    label: modal.label,
    icon: modal.icon,
    tone: modal.tone,
    onSelect: () => setOpenKey(modal.key),
  }));
  const headerSlot = typeof header === 'function'
    ? header(card)
    : header;
  const open = resolved.find((modal) => modal.key === openKey);
  const menuSlot = menu === undefined
    ? items.length > 0 && <CardMenu items={items} label={`Options for ${title}`} />
    : menu;

  return (
    <Card label={title} span={span} surface={surface} className={className}>
      <div className={cardLayoutTopVariants()}>
        <div className={cardLayoutHeaderVariants()}>
          {headerSlot === undefined
            ? <CardHeader title={title} />
            : headerSlot}
        </div>
        {menuSlot}
      </div>
      <div className={cardLayoutContentVariants()}>
        <CardBoundary onError={onCaught} resetKey={attempt}><ContentSlot content={content} view={{ card, maximised: false, height: DEFAULT_CHART_HEIGHT }} /></CardBoundary>
      </div>
      {footer !== undefined && footer !== null && <div className={cardLayoutFooterVariants()}>{footer}</div>}
      {open && <OpenModal key={open.key} modal={open} card={card} />}
    </Card>
  );
}
