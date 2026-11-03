import { describe, expect, it } from 'bun:test';

import {
  formatCompact,
  formatDate,
  formatDay,
  formatMeasured,
  formatMinutes,
  formatPercent,
  formatterFor,
  formatWeek,
  resolveFormatContext,
  type ValueFormat,
} from './format.js';

/** 23:30 UTC on 1 Nov 2026: the next day east of UTC+0:30. */
const LATE = new Date(Date.UTC(2026, 10, 1, 23, 30));

describe('formatCompact', () => {
  it('keeps integers below a thousand as they are', () => {
    expect(formatCompact(0)).toBe('0');
    expect(formatCompact(999)).toBe('999');
  });

  it('shortens thousands and millions to one decimal, dropping a trailing zero', () => {
    expect(formatCompact(1_284)).toBe('1.3K');
    expect(formatCompact(2_000)).toBe('2K');
    expect(formatCompact(4_200_000)).toBe('4.2M');
  });

  it('keeps one decimal on a small fraction', () => {
    expect(formatCompact(0.25)).toBe('0.3');
    expect(formatCompact(1.04)).toBe('1');
  });

  it('keeps the sign', () => {
    expect(formatCompact(-1_500)).toBe('-1.5K');
  });
});

describe('formatPercent', () => {
  it('rounds a fraction to a whole percent', () => {
    expect(formatPercent(0.784)).toBe('78%');
    expect(formatPercent(1.24)).toBe('124%');
  });
});

describe('formatMinutes', () => {
  it('shows minutes below an hour and hours from an hour', () => {
    expect(formatMinutes(45.4)).toBe('45 min');
    expect(formatMinutes(90)).toBe('1.5 h');
    expect(formatMinutes(120)).toBe('2 h');
  });
});

describe('formatDay and formatWeek', () => {
  const noon = new Date(Date.UTC(2026, 10, 1, 12));

  it('writes the day in a fixed locale', () => {
    expect(formatDay(noon)).toBe('1 Nov');
  });

  it('prefixes the week', () => {
    expect(formatWeek(noon)).toBe('w/c 1 Nov');
  });

  it('writes the UTC day of a date late in the UTC day', () => {
    expect(formatDay(LATE)).toBe('1 Nov');
    expect(formatWeek(LATE)).toBe('w/c 1 Nov');
  });

  // The process's own timezone cannot be switched at run time, so a child
  // process runs under a zone fourteen hours ahead, where 23:30 UTC is the
  // next day locally.
  it('writes the UTC day under a timezone where it is already the next day', () => {
    const entry = new URL('./format.ts', import.meta.url).pathname;
    const script = [
      `const { formatDay, formatterFor } = await import(${JSON.stringify(entry)});`,
      `const late = new Date(${LATE.getTime()});`,
      'process.stdout.write(JSON.stringify([late.getDate(), formatDay(late), formatterFor({ kind: \'date\', pattern: \'datetime\' })(late.getTime())]));',
    ].join('\n');
    const child = Bun.spawnSync([process.execPath, '-e', script], { env: { ...process.env, TZ: 'Pacific/Kiritimati' } });

    expect(child.stderr.toString()).toBe('');
    expect(JSON.parse(child.stdout.toString())).toEqual([2, '1 Nov', '1 Nov, 23:30']);
  });
});

describe('formatDate', () => {
  it('writes every pattern in UTC, from a date or an epoch', () => {
    expect(formatDate(LATE, 'day')).toBe('1 Nov');
    expect(formatDate(LATE.getTime(), 'week')).toBe('w/c 1 Nov');
    expect(formatDate(LATE, 'time')).toBe('23:30');
    expect(formatDate(LATE, 'datetime')).toBe('1 Nov, 23:30');
    expect(formatDate(LATE, 'month')).toBe('Nov 2026');
  });

  it('reads the locale it is given', () => {
    expect(formatDate(LATE, 'day', 'de-DE')).toBe('1. Nov.');
    expect(formatDate(LATE, 'month', 'de-DE')).toBe('Nov. 2026');
  });
});

/** Writes `value` under `spec` in a pinned locale. */
function write(spec: ValueFormat, value: number, locale = 'en-GB'): string {
  return formatterFor(spec, { locale })(value);
}

