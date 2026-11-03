import type { DialogFitSize } from '../../atoms/Dialog/Dialog.variants.js';
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

/** How much of the viewport's smaller side the box takes, in percent; the rest is the clearance. */
export type MaximiseStretch = '70' | '80' | '90';

/** The box size the view opens at: 80/20. */
export const DEFAULT_MAXIMISE_STRETCH: MaximiseStretch = '80';

/** The three combos, labelled stretch/clearance. */
export const MAXIMISE_STRETCH_OPTIONS: readonly SegmentedOption<MaximiseStretch>[] = [
  { value: '70', label: '70/30' },
  { value: '80', label: '80/20' },
  { value: '90', label: '90/10' },
];

/** The dialog size for a stretch. */
const FIT_SIZE: Readonly<Record<MaximiseStretch, DialogFitSize>> = { 70: 'fit-70', 80: 'fit-80', 90: 'fit-90' };

/** What the view tells the content it renders: fill the box. */
export interface MaximiseContentView {
  readonly height: Extract<ChartHeight, 'fill'>;
}

/** The view's content: a node, or a function of the view (the chart, told to fill the box). */
export type MaximiseContent = ReactNode | ((view: MaximiseContentView) => ReactNode);

/** What a card offers under the maximised chart, each behind a toggle; absent leaves the toggle out. */
export interface MaximiseExtras {
  /** The card's legend. */
  readonly legend?: ReactNode;
  /** The card's source table, as the Source entry shows it. */
  readonly table?: ReactNode;
}

/** A maximise view's props: the card's title, the close handler, the content and its extras. */
export interface MaximiseViewProps extends MaximiseExtras {
  /** The dialog's title: the card's title. */
  readonly title: string;
  /** Called on Close and on Escape. */
  readonly onClose: () => void;
  readonly children: MaximiseContent;
  /** Layout context from the parent; never colour or size. */
  readonly className?: string;
}

const FILL: MaximiseContentView = { height: 'fill' };

/**
 * A card at full size: a square page dialog of 70, 80 or 90 percent of the
 * viewport's smaller side (80 by default, picked in the header), with the
 * content filling the box under the header. The Legend and Table toggles
 * beside the picker, off by default, add the card's legend and source
 * table under the chart; the box then scrolls. A toggle is left out when
 * the card has nothing for it. Escape and Close call `onClose`.
 */
export function MaximiseView({ title, onClose, children, legend, table, className }: MaximiseViewProps): ReactElement {
  const [stretch, setStretch] = useState<MaximiseStretch>(DEFAULT_MAXIMISE_STRETCH);
  const [legendShown, setLegendShown] = useState(false);
  const [tableShown, setTableShown] = useState(false);
  const hasLegend = legend !== undefined && legend !== null && legend !== false;
  const hasTable = table !== undefined && table !== null && table !== false;
  const showLegend = hasLegend && legendShown;
  const showTable = hasTable && tableShown;

  const controls = (
    <div className={maximiseControlsVariants()}>
      <Segmented value={stretch} options={MAXIMISE_STRETCH_OPTIONS} onChange={setStretch} label="Box size: stretch and clearance" size="sm" />
      {hasLegend && <Button variant="text" aria-pressed={legendShown} onClick={() => setLegendShown((shown) => !shown)}>Legend</Button>}
      {hasTable && <Button variant="text" aria-pressed={tableShown} onClick={() => setTableShown((shown) => !shown)}>Table</Button>}
    </div>
  );

  return (
    <CardModal title={title} onClose={onClose} placement="page" size={FIT_SIZE[stretch]} actions={controls} className={className}>
      <div className={maximiseViewVariants()}>
        <div className={maximiseChartVariants()}>
          {typeof children === 'function'
            ? children(FILL)
            : children}
        </div>
        {(showLegend || showTable) && (
          <div className={maximiseExtrasVariants()}>
            {showLegend && legend}
            {showTable && table}
          </div>
        )}
      </div>
    </CardModal>
  );
}
