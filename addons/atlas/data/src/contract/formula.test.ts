/**
 * Tests for `formula.ts`: `applyFormula` over each of the four formula
 * kinds, the previous window's rows, and the columns it refuses.
 */
import type { QueryResult } from './types.js';

import { describe, expect, it } from 'bun:test';

import { InvalidParams } from './errors.js';
import { applyFormula } from './formula.js';

/** Three days of done and planned tasks, with one NULL cell. */
const RESULT: QueryResult = {
  columns: [
    { key: 'day', label: 'Day', type: 'date' },
    { key: 'done', label: 'Done', type: 'integer', unit: 'tasks' },
    { key: 'planned', label: 'Planned', type: 'integer' },
  ],
  rows: [
    ['2026-11-01', 2, 4],
    ['2026-11-02', null, 5],
    ['2026-11-03', 6, 0],
  ],
  meta: {
    asOf: null,
    partial: false,
    partialReasons: [],
    rowCount: 3,
    truncated: false,
    window: { from: '2026-11-01', to: '2026-11-03' },
  },
};

const WITH_PREVIOUS: QueryResult = {
  ...RESULT,
  meta: {
    ...RESULT.meta,
    previous: {
      rows: [
        ['2026-10-29', 1, 2],
        ['2026-10-30', 3, 3],
      ],
      window: { from: '2026-10-29', to: '2026-10-31' },
    },
  },
};

/** The values of the last column. */
function lastColumn(result: QueryResult): unknown[] {
  return result.rows.map((row) => row[row.length - 1]);
}

describe('applyFormula, none', () => {
  it('answers the result itself, adding no column', () => {
    expect(applyFormula(RESULT, { kind: 'none' })).toBe(RESULT);
  });
});

describe('applyFormula, ratio', () => {
  it('divides numerator by denominator, null on a NULL cell or a zero denominator', () => {
    const applied = applyFormula(RESULT, {
      kind: 'ratio',
      numerator: 'done',
      denominator: 'planned',
      as: 'rate',
    });

    expect(applied.columns[3]).toEqual({ key: 'rate', label: 'rate', type: 'number' });
    expect(lastColumn(applied)).toEqual([0.5, null, null]);
  });
});

describe('applyFormula, share', () => {
  it('divides each value by its column total, counting a NULL cell as nothing', () => {
    const applied = applyFormula(RESULT, { kind: 'share', of: 'done', as: 'part' });

    expect(applied.columns[3]).toEqual({ key: 'part', label: 'part', type: 'number' });
    expect(lastColumn(applied)).toEqual([0.25, null, 0.75]);
  });

  it('answers null for every row when the column total is zero', () => {
    const zero: QueryResult = { ...RESULT, rows: [['2026-11-01', 0, 1]] };

    expect(lastColumn(applyFormula(zero, { kind: 'share', of: 'done', as: 'part' }))).toEqual([
      null,
    ]);
  });
});

describe('applyFormula, cumulative', () => {
  it('keeps a running sum in row order, with the source column type and unit', () => {
    const applied = applyFormula(RESULT, { kind: 'cumulative', of: 'done', as: 'total' });

    expect(applied.columns[3]).toEqual({
      key: 'total',
      label: 'total',
      type: 'integer',
      unit: 'tasks',
    });
    expect(lastColumn(applied)).toEqual([2, 2, 8]);
  });

  it('leaves the unit out when the source column has none', () => {
    const applied = applyFormula(RESULT, { kind: 'cumulative', of: 'planned', as: 'total' });

    expect(applied.columns[3]).toEqual({ key: 'total', label: 'total', type: 'integer' });
    expect(lastColumn(applied)).toEqual([4, 9, 9]);
  });
});

describe('applyFormula over a result and its previous window', () => {
  it('computes the previous rows on their own, leaving the input untouched', () => {
    const before = JSON.stringify(WITH_PREVIOUS);
    const applied = applyFormula(WITH_PREVIOUS, { kind: 'cumulative', of: 'done', as: 'total' });

    expect(lastColumn(applied)).toEqual([2, 2, 8]);
    expect(applied.meta.previous?.rows.map((row) => row[3])).toEqual([1, 4]);
    expect(applied.meta.previous?.window).toEqual({ from: '2026-10-29', to: '2026-10-31' });
    expect(applied.meta.rowCount).toBe(3);
    expect(JSON.stringify(WITH_PREVIOUS)).toBe(before);
  });
});

describe('applyFormula, refused', () => {
  it('refuses a column the result lacks as InvalidParams naming it', () => {
    const run = (): QueryResult => applyFormula(RESULT, { kind: 'share', of: 'nope', as: 'part' });

    expect(run).toThrow(InvalidParams);
    try {
      run();
    } catch (error: unknown) {
      expect(error instanceof InvalidParams
        ? error.details
        : null).toEqual({ fields: ['nope'] });
    }
  });

  it('refuses a column that is not numeric', () => {
    expect(() => applyFormula(RESULT, { kind: 'cumulative', of: 'day', as: 'total' })).toThrow(
      'not numeric: day',
    );
  });

  it('refuses an as naming a column the result already has', () => {
    expect(() => applyFormula(RESULT, { kind: 'share', of: 'done', as: 'planned' })).toThrow(
      'already has: planned',
    );
  });
});
