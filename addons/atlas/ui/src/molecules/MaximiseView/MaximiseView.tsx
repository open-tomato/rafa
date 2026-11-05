import type { DialogFitSize } from '../../atoms/Dialog/Dialog.variants.js';
import type { MaximiseConfig, MaximiseExtraMode, MaximiseSize } from '../../contract/schemas.js';
import type { ChartHeight } from '@open-tomato/charts';

import { useState, type ReactElement, type ReactNode } from 'react';

import { Button } from '../../atoms/Button/Button.js';
import { Segmented, type SegmentedOption } from '../../atoms/Segmented/Segmented.js';
import { CardModal } from '../CardModal/CardModal.js';

import {
  maximiseChartVariants,
  maximiseControlsVariants,
  maximiseExtrasVariants,
  maximiseViewVariants,
} from './MaximiseView.variants.js';

/** The box size the view opens at when the card names none: medium. */
export const DEFAULT_MAXIMISE_SIZE: MaximiseSize = 'medium';

/** How an extra shows when the card names no mode: behind a toggle that starts off. */
export const DEFAULT_MAXIMISE_EXTRA_MODE: MaximiseExtraMode = 'toggle';

/** The two box sizes in the header's picker; the card itself is the small one. */
export const MAXIMISE_SIZE_OPTIONS: readonly SegmentedOption<MaximiseSize>[] = [
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' },
];

/** The dialog size for a box size: medium keeps 30% of the smaller side clear, large 10%. */
const FIT_SIZE: Readonly<Record<MaximiseSize, DialogFitSize>> = { medium: 'fit-70', large: 'fit-90' };

/** What the view tells the content it renders: fill the box. */
export interface MaximiseContentView {
  readonly height: Extract<ChartHeight, 'fill'>;
}

/** The view's content: a node, or a function of the view (the chart, told to fill the box). */
export type MaximiseContent = ReactNode | ((view: MaximiseContentView) => ReactNode);

/** What a card offers beside the maximised chart; absent leaves the extra and its toggle out. */
export interface MaximiseExtras {
  /** The card's legend. */
  readonly legend?: ReactNode;
  /** The card's source table, as the Source entry shows it. */
  readonly table?: ReactNode;
}

/** A maximise view's props: the card's title, the close handler, the content, its extras and the card's setup. */
export interface MaximiseViewProps extends MaximiseExtras {
  /** The dialog's title: the card's title. */
  readonly title: string;
  /** Called on Close and on Escape. */
  readonly onClose: () => void;
  readonly children: MaximiseContent;
  /** The card's maximise setup: the size it opens at and how each extra shows; every field defaults. */
  readonly options?: MaximiseConfig;
  /** Layout context from the parent; never colour or size. */
  readonly className?: string;
}

const FILL: MaximiseContentView = { height: 'fill' };

/** True when an extra was given. */
function given(extra: ReactNode): boolean {
  return extra !== undefined && extra !== null && extra !== false;
}

/** One extra's state from its mode: shown at first, and whether a toggle is offered. */
function useExtra(extra: ReactNode, mode: MaximiseExtraMode): { shown: boolean; toggle: (() => void) | null } {
  const [on, setOn] = useState(mode === 'toggle-on');
  if (!given(extra)) return { shown: false, toggle: null };
  if (mode === 'always') return { shown: true, toggle: null };
  return { shown: on, toggle: () => setOn((current) => !current) };
}

/**
 * A card at full size: a page dialog whose chart box is a square of the
 * viewport's smaller side, medium (70%) or large (90%), opening at the
 * size the card's setup names (medium when it names none) and switched in
 * the header. The content fills the box. The card's legend and source
 * table show beside the box on a landscape viewport and under it on a
 * portrait one, each as its mode says: always, behind a toggle that
 * starts off (the default), or behind one that starts on; the dialog grows
 * that way up to the clearance, then that pane scrolls. An extra the card
 * does not have is left out with its toggle. Escape and Close call
 * `onClose`.
 */
export function MaximiseView({ title, onClose, children, legend, table, options, className }: MaximiseViewProps): ReactElement {
  const [size, setSize] = useState<MaximiseSize>(options?.size ?? DEFAULT_MAXIMISE_SIZE);
  const legendState = useExtra(legend, options?.legend ?? DEFAULT_MAXIMISE_EXTRA_MODE);
  const tableState = useExtra(table, options?.table ?? DEFAULT_MAXIMISE_EXTRA_MODE);

  const controls = (
    <div className={maximiseControlsVariants()}>
      <Segmented value={size} options={MAXIMISE_SIZE_OPTIONS} onChange={setSize} label="Box size" size="sm" />
      {legendState.toggle && <Button variant="text" aria-pressed={legendState.shown} onClick={legendState.toggle}>Legend</Button>}
      {tableState.toggle && <Button variant="text" aria-pressed={tableState.shown} onClick={tableState.toggle}>Table</Button>}
    </div>
  );

  return (
    <CardModal title={title} onClose={onClose} placement="page" size={FIT_SIZE[size]} actions={controls} className={className}>
      <div className={maximiseViewVariants()}>
        <div className={maximiseChartVariants({ size })}>
          {typeof children === 'function'
            ? children(FILL)
            : children}
        </div>
        {(legendState.shown || tableState.shown) && (
          <div className={maximiseExtrasVariants({ size })}>
            {legendState.shown && legend}
            {tableState.shown && table}
          </div>
        )}
      </div>
    </CardModal>
  );
}
