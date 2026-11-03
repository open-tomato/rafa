/**
 * The Atlas contract: what a data source exposes (`DataSourceDescriptor`),
 * what a query accepts (`QueryParams`), what comes back (`QueryResult`,
 * `Envelope`) and what a named metric is (`MetricDefinition`). Browser-safe:
 * nothing here imports `bun:*`, `node:*` or a rafa package.
 */
export type { AtlasError, AtlasErrorCode, Envelope, EnvelopeMeta } from './types.js';
export { ATLAS_CONTRACT_VERSION } from './version.js';
