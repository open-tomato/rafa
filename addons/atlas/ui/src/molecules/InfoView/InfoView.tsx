import type { LegendItem, LegendMark } from '../../context/types.js';
import type { ReactElement, ReactNode } from 'react';

import { cn } from '@open-tomato/charts';

import { Legend } from '../../atoms/Legend/Legend.js';

import { infoLeadVariants, infoMutedVariants, infoViewVariants } from './InfoView.variants.js';

/** An info view's props: what the card shows and how to read it, with its legend and source. */
export interface InfoViewProps {
  readonly subtitle?: string;
  /** What the card shows and how to read it; text or paragraphs. */
  readonly description?: ReactNode;
  /** A proxy or a gap the reader should know about. */
  readonly note?: string;
  readonly legend?: readonly LegendItem[];
  readonly mark?: LegendMark;
  readonly source?: string;
  /** Layout context from the parent; never colour or size. */
  readonly className?: string;
}

/** How to read a card: the subtitle, the description, a note, the legend and the source line. */
export function InfoView({ subtitle, description, note, legend, mark, source, className }: InfoViewProps): ReactElement {
  return (
    <div className={cn(infoViewVariants(), className)}>
      {subtitle && <p className={infoMutedVariants()}>{subtitle}</p>}
      {typeof description === 'string' || description === undefined
        ? <p>{description ?? 'No description yet for this card.'}</p>
        : description}
      {note && <p><span className={infoLeadVariants()}>Note.</span> {note}</p>}
      {legend && <Legend items={legend} mark={mark} />}
      {source && <p className={infoMutedVariants()}>Source: {source}</p>}
    </div>
  );
}
