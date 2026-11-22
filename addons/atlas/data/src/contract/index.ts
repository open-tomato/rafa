/**
 * The Atlas contract: what a data source exposes (`DataSourceDescriptor`),
 * what a query accepts (`QueryParams`), what comes back (`QueryResult`,
 * `Envelope`) and what a named metric is (`MetricDefinition`), with a zod
 * schema per type, `validateStandard`, `applyFormula` and `InvalidParams`.
 * Browser-safe: nothing here imports `bun:*`, `node:*` or a rafa package.
 */
export type { InvalidParamsDetails } from './errors.js';
export type { Validated } from './standard.js';
export type {
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
export { InvalidParams } from './errors.js';
export { applyFormula } from './formula.js';
export {
  AggregateSchema,
  AtlasErrorCodeSchema,
  AtlasErrorSchema,
  ChartKindSchema,
  DataSourceDescriptorSchema,
  DEFAULT_LIMIT,
  envelopeSchema,
  EnvelopeMetaSchema,
  FeasibilitySchema,
  FieldDescriptorSchema,
  FieldRoleSchema,
  FieldTypeSchema,
  FilterOpSchema,
  FilterSchema,
  FormulaSchema,
  GrainSchema,
  LensSchema,
  MAX_LIMIT,
  MeasureSchema,
  MetricDefinitionSchema,
  OrderBySchema,
  QueryColumnSchema,
  QueryMetaSchema,
  QueryParamsSchema,
  QueryResultSchema,
  ScalarSchema,
  ThresholdSchema,
  WindowSchema,
} from './schemas.js';
export { validateStandard } from './standard.js';
export { ATLAS_CONTRACT_VERSION } from './version.js';
