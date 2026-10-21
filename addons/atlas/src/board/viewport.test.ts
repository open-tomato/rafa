import { describe, expect, test } from 'bun:test';

import { fitTo, toScreen, toWorld, zoomAt } from './viewport.ts';

describe('viewport', () => {
  test('world y runs up the screen', () => {
    const v = { x: 100, y: 100, k: 2 };
    expect(toScreen(v, [10, 10])).toEqual([120, 80]);
    expect(toWorld(v, [120, 80])).toEqual([10, 10]);
  });

  test('zooming keeps the world point under the cursor in place', () => {
    const v = { x: 40, y: 300, k: 1.5 };
    const cursor = [210, 90] as const;
    const before = toWorld(v, cursor);
    const after = toWorld(zoomAt(v, 2, cursor), cursor);
    expect(after[0]).toBeCloseTo(before[0]);
    expect(after[1]).toBeCloseTo(before[1]);
  });

  test('fitting centres the bounds in the box with a margin', () => {
    const v = fitTo({ minX: -10, maxX: 10, minY: -5, maxY: 5 }, { width: 400, height: 200 }, 0.1);
    expect(toScreen(v, [0, 0])).toEqual([200, 100]);
    expect(v.k).toBeCloseTo(18);
  });

  test('an empty or single-point bound still gives a usable zoom', () => {
    const v = fitTo({ minX: 3, maxX: 3, minY: 3, maxY: 3 }, { width: 400, height: 200 }, 0.1);
    expect(Number.isFinite(v.k)).toBe(true);
    expect(toScreen(v, [3, 3])).toEqual([200, 100]);
  });
});
