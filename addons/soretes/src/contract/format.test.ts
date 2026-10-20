import { describe, expect, test } from 'bun:test';

import { formatValue } from './format.ts';

const NOW = new Date('2026-10-20T12:00:00Z');

describe('formatValue', () => {
  test('shortens thousands with compact numbers', () => {
    expect(formatValue(12400, { kind: 'number', compact: true })).toBe('12.4K');
  });

  test('rounds to the asked decimals', () => {
    expect(formatValue(3.14159, { kind: 'number', decimals: 1 })).toBe('3.1');
  });

  test('appends a unit', () => {
    expect(formatValue(240, { kind: 'number', unit: 'ms' })).toBe('240 ms');
  });

  test('reads a ratio or a 0–100 value as a percent', () => {
    expect(formatValue(0.237, { kind: 'percent', ratio: true })).toBe('24%');
    expect(formatValue(23.71, { kind: 'percent', decimals: 1 })).toBe('23.7%');
  });

  test('tells a past and a future date relative to now', () => {
    expect(formatValue('2026-09-29T12:00:00Z', { kind: 'relative-time' }, NOW)).toBe('3 weeks ago');
    expect(formatValue('2026-10-20T14:00:00Z', { kind: 'relative-time' }, NOW)).toBe('in 2 hours');
  });

  test('cuts long text with an ellipsis', () => {
    expect(formatValue('packages/rafa/src/effort/store', { kind: 'text', max: 12 })).toBe('packages/ra…');
  });

  test('counts a list unless asked for its text', () => {
    expect(formatValue(['a', 'b', 'c'], undefined)).toBe('3');
  });

  test('shows a dash for a missing value', () => {
    expect(formatValue(undefined, { kind: 'number' })).toBe('—');
  });
});
