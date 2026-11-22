/**
 * `METRIC_CATALOGUE`: the named metrics the registry serves, each a
 * source id, fixed query params and a formula, with how a card draws it.
 * The params carry no window: a caller adds the one its range asks for.
 *
 * Phase 1 holds three, on the two sources built so far:
 * `pm.tokens-per-day` and `arch.tokens-by-model` are measured as named,
 * and `arch.task-minutes-p50-p90` stands in for loop latency, which the
 * store does not record.
 */
import type { MetricDefinition } from '@open-tomato/atlas-data/contract';

import { DAILY_SOURCE } from '../build/daily.js';
import { TASKS_SOURCE } from '../ingest/effort.js';

/** Tokens spent per day, every session kind summed. */
export const TOKENS_PER_DAY: MetricDefinition = {
  id: 'pm.tokens-per-day',
  title: 'Tokens per day',
  lenses: ['pm'],
  description: 'Input, output and cache tokens of every session, summed per day.',
  sourceId: DAILY_SOURCE,
  params: {
    grain: 'day',
    measures: [{ field: 'tokens_total', agg: 'sum', as: 'tokens' }],
    orderBy: [{ key: 'day', dir: 'asc' }],
  },
  formula: { kind: 'none' },
  unit: 'tokens',
  chart: 'line',
  feasibility: 'direct',
};

/** Tokens spent per day, split by the model that answered each session. */
export const TOKENS_BY_MODEL: MetricDefinition = {
  id: 'arch.tokens-by-model',
  title: 'Tokens by model',
  lenses: ['architect'],
  description: 'Tokens of every session per day, stacked by the model that answered most of its turns.',
  sourceId: TASKS_SOURCE,
  params: {
    grain: 'day',
    groupBy: ['model'],
    measures: [{ field: 'tokens', agg: 'sum', as: 'tokens' }],
    orderBy: [{ key: 'day', dir: 'asc' }],
  },
  formula: { kind: 'none' },
  unit: 'tokens',
  chart: 'area',
  feasibility: 'direct',
};

/** The median and p90 minutes of a task session, per week. */
export const TASK_MINUTES_P50_P90: MetricDefinition = {
  id: 'arch.task-minutes-p50-p90',
  title: 'Task minutes, p50 and p90',
  lenses: ['architect'],
  description: 'The median and 90th percentile of task session minutes, per ISO week.',
  sourceId: TASKS_SOURCE,
  params: {
    grain: 'week',
    filters: [{ field: 'kind', op: 'eq', value: 'task' }],
    measures: [
      { field: 'minutes', agg: 'p50', as: 'p50' },
      { field: 'minutes', agg: 'p90', as: 'p90' },
    ],
    orderBy: [{ key: 'week', dir: 'asc' }],
  },
  formula: { kind: 'none' },
  unit: 'min',
  chart: 'line',
  feasibility: 'proxy',
  proxyFor: 'latency p50/p99',
  proxyNote: 'Task session minutes stand in for loop latency, which the effort store does not record.',
};

/** Every metric the registry serves, in the order `/metrics` lists them. */
export const METRIC_CATALOGUE: readonly MetricDefinition[] = [TOKENS_PER_DAY, TOKENS_BY_MODEL, TASK_MINUTES_P50_P90];
