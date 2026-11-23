/**
 * The architect lens's PoC metrics (spec section G): the debt ratio, task
 * minutes p50 and p90, tokens by model and preflight halts.
 *
 * Three are proxies, each with its `ProxyNote`: the debt ratio reads the
 * work type of decision D4, from each task's reported change level, as
 * loop branches carry none; task minutes stand in for loop latency and
 * preflight halts for uptime, neither of which the store records.
 */
import type { MetricDefinition } from '@open-tomato/atlas-data/contract';

import { DAILY_SOURCE } from '../build/daily.js';
import { TASKS_SOURCE } from '../ingest/effort.js';

/** Task minutes by work type, with each type's share: fix and chore over all is the debt ratio. */
export const DEBT_RATIO: MetricDefinition = {
  id: 'arch.debt-ratio',
  title: 'Debt ratio',
  lenses: ['architect'],
  description: 'Task session minutes by work type (feature, fix, chore), each with its share of all task minutes; the fix and chore shares summed are the ratio.',
  sourceId: TASKS_SOURCE,
  params: {
    filters: [{ field: 'kind', op: 'eq', value: 'task' }],
    groupBy: ['work_type'],
    measures: [{ field: 'minutes', agg: 'sum', as: 'minutes' }],
    orderBy: [{ key: 'minutes', dir: 'desc' }],
  },
  formula: { kind: 'share', of: 'minutes', as: 'share' },
  unit: 'min',
  chart: 'kpi',
  feasibility: 'proxy',
  proxyFor: 'tech debt ratio',
  proxyNote: 'Work type is read from the change level each task reported (patch = fix, none = chore or docs, minor = feature): loop branches carry no type, and the store holds no remediation estimate.',
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

/** The preflight runs that halted, per day, beside the runs of that day. */
export const PREFLIGHT_HALTS: MetricDefinition = {
  id: 'arch.preflight-halts',
  title: 'Preflight halts',
  lenses: ['architect'],
  description: 'Per day, the preflight runs with a required check that did not pass, beside every preflight run of that day.',
  sourceId: DAILY_SOURCE,
  params: {
    grain: 'day',
    measures: [
      { field: 'preflight_halts', agg: 'sum', as: 'halts' },
      { field: 'preflight_runs', agg: 'sum', as: 'runs' },
    ],
    orderBy: [{ key: 'day', dir: 'asc' }],
  },
  formula: { kind: 'none' },
  unit: 'runs',
  chart: 'calendar',
  feasibility: 'proxy',
  proxyFor: 'uptime / SLA',
  proxyNote: 'A halted preflight is a run the loop could not start; the store records no uptime of a service.',
};

/** The architect lens's metrics, in the order section G lists them. */
export const ARCHITECT_METRICS: readonly MetricDefinition[] = [DEBT_RATIO, TASK_MINUTES_P50_P90, TOKENS_BY_MODEL, PREFLIGHT_HALTS];
