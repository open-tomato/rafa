/**
 * The format spec as zod v4 schemas, for a contract that carries a
 * `ValueFormat` or a `FormatContext` as data (`@open-tomato/atlas-ui`'s
 * card contract embeds them). The types live in `format.ts`; each schema is
 * annotated with its type because the repo compiles with
 * `isolatedDeclarations`, and the annotation also holds the schema to it.
 * Widen the type and the schema together.
 */
import type { FormatContext, ValueFormat, ValueFormatter } from './format.js';

import { z } from 'zod';

import { DATE_PATTERNS, DURATION_UNITS, PERCENT_BASES, UNIT_POSITIONS } from './format.js';

/** The most fraction digits `Intl.NumberFormat` and `toFixed` both accept. */
const MAX_DIGITS = 20;

const digits = z.number().int()
  .min(0)
  .max(MAX_DIGITS)
  .optional();

/** An ISO 4217 code: three letters. */
const currency = z.string().regex(/^[A-Za-z]{3}$/, 'a currency is a three-letter ISO 4217 code');

/** Whether `Intl` accepts `tag` as a locale. */
function isLocale(tag: string): boolean {
  try {
    return Intl.getCanonicalLocales(tag).length === 1;
  } catch {
    return false;
  }
}

/** A `ValueFormat`, discriminated on `kind`. */
export const valueFormatSchema: z.ZodType<ValueFormat> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('raw'), digits }),
  z.object({ kind: z.literal('number'), digits, grouping: z.boolean().optional() }),
  z.object({ kind: z.literal('compact') }),
  z.object({ kind: z.literal('percent'), digits, of: z.enum(PERCENT_BASES).optional(), signed: z.boolean().optional() }),
  z.object({ kind: z.literal('money'), currency: currency.optional(), digits, compact: z.boolean().optional() }),
  z.object({ kind: z.literal('unit'), unit: z.string().min(1), position: z.enum(UNIT_POSITIONS).optional() }),
  z.object({ kind: z.literal('duration'), from: z.enum(DURATION_UNITS) }),
  z.object({ kind: z.literal('elapsed'), from: z.enum(DURATION_UNITS) }),
  z.object({ kind: z.literal('date'), pattern: z.enum(DATE_PATTERNS) }),
  z.object({ kind: z.literal('relative') }),
  z.object({ kind: z.literal('custom'), id: z.string().min(1) }),
]);

/** A `FormatContext`; `customFormatters` holds functions, so it validates only in code, never from JSON. */
export const formatContextSchema: z.ZodType<FormatContext> = z.object({
  locale: z.string().refine(isLocale, 'a locale is a BCP 47 tag Intl accepts')
    .optional(),
  currency: currency.optional(),
  timeZone: z.literal('UTC').optional(),
  customFormatters: z.record(
    z.string(),
    z.custom<ValueFormatter>((value) => typeof value === 'function', 'a custom formatter is a function'),
  ).optional(),
  now: z.number().optional(),
});
