import { describe, expect, it } from 'bun:test';

import { echartsEngine } from './index.js';

const PRIMITIVES = [
  'BarChart', 'LineChart', 'ScatterChart', 'Histogram', 'BoxPlot', 'Gauge', 'Bullet', 'Donut',
  'Treemap', 'HeatmapGrid', 'NetworkGraph', 'Sankey', 'Nightingale', 'Sunburst', 'Radar',
] as const;

describe('echartsEngine', () => {
  it('names itself', () => {
    expect(echartsEngine.id).toBe('echarts');
    expect(echartsEngine.label).toBe('ECharts 6');
  });

  it('implements all fifteen primitives', () => {
    for (const name of PRIMITIVES) {
      expect(typeof echartsEngine[name]).toBe('function');
    }
  });

  it('notes what it covers by hand', () => {
    expect(echartsEngine.notes.length).toBeGreaterThan(0);
    expect(echartsEngine.notes.every((note) => note.length > 0)).toBe(true);
  });
});
