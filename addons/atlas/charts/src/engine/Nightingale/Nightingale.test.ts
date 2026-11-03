import type { NightingaleProps } from '../../seam/types.js';

import { describe, expect, it } from 'bun:test';

import { FIXED_TOKENS, LAYER_TONES, ROSE_SLICES, seriesOf } from '../fixtures.js';

import { buildOption } from './Nightingale.option.js';

const base: NightingaleProps = { ariaLabel: 'Package size', slices: ROSE_SLICES, groupTones: LAYER_TONES, unit: 'lines' };

type RoseDatum = { id: string; value: number; itemStyle: { color: string }; label: { show: boolean } };

describe('Nightingale option', () => {
  it('draws a pie rose where the radius, not the angle, carries the value', () => {
    const [rose] = seriesOf(buildOption(base, FIXED_TOKENS));

    expect(rose?.type).toBe('pie');
    expect(rose?.roseType).toBe('area');
  });

  it('draws a slice per input, keyed by id, in its group tone', () => {
    const [rose] = seriesOf(buildOption(base, FIXED_TOKENS));
    const slices = rose?.data as RoseDatum[];

    expect(slices.map((slice) => slice.id)).toEqual(ROSE_SLICES.map((slice) => slice.id));
    expect(slices[0]?.itemStyle.color).toBe(FIXED_TOKENS['series-1']);
  });

  it('lets a slice tone win over its group tone', () => {
    const [rose] = seriesOf(buildOption({ ...base, slices: [{ id: 'a', label: 'a', value: 1, group: 'core', tone: 'critical' }] }, FIXED_TOKENS));

    expect((rose?.data?.[0] as RoseDatum).itemStyle.color).toBe(FIXED_TOKENS['critical']);
  });

  it('switches the label off for a slice under 4% of the total', () => {
    const [rose] = seriesOf(buildOption(base, FIXED_TOKENS));
    const slices = rose?.data as RoseDatum[];

    expect(slices.find((slice) => slice.id === 'core')?.label.show).toBe(true);
    expect(slices.find((slice) => slice.id === 'data')?.label.show).toBe(false);
  });
});
