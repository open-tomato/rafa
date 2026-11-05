import type { DonutProps } from '../../seam/types.js';

import { describe, expect, it } from 'bun:test';

import { withAlpha } from '../core.js';
import { DONUT_PREVIOUS, DONUT_SLICES, FIXED_TOKENS, seriesOf } from '../fixtures.js';

import { buildOption } from './Donut.option.js';

const base: DonutProps = { ariaLabel: 'Minutes by kind', slices: DONUT_SLICES };

describe('Donut option', () => {
  it('draws one ring with a slice per input, in its tone', () => {
    const series = seriesOf(buildOption(base, FIXED_TOKENS));

    expect(series.map((entry) => entry.id)).toEqual(['main']);
    expect(series[0]?.data?.map((slice) => (slice as { name: string }).name)).toEqual(['feat', 'fix', 'refactor', 'chore']);
    expect((series[0]?.data?.[0] as { itemStyle: { color: string } }).itemStyle.color).toBe(FIXED_TOKENS['series-1']);
  });

  it('separates slices with a 2px surface stroke', () => {
    const [ring] = seriesOf(buildOption(base, FIXED_TOKENS));

    expect(ring?.itemStyle).toEqual({ borderColor: FIXED_TOKENS['surface'], borderWidth: 2 });
  });

  it('adds the previous period as a thinner inner ring in a washed tone, and moves the main ring out', () => {
    const plain = seriesOf(buildOption(base, FIXED_TOKENS));
    const series = seriesOf(buildOption({ ...base, compare: { label: 'last month', slices: DONUT_PREVIOUS } }, FIXED_TOKENS));
    const washed = (series[1]?.data?.[0] as { itemStyle: { color: string } }).itemStyle.color;

    expect(series.map((entry) => entry.id)).toEqual(['main', 'compare']);
    expect(series[0]?.radius).not.toEqual(plain[0]?.radius);
    expect(washed).toBe(withAlpha(FIXED_TOKENS['series-1'] ?? '', 0.6));
    expect(series[1]?.data?.map((slice) => (slice as { value: number }).value)).toEqual([4600, 3300, 1200, 1000]);
  });

  it('draws no centre text unless given one', () => {
    expect(buildOption(base, FIXED_TOKENS).graphic).toEqual([]);
  });

  it('draws the centre value and label as rich text', () => {
    const graphic = buildOption({ ...base, centerValue: '10.7K', centerLabel: 'minutes' }, FIXED_TOKENS).graphic as { style: { text: string } }[];

    expect(graphic[0]?.style.text).toBe('{value|10.7K}\n{label|minutes}');
  });
});
