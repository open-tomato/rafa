/**
 * `METRIC_CATALOGUE`: the named metrics the registry serves, each a
 * source id, fixed query params and a formula, with how a card draws it.
 * The params carry no window: a caller adds the one its range asks for.
 *
 * It holds the PoC cut of spec section G, four rows per lens, one file
 * per lens (`pm.ts`, `architect.ts`, `developer.ts`, `qa.ts`). G's fourth
 * PM row names two metrics, `pm.planned-vs-sessions` and
 * `pm.active-blockers`, so its 16 rows are 17 definitions. Every metric of
 * spec section B4, served or not, is listed with its feasibility in
 * `entries.ts`.
 */
import type { MetricDefinition } from '@open-tomato/atlas-data/contract';

import { ARCHITECT_METRICS } from './architect.js';
import { DEVELOPER_METRICS } from './developer.js';
import { PM_METRICS } from './pm.js';
import { QA_METRICS } from './qa.js';

/** Every metric the registry serves, in the order `/metrics` lists them: by lens, as section G does. */
export const METRIC_CATALOGUE: readonly MetricDefinition[] = [...PM_METRICS, ...ARCHITECT_METRICS, ...DEVELOPER_METRICS, ...QA_METRICS];
