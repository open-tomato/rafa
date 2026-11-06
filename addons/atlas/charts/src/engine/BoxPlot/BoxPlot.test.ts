import type { BoxPlotProps } from '../../seam/types.js';

import { describe, expect, it } from 'bun:test';

import { BOX_GROUPS, FIXED_TOKENS, seriesOf } from '../fixtures.js';

import { buildOption } from './BoxPlot.option.js';

const base: BoxPlotProps = { ariaLabel: 'Minutes by kind', groups: BOX_GROUPS, unit: 'min' };

describe('BoxPlot option', () => {
  it('draws boxes, medians and outliers as three series', () => {
    const series = seriesOf(buildOption(base, FIXED_TOKENS));

    expect(series.map((entry) => entry.type)).toEqual(['boxplot', 'custom', 'scatter']);
  });

  it('feeds each box its five numbers, minimum to maximum', () => {
    const [boxes] = seriesOf(buildOption(base, FIXED_TOKENS));

    expect(boxes?.data?.[0]).toEqual([6, 14, 22, 34, 52]);
    expect(boxes?.data).toHaveLength(BOX_GROUPS.length);
  });

  it('strokes box and whiskers in ink-2 and caps the box at 24px', () => {
    const [boxes] = seriesOf(buildOption(base, FIXED_TOKENS));

    expect((boxes?.itemStyle as { borderColor: string }).borderColor).toBe(FIXED_TOKENS['ink-2']);
    expect(boxes?.boxWidth).toEqual([24, 24]);
  });

  it('places the medians by group index', () => {
    const [, medians] = seriesOf(buildOption(base, FIXED_TOKENS));

    expect(medians?.data).toEqual(BOX_GROUPS.map((group, index) => [index, group.median]));
  });

  it('flattens the outliers to group index and value, ringed with the surface colour', () => {
    const [, , outliers] = seriesOf(buildOption(base, FIXED_TOKENS));

    expect(outliers?.data).toEqual([[0, 71], [0, 80], [1, 48], [3, 34]]);
    expect((outliers?.itemStyle as { borderColor: string }).borderColor).toBe(FIXED_TOKENS['surface']);
  });

  it('labels the category axis with the group names', () => {
    expect((buildOption(base, FIXED_TOKENS).xAxis as { data: string[] }).data).toEqual(['feat', 'fix', 'refactor', 'chore']);
  });
});
