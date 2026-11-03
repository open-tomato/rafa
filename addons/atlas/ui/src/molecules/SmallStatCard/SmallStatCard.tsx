import type { ReactElement, ReactNode } from 'react';

import { cn, formatCompact } from '@open-tomato/charts';
import { ArrowDown, ArrowUp, Minus } from 'lucide-react';

import { readDelta, type StatDelta } from '../../atoms/StatTile/delta.js';
import { TrendIndicator } from '../../atoms/TrendIndicator/TrendIndicator.js';

import {
  smallStatCardAsideVariants,
  smallStatCardDeltaVariants,
  smallStatCardFooterVariants,
  smallStatCardHeadVariants,
  smallStatCardNumberVariants,
  smallStatCardRowVariants,
  smallStatCardSuffixVariants,
  smallStatCardTitleVariants,
  smallStatCardValueVariants,
  smallStatCardVariants,
  type SmallStatCardVariants,
} from './SmallStatCard.variants.js';

/** The delta arrow's size, in pixels. */
const DELTA_ICON_SIZE = 12;

/** A small stat card's props: the title row, the value and its suffix, the aside graphic, the delta line and the footer. */
export interface SmallStatCardProps extends SmallStatCardVariants {
  /** The top-left title, written in uppercase mono. */
  readonly title: string;
  /** The top-right slot as a trend: a ratio for a `TrendIndicator` with its value (0.12 → +12%). Wins over `decoration`. */
  readonly trend?: number;
  /** The top-right slot as a decoration: an icon, a status dot, a label. */
  readonly decoration?: ReactNode;
  /** The stat. A number is written compact (1.2M); a node is rendered as given. */
  readonly value: number | ReactNode;
  /** The unit suffix, small and greyed, right of the value. */
  readonly unit?: string;
  /** Writes the suffix as `/ goal`, before any unit. */
  readonly goal?: number;
  /** The column beside the value: a sparkline or another small graphic. */
  readonly aside?: ReactNode;
  /** The line under the value row, the whole width: a change against a named period. */
  readonly delta?: StatDelta;
  /** The bottom line, pinned: a progress bar, a link, a note. */
  readonly footer?: ReactNode;
  /** Layout context from the parent (grid placement); never colour or size. */
  readonly className?: string;
}

/** The arrow beside a delta. */
function DeltaIcon({ delta }: { readonly delta: StatDelta }): ReactElement {
  if (delta.direction === 'up') return <ArrowUp size={DELTA_ICON_SIZE} aria-hidden="true" />;
  if (delta.direction === 'down') return <ArrowDown size={DELTA_ICON_SIZE} aria-hidden="true" />;
  return <Minus size={DELTA_ICON_SIZE} aria-hidden="true" />;
}

/** The `/ goal unit` suffix, or an empty string when there is none. */
function suffixOf(goal: number | undefined, unit: string | undefined): string {
  return [goal === undefined
    ? null
    : `/ ${formatCompact(goal)}`, unit].filter((part) => part !== null && part !== undefined).join(' ');
}

/** An at-a-glance number on a small card; a named region for assistive technology. */
export function SmallStatCard({ title, trend, decoration, value, unit, goal, aside, delta, footer, size, className }: SmallStatCardProps): ReactElement {
  const suffix = suffixOf(goal, unit);
  return (
    <section aria-label={title} className={cn(smallStatCardVariants({ size }), className)}>
      <div className={smallStatCardHeadVariants()}>
        <span className={smallStatCardTitleVariants()}>{title}</span>
        {trend === undefined
          ? decoration
          : <TrendIndicator trend={trend} showValue />}
      </div>
      <div className={smallStatCardRowVariants()}>
        <div className={smallStatCardValueVariants()}>
          <span className={smallStatCardNumberVariants({ size })}>
            {typeof value === 'number'
              ? formatCompact(value)
              : value}
          </span>
          {suffix !== '' && <span className={smallStatCardSuffixVariants()}>{suffix}</span>}
        </div>
        {aside !== undefined && <div className={smallStatCardAsideVariants()}>{aside}</div>}
      </div>
      {delta && (
        <p className={smallStatCardDeltaVariants({ reading: readDelta(delta) })}>
          <DeltaIcon delta={delta} />
          {delta.text}
        </p>
      )}
      {footer !== undefined && <div className={smallStatCardFooterVariants()}>{footer}</div>}
    </section>
  );
}
