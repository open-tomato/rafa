/**
 * Tests for `window.ts`: a plain-date `to` covering its whole day, `last`
 * counting back from the end of today, months cut to the month's last day,
 * the previous window, and the refusals.
 */
import { describe, expect, it } from 'bun:test';

import { InvalidParams } from '../contract/errors.js';

import { boundText, previousWindow, resolveWindow } from './window.js';

const NOW = new Date('2026-11-15T12:00:00.000Z');

function isoOf(window: { readonly from: Date | null; readonly to: Date | null }): readonly (string | null)[] {
  return [window.from?.toISOString() ?? null, window.to?.toISOString() ?? null];
}

describe('resolveWindow', () => {
  it('leaves both ends open with no window', () => {
    expect(isoOf(resolveWindow(undefined, NOW))).toEqual([null, null]);
  });

  it('reads a plain-date to as the end of that day, and a stamp as itself', () => {
    expect(isoOf(resolveWindow({ from: '2026-11-01', to: '2026-11-07' }, NOW)))
      .toEqual(['2026-11-01T00:00:00.000Z', '2026-11-08T00:00:00.000Z']);
    expect(isoOf(resolveWindow({ from: '2026-11-01T06:00:00+02:00', to: '2026-11-07T10:00:00Z' }, NOW)))
      .toEqual(['2026-11-01T04:00:00.000Z', '2026-11-07T10:00:00.000Z']);
  });

  it('counts last in days and weeks back from the end of today', () => {
    expect(isoOf(resolveWindow({ last: '7d' }, NOW))).toEqual(['2026-11-09T00:00:00.000Z', '2026-11-16T00:00:00.000Z']);
    expect(isoOf(resolveWindow({ last: '2w' }, NOW))).toEqual(['2026-11-02T00:00:00.000Z', '2026-11-16T00:00:00.000Z']);
  });

  it('counts last in calendar months, a day past the month\'s end cut to its last day', () => {
    expect(isoOf(resolveWindow({ last: '1m', to: '2026-03-30' }, NOW))).toEqual(['2026-02-28T00:00:00.000Z', '2026-03-31T00:00:00.000Z']);
  });

  it('refuses a window that ends before it starts, last of zero and last with from', () => {
    expect(() => resolveWindow({ from: '2026-11-09', to: '2026-11-01' }, NOW)).toThrow(InvalidParams);
    expect(() => resolveWindow({ last: '0d' }, NOW)).toThrow(InvalidParams);
    expect(() => resolveWindow({ last: '7d', from: '2026-11-01' }, NOW)).toThrow(InvalidParams);
  });
});

describe('previousWindow', () => {
  it('ends where the asked window starts and is as long', () => {
    const window = { from: '2026-11-09', to: '2026-11-15' };

    expect(isoOf(previousWindow(window, resolveWindow(window, NOW)))).toEqual(['2026-11-02T00:00:00.000Z', '2026-11-09T00:00:00.000Z']);
  });

  it('steps back by calendar months for a last in months', () => {
    const window = { last: '1m', to: '2026-03-31' };

    expect(isoOf(previousWindow(window, resolveWindow(window, NOW)))).toEqual(['2026-02-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z']);
  });

  it('refuses a window open at either end', () => {
    expect(() => previousWindow({ to: '2026-11-01' }, resolveWindow({ to: '2026-11-01' }, NOW))).toThrow(InvalidParams);
    expect(() => previousWindow(undefined, resolveWindow(undefined, NOW))).toThrow(InvalidParams);
  });
});

describe('boundText', () => {
  it('writes a day for a date field and a full stamp for a datetime one', () => {
    const bound = new Date('2026-11-08T00:00:00.000Z');

    expect(boundText(bound, 'date')).toBe('2026-11-08');
    expect(boundText(bound, 'datetime')).toBe('2026-11-08T00:00:00.000Z');
  });
});
