import type { HeatmapGridProps } from '../../seam/types.js';

import { describe, expect, it } from 'bun:test';

import { SEQUENTIAL_STEPS } from '../../seam/tones.js';
import { FIXED_TOKENS, HEAT_CELLS, HEAT_COLS, HEAT_ROWS, seriesOf } from '../fixtures.js';

import { buildOption } from './HeatmapGrid.option.js';

const base: HeatmapGridProps = { ariaLabel: 'Halts', rows: HEAT_ROWS, cols: HEAT_COLS, cells: HEAT_CELLS, unit: 'halts' };

describe('HeatmapGrid option', () => {
  it('draws one cell per row and column as [col, row, value]', () => {
    const [heat] = seriesOf(buildOption(base, FIXED_TOKENS));

    expect(heat?.type).toBe('heatmap');
    expect(heat?.data).toHaveLength(HEAT_ROWS.length * HEAT_COLS.length);
    expect(heat?.data?.[0]).toEqual([0, 0, HEAT_CELLS[0]?.[0]]);
  });

  it('maps the values onto the seven steps of the sequential ramp', () => {
    const { visualMap } = buildOption(base, FIXED_TOKENS) as { visualMap: { splitNumber: number; inRange: { color: string[] }; max: number } };

    expect(visualMap.inRange.color).toEqual(SEQUENTIAL_STEPS.map((step) => FIXED_TOKENS[step]));
    expect(visualMap.splitNumber).toBe(7);
    expect(visualMap.max).toBe(Math.max(1, ...HEAT_CELLS.flat()));
  });

  it('puts the first row at the top and labels every nth column', () => {
    const option = buildOption({ ...base, colLabelEvery: 4 }, FIXED_TOKENS);

    expect(option.yAxis).toMatchObject({ inverse: true });
    expect((option.xAxis as { axisLabel: { interval: number } }).axisLabel.interval).toBe(3);
  });

  it('keeps every cell and draws the selected one last, with an ink ring', () => {
    const [heat] = seriesOf(buildOption({ ...base, selected: { row: 2, col: 5 } }, FIXED_TOKENS));
    const last = heat?.data?.at(-1) as { value: number[]; itemStyle: { borderColor: string; borderWidth: number } };

    expect(heat?.data).toHaveLength(HEAT_ROWS.length * HEAT_COLS.length);
    expect(last.value).toEqual([5, 2, HEAT_CELLS[2]?.[5]]);
    expect(last.itemStyle).toEqual({ borderColor: FIXED_TOKENS['ink'], borderWidth: 2 });
  });

  it('separates cells with a 2px surface stroke', () => {
    const [heat] = seriesOf(buildOption(base, FIXED_TOKENS));

    expect(heat?.itemStyle).toMatchObject({ borderColor: FIXED_TOKENS['surface'], borderWidth: 2 });
  });
});
