/**
 * How tall a chart draws. A number is a plot height in px. `'fill'` takes
 * the full height of the chart's container, which must have a height of
 * its own (a sized box, a flex or grid cell that is stretched); the chart
 * then follows that container as it resizes.
 */
export type ChartHeight = number | 'fill';

/** Plot height in px when a chart is given none. */
export const DEFAULT_CHART_HEIGHT = 220;

/**
 * The height in px a layout works with: the given px, or for `'fill'` the
 * measured px of the container, or the default while nothing is measured
 * yet (the first render, a headless drawing that did not resolve it).
 */
export function plotHeightOf(height: ChartHeight | undefined, measured = 0): number {
  if (height === 'fill') {
    return measured > 0
      ? measured
      : DEFAULT_CHART_HEIGHT;
  }
  return height ?? DEFAULT_CHART_HEIGHT;
}
