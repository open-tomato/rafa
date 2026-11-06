import type { HistogramProps } from '../../seam/types.js';

import { describe, expect, it } from 'bun:test';

import { FIXED_TOKENS, HISTOGRAM_BINS, seriesOf } from '../fixtures.js';

import { buildOption } from './Histogram.option.js';

const base: HistogramProps = { ariaLabel: 'Task duration', bins: HISTOGRAM_BINS, unit: 'min' };

describe('Histogram option', () => {
  it('draws one bar series with a count per bin', () => {
    const series = seriesOf(buildOption(base, FIXED_TOKENS));

    expect(series).toHaveLength(1);
    expect(series[0]?.data).toEqual(HISTOGRAM_BINS.map((bin) => bin.count));
  });

  it('lets the bins touch, with the 2px surface gap as the only space', () => {
    const [bars] = seriesOf(buildOption(base, FIXED_TOKENS));

    expect(bars?.barCategoryGap).toBe(2);
    expect((bars?.itemStyle as { color: string }).color).toBe(FIXED_TOKENS['series-1']);
  });

  it('labels the bin edges with a second axis of one more entry, the last carrying the unit', () => {
    const option = buildOption(base, FIXED_TOKENS);
    const [bands, edges] = option.xAxis as { data: string[]; boundaryGap?: boolean; axisLabel: { show: boolean } }[];

    expect(bands?.data).toHaveLength(HISTOGRAM_BINS.length);
    expect(bands?.axisLabel.show).toBe(false);
    expect(edges?.data).toHaveLength(HISTOGRAM_BINS.length + 1);
    expect(edges?.data.at(0)).toBe('0');
    expect(edges?.data.at(-1)).toBe('80 min');
    expect(edges?.boundaryGap).toBe(false);
  });
});
