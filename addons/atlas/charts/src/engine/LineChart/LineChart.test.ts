import type { LineChartProps } from '../../seam/types.js';
import type { ChartOption } from '../core.js';

import { describe, expect, it } from 'bun:test';

import { AREA_SERIES, FIXED_TOKENS, LINE_SERIES, seriesOf } from '../fixtures.js';

import { carryZoom, readZoomWindow } from './LineChart.js';
import { buildOption } from './LineChart.option.js';

const base: LineChartProps = {
  ariaLabel: 'Tokens per day',
  series: LINE_SERIES,
  zoom: true,
};

const liveOption = (zoom: Record<string, number>): { getOption: () => ChartOption } => ({
  getOption: () => ({ dataZoom: [zoom] }) as unknown as ChartOption,
});

describe('LineChart option', () => {
  it('draws one line per series, keyed by id, in the series tone', () => {
    const series = seriesOf(buildOption(base, FIXED_TOKENS));

    expect(series.map((entry) => entry.id)).toEqual(['opus', 'sonnet']);
    expect((series[0]?.lineStyle as { color: string; width: number }).color).toBe(FIXED_TOKENS['series-1']);
    expect((series[1]?.lineStyle as { color: string }).color).toBe(FIXED_TOKENS['series-2']);
  });

  it('strokes lines 2px wide and keeps the dots hidden until hover', () => {
    const [opus] = seriesOf(buildOption(base, FIXED_TOKENS));

    expect((opus?.lineStyle as { width: number }).width).toBe(2);
    expect(opus?.showSymbol).toBe(false);
    expect(opus?.symbolSize).toBe(10);
  });

  it('feeds the points as epoch milliseconds', () => {
    const [opus] = seriesOf(buildOption(base, FIXED_TOKENS));
    const first = LINE_SERIES[0]?.points[0];

    expect(opus?.data?.[0]).toEqual([first?.x.getTime(), first?.y]);
  });

  it('adds no area for the line variant', () => {
    const series = seriesOf(buildOption({ ...base, variant: 'line' }, FIXED_TOKENS));

    expect(series.map((entry) => entry.areaStyle)).toEqual([undefined, undefined]);
  });

  it('washes the area variant at 10%', () => {
    const [only] = seriesOf(buildOption({ ...base, series: AREA_SERIES, variant: 'area' }, FIXED_TOKENS));

    expect((only?.areaStyle as { opacity: number }).opacity).toBe(0.1);
    expect(only?.stack).toBeUndefined();
  });

  it('stacks the series for the stacked-area variant', () => {
    const series = seriesOf(buildOption({ ...base, variant: 'stacked-area' }, FIXED_TOKENS));

    expect(series.map((entry) => entry.stack)).toEqual(['total', 'total']);
  });

  it('puts the baseline on the first series and lifts the axis ceiling to it', () => {
    const option = buildOption({ ...base, baseline: { value: 9_000_000, label: 'average' } }, FIXED_TOKENS);
    const series = seriesOf(option);
    const { max } = option.yAxis as { max: (extent: { max: number }) => number };

    expect(series[0]?.markLine).toBeDefined();
    expect(series[1]?.markLine).toBeUndefined();
    expect(max({ max: 1_000 })).toBe(9_000_000);
  });

  describe('zoom', () => {
    it('adds a slider and an inside zoom over the whole range, with room under the plot', () => {
      const option = buildOption(base, FIXED_TOKENS);
      const zoom = option.dataZoom as { type: string; start: number; end: number }[];

      expect(zoom.map((entry) => entry.type)).toEqual(['slider', 'inside']);
      expect(zoom.map((entry) => [entry.start, entry.end])).toEqual([[0, 100], [0, 100]]);
      expect(option.grid).toMatchObject({ bottom: 36 });
    });

    it('adds neither without the zoom flag', () => {
      const option = buildOption({ ...base, zoom: false }, FIXED_TOKENS);

      expect(option.dataZoom).toBeUndefined();
      expect(option.grid).toMatchObject({ bottom: 4 });
    });

    it('reads a zoomed window from the live chart', () => {
      expect(readZoomWindow(liveOption({ start: 20, end: 60, startValue: 100, endValue: 200 }))).toEqual({ from: 100, to: 200 });
    });

    it('reads no window from an instance that has no option yet', () => {
      const fresh = { getOption: () => undefined } as unknown as { getOption: () => ChartOption };
      const option = buildOption(base, FIXED_TOKENS);

      expect(readZoomWindow(fresh)).toBeNull();
      expect(carryZoom(option, fresh)).toBe(option);
    });

    it('reads the whole range as no window', () => {
      expect(readZoomWindow(liveOption({ start: 0, end: 100, startValue: 1, endValue: 9 }))).toBeNull();
    });

    it('pins the live window into a rebuilt option by value, dropping the percent range', () => {
      const rebuilt = buildOption(base, FIXED_TOKENS);
      const carried = carryZoom(rebuilt, liveOption({ start: 20, end: 60, startValue: 100, endValue: 200 }));
      const zoom = carried.dataZoom as Record<string, unknown>[];

      expect(zoom.map((entry) => [entry.startValue, entry.endValue])).toEqual([[100, 200], [100, 200]]);
      expect(zoom.map((entry) => 'start' in entry || 'end' in entry)).toEqual([false, false]);
      expect(zoom.map((entry) => entry.type)).toEqual(['slider', 'inside']);
    });

    it('leaves the option untouched while the whole range shows', () => {
      const rebuilt = buildOption(base, FIXED_TOKENS);

      expect(carryZoom(rebuilt, liveOption({ start: 0, end: 100 }))).toBe(rebuilt);
    });
  });
});