describe('formatterFor', () => {
  it('raw: String(value), or fixed digits', () => {
    expect(write({ kind: 'raw' }, 1234.5)).toBe('1234.5');
    expect(write({ kind: 'raw', digits: 2 }, 1234.5)).toBe('1234.50');
  });

  it('number: grouped in the locale, with fixed digits when asked', () => {
    expect(write({ kind: 'number' }, 1_234_567.891)).toBe('1,234,567.891');
    expect(write({ kind: 'number' }, 1_234_567.891, 'de-DE')).toBe('1.234.567,891');
    expect(write({ kind: 'number', digits: 1 }, 1234.56)).toBe('1,234.6');
    expect(write({ kind: 'number', grouping: false }, 1234.5)).toBe('1234.5');
  });

  it('compact: formatCompact, "K" for thousands in every locale', () => {
    expect(write({ kind: 'compact' }, 1000)).toBe('1K');
    expect(write({ kind: 'compact' }, 1_200_000, 'de-DE')).toBe('1.2M');
  });

  it('percent: a fraction by default, or a value already in percent', () => {
    expect(write({ kind: 'percent' }, 0.78)).toBe('78%');
    expect(write({ kind: 'percent', of: 'percent' }, 78)).toBe('78%');
    expect(write({ kind: 'percent', digits: 1 }, 0.7843)).toBe('78.4%');
    expect(write({ kind: 'percent' }, 0.78, 'de-DE')).toBe('78\u00A0%');
  });

  it('money: the format\'s currency, else the context\'s, else USD', () => {
    expect(write({ kind: 'money' }, 1234.5)).toBe('US$1,234.50');
    expect(write({ kind: 'money', currency: 'EUR' }, 1234.5, 'de-DE')).toBe('1.234,50\u00A0€');
    expect(formatterFor({ kind: 'money' }, { locale: 'en-GB', currency: 'GBP' })(12)).toBe('£12.00');
    expect(write({ kind: 'money', currency: 'GBP', digits: 0 }, 1234.5)).toBe('£1,235');
  });

  it('unit: after the number with a space, or before it with none', () => {
    expect(write({ kind: 'unit', unit: 'min' }, 45)).toBe('45 min');
    expect(write({ kind: 'unit', unit: 'min' }, 1234.5, 'de-DE')).toBe('1.234,5 min');
    expect(write({ kind: 'unit', unit: '~', position: 'before' }, 45)).toBe('~45');
  });

  it('duration: minutes, seconds or ms through formatMinutes', () => {
    expect(write({ kind: 'duration', from: 'minutes' }, 90)).toBe('1.5 h');
    expect(write({ kind: 'duration', from: 'seconds' }, 2700)).toBe('45 min');
    expect(write({ kind: 'duration', from: 'ms' }, 5_400_000)).toBe('1.5 h');
  });

  it('date: an epoch in UTC by pattern', () => {
    expect(write({ kind: 'date', pattern: 'day' }, LATE.getTime())).toBe('1 Nov');
    expect(write({ kind: 'date', pattern: 'time' }, LATE.getTime())).toBe('23:30');
  });

  it('custom: the formatter the context registers under the id', () => {
    const tokens = (value: number): string => `${value} tok`;

    expect(formatterFor({ kind: 'custom', id: 'tokens' }, { customFormatters: { tokens } })(5)).toBe('5 tok');
  });

  it('custom: throws a clear error naming the missing id and the registered ones', () => {
    const tokens = (value: number): string => String(value);

    expect(() => formatterFor({ kind: 'custom', id: 'cost' }, { customFormatters: { tokens } }))
      .toThrow('no custom formatter "cost" in the format context (registered: tokens)');
    expect(() => formatterFor({ kind: 'custom', id: 'cost' })).toThrow('none are registered');
  });

  it('custom: never resolves an id from the object prototype', () => {
    expect(() => formatterFor({ kind: 'custom', id: 'toString' }, { customFormatters: {} })).toThrow('"toString"');
  });

  it('throws on a kind it does not know', () => {
    expect(() => formatterFor({ kind: 'nope' } as unknown as ValueFormat)).toThrow('unknown format kind "nope"');
  });

  it('defaults the context to en-GB, USD and UTC', () => {
    expect(resolveFormatContext()).toEqual({ locale: 'en-GB', currency: 'USD', timeZone: 'UTC', customFormatters: {} });
    expect(formatterFor({ kind: 'money' })(1)).toBe('US$1.00');
  });
});

describe('formatMeasured', () => {
  const context = { locale: 'en-GB', currency: 'USD' };

  it('the point format wins over the spec format, which wins over the context defaults', () => {
    const spec: ValueFormat = { kind: 'money', currency: 'GBP' };

    expect(formatMeasured({ value: 12, format: { kind: 'money', currency: 'EUR' } }, context, spec)).toBe('€12.00');
    expect(formatMeasured({ value: 12 }, context, spec)).toBe('£12.00');
    expect(formatMeasured({ value: 12, format: { kind: 'money' } }, context, spec)).toBe('US$12.00');
  });

  it('writes a number in the context locale when neither the point nor the spec has a format', () => {
    expect(formatMeasured({ value: 1234.5 }, { locale: 'de-DE' })).toBe('1.234,5');
  });

  it('puts the point unit after a bare number', () => {
    expect(formatMeasured({ value: 45, unit: 'min' })).toBe('45 min');
    expect(formatMeasured({ value: 4200, unit: 'tokens' }, context, { kind: 'compact' })).toBe('4.2K tokens');
  });

  it('leaves the unit out when the format writes its own', () => {
    expect(formatMeasured({ value: 0.5, unit: 'share', format: { kind: 'percent' } })).toBe('50%');
  });
});
