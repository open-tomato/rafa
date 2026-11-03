import type { BulletProps } from '../../seam/types.js';

import { describe, expect, it } from 'bun:test';

import { FIXED_TOKENS, seriesOf } from '../fixtures.js';

import { buildOption } from './Bullet.option.js';

const base: BulletProps = { ariaLabel: 'Plans done', value: 78, target: 80, max: 100, ranges: [0.5, 0.8], label: 'on time' };

describe('Bullet option', () => {
  it('draws three bands and the reading bar', () => {
    const series = seriesOf(buildOption(base, FIXED_TOKENS));

    expect(series.map((entry) => entry.name)).toEqual(['band-0', 'band-1', 'band-2', 'on time']);
  });

  it('sizes the bands to the range ends so they add up to the max', () => {
    const bands = seriesOf(buildOption(base, FIXED_TOKENS)).slice(0, 3);
    const widths = bands.map((band) => (band.data?.[0] as number));

    expect(widths[0]).toBeCloseTo(50, 10);
    expect(widths[1]).toBeCloseTo(30, 10);
    expect(widths[2]).toBeCloseTo(20, 10);
    expect(widths.reduce((sum, width) => sum + width, 0)).toBeCloseTo(100, 10);
  });

  it('stacks the bands in the grid colour, lighter where the reading is better', () => {
    const bands = seriesOf(buildOption(base, FIXED_TOKENS)).slice(0, 3);

    expect(bands.map((band) => band.stack)).toEqual(['bands', 'bands', 'bands']);
    expect(bands.map((band) => (band.itemStyle as { color: string }).color)).toEqual([FIXED_TOKENS['grid'], FIXED_TOKENS['grid'], FIXED_TOKENS['grid']]);
    expect(bands.map((band) => (band.itemStyle as { opacity: number }).opacity)).toEqual([0.45, 0.75, 1]);
  });

  it('draws the reading 8px thick, capped at the max, with the target as a line', () => {
    const reading = seriesOf(buildOption({ ...base, value: 140 }, FIXED_TOKENS)).at(-1);

    expect(reading?.barWidth).toBe(8);
    expect(reading?.data).toEqual([100]);
    expect((reading?.markLine as { data: unknown[] }).data).toEqual([{ xAxis: 80 }]);
  });

  it('paints the reading in the first tone, or critical past the target when smaller is better', () => {
    const colourOf = (props: BulletProps): string => (seriesOf(buildOption(props, FIXED_TOKENS)).at(-1)?.itemStyle as { color: string }).color;

    expect(colourOf(base)).toBe(FIXED_TOKENS['series-1']);
    expect(colourOf({ ...base, value: 90, higherIsBetter: false })).toBe(FIXED_TOKENS['critical']);
    expect(colourOf({ ...base, value: 70, higherIsBetter: false })).toBe(FIXED_TOKENS['series-1']);
  });

  it('writes the value and its label beside the track', () => {
    const graphic = buildOption(base, FIXED_TOKENS).graphic as { style: { text: string } }[];

    expect(graphic.map((entry) => entry.style.text)).toEqual(['78', 'on time']);
  });

  it('centres the track and its text in a filling chart, whose height it cannot know', () => {
    const option = buildOption({ ...base, height: 'fill' }, FIXED_TOKENS);
    const [group] = option.graphic as { type: string; top: string; children: { style: { text: string } }[] }[];

    expect(option.grid).toMatchObject({ top: 'middle', height: 28 });
    expect(group).toMatchObject({ type: 'group', top: 'middle' });
    expect(group?.children.map((entry) => entry.style.text)).toEqual(['78', 'on time']);
  });

  it('keeps the px layout for a fixed height', () => {
    const option = buildOption({ ...base, height: 120 }, FIXED_TOKENS);

    // (120 - 28 track - 20 label room) / 2
    expect(option.grid).toMatchObject({ top: 36 });
  });
});
