import type { SkeletonKind } from '../../contract/schemas.js';
import type { ReactElement } from 'react';

import { cn, DEFAULT_CHART_HEIGHT, type ChartHeight } from '@open-tomato/charts';

import { Skeleton } from '../../atoms/Skeleton/Skeleton.js';

import {
  chartSkeletonBarsVariants,
  chartSkeletonBarVariants,
  chartSkeletonLabelVariants,
  chartSkeletonLineVariants,
  chartSkeletonRingVariants,
  chartSkeletonRowsVariants,
  chartSkeletonRowVariants,
  chartSkeletonTileVariants,
  chartSkeletonVariants,
  type ChartSkeletonBarVariantProps,
} from './ChartSkeleton.variants.js';

/** The bar heights, left to right. */
const BAR_LEVELS: readonly NonNullable<ChartSkeletonBarVariantProps['level']>[] = ['2', '4', '3', '5', '1', '4', '3', '5'];

/** How many rows the rows family draws. */
const ROW_COUNT = 4;

/** The faint line's path, in a 100×40 box. */
const LINE_PATH = '0,30 14,22 28,26 42,12 56,18 70,8 84,14 100,4';

/** A chart skeleton's props: the shape, the box height and the status text. */
export interface ChartSkeletonProps {
  readonly kind: SkeletonKind;
  /** The box height: the chart's px, or `'fill'` for the container's; the charts' default when absent. */
  readonly height?: ChartHeight;
  /** What assistive technology reads. */
  readonly label?: string;
  /** Layout context from the parent (margin); never colour or size. */
  readonly className?: string;
}

/** The bars family. */
function Bars(): ReactElement {
  return (
    <div className={chartSkeletonBarsVariants()}>
      {BAR_LEVELS.map((level, index) => <Skeleton key={index} shape="block" width="fit" height="fill" className={chartSkeletonBarVariants({ level })} />)}
    </div>
  );
}

/** The line family. */
function Line(): ReactElement {
  return (
    <svg viewBox="0 0 100 40" preserveAspectRatio="none" className={chartSkeletonLineVariants()} aria-hidden="true">
      <polyline points={`${LINE_PATH} 100,40 0,40`} fill="currentColor" opacity="0.35" />
      <polyline points={LINE_PATH} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

/** The rows family. */
function Rows(): ReactElement {
  return (
    <div className={chartSkeletonRowsVariants()}>
      {Array.from({ length: ROW_COUNT }, (_, index) => (
        <div key={index} className={chartSkeletonRowVariants()}>
          <Skeleton width="short" />
          <Skeleton width="full" />
          <Skeleton width="short" />
        </div>
      ))}
    </div>
  );
}

/** The tile family. */
function Tile(): ReactElement {
  return (
    <div className={chartSkeletonTileVariants()}>
      <Skeleton width="half" />
      <Skeleton shape="block" width="short" height="value" />
      <Skeleton shape="block" width="wide" height="text" />
    </div>
  );
}

/** The shape for each kind. */
const SHAPES: Readonly<Record<SkeletonKind, () => ReactElement>> = {
  bars: Bars,
  line: Line,
  ring: () => <div className={chartSkeletonRingVariants()} />,
  rows: Rows,
  tile: Tile,
};

/**
 * The outline of a chart while its data loads: a live status region
 * reading "Loading…", holding the shape of the chart family in a box
 * the chart's height, so the card keeps its size.
 */
export function ChartSkeleton({ kind, height = DEFAULT_CHART_HEIGHT, label = 'Loading…', className }: ChartSkeletonProps): ReactElement {
  const Shape = SHAPES[kind];
  // The box height is the chart's own number, so it is set at the site; 'fill' takes the container.
  const boxStyle = height === 'fill'
    ? { height: '100%' }
    : { height };
  return (
    <div role="status" aria-busy="true" className={cn(chartSkeletonVariants(), className)} style={boxStyle}>
      <span className={chartSkeletonLabelVariants()}>{label}</span>
      <Shape />
    </div>
  );
}
