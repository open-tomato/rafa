/**
 * The QA lens's PoC metrics (spec section G): bugs by kind per week,
 * regressions, flaky checks and the share of bugs per route.
 *
 * The three bug metrics read the routed rows of `local.bugs`, the only
 * ones holding a kind and a route, and leave out `module` `cli-gap`
 * ({@link NOT_CLI_GAP}), which the engine reads as true for a NULL
 * module, so a bug naming no module stays in.
 *
 * `qa.flaky-checks` groups by each reading's failing set, as a JSON
 * array: the engine does not split an array, so the card splits each set
 * into its names, sums each name's failures over the sets and keeps the
 * ten with the most.
 */
import type { Filter, MetricDefinition } from '@open-tomato/atlas-data/contract';

import { BUGS_SOURCE, CI_SOURCE } from '../ingest/facts.js';

/** The bug rows a bug metric reads: routed, and not a gap in rafa's own CLI. */
export const NOT_CLI_GAP: readonly Filter[] = [
  { field: 'source', op: 'eq', value: 'routed' },
  { field: 'module', op: 'ne', value: 'cli-gap' },
];

/** Routed bugs per week, stacked by the kind the loop read. */
export const BUGS_BY_KIND: MetricDefinition = {
  id: 'qa.bugs-by-kind',
  title: 'Bugs by kind per week',
  lenses: ['qa'],
  description: 'The bugs the loop routed, per ISO week, split by kind (bug, own-fallout, own-gap, convention, docs, machine).',
  sourceId: BUGS_SOURCE,
  params: {
    grain: 'week',
    filters: NOT_CLI_GAP,
    groupBy: ['kind'],
    measures: [{ field: 'id', agg: 'count', as: 'bugs' }],
    orderBy: [{ key: 'week', dir: 'asc' }],
  },
  formula: { kind: 'none' },
  unit: 'bugs',
  chart: 'stacked-bar',
  feasibility: 'direct',
};

/** Routed bugs of kind own-fallout, per week. */
export const REGRESSIONS: MetricDefinition = {
  id: 'qa.regressions',
  title: 'Regressions per week',
  lenses: ['qa'],
  description: 'The bugs the loop routed as own-fallout, something an earlier task of the same plan broke, per ISO week.',
  sourceId: BUGS_SOURCE,
  params: {
    grain: 'week',
    filters: [...NOT_CLI_GAP, { field: 'kind', op: 'eq', value: 'own-fallout' }],
    measures: [{ field: 'id', agg: 'count', as: 'bugs' }],
    orderBy: [{ key: 'week', dir: 'asc' }],
  },
  formula: { kind: 'none' },
  unit: 'bugs',
  chart: 'line',
  feasibility: 'direct',
};

/** The failing checks of the red readings of heads that later read green. */
export const FLAKY_CHECKS: MetricDefinition = {
  id: 'qa.flaky-checks',
  title: 'Flaky checks',
  lenses: ['qa'],
  description: 'The red readings of plan heads that read green later with no new commit, grouped by their failing checks, the most failures first; the card keeps the ten names failing most.',
  sourceId: CI_SOURCE,
  params: {
    filters: [
      { field: 'flipped', op: 'eq', value: 1 },
      { field: 'verdict', op: 'eq', value: 'red' },
    ],
    groupBy: ['failing_json'],
    measures: [
      { field: 'head_sha', agg: 'count', as: 'failures' },
      { field: 'head_sha', agg: 'count_distinct', as: 'heads' },
    ],
    orderBy: [{ key: 'failures', dir: 'desc' }],
  },
  formula: { kind: 'none' },
  unit: 'readings',
  chart: 'table',
  feasibility: 'direct',
};

/** Routed bugs per week, split by the route the loop gave each. */
export const FILED_SHARE: MetricDefinition = {
  id: 'qa.filed-share',
  title: 'Where bugs went',
  lenses: ['qa'],
  description: 'The bugs the loop routed, per ISO week, split by route: filed as an issue, or kept private, inherited, repaired, followed up and the rest.',
  sourceId: BUGS_SOURCE,
  params: {
    grain: 'week',
    filters: NOT_CLI_GAP,
    groupBy: ['route'],
    measures: [{ field: 'id', agg: 'count', as: 'bugs' }],
    orderBy: [{ key: 'week', dir: 'asc' }],
  },
  formula: { kind: 'none' },
  unit: 'bugs',
  chart: 'percent-bar',
  feasibility: 'direct',
};

/** The QA lens's metrics, in the order section G lists them. */
export const QA_METRICS: readonly MetricDefinition[] = [BUGS_BY_KIND, REGRESSIONS, FLAKY_CHECKS, FILED_SHARE];
