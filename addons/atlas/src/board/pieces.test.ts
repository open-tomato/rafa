import { describe, expect, test } from 'bun:test';

import { SHAPES } from '../geometry/dice.ts';
import { morph, piecesOf } from './pieces.ts';

const close = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6;

describe('piecesOf', () => {
  test('every piece has as many open points as folded points', () => {
    for (const shape of Object.values(SHAPES)) {
      for (const piece of piecesOf(shape)) expect(piece.open.length).toBe(piece.folded.length);
    }
  });

  test('a d6 front face opens in place, since the net is laid on the front plane', () => {
    const front = piecesOf(SHAPES.d6).find((p) => !p.back && p.folded.every(([x, y], i) => close(x, p.open[i]![0]) && close(y, p.open[i]![1])));
    expect(front).toBeDefined();
  });

  test('a d6 seen from the front hides only its back face; the four sides are edge-on', () => {
    expect(piecesOf(SHAPES.d6).filter((p) => p.back).length).toBe(1);
  });

  test('the cylinder opens into its cells and both caps', () => {
    const cyl = SHAPES.cylinder;
    expect(piecesOf(cyl).length).toBe(cyl.cells.length + cyl.regions.length);
  });
});

describe('morph', () => {
  test('returns the folded outline at 0 and the open outline at 1', () => {
    const piece = { folded: [[0, 0], [2, 0]] as const, open: [[4, 4], [6, 4]] as const, back: false };
    expect(morph(piece, 0)).toEqual([[0, 0], [2, 0]]);
    expect(morph(piece, 1)).toEqual([[4, 4], [6, 4]]);
    expect(morph(piece, 0.5)).toEqual([[2, 2], [4, 2]]);
  });
});
