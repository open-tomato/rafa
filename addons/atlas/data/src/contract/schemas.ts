/**
 * The zod schemas of the contract, one per type in `types.ts`, each written
 * as `z.ZodType<T>` against its interface (`isolatedDeclarations` infers no
 * schema type across files). A schema checks shape only; the engine checks
 * meaning against the descriptor and throws `InvalidParams`.
 */
import type {
  Aggregate,
  AtlasError,
  AtlasErrorCode,
  ChartKind,
  DataSourceDescriptor,
  Envelope,
  EnvelopeMeta,
  Feasibility,
  FieldDescriptor,
  FieldRole,
  FieldType,
  Filter,
  FilterOp,
  Formula,
  Grain,
  Lens,
  Measure,
  MetricDefinition,
  OrderBy,
  QueryColumn,
  QueryMeta,
  QueryParams,
  QueryResult,
  Scalar,
  Threshold,
  Window,
} from './types.js';

import { z } from 'zod';

/** The most rows one query may ask for. */
export const MAX_LIMIT = 10_000;
/** The rows a query answers when it names no `limit`. */
export const DEFAULT_LIMIT = 1_000;

/** An ISO stamp with an offset, or a plain `YYYY-MM-DD` date. */
const ISO = z.iso.datetime({ offset: true }).or(z.iso.date());

/** An optional read-only list, of at most `max` items when given. */
function optionalList<T>(item: z.ZodType<T>, max?: number): z.ZodOptional<z.ZodReadonly<z.ZodArray<z.ZodType<T>>>> {
  const list = z.array(item);
  const capped = max === undefined
    ? list
    : list.max(max);
  return capped.readonly().optional();
}

export const FieldTypeSchema: z.ZodType<FieldType> = z.enum([
  'string',
  'integer',
  'number',
  'boolean',
  'date',
  'datetime',
  'json',
]);

export const FieldRoleSchema: z.ZodType<FieldRole> = z.enum(['dimension', 'measure', 'time', 'id']);

export const AggregateSchema: z.ZodType<Aggregate> = z.enum([
  'count',
  'count_distinct',
  'sum',
  'mean',
  'min',
  'max',
  'p50',
  'p90',
  'p99',
]);

export const FilterOpSchema: z.ZodType<FilterOp> = z.enum([
  'eq',
  'ne',
  'in',
  'nin',
  'gt',
  'gte',
  'lt',
  'lte',
  'contains',
  'is_null',
]);

export const GrainSchema: z.ZodType<Grain> = z.enum(['day', 'week', 'month', 'plan', 'all']);

export const LensSchema: z.ZodType<Lens> = z.enum(['pm', 'architect', 'developer', 'qa']);

export const ChartKindSchema: z.ZodType<ChartKind> = z.enum([
  'kpi',
  'line',
  'area',
  'bar',
  'stacked-bar',
  'percent-bar',
  'scatter',
  'histogram',
  'box',
  'gauge',
  'bullet',
  'donut',
  'treemap',
  'heatmap',
  'calendar',
  'table',
  'list',
]);

export const FeasibilitySchema: z.ZodType<Feasibility> = z.enum(['direct', 'proxy', 'gh', 'collect']);

export const ScalarSchema: z.ZodType<Scalar> = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const FieldDescriptorSchema: z.ZodType<FieldDescriptor> = z.strictObject({
  key: z.string().regex(/^[a-z][a-z0-9_]*$/),
  label: z.string(),
  type: FieldTypeSchema,
  role: FieldRoleSchema,
  unit: z.string().optional(),
  description: z.string().optional(),
  values: optionalList(z.string()),
  range: z.strictObject({ min: z.number().optional(), max: z.number().optional() }).optional(),
  aggregates: z.array(AggregateSchema).readonly(),
  filterable: z.boolean(),
  groupable: z.boolean(),
});

export const DataSourceDescriptorSchema: z.ZodType<DataSourceDescriptor> = z.strictObject({
  id: z.string().min(1),
  source: z.string().min(1),
  channel: z.string().min(1),
  title: z.string(),
  description: z.string(),
  timeField: z.string().nullable(),
  grains: z.array(GrainSchema).readonly(),
  fields: z.array(FieldDescriptorSchema).readonly(),
  asOf: ISO.nullable(),
  partial: z.boolean(),
  partialReasons: z.array(z.string()).readonly(),
});

export const WindowSchema: z.ZodType<Window> = z
  .strictObject({
    from: ISO.optional(),
    to: ISO.optional(),
    last: z
      .string()
      .regex(/^\d{1,4}[dwm]$/)
      .optional(),
  })
  .refine((window) => !(window.last !== undefined && window.from !== undefined), {
    message: 'last and from exclude each other',
  });

