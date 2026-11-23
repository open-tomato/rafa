import type { LensField, LensResult } from '../data/source.js';
import type { ReactElement } from 'react';

import { SmallStatCard, Sparkline, useDashboard, type StatDelta } from '@open-tomato/atlas-ui';

import { isWired, NOT_WIRED_TITLE } from './spec.js';

/** A lens stat's props: the label, the formatted value, a delta, a trend, the hero flag, a note and the fields it reads. */
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
  /** The result fields the value, delta and trend come from; none means module constants only. */
  readonly reads?: readonly LensField[];
}

const NO_FIELDS: readonly LensField[] = [];

/** The value a tile shows when no live metric feeds it: a dash, never a sample number. */
const NO_VALUE = '—';

/**
 * One stat in a lens's tile row: a `SmallStatCard` with the trend as a
 * muted sparkline in the aside column, the note as the footer, and the
 * hero at the `md` scale while the others sit at `sm`. On the live page a
 * tile `isWired` refuses shows a dash and "not wired yet" instead.
 */
export function LensStat({ label, value, goal, delta, trend, hero, note, reads = NO_FIELDS }: LensStatProps): ReactElement {
  const { data } = useDashboard<LensResult>();
  const size = hero
    ? 'md'
    : 'sm';
  if (data !== undefined && !isWired(data, reads)) {
    return <SmallStatCard title={label} value={NO_VALUE} footer={NOT_WIRED_TITLE.toLowerCase()} size={size} />;
  }
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
      size={size}
    />
  );
}
