import type { BarChartProps } from '../../seam/types.js';

import { describe, expect, it } from 'bun:test';

import { BAR_CATEGORIES, BAR_SERIES, FIXED_TOKENS, seriesOf } from '../fixtures.js';

import { buildOption } from './BarChart.option.js';

const base: BarChartProps = {
  ariaLabel: 'Minutes by agent',
  categories: BAR_CATEGORIES,
  series: BAR_SERIES,
};

describe('BarChart option', () => {
  it('draws one bar series per input series, keyed by id', () => {
    const series = seriesOf(buildOption(base, FIXED_TOKENS));

    expect(series.map((entry) => entry.id)).toEqual(['feat', 'fix', 'chore']);
    expect(series.every((entry) => entry.type === 'bar')).toBe(true);
  });

  it('paints each series with its tone from the tokens', () => {
    const [feat, fix] = seriesOf(buildOption(base, FIXED_TOKENS));

    expect((feat?.itemStyle as { color: string }).color).toBe(FIXED_TOKENS['series-1']);
    expect((fix?.itemStyle as { color: string }).color).toBe(FIXED_TOKENS['series-2']);
  });

  it('caps the bar width at 24px and leaves a surface stroke as the gap', () => {
    const [feat] = seriesOf(buildOption(base, FIXED_TOKENS));

    expect(feat?.barMaxWidth).toBe(24);
    expect((feat?.itemStyle as { borderColor: string }).borderColor).toBe(FIXED_TOKENS['surface']);
  });

  it('leaves series unstacked when grouped', () => {
    const series = seriesOf(buildOption(base, FIXED_TOKENS));

    expect(series.map((entry) => entry.stack)).toEqual([undefined, undefined, undefined]);
  });

  it('stacks the series and rounds only the data end of each stack', () => {
    const series = seriesOf(buildOption({ ...base, mode: 'stacked' }, FIXED_TOKENS));
    const cornersOf = (index: number): unknown => (series[index]?.data?.[0] as { itemStyle: { borderRadius: number[] } }).itemStyle.borderRadius;

    expect(series.map((entry) => entry.stack)).toEqual(['total', 'total', 'total']);
    expect(cornersOf(0)).toEqual([0, 0, 0, 0]);
    expect(cornersOf(2)).toEqual([4, 4, 0, 0]);
  });

  it('turns values into shares of the category total for stacked100', () => {
    const series = seriesOf(buildOption({ ...base, mode: 'stacked100' }, FIXED_TOKENS));
    const firstCategory = series.map((entry) => (entry.data?.[0] as { value: number }).value);

    expect(firstCategory.reduce((sum, share) => sum + share, 0)).toBeCloseTo(1, 10);
    expect(buildOption({ ...base, mode: 'stacked100' }, FIXED_TOKENS).yAxis).toMatchObject({ min: 0, max: 1 });
  });

  it('swaps the axes and rounds the right-hand end when horizontal', () => {
    const option = buildOption({ ...base, orientation: 'horizontal' }, FIXED_TOKENS);
    const [feat] = seriesOf(option);

    expect(option.xAxis).toMatchObject({ type: 'value' });
    expect(option.yAxis).toMatchObject({ type: 'category', inverse: true });
    expect((feat?.data?.[0] as { itemStyle: { borderRadius: number[] } }).itemStyle.borderRadius).toEqual([0, 4, 4, 0]);
  });

  it('draws a limit line on the first series only', () => {
    const series = seriesOf(buildOption({ ...base, limit: { value: 500, label: 'WIP limit' } }, FIXED_TOKENS));

    expect(series[0]?.markLine).toBeDefined();
    expect(series[1]?.markLine).toBeUndefined();
  });

  it('lifts the value axis ceiling to the limit', () => {
    const option = buildOption({ ...base, limit: { value: 900, label: 'WIP limit' } }, FIXED_TOKENS);
    const { max } = option.yAxis as { max: (extent: { max: number }) => number };

    expect(max({ max: 300 })).toBe(900);
    expect(max({ max: 1200 })).toBe(1200);
  });

  it('formats the value axis with the compact formatter unless told otherwise', () => {
    const axis = buildOption(base, FIXED_TOKENS).yAxis as { axisLabel: { formatter: (value: number) => string } };
    const custom = buildOption({ ...base, valueFormat: (value) => `${value} min` }, FIXED_TOKENS).yAxis as { axisLabel: { formatter: (value: number) => string } };

    expect(axis.axisLabel.formatter(1500)).toBe('1.5K');
    expect(custom.axisLabel.formatter(30)).toBe('30 min');
  });
});
