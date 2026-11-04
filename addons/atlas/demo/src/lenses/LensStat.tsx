import type { ReactElement } from 'react';

import { SmallStatCard, Sparkline, type StatDelta } from '@open-tomato/atlas-ui';

/** A lens stat's props: the label, the formatted value, a delta, a trend, the hero flag and a note. */
export interface LensStatProps {
  readonly label: string;
  /** The value: a number written compact, or a string already formatted. */
  readonly value: number | string;
  /** Writes the suffix as `/ goal` beside the value. */
  readonly goal?: number;
  readonly delta?: StatDelta;
  /** The recent values behind the trend line, drawn beside the value. */
  readonly trend?: readonly number[];
  /** One per lens: the number the lens leads with, drawn at the card's full scale. */
  readonly hero?: boolean;
  /** A note pinned to the card's bottom line. */
  readonly note?: string;
}

/**
 * One stat in a lens's tile row: a `SmallStatCard` with the trend as a
 * muted sparkline in the aside column, the note as the footer, and the
 * hero at the `md` scale while the others sit at `sm`.
 */
export function LensStat({ label, value, goal, delta, trend, hero, note }: LensStatProps): ReactElement {
  return (
    <SmallStatCard
      title={label}
      value={value}
      goal={goal}
      delta={delta}
      aside={trend === undefined
        ? undefined
        : <Sparkline values={trend} tone="muted" />}
      footer={note}
      size={hero
        ? 'md'
        : 'sm'}
    />
  );
}