export const MeasureSchema: z.ZodType<Measure> = z.strictObject({
  field: z.string(),
  agg: AggregateSchema,
  as: z.string().optional(),
});

export const FilterSchema: z.ZodType<Filter> = z.strictObject({
  field: z.string(),
  op: FilterOpSchema,
  value: z.union([ScalarSchema, z.array(ScalarSchema).readonly()]).optional(),
});

export const OrderBySchema: z.ZodType<OrderBy> = z.strictObject({
  key: z.string(),
  dir: z.enum(['asc', 'desc']),
});

export const QueryParamsSchema: z.ZodType<QueryParams> = z.strictObject({
  window: WindowSchema.optional(),
  grain: GrainSchema.optional(),
  groupBy: optionalList(z.string(), 3),
  measures: optionalList(MeasureSchema, 8),
  filters: optionalList(FilterSchema, 16),
  fields: optionalList(z.string(), 32),
  orderBy: optionalList(OrderBySchema, 3),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_LIMIT)
    .optional(),
  compare: z.literal('previous').optional(),
});

export const QueryColumnSchema: z.ZodType<QueryColumn> = z.strictObject({
  key: z.string(),
  label: z.string(),
  type: FieldTypeSchema,
  unit: z.string().optional(),
});

const RowSchema = z.array(ScalarSchema).readonly();

export const QueryMetaSchema: z.ZodType<QueryMeta> = z.strictObject({
  asOf: ISO.nullable(),
  partial: z.boolean(),
  partialReasons: z.array(z.string()).readonly(),
  rowCount: z
    .number()
    .int()
    .min(0),
  truncated: z.boolean(),
  window: z.strictObject({ from: ISO.nullable(), to: ISO.nullable() }),
  previous: z
    .strictObject({
      rows: z.array(RowSchema).readonly(),
      window: z.strictObject({ from: ISO, to: ISO }),
    })
    .optional(),
});

export const QueryResultSchema: z.ZodType<QueryResult> = z.strictObject({
  columns: z.array(QueryColumnSchema).readonly(),
  rows: z.array(RowSchema).readonly(),
  meta: QueryMetaSchema,
});

export const FormulaSchema: z.ZodType<Formula> = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('none') }),
  z.strictObject({
    kind: z.literal('ratio'),
    numerator: z.string(),
    denominator: z.string(),
    as: z.string(),
  }),
  z.strictObject({ kind: z.literal('share'), of: z.string(), as: z.string() }),
  z.strictObject({ kind: z.literal('cumulative'), of: z.string(), as: z.string() }),
]);

export const ThresholdSchema: z.ZodType<Threshold> = z.strictObject({
  at: z.number(),
  tone: z.enum(['success', 'gold', 'danger']),
  label: z.string(),
});

export const MetricDefinitionSchema: z.ZodType<MetricDefinition> = z.strictObject({
  id: z.string().min(1),
  title: z.string().min(1),
  lenses: z.array(LensSchema).readonly(),
  description: z.string(),
  sourceId: z.string().min(1),
  params: QueryParamsSchema,
  formula: FormulaSchema,
  unit: z.string().optional(),
  chart: ChartKindSchema,
  goal: z.number().optional(),
  thresholds: optionalList(ThresholdSchema),
  feasibility: FeasibilitySchema,
  proxyFor: z.string().optional(),
  proxyNote: z.string().optional(),
});

export const AtlasErrorCodeSchema: z.ZodType<AtlasErrorCode> = z.enum([
  'invalid_params',
  'invalid_body',
  'unknown_route',
  'unknown_source',
  'unknown_metric',
  'method_not_allowed',
  'contract_mismatch',
  'replica_unavailable',
  'internal',
]);

export const AtlasErrorSchema: z.ZodType<AtlasError> = z.strictObject({
  code: AtlasErrorCodeSchema,
  message: z.string(),
  details: z.unknown().optional(),
});

export const EnvelopeMetaSchema: z.ZodType<EnvelopeMeta> = z.strictObject({
  asOf: ISO.nullable(),
  version: z.string(),
  elapsedMs: z.number().min(0),
});

/**
 * The envelope around `data`. An `ok` envelope carries no error, and an
 * `error` envelope carries one with its data null.
 */
export function envelopeSchema<T>(data: z.ZodType<T>): z.ZodType<Envelope<T>> {
  return z
    .strictObject({
      status: z.enum(['ok', 'error']),
      data: data.nullable(),
      error: AtlasErrorSchema.nullable(),
      meta: EnvelopeMetaSchema,
    })
    .refine(
      (envelope) => envelope.status === 'ok'
        ? envelope.error === null
        : envelope.error !== null && envelope.data === null,
      { message: 'an ok envelope carries no error; an error envelope carries one and no data' },
    );
}
