/**
 * Value formatting shared by the engines and the atoms: the plain helpers
 * (`formatCompact`, `formatDay` and the rest), and the declarative
 * `ValueFormat` spec, which `formatterFor` turns into the `(value) => string`
 * function every primitive's `valueFormat` takes. No React and no zod, so
 * the headless engine carries it; the zod schemas are in `format.schema.ts`
 * and the React context in `FormatProvider.tsx`.
 *
 * Every date is written in UTC, so a tick label never depends on the
 * machine's timezone.
 */

/** 1,284 → "1.3K", 4,200,000 → "4.2M"; integers below 1,000 stay as they are. */
export function formatCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${trimZero((value / 1_000_000).toFixed(1))}M`;
  if (abs >= 1_000) return `${trimZero((value / 1_000).toFixed(1))}K`;
  if (Number.isInteger(value)) return String(value);
  return trimZero(value.toFixed(1));
}

/** 0.78 → "78%". */
export function formatPercent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

/** 45 → "45 min", 90 → "1.5 h". */
export function formatMinutes(minutes: number): string {
  if (minutes >= 60) return `${trimZero((minutes / 60).toFixed(1))} h`;
  return `${Math.round(minutes)} min`;
}

/** A day as "1 Nov", in a fixed locale and in UTC, so the label never depends on the viewer. */
export function formatDay(date: Date): string {
  return formatDate(date, 'day');
}

/** The week starting on a date, as "w/c 1 Nov", in UTC. */
export function formatWeek(date: Date): string {
  return formatDate(date, 'week');
}

/** The seconds in each elapsed unit, largest first. */
const ELAPSED_UNITS: readonly (readonly [string, number])[] = [['d', 86_400], ['h', 3_600], ['m', 60], ['s', 1]];

/**
 * A count of seconds as "1h 3m 10s": zero units left out ("1h 10s"),
 * "0s" for nothing, sub-second precision dropped, a negative count
 * clamped to "0s".
 */
export function formatElapsed(seconds: number): string {
  let rest = Math.max(0, Math.floor(seconds));
  const parts: string[] = [];
  for (const [unit, size] of ELAPSED_UNITS) {
    const count = Math.floor(rest / size);
    rest -= count * size;
    if (count > 0) parts.push(`${count}${unit}`);
  }
  return parts.length > 0
    ? parts.join(' ')
    : '0s';
}

const MS_PER_HOUR = 3_600_000;
const HOURS_PER_DAY = 24;
const DAYS_PER_WEEK = 7;
const AVERAGE_DAYS_PER_MONTH = 30.44;
const AVERAGE_DAYS_PER_YEAR = 365.25;

/** Whether two instants fall on the same UTC day. */
function sameUtcDay(a: Date, b: Date): boolean {
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() === b.getUTCDate();
}

/**
 * An instant relative to `now`, on a ladder: the same UTC day reads as a
 * clock time ("23:30"); then "6 hours ago", "yesterday", "3 days ago",
 * "last week", "2 weeks ago", "last month", "4 months ago", "last year",
 * "2 years ago". Months and years use average lengths. An instant after
 * `now` mirrors the ladder ("tomorrow", "in 3 days").
 */
export function formatRelative(value: Date | number, now: Date | number, locale: string = DEFAULT_FORMAT_CONTEXT.locale): string {
  const date = typeof value === 'number'
    ? new Date(value)
    : value;
  const reference = typeof now === 'number'
    ? new Date(now)
    : now;
  if (sameUtcDay(date, reference)) return formatDate(date, 'time', locale);
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const diff = date.getTime() - reference.getTime();
  const sign = diff < 0
    ? -1
    : 1;
  const hours = Math.abs(diff) / MS_PER_HOUR;
  if (hours < HOURS_PER_DAY) return relative.format(sign * Math.max(1, Math.floor(hours)), 'hour');
  const days = Math.floor(hours / HOURS_PER_DAY);
  if (days < DAYS_PER_WEEK) return relative.format(sign * days, 'day');
  const months = Math.floor(days / AVERAGE_DAYS_PER_MONTH);
  if (months < 1) return relative.format(sign * Math.floor(days / DAYS_PER_WEEK), 'week');
  const years = Math.floor(days / AVERAGE_DAYS_PER_YEAR);
  if (years < 1) return relative.format(sign * months, 'month');
  return relative.format(sign * years, 'year');
}

function trimZero(text: string): string {
  return text.replace(/\.0$/, '');
}

/* ---------- the declarative spec ---------- */

/** The kinds a {@link ValueFormat} can name. */
export const VALUE_FORMAT_KINDS = ['raw', 'number', 'compact', 'percent', 'money', 'unit', 'duration', 'elapsed', 'date', 'relative', 'custom'] as const;

/** How a `date` format writes its value: "1 Nov", "w/c 1 Nov", "23:30", "1 Nov, 23:30", "Nov 2026". */
export const DATE_PATTERNS = ['day', 'week', 'time', 'datetime', 'month'] as const;

/** The unit a `duration` format reads its value in. */
export const DURATION_UNITS = ['minutes', 'seconds', 'ms'] as const;

/** What a `percent` format's value is: a fraction (0.78) or already a percent (78). */
export const PERCENT_BASES = ['fraction', 'percent'] as const;

/** Which side of the number a `unit` format puts its unit. */
export const UNIT_POSITIONS = ['after', 'before'] as const;

export type ValueFormatKind = typeof VALUE_FORMAT_KINDS[number];
export type DatePattern = typeof DATE_PATTERNS[number];
export type DurationUnit = typeof DURATION_UNITS[number];
export type PercentBase = typeof PERCENT_BASES[number];
export type UnitPosition = typeof UNIT_POSITIONS[number];

/**
 * How a value is written, as data a spec or a data point can carry. Each
 * kind reads the locale and the currency from the {@link FormatContext}
 * unless it names its own. `digits` is the number of fraction digits, fixed.
 */
export type ValueFormat =
  /** `String(value)`, or `value.toFixed(digits)`. */
  | { readonly kind: 'raw'; readonly digits?: number }
  /** `Intl.NumberFormat` in the context's locale; `grouping` is on unless false. */
  | { readonly kind: 'number'; readonly digits?: number; readonly grouping?: boolean }
  /** `formatCompact`: 1,000 → "1K", 1,200,000 → "1.2M", in every locale. */
  | { readonly kind: 'compact' }
  /** 0.78 → "78%" (`of: 'fraction'`, the default), or 78 → "78%" (`of: 'percent'`); `signed` writes "+12%" and "-30%". */
  | { readonly kind: 'percent'; readonly digits?: number; readonly of?: PercentBase; readonly signed?: boolean }
  /** A currency amount; the currency is the context's when the format names none. `compact` writes "$1.2K". */
  | { readonly kind: 'money'; readonly currency?: string; readonly digits?: number; readonly compact?: boolean }
  /** "45 min" (`after`, the default, with a space) or "£45" (`before`, no space). */
  | { readonly kind: 'unit'; readonly unit: string; readonly position?: UnitPosition }
  /** A duration read in `from`, written by `formatMinutes`: "45 min", "1.5 h". */
  | { readonly kind: 'duration'; readonly from: DurationUnit }
  /** A duration read in `from`, written by `formatElapsed`: "1h 3m 10s". */
  | { readonly kind: 'elapsed'; readonly from: DurationUnit }
  /** An epoch in ms, written in UTC by `pattern`. */
  | { readonly kind: 'date'; readonly pattern: DatePattern }
  /** An epoch in ms, written by `formatRelative` against the context's `now`, or the wall clock. */
  | { readonly kind: 'relative' }
  /** A formatter the context registers under `id` in `customFormatters`. */
  | { readonly kind: 'custom'; readonly id: string };

/** A value-to-text function, the shape of every primitive's `valueFormat`. */
export type ValueFormatter = (value: number) => string;

/** What a {@link ValueFormat} reads when it does not say: the locale, the currency, the custom formatters. */
export interface FormatContext {
  /** A BCP 47 tag; `en-GB` when absent. */
  readonly locale?: string;
  /** An ISO 4217 code for `money`; `USD` when absent. */
  readonly currency?: string;
  /** Dates are always written in UTC; the field names it so a contract can carry it. */
  readonly timeZone?: 'UTC';
  /** Formatters a `custom` format names by id, registered by the hub or an app. */
  readonly customFormatters?: Readonly<Record<string, ValueFormatter>>;
  /** The instant a `relative` format counts from, as an epoch in ms; the wall clock when absent. */
  readonly now?: number;
}

/** A {@link FormatContext} with every default filled in; `now` stays open, so a relative value reads the clock when it is written. */
export interface ResolvedFormatContext {
  readonly locale: string;
  readonly currency: string;
  readonly timeZone: 'UTC';
  readonly customFormatters: Readonly<Record<string, ValueFormatter>>;
  readonly now?: number;
}

/** The defaults: `en-GB`, `USD`, `UTC`, no custom formatters. */
export const DEFAULT_FORMAT_CONTEXT: ResolvedFormatContext = {
  locale: 'en-GB',
  currency: 'USD',
  timeZone: 'UTC',
  customFormatters: {},
};

/** The context with its gaps filled from {@link DEFAULT_FORMAT_CONTEXT}. */
export function resolveFormatContext(context: FormatContext = {}): ResolvedFormatContext {
  return {
    locale: context.locale ?? DEFAULT_FORMAT_CONTEXT.locale,
    currency: context.currency ?? DEFAULT_FORMAT_CONTEXT.currency,
    timeZone: 'UTC',
    customFormatters: context.customFormatters ?? DEFAULT_FORMAT_CONTEXT.customFormatters,
    ...(context.now === undefined
      ? {}
      : { now: context.now }),
  };
}

/* ---------- dates ---------- */

const DAY: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', timeZone: 'UTC' };
const TIME: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' };
const MONTH: Intl.DateTimeFormatOptions = { month: 'short', year: 'numeric', timeZone: 'UTC' };

/**
 * A date or an epoch in ms, written in UTC by `pattern` in `locale`
 * (`en-GB` by default). `datetime` joins the day and the time with a comma
 * rather than taking the locale's own joiner, which differs between ICU
 * versions. `week` prefixes the day with "w/c" in every locale.
 */
export function formatDate(value: Date | number, pattern: DatePattern, locale: string = DEFAULT_FORMAT_CONTEXT.locale): string {
  const date = typeof value === 'number'
    ? new Date(value)
    : value;
  switch (pattern) {
    case 'day': return date.toLocaleDateString(locale, DAY);
    case 'week': return `w/c ${date.toLocaleDateString(locale, DAY)}`;
    case 'time': return date.toLocaleTimeString(locale, TIME);
    case 'datetime': return `${date.toLocaleDateString(locale, DAY)}, ${date.toLocaleTimeString(locale, TIME)}`;
    case 'month': return date.toLocaleDateString(locale, MONTH);
  }
}

/* ---------- formatterFor ---------- */

/** Fixed fraction digits, or nothing for the formatter's own default. */
function fractionDigits(digits: number | undefined): Intl.NumberFormatOptions {
  return digits === undefined
    ? {}
    : { minimumFractionDigits: digits, maximumFractionDigits: digits };
}

/** The value in minutes, from each duration unit. */
const TO_MINUTES: Readonly<Record<DurationUnit, number>> = { minutes: 1, seconds: 1 / 60, ms: 1 / 60_000 };

/** The value in seconds, from each duration unit. */
const TO_SECONDS: Readonly<Record<DurationUnit, number>> = { minutes: 60, seconds: 1, ms: 1 / 1000 };

type Builder<K extends ValueFormatKind> = (spec: Extract<ValueFormat, { kind: K }>, context: ResolvedFormatContext) => ValueFormatter;

/** One builder per kind; each makes its `Intl` formatter once, so a bad locale or currency throws at build time. */
const BUILDERS: { readonly [K in ValueFormatKind]: Builder<K> } = {
  raw: ({ digits }) => (value) => (digits === undefined
    ? String(value)
    : value.toFixed(digits)),
  number: ({ digits, grouping }, { locale }) => {
    const intl = new Intl.NumberFormat(locale, { ...fractionDigits(digits), useGrouping: grouping !== false });
    return (value) => intl.format(value);
  },
  compact: () => formatCompact,
  percent: ({ digits, of, signed }, { locale }) => {
    const intl = new Intl.NumberFormat(locale, {
      style: 'percent',
      ...fractionDigits(digits ?? 0),
      signDisplay: signed === true
        ? 'exceptZero'
        : 'auto',
    });
    const scale = of === 'percent'
      ? 1 / 100
      : 1;
    return (value) => intl.format(value * scale);
  },
  money: ({ currency, digits, compact }, context) => {
    const intl = new Intl.NumberFormat(context.locale, {
      style: 'currency',
      currency: currency ?? context.currency,
      ...(compact === true
        ? { notation: 'compact', maximumFractionDigits: digits ?? 1 }
        : fractionDigits(digits)),
    });
    return (value) => intl.format(value);
  },
  unit: ({ unit, position }, { locale }) => {
    const intl = new Intl.NumberFormat(locale);
    return position === 'before'
      ? (value) => `${unit}${intl.format(value)}`
      : (value) => `${intl.format(value)} ${unit}`;
  },
  duration: ({ from }) => (value) => formatMinutes(value * TO_MINUTES[from]),
  elapsed: ({ from }) => (value) => formatElapsed(value * TO_SECONDS[from]),
  date: ({ pattern }, { locale }) => (value) => formatDate(value, pattern, locale),
  relative: (_spec, { locale, now }) => (value) => formatRelative(value, now ?? Date.now(), locale),
  custom: ({ id }, { customFormatters }) => {
    const registered = Object.hasOwn(customFormatters, id)
      ? customFormatters[id]
      : undefined;
    if (registered === undefined) {
      const known = Object.keys(customFormatters);
      const list = known.length === 0
        ? 'none are registered'
        : `registered: ${known.join(', ')}`;
      throw new Error(`formatterFor: no custom formatter "${id}" in the format context (${list})`);
    }
    return registered;
  },
};

/**
 * The function that writes values as `spec` says, over `context`'s locale,
 * currency and custom formatters. Throws when a `custom` id is not
 * registered, or when `spec` names no known kind.
 */
export function formatterFor(spec: ValueFormat, context: FormatContext = {}): ValueFormatter {
  const kind: string = spec.kind;
  if (!Object.hasOwn(BUILDERS, kind)) throw new Error(`formatterFor: unknown format kind "${kind}"`);
  const build = BUILDERS[spec.kind] as Builder<ValueFormatKind>;
  return build(spec as never, resolveFormatContext(context));
}

/* ---------- a unit riding with the data ---------- */

/** A value with its own unit and, optionally, its own format, which wins over the chart's. */
export interface Measured {
  readonly value: number;
  /** Written after the number when the format writes no unit of its own. */
  readonly unit?: string;
  /** This value's format; it wins over the spec's. */
  readonly format?: ValueFormat;
}

/** The kinds that write a bare number, so a measured value's `unit` is added after them. */
const UNITLESS_KINDS: ReadonlySet<ValueFormatKind> = new Set(['raw', 'number', 'compact']);

/**
 * A measured value as text. The format is the point's own, else
 * `specFormat`, else a `number` in the context's locale; the context fills
 * whatever the format leaves out. The point's `unit` follows a bare number
 * ("45 min"); a format with a unit of its own (percent, money, unit,
 * duration, elapsed, date, relative, custom) keeps it alone.
 */
export function formatMeasured(measured: Measured, context: FormatContext = {}, specFormat?: ValueFormat): string {
  const { value, unit } = measured;
  const format = measured.format ?? specFormat ?? { kind: 'number' };
  const text = formatterFor(format, context)(value);
  return unit !== undefined && UNITLESS_KINDS.has(format.kind)
    ? `${text} ${unit}`
    : text;
}
