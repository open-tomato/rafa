/**
 * The card contract as zod v4 schemas, each with its inferred type. Kept
 * minimal on purpose: the cascade and the engine port extend them. Every
 * schema carries an explicit zod type because the repo compiles with
 * `isolatedDeclarations`; widen the annotation together with the schema.
 */
import { z } from 'zod';

/** The page-level ranges a dashboard reads. */
export const TIME_RANGES = ['now', 'last-week', 'past-month', 'last-year'] as const;

/** The four compositions of the card cascade. */
export const CARD_MODES = ['dashboard', 'widget', 'snapshot', 'report'] as const;

/** A time range: `now`, `last-week`, `past-month` or `last-year`. */
export const timeRangeSchema: z.ZodEnum<{
  'now': 'now';
  'last-week': 'last-week';
  'past-month': 'past-month';
  'last-year': 'last-year';
}> = z.enum(TIME_RANGES);
export type TimeRange = z.infer<typeof timeRangeSchema>;

/** A card mode: where its data and config come from and how much it interacts. */
export const cardModeSchema: z.ZodEnum<{
  dashboard: 'dashboard';
  widget: 'widget';
  snapshot: 'snapshot';
  report: 'report';
}> = z.enum(CARD_MODES);
export type CardMode = z.infer<typeof cardModeSchema>;

/** One entry of a card's menu: the modal key it opens, its label and a lucide icon name. */
export const menuItemSchema: z.ZodObject<{
  key: z.ZodString;
  label: z.ZodString;
  icon: z.ZodOptional<z.ZodString>;
}, z.core.$strip> = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  icon: z.string().min(1)
    .optional(),
});
export type MenuItem = z.infer<typeof menuItemSchema>;

/** What a card draws: a seam primitive by name and its engine-free options. */
export const chartDescriptorSchema: z.ZodObject<{
  primitive: z.ZodString;
  options: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strip> = z.object({
  primitive: z.string().min(1),
  options: z.record(z.string(), z.unknown()).optional(),
});
export type ChartDescriptor = z.infer<typeof chartDescriptorSchema>;

/** How many grid columns a card takes on a page. */
export const CARD_SPANS = ['one', 'two', 'full'] as const;

/** A card's span: `one`, `two` or `full` columns. */
export const cardSpanSchema: z.ZodEnum<{
  one: 'one';
  two: 'two';
  full: 'full';
}> = z.enum(CARD_SPANS);
export type CardSpan = z.infer<typeof cardSpanSchema>;

/** The modal keys `CardLayout` wires to the menu without being told: the built-in entries. */
export const MODAL_KEYS = ['info', 'source', 'config', 'errors', 'maximise'] as const;

/** A built-in modal key. */
export const modalKeySchema: z.ZodEnum<{
  info: 'info';
  source: 'source';
  config: 'config';
  errors: 'errors';
  maximise: 'maximise';
}> = z.enum(MODAL_KEYS);
export type ModalKey = z.infer<typeof modalKeySchema>;

/** How a legend draws its marks, and whether its entries hide series. */
export const legendConfigSchema: z.ZodObject<{
  mark: z.ZodOptional<z.ZodEnum<{ rect: 'rect'; line: 'line' }>>;
  toggleable: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip> = z.object({
  mark: z.enum(['rect', 'line']).optional(),
  toggleable: z.boolean().optional(),
});
export type LegendConfig = z.infer<typeof legendConfigSchema>;

/**
 * The static descriptor `CardSpecProvider` provides: identity, title,
 * chart, mode and range, plus what the card's chrome shows. `modals`
 * lists the built-in entries the menu offers (all that apply when
 * absent; `errors` is offered whenever the boundary caught); `menu`
 * relabels entries by key.
 */
export const cardSpecSchema: z.ZodObject<{
  id: z.ZodString;
  title: z.ZodString;
  subtitle: z.ZodOptional<z.ZodString>;
  description: z.ZodOptional<z.ZodString>;
  note: z.ZodOptional<z.ZodString>;
  source: z.ZodOptional<z.ZodString>;
  chart: typeof chartDescriptorSchema;
  mode: z.ZodOptional<typeof cardModeSchema>;
  range: z.ZodOptional<typeof timeRangeSchema>;
  span: z.ZodOptional<typeof cardSpanSchema>;
  legend: z.ZodOptional<typeof legendConfigSchema>;
  animate: z.ZodOptional<z.ZodBoolean>;
  modals: z.ZodOptional<z.ZodArray<typeof modalKeySchema>>;
  menu: z.ZodOptional<z.ZodArray<typeof menuItemSchema>>;
}, z.core.$strip> = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  subtitle: z.string().optional(),
  description: z.string().optional(),
  note: z.string().optional(),
  source: z.string().optional(),
  chart: chartDescriptorSchema,
  mode: cardModeSchema.optional(),
  range: timeRangeSchema.optional(),
  span: cardSpanSchema.optional(),
  legend: legendConfigSchema.optional(),
  animate: z.boolean().optional(),
  modals: z.array(modalKeySchema).optional(),
  menu: z.array(menuItemSchema).optional(),
});
export type CardSpec = z.infer<typeof cardSpecSchema>;

/**
 * The part of a card's spec the Config modal edits (report mode): the
 * words, the range and the span. Identity, chart and mode stay fixed.
 */
export const cardDescriptorSchema: z.ZodObject<{
  title: z.ZodString;
  subtitle: z.ZodOptional<z.ZodString>;
  description: z.ZodOptional<z.ZodString>;
  range: z.ZodOptional<typeof timeRangeSchema>;
  span: z.ZodOptional<typeof cardSpanSchema>;
}, z.core.$strip> = z.object({
  title: z.string().trim()
    .min(1, 'A card needs a title.'),
  subtitle: z.string().optional(),
  description: z.string().optional(),
  range: timeRangeSchema.optional(),
  span: cardSpanSchema.optional(),
});
export type CardDescriptor = z.infer<typeof cardDescriptorSchema>;

/** The descriptor fields of a spec, as the Config modal starts them. */
export function descriptorOf(config: CardSpec): CardDescriptor {
  const { title, subtitle, description, range, span } = config;
  return { title, subtitle, description, range, span };
}

/**
 * A spec with the descriptor's fields put in: every one of the five is
 * replaced, so a field the form left blank is cleared rather than kept.
 */
export function applyDescriptor(config: CardSpec, descriptor: CardDescriptor): CardSpec {
  return {
    ...config,
    title: descriptor.title,
    subtitle: descriptor.subtitle,
    description: descriptor.description,
    range: descriptor.range,
    span: descriptor.span,
  };
}
