/**
 * The Atlas query engine: `runQuery` (`engine.ts`) over a select runner,
 * with the meaning checks (`plan.ts`), the select builder (`sql.ts`),
 * windows (`window.ts`), time grains (`grain.ts`), aggregates
 * (`aggregate.ts`) and the nearest-rank quantile (`quantile.ts`). It reads
 * no database itself, so it imports no `bun:*`; `../source.ts` runs it over
 * a replica.
 */
export type { QueryTarget, RunQueryOptions, RunSelects } from './engine.js';
export type { TimeGrain } from './grain.js';
export type { SqlSelect, SqlValue } from './sql.js';
export type { ClosedWindow, ResolvedWindow } from './window.js';
export { aggregate } from './aggregate.js';
export { MAX_SCAN_ROWS, runQuery } from './engine.js';
export { timeKey } from './grain.js';
export { PLAN_FIELD } from './plan.js';
export { nearestRank, QUANTILES } from './quantile.js';
export { MAX_FILTER_VALUES } from './sql.js';
export { previousWindow, resolveWindow } from './window.js';
