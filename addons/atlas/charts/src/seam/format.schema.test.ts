import type { ValueFormat } from './format.js';

import { describe, expect, it } from 'bun:test';

import { formatterFor } from './format.js';
import { formatContextSchema, valueFormatSchema } from './format.schema.js';

/** One format of every kind, with every optional field set. */
const EVERY_KIND: readonly ValueFormat[] = [
  { kind: 'raw', digits: 2 },
  { kind: 'number', digits: 1, grouping: false },
  { kind: 'compact' },
  { kind: 'percent', digits: 1, of: 'percent' },
  { kind: 'money', currency: 'EUR', digits: 0 },
  { kind: 'unit', unit: 'min', position: 'before' },
  { kind: 'duration', from: 'ms' },
  { kind: 'date', pattern: 'datetime' },
  { kind: 'custom', id: 'tokens' },
];

describe('valueFormatSchema', () => {
  it('accepts every kind as it is', () => {
    for (const format of EVERY_KIND) expect(valueFormatSchema.parse(format)).toEqual(format);
  });

  it('accepts a JSON round trip, so a contract can carry a format as data', () => {
    const parsed = valueFormatSchema.parse(JSON.parse(JSON.stringify({ kind: 'percent' })));

    expect(formatterFor(parsed, { locale: 'en-GB' })(0.5)).toBe('50%');
  });

  it('refuses an unknown kind, a missing field and a bad value', () => {
    expect(valueFormatSchema.safeParse({ kind: 'nope' }).success).toBe(false);
    expect(valueFormatSchema.safeParse({ kind: 'unit' }).success).toBe(false);
    expect(valueFormatSchema.safeParse({ kind: 'date', pattern: 'year' }).success).toBe(false);
    expect(valueFormatSchema.safeParse({ kind: 'money', currency: 'EURO' }).success).toBe(false);
    expect(valueFormatSchema.safeParse({ kind: 'number', digits: 1.5 }).success).toBe(false);
    expect(valueFormatSchema.safeParse({ kind: 'raw', digits: 21 }).success).toBe(false);
  });
});

describe('formatContextSchema', () => {
  it('accepts the defaults spelt out, and an empty context', () => {
    expect(formatContextSchema.parse({ locale: 'de-DE', currency: 'EUR', timeZone: 'UTC' })).toEqual({ locale: 'de-DE', currency: 'EUR', timeZone: 'UTC' });
    expect(formatContextSchema.parse({})).toEqual({});
  });

  it('keeps custom formatters that are functions', () => {
    const tokens = (value: number): string => String(value);

    expect(formatContextSchema.parse({ customFormatters: { tokens } }).customFormatters?.['tokens']).toBe(tokens);
  });

  it('refuses a locale Intl rejects, a time zone other than UTC and a formatter that is no function', () => {
    expect(formatContextSchema.safeParse({ locale: 'not a locale' }).success).toBe(false);
    expect(formatContextSchema.safeParse({ timeZone: 'Europe/Berlin' }).success).toBe(false);
    expect(formatContextSchema.safeParse({ customFormatters: { tokens: 'x' } }).success).toBe(false);
  });
});
