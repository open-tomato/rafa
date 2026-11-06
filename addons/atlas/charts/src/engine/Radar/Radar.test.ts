import type { RadarProps } from '../../seam/types.js';

import { describe, expect, it } from 'bun:test';
import { color } from 'echarts/core';

import { FIXED_TOKENS, RADAR_AXES, RADAR_POLES, RADAR_SERIES, seriesOf } from '../fixtures.js';

import { buildOption } from './Radar.option.js';

const base: RadarProps = {
  ariaLabel: 'Balance',
  axes: RADAR_AXES,
  poles: RADAR_POLES,
  series: RADAR_SERIES,
  max: 2,
  baseline: { value: 1, label: 'as usual' },
};

type Datum = { name: string; value: number | number[]; itemStyle?: { color: string } };

const bandsOf = (props: RadarProps): readonly ReturnType<typeof seriesOf>[number][] => seriesOf(buildOption(props, FIXED_TOKENS)).filter((entry) => entry.id?.startsWith('band-'));

/** The alpha of the wedge colour of the first pole in one band. */
const alphaOf = (band: ReturnType<typeof seriesOf>[number] | undefined): number => color.parse((band?.data?.[0] as Datum).itemStyle?.color ?? '')?.[3] ?? NaN;

describe('Radar option', () => {
  it('draws the scale as a circle radar with one indicator per axis, on the 0..max scale', () => {
    const [scale] = buildOption(base, FIXED_TOKENS).radar as { shape: string; indicator: { name: string; min: number; max: number }[] }[];

    expect(scale?.shape).toBe('circle');
    expect(scale?.indicator.map((indicator) => indicator.name)).toEqual(RADAR_AXES.map((axis) => axis.label));
    expect(scale?.indicator.every((indicator) => indicator.min === 0 && indicator.max === 2)).toBe(true);
  });

  it('draws the wedges as twelve stacked bands, one slice per run of contiguous axes', () => {
    const bands = bandsOf(base);

    expect(bands).toHaveLength(12);
    expect(bands.map((band) => band.id)).toEqual(Array.from({ length: 12 }, (_, index) => `band-${index}`));
    expect(bands[0]?.data).toEqual([
      expect.objectContaining({ name: 'shipping', value: 3 }),
      expect.objectContaining({ name: 'failing', value: 3 }),
      expect.objectContaining({ name: 'foundation', value: 2 }),
    ]);
  });

  it('steps each wedge from the core colour at the centre to the rim colour at the edge', () => {
    const bands = bandsOf({ ...base, baseline: undefined });
    const channelsOf = (band: (typeof bands)[number] | undefined): number[] => color.parse((band?.data?.[0] as Datum).itemStyle?.color ?? '') ?? [];
    const core = color.parse(FIXED_TOKENS['pole-ship-core'] ?? '') ?? [];
    const rim = color.parse(FIXED_TOKENS['pole-ship'] ?? '') ?? [];
    const innermost = channelsOf(bands[0]);
    const outermost = channelsOf(bands[11]);

    // Band 0 sits a twenty-fourth of the way out, band 11 twenty-third twenty-fourths.
    expect(Math.abs((innermost[0] ?? 0) - (core[0] ?? 0))).toBeLessThan(Math.abs((outermost[0] ?? 0) - (core[0] ?? 0)));
    expect(Math.abs((outermost[0] ?? 0) - (rim[0] ?? 0))).toBeLessThan(Math.abs((innermost[0] ?? 0) - (rim[0] ?? 0)));
  });

  it('draws the baseline ring as a second one-axis radar sized to its share of the scale', () => {
    const radars = buildOption(base, FIXED_TOKENS).radar as { radius: string; indicator: { name: string }[] }[];

    expect(radars).toHaveLength(2);
    expect(radars[1]?.indicator[0]?.name).toBe('as usual');
    // A value of 1 on a scale of 2 is half of the 60% radar radius.
    expect(radars[1]?.radius).toBe('30%');
  });

  it('draws no ring when there is no baseline, or it lies off the scale', () => {
    expect(buildOption({ ...base, baseline: undefined }, FIXED_TOKENS).radar).toHaveLength(1);
    expect(buildOption({ ...base, baseline: { value: 3, label: 'off' } }, FIXED_TOKENS).radar).toHaveLength(1);
  });

  it('firms up the core inside the ring as the history grows, and leaves the rim alone', () => {
    const young = bandsOf({ ...base, history: { weeks: 2, of: 12 } });
    const settled = bandsOf({ ...base, history: { weeks: 12, of: 12 } });

    expect(alphaOf(young[0])).toBeCloseTo(0.14 + (0.8 - 0.14) / 6, 2);
    expect(alphaOf(settled[0])).toBeCloseTo(0.8, 2);
    expect(alphaOf(young[11])).toBeCloseTo(0.14, 2);
    expect(alphaOf(settled[11])).toBeCloseTo(0.14, 2);
  });

  it('treats a missing history as full', () => {
    expect(alphaOf(bandsOf(base)[0])).toBeCloseTo(0.8, 2);
  });

  it('thickens the ring stroke with the history', () => {
    const widthOf = (props: RadarProps): unknown => ((buildOption(props, FIXED_TOKENS).radar as { splitLine: { lineStyle: { width: number } } }[])[1])?.splitLine.lineStyle.width;

    expect(widthOf({ ...base, history: { weeks: 12, of: 12 } })).toBe(2);
    expect(widthOf({ ...base, history: { weeks: 0, of: 12 } })).toBe(1);
  });

  it('labels one wedge per pole, with its icon, on a transparent pie', () => {
    const poles = seriesOf(buildOption(base, FIXED_TOKENS)).find((entry) => entry.id === 'poles');
    const formatter = (poles?.label as { formatter: (params: { dataIndex: number }) => string }).formatter;

    expect(poles?.data).toHaveLength(3);
    expect(formatter({ dataIndex: 0 })).toBe('\u{1F4E6} Shipping');
  });

  it('draws each series as a radar shape in its tone, with one value per axis', () => {
    const shapes = seriesOf(buildOption(base, FIXED_TOKENS)).find((entry) => entry.id === 'shapes');
    const [now] = shapes?.data as { value: number[]; lineStyle: { color: string; width: number } }[];

    expect(shapes?.type).toBe('radar');
    expect(now?.value).toEqual([1.35, 1.2, 1.5, 1.1, 1.45, 1.25, 0.55, 0.8]);
    expect(now?.lineStyle).toMatchObject({ color: FIXED_TOKENS['neutral'], width: 2 });
  });

  it('lays a hit slice over each axis', () => {
    const axes = seriesOf(buildOption(base, FIXED_TOKENS)).find((entry) => entry.id === 'axes');

    expect(axes?.data).toHaveLength(RADAR_AXES.length);
  });
});
