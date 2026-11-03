import type { SunburstProps } from '../../seam/types.js';

import { describe, expect, it } from 'bun:test';

import { FIXED_TOKENS, seriesOf, SUNBURST_NODES, SUNBURST_TONES } from '../fixtures.js';

import { buildOption, pathsById } from './Sunburst.option.js';

const base: SunburstProps = { ariaLabel: 'Composition', nodes: SUNBURST_NODES, groupTones: SUNBURST_TONES, unit: 'lines', height: 300 };

type Level = { radius?: string[]; label?: { width: number; minAngle: number; rotate: string } };
type Item = { id: string; value?: number; itemStyle: { color: string }; children?: Item[] };

describe('Sunburst option', () => {
  it('draws two rings as levels after the empty root level', () => {
    const [sunburst] = seriesOf(buildOption(base, FIXED_TOKENS, 300));
    const levels = sunburst?.levels as Level[];

    expect(levels).toHaveLength(3);
    expect(levels[0]).toEqual({});
    expect(levels[1]?.radius).toEqual(['25%', '55%']);
    expect(levels[2]?.radius).toEqual(['57%', '90%']);
  });

  it('sizes the radial label of each ring from its depth in px', () => {
    const [sunburst] = seriesOf(buildOption(base, FIXED_TOKENS, 300));
    const [, inner, outer] = sunburst?.levels as Level[];

    // The view radius is half the smaller of width and height: 150px.
    expect(inner?.label?.width).toBeCloseTo((0.55 - 0.25) * 150 - 8, 10);
    expect(outer?.label?.width).toBeCloseTo((0.9 - 0.57) * 150 - 8, 10);
    expect(inner?.label).toMatchObject({ rotate: 'radial', minAngle: 18 });
  });

  it('never gives a label a negative width before the canvas is measured', () => {
    const [sunburst] = seriesOf(buildOption({ ...base, height: 10 }, FIXED_TOKENS));
    const [, inner] = sunburst?.levels as Level[];

    expect(inner?.label?.width).toBe(0);
  });

  it('sizes the labels from the measured height when the chart fills its container', () => {
    const [sunburst] = seriesOf(buildOption({ ...base, height: 'fill' }, FIXED_TOKENS, 800, 600));
    const [, inner] = sunburst?.levels as Level[];

    // The view radius is half the smaller of 800 x 600: 300px.
    expect(inner?.label?.width).toBeCloseTo((0.55 - 0.25) * 300 - 8, 10);
  });

  it('falls back to the default height while a filling chart is unmeasured', () => {
    const [sunburst] = seriesOf(buildOption({ ...base, height: 'fill' }, FIXED_TOKENS, 800));
    const [, inner] = sunburst?.levels as Level[];

    // The view radius is half of the default 220px: 110px.
    expect(inner?.label?.width).toBeCloseTo((0.55 - 0.25) * 110 - 8, 10);
  });

  it('nests the parts under their package, leaving the parents without a value', () => {
    const [sunburst] = seriesOf(buildOption(base, FIXED_TOKENS, 300));
    const [core] = sunburst?.data as Item[];

    expect(core?.id).toBe('core');
    expect(core?.value).toBeUndefined();
    expect(core?.children?.map((child) => child.id)).toEqual(['core/source', 'core/tests', 'core/docs', 'core/config']);
    expect(core?.children?.[0]?.value).toBe(50);
  });

  it('paints a node by its group tone', () => {
    const [sunburst] = seriesOf(buildOption(base, FIXED_TOKENS, 300));
    const [core] = sunburst?.data as Item[];

    expect(core?.itemStyle.color).toBe(FIXED_TOKENS['series-1']);
    expect(core?.children?.[0]?.itemStyle.color).toBe(FIXED_TOKENS['series-1']);
    expect(core?.children?.[1]?.itemStyle.color).toBe(FIXED_TOKENS['series-3']);
  });

  it('keeps clicks from drilling in, and shows the pointer only with a handler', () => {
    const plain = seriesOf(buildOption(base, FIXED_TOKENS, 300))[0];
    const clickable = seriesOf(buildOption({ ...base, onNodeClick: () => undefined }, FIXED_TOKENS, 300))[0];

    expect(plain?.nodeClick).toBe(false);
    expect(plain?.cursor).toBe('default');
    expect(clickable?.cursor).toBe('pointer');
  });

  it('maps each node id to its ids from the root', () => {
    const paths = pathsById(SUNBURST_NODES);

    expect(paths.get('core')).toEqual(['core']);
    expect(paths.get('board/tests')).toEqual(['board', 'board/tests']);
  });
});
