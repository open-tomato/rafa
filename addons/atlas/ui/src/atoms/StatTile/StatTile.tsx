import type { ReactElement } from 'react';

import { cn } from '@open-tomato/charts';
import { ArrowDown, ArrowUp, Minus } from 'lucide-react';

import { Card } from '../Card/Card.js';
import { Sparkline } from '../Sparkline/Sparkline.js';

import { readDelta, type StatDelta } from './delta.js';
import {
  statTileBodyVariants,
  statTileDeltaVariants,
  statTileLabelVariants,
  statTileNoteVariants,
  statTileValueVariants,
  statTileVariants,
} from './StatTile.variants.js';

/** The delta arrow's size, in pixels. */
const DELTA_ICON_SIZE = 12;

/** A stat tile's props: label, value, delta, trend, and whether it is the view's hero number. */
export interface StatTileProps {
  readonly label: string;
  /** The value, already formatted. */
  readonly value: string;
  readonly delta?: StatDelta;
  /** The recent values behind the trend line. */
  readonly trend?: readonly number[];
  /** One per view: the number the lens leads with, drawn larger. */
  readonly hero?: boolean;
  readonly note?: string;
  /** Layout context from the parent (grid placement); never colour or size. */
  readonly className?: string;
}

/** The arrow beside a delta. */
function DeltaIcon({ delta }: { readonly delta: StatDelta }): ReactElement {
  if (delta.direction === 'up') return <ArrowUp size={DELTA_ICON_SIZE} aria-hidden="true" />;
  if (delta.direction === 'down') return <ArrowDown size={DELTA_ICON_SIZE} aria-hidden="true" />;
  return <Minus size={DELTA_ICON_SIZE} aria-hidden="true" />;
}

/** One number on a small card: label, value, delta against a named period, and a trend line. */
export function StatTile({ label, value, delta, trend, hero, note, className }: StatTileProps): ReactElement {
  return (
    <Card label={label} padding="sm" className={cn(statTileVariants(), className)}>
      <div className={statTileBodyVariants()}>
        <p className={statTileLabelVariants()}>{label}</p>
        <p className={statTileValueVariants({ hero })}>{value}</p>
        {delta && (
          <p className={statTileDeltaVariants({ reading: readDelta(delta) })}>
            <DeltaIcon delta={delta} />
            {delta.text}
          </p>
        )}
        {note && <p className={statTileNoteVariants()}>{note}</p>}
      </div>
      {trend && <Sparkline values={trend} tone="muted" />}
    </Card>
  );
}
