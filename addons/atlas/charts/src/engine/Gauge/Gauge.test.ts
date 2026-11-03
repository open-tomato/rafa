import type { GaugeProps } from '../../seam/types.js';

import { describe, expect, it } from 'bun:test';

import { FIXED_TOKENS, seriesOf } from '../fixtures.js';

import { buildOption } from './Gauge.option.js';

const base: GaugeProps = { ariaLabel: 'Budget burn', value: 6, max: 12, label: 'of allowance' };

const fillOf = (props: GaugeProps): unknown => (seriesOf(buildOption(props, FIXED_TOKENS))[0]?.progress as { itemStyle: { color: string } }).itemStyle.color;

describe('Gauge option', () => {
  it('draws one arc for a plain reading, clamped to the scale', () => {
    const series = seriesOf(buildOption(base, FIXED_TOKENS));

    expect(series).toHaveLength(1);
    expect(series[0]?.data).toEqual([{ value: 6 }]);
    expect(series[0]).toMatchObject({ min: 0, max: 12 });
  });

  it('fills in the first series tone below the thresholds', () => {
    expect(fillOf({ ...base, thresholds: { warning: 0.7, critical: 0.9 } })).toBe(FIXED_TOKENS['series-1']);
  });

  it('turns the fill warning, then critical, at the thresholds', () => {
    const thresholds = { warning: 0.4, critical: 0.8 };

    expect(fillOf({ ...base, thresholds })).toBe(FIXED_TOKENS['warning']);
    expect(fillOf({ ...base, value: 10, thresholds })).toBe(FIXED_TOKENS['critical']);
  });

  it('adds a thin inner arc for the compare reading', () => {
    const series = seriesOf(buildOption({ ...base, compare: { value: 4, label: 'last week' } }, FIXED_TOKENS));

    expect(series).toHaveLength(2);
    expect(series[1]?.data).toEqual([{ value: 4 }]);
    expect((series[1]?.progress as { width: number }).width).toBe(4);
  });

  it('keeps the arc full and critical past the max, and adds the zero-span max marker', () => {
    const over: GaugeProps = { ...base, value: 14.88 };
    const series = seriesOf(buildOption(over, FIXED_TOKENS));

    expect(series[0]?.data).toEqual([{ value: 12 }]);
    expect(fillOf(over)).toBe(FIXED_TOKENS['critical']);
    expect(series).toHaveLength(2);
    expect(series[1]).toMatchObject({ startAngle: -20, endAngle: -20 });
  });

  it('says the true share past the max in the centre text', () => {
    const [main] = seriesOf(buildOption({ ...base, value: 14.88 }, FIXED_TOKENS));
    const text = (main?.detail as { formatter: () => string }).formatter();

    expect(text).toContain('{big|124%}');
    expect(text).toContain('{label|of allowance}');
  });
});
