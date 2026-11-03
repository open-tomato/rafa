import { describe, expect, it } from 'bun:test';

import {
  categoryAxis,
  firstParam,
  numericAt,
  plotGrid,
  referenceLabelRoom,
  referenceLine,
  timeAxis,
  tooltipNode,
  valueAxis,
  type TooltipParams,
} from './chrome.js';
import { FIXED_TOKENS } from './fixtures.js';

describe('the plot chrome', () => {
  it('keeps the plot rect inside the canvas, with a small gutter by default', () => {
    expect(plotGrid()).toMatchObject({ top: 12, right: 8, bottom: 4, left: 4, outerBoundsContain: 'axisLabel' });
    expect(plotGrid({ right: 40 })).toMatchObject({ right: 40 });
  });

  it('leaves a category axis option unset when no value is given, so the engine default holds', () => {
    const bare = categoryAxis(FIXED_TOKENS, ['a', 'b']);
    const closed = categoryAxis(FIXED_TOKENS, ['a', 'b'], { boundaryGap: false, inverse: true, position: 'top' });

    expect(Object.hasOwn(bare, 'boundaryGap')).toBe(false);
    expect(Object.hasOwn(bare, 'inverse')).toBe(false);
    expect(Object.hasOwn(bare, 'position')).toBe(false);
    expect(closed).toMatchObject({ boundaryGap: false, inverse: true, position: 'top' });
  });

  it('draws the value axis with a hairline solid grid and no axis line', () => {
    const axis = valueAxis(FIXED_TOKENS, (value) => `${value}!`, { min: 0 }) as {
      axisLine: { show: boolean };
      splitLine: { lineStyle: { color: string; width: number; type: string } };
      axisLabel: { color: string; formatter: (value: number) => string };
      min: number;
    };

    expect(axis.axisLine.show).toBe(false);
    expect(axis.splitLine.lineStyle).toEqual({ color: FIXED_TOKENS['grid'], width: 1, type: 'solid' });
    expect(axis.axisLabel.color).toBe(FIXED_TOKENS['muted']);
    expect(axis.axisLabel.formatter(3)).toBe('3!');
    expect(axis.min).toBe(0);
  });

  it('draws a category axis with the line in baseline and no ticks', () => {
    const axis = categoryAxis(FIXED_TOKENS, ['a', 'b']) as {
      data: string[];
      axisLine: { show: boolean; lineStyle: { color: string } };
      axisTick: { show: boolean };
    };

    expect(axis.data).toEqual(['a', 'b']);
    expect(axis.axisLine.lineStyle.color).toBe(FIXED_TOKENS['baseline']);
    expect(axis.axisTick.show).toBe(false);
  });

  it('can hide the line and the labels of a category axis', () => {
    const axis = categoryAxis(FIXED_TOKENS, ['a'], { showLine: false, showLabels: false }) as { axisLine: { show: boolean }; axisLabel: { show: boolean } };

    expect(axis.axisLine.show).toBe(false);
    expect(axis.axisLabel.show).toBe(false);
  });

  it('formats time ticks through the given formatter', () => {
    const axis = timeAxis(FIXED_TOKENS, (date) => `d${date.getUTCDate()}`) as { axisLabel: { formatter: (value: number) => string } };

    expect(axis.axisLabel.formatter(Date.UTC(2026, 10, 1))).toBe('d1');
  });

  it('draws a reference line 1px in ink-2 with its label', () => {
    const line = referenceLine(FIXED_TOKENS, 'yAxis', 50, 'target');

    expect(line.lineStyle).toMatchObject({ color: FIXED_TOKENS['ink-2'], width: 1 });
    expect(line.data).toEqual([{ yAxis: 50 }]);
    expect((line.label as { formatter: () => string }).formatter()).toBe('target');
    expect(referenceLine(FIXED_TOKENS, 'xAxis', 7, 'x').data).toEqual([{ xAxis: 7 }]);
  });

  it('leaves room for a reference label wider than nothing', () => {
    expect(referenceLabelRoom('WIP limit')).toBeGreaterThan(12);
  });
});

describe('the hover readout', () => {
  it('builds a heading and one row per entry, as text nodes', () => {
    const node = tooltipNode('Mon', [{ value: '12', label: 'halts', colour: '#112233', key: 'dot' }, { value: '3', label: 'plain' }]);
    const rows = node.querySelectorAll('strong');

    expect(node.firstElementChild?.textContent).toBe('Mon');
    expect([...rows].map((row) => row.textContent)).toEqual(['12', '3']);
    expect(node.querySelectorAll('span').length).toBe(3);
  });

  it('draws a colour key only for a row with a colour', () => {
    const node = tooltipNode(undefined, [{ value: '1', label: 'a', colour: '#112233' }, { value: '2', label: 'b' }]);
    const [first, second] = [...node.children];

    expect(first?.children).toHaveLength(3);
    expect(second?.children).toHaveLength(2);
    expect((first?.firstElementChild as HTMLElement).style.background).not.toBe('');
  });

  it('writes a hostile label as text, not markup', () => {
    const node = tooltipNode('<img src=x>', [{ value: '1', label: '<b>x</b>' }]);

    expect(node.querySelector('img')).toBeNull();
    expect(node.querySelector('b')).toBeNull();
  });
});

describe('reading tooltip params', () => {
  const item = { seriesIndex: 1, value: [10, 20] } as unknown as Exclude<TooltipParams, unknown[]>;

  it('takes the first of a list, or the single item', () => {
    expect(firstParam([item])).toBe(item);
    expect(firstParam(item)).toBe(item);
  });

  it('reads a number from an array or a plain value', () => {
    expect(numericAt([10, 20], 1)).toBe(20);
    expect(numericAt(7, 0)).toBe(7);
    expect(numericAt(['5'], 0)).toBe(5);
  });
});
