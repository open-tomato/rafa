import type { CardTone } from '../../context/types.js';
import type { ReactElement } from 'react';

import { cn } from '@open-tomato/charts';

import { sparkPath } from './points.js';
import { sparklineDotVariants, sparklineVariants } from './Sparkline.variants.js';

/** The sparkline's default size, in pixels. */
const DEFAULT_WIDTH = 96;
const DEFAULT_HEIGHT = 28;

/** The line's stroke and the dot's radius and ring, in SVG user units. */
const STROKE_WIDTH = 2;
const DOT_RADIUS = 4;

/** A sparkline's props: the values, a tone, the size and an optional accessible name. */
export interface SparklineProps {
  readonly values: readonly number[];
  readonly tone?: CardTone;
  readonly width?: number;
  readonly height?: number;
  /** Names the trend for assistive technology; without it the sparkline is decorative. */
  readonly label?: string;
  /** Layout context from the parent (margin, alignment); never colour or size. */
  readonly className?: string;
}

/**
 * A small trend line in pure SVG, engine-free so it renders on the
 * server: the values as a stroke and the last one as a dot. Under two
 * values there is no trend, so it renders nothing.
 */
export function Sparkline({ values, tone, width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT, label, className }: SparklineProps): ReactElement | null {
  const path = sparkPath(values, width, height);
  if (path === null) return null;
  const naming = label === undefined
    ? { 'aria-hidden': true as const }
    : { role: 'img', 'aria-label': label };
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={cn(sparklineVariants({ tone }), className)} {...naming}>
      <polyline points={path.points} fill="none" stroke="currentColor" strokeWidth={STROKE_WIDTH} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={path.last.x} cy={path.last.y} r={DOT_RADIUS} fill="currentColor" strokeWidth={STROKE_WIDTH} className={sparklineDotVariants()} />
    </svg>
  );
}
