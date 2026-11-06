import type { ScatterChartProps } from '../../seam/types.js';

import { describe, expect, it } from 'bun:test';

import { FIXED_TOKENS, SCATTER_POINTS, SCATTER_TREND, seriesOf } from '../fixtures.js';

import { buildOption } from './ScatterChart.option.js';

const base: ScatterChartProps = {
  ariaLabel: 'Task minutes',
  points: SCATTER_POINTS,
  pointsLabel: 'task',
  yLabel: 'min',
};

describe('ScatterChart option', () => {
  it('draws the dots and an invisible hit layer over them', () => {
    const series = seriesOf(buildOption(base, FIXED_TOKENS));

    expect(series.map((entry) => entry.id)).toEqual(['points', 'points-hit']);
    expect(series[0]?.symbolSize).toBe(10);
    expect(series[1]?.symbolSize).toBe(24);
    expect((series[1]?.itemStyle as { opacity: number }).opacity).toBe(0);
  });

  it('feeds both layers the same points as epoch milliseconds', () => {
    const [dots, hits] = seriesOf(buildOption(base, FIXED_TOKENS));
    const first = SCATTER_POINTS[0];

    expect(dots?.data?.[0]).toEqual([first?.x.getTime(), first?.y]);
    expect(hits?.data).toEqual(dots?.data);
  });

  it('rings each dot with the surface colour', () => {
    const [dots] = seriesOf(buildOption(base, FIXED_TOKENS));
    const style = dots?.itemStyle as { color: string; borderColor: string; borderWidth: number };

    expect(style.color).toBe(FIXED_TOKENS['series-1']);
    expect(style.borderColor).toBe(FIXED_TOKENS['surface']);
    expect(style.borderWidth).toBe(2);
  });

  it('puts the trend line first, 2px in the second tone, so it draws over the dots', () => {
    const series = seriesOf(buildOption({ ...base, trend: SCATTER_TREND, trendLabel: 'average' }, FIXED_TOKENS));
    const trend = series[0];

    expect(series.map((entry) => entry.id)).toEqual(['trend', 'points', 'points-hit']);
    expect((trend?.lineStyle as { color: string; width: number })).toMatchObject({ color: FIXED_TOKENS['series-2'], width: 2 });
    expect(trend?.z).toBeGreaterThan(Number(series[1]?.z));
  });

  it('starts the value axis at zero', () => {
    expect(buildOption(base, FIXED_TOKENS).yAxis).toMatchObject({ type: 'value', min: 0 });
  });
});
