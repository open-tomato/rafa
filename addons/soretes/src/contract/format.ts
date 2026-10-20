/**
 * Value formats a binding can ask for. A format only turns a value into the
 * short text a face has room for; it never validates.
 *
 *   { kind: 'number', compact: true }        12 400      → "12.4K"
 *   { kind: 'number', decimals: 1 }          3.14159     → "3.1"
 *   { kind: 'number', unit: 'ms' }           240         → "240 ms"
 *   { kind: 'percent', ratio: true }         0.237       → "24%"
 *   { kind: 'percent', decimals: 1 }         23.71       → "23.7%"
 *   { kind: 'relative-time' }                ISO string  → "3 weeks ago", "in 2 hours"
 *   { kind: 'date' }                         ISO string  → "Oct 11"
 *   { kind: 'text', max: 18 }                long text   → "long text, cut…"
 */
export type ValueFormat =
  | { readonly kind: 'number'; readonly decimals?: number; readonly compact?: boolean; readonly unit?: string }
  | { readonly kind: 'percent'; readonly decimals?: number; readonly ratio?: boolean }
  | { readonly kind: 'relative-time'; readonly style?: 'long' | 'short' }
  | { readonly kind: 'date'; readonly style?: 'short' | 'medium' }
  | { readonly kind: 'text'; readonly max?: number };

const RELATIVE_STEPS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ['second', 60],
  ['minute', 60],
  ['hour', 24],
  ['day', 7],
  ['week', 4.345],
  ['month', 12],
  ['year', Number.POSITIVE_INFINITY],
];

function relative(at: Date, now: Date, style: 'long' | 'short'): string {
  let amount = (at.getTime() - now.getTime()) / 1000;
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto', style });
  for (const [unit, size] of RELATIVE_STEPS) {
    if (Math.abs(amount) < size) return formatter.format(Math.round(amount), unit);
    amount /= size;
  }
  return formatter.format(Math.round(amount), 'year');
}

const asDate = (value: unknown): Date | null => {
  if (value instanceof Date) return value;
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/** The text a face shows for `value`; `—` for a missing value, the raw text when the format does not fit it. */
export function formatValue(value: unknown, format: ValueFormat | undefined, now: Date = new Date()): string {
  if (value === null || value === undefined || value === '') return '—';
  // A list counts as its length, as bindings do, unless the format asks for its text.
  if (Array.isArray(value) && format?.kind !== 'text') return formatValue(value.length, format ?? { kind: 'number' }, now);
  if (!format) return String(value);
  switch (format.kind) {
    case 'number': {
      if (typeof value !== 'number') return String(value);
      const text = new Intl.NumberFormat(undefined, {
        notation: format.compact ? 'compact' : 'standard',
        maximumFractionDigits: format.decimals ?? (format.compact ? 1 : 0),
      }).format(value);
      return format.unit ? `${text} ${format.unit}` : text;
    }
    case 'percent': {
      if (typeof value !== 'number') return String(value);
      const ratio = format.ratio ? value : value / 100;
      return new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: format.decimals ?? 0 }).format(ratio);
    }
    case 'relative-time': {
      const date = asDate(value);
      return date ? relative(date, now, format.style ?? 'long') : String(value);
    }
    case 'date': {
      const date = asDate(value);
      return date ? new Intl.DateTimeFormat(undefined, { dateStyle: format.style ?? 'medium' }).format(date) : String(value);
    }
    case 'text': {
      const text = String(value);
      const max = format.max ?? 24;
      return text.length > max ? `${text.slice(0, max - 1)}…` : text;
    }
  }
}
