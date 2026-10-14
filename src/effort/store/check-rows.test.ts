/**
 * Tests for the check rows' verdict and failing selection
 * (`src/effort/store/check-rows.ts`).
 *
 * The rows are built by hand, outcome and all, so the case imports its
 * own module and nothing of the `pr` module that parses them. Each
 * verdict sits beside one input differing in the outcome that decides it.
 */

import type { CheckOutcome, CheckRow } from './check-rows.js';

import { describe, expect, it } from 'bun:test';

import { failingRows, verdictOf } from './check-rows.js';

/** One row per entry, named by its key, its outcome as given. */
function rowsOf(outcomes: Record<string, CheckOutcome>): CheckRow[] {
  return Object.entries(outcomes).map(([name, outcome]) => ({
    name,
    state: outcome.toUpperCase(),
    link: '',
    outcome,
  }));
}

describe('verdictOf', () => {
  it('reports none when there are no rows', () => {
    expect(verdictOf([])).toBe('none');
  });

  it('reports green when every row passed', () => {
    expect(verdictOf(rowsOf({ a: 'pass', b: 'pass' }))).toBe('green');
  });

  it('reports red when any row failed', () => {
    expect(verdictOf(rowsOf({ a: 'pass', b: 'fail' }))).toBe('red');
  });

  it('lets pending outrank failure on a partial reading', () => {
    expect(verdictOf(rowsOf({ a: 'fail', b: 'pending' }))).toBe('pending');
  });
});

describe('failingRows', () => {
  it('selects only the failing rows, in their order', () => {
    const rows = rowsOf({ a: 'fail', b: 'pass', c: 'pending', d: 'fail' });
    expect(failingRows(rows).map((r) => r.name)).toEqual(['a', 'd']);
  });

  it('selects none when no row failed', () => {
    expect(failingRows(rowsOf({ a: 'pass', b: 'pending' }))).toEqual([]);
  });
});
