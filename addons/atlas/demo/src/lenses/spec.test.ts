/**
 * Tests for the live rules every lens card shares: `isWired` draws every
 * card over the mock and only fully fed ones over the live source, and
 * `liveNoteOf` says the row count and proxy note behind a live card.
 */
import type { FieldMeta, LensField, LensResult } from '../data/source.js';

import { describe, expect, it } from 'bun:test';

import { lensResultOf } from '../data/source.js';

import { isWired, liveNoteOf } from './spec.js';

/** The mock result relabelled live, `notWired` marked and `fieldMeta` set. */
function liveOf(notWired: readonly LensField[], meta: readonly (readonly [LensField, FieldMeta])[]): LensResult {
  return { ...lensResultOf('past-month'), source: 'live', notWired: new Set(notWired), fieldMeta: new Map(meta) };
}

describe('isWired', () => {
  it('draws every card over the mock, one reading no field included', () => {
    expect(isWired(lensResultOf('now'), [])).toBe(true);
  });

  it('draws a live card only when it reads a field and none it reads is marked', () => {
    const result = liveOf(['balance'], []);

    expect(isWired(result, ['redCiShare'])).toBe(true);
    expect(isWired(result, ['redCiShare', 'balance'])).toBe(false);
    expect(isWired(result, [])).toBe(false);
  });
});

describe('liveNoteOf', () => {
  it('says nothing over the mock', () => {
    expect(liveNoteOf(lensResultOf('now'), ['redCiShare'])).toBeUndefined();
  });

  it('says the row count once per metric, a single row as one', () => {
    const result = liveOf([], [
      ['taskCycle', { metricId: 'dev.task-cycle', rowCount: 1 }],
      ['taskCycleTrend', { metricId: 'dev.task-cycle', rowCount: 1 }],
      ['redCiShare', { metricId: 'dev.red-ci-share', rowCount: 303 }],
    ]);

    expect(liveNoteOf(result, ['taskCycle', 'taskCycleTrend'])).toBe('1 row behind it (dev.task-cycle).');
    expect(liveNoteOf(result, ['redCiShare'])).toBe('303 rows behind it (dev.red-ci-share).');
  });

  it('leads with a proxy metric\'s note', () => {
    const result = liveOf([], [['debtRatio', { metricId: 'arch.debt-ratio', rowCount: 3, proxyNote: 'work type from change level.' }]]);

    expect(liveNoteOf(result, ['debtRatio'])).toBe('Proxy: work type from change level. 3 rows behind it (arch.debt-ratio).');
  });

  it('says nothing for fields with no meta', () => {
    expect(liveNoteOf(liveOf([], []), ['redCiShare'])).toBeUndefined();
  });
});
