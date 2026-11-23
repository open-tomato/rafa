/**
 * The architect lens's PoC metrics (spec section G): the debt ratio, task
 * minutes p50 and p90, tokens by model and preflight halts.
 *
 * Three are proxies, each with its `ProxyNote`: the debt ratio reads the
 * work type of decision D4, from each task's reported change level, as
 * loop branches carry none; task minutes stand in for loop latency and
 * preflight halts for uptime, neither of which the store records.
 *
 * Past the PoC cut, three read `local.modules`, the module ingest's one
 * row per module folder, each a proxy: lines of code per module stand in
 * for cyclomatic complexity (entry 17), the `@open-tomato` import fan for
 * coupling (entry 18), and the upward edges `docs/survey/cut-table.json`
 * lists for architecture violations (entry 13). `local.modules` has no
 * time axis, so a window is refused on them: the card asks with none.
 */
import type { MetricDefinition } from '@open-tomato/atlas-data/contract';

import { DAILY_SOURCE } from '../build/daily.js';
import { TASKS_SOURCE } from '../ingest/effort.js';
import { MODULES_SOURCE } from '../ingest/modules.js';

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

/** The lines of code and files of each module, the largest first: the treemap. */
export const LOC_PER_MODULE: MetricDefinition = {
  id: 'arch.loc-per-module',
  title: 'Lines of code per module',
  lenses: ['architect'],
  description: 'Per module folder, the lines of code and the files of its source, test files left out, the largest first.',
  sourceId: MODULES_SOURCE,
  params: {
    groupBy: ['path'],
    measures: [
      { field: 'loc', agg: 'sum', as: 'loc' },
      { field: 'files', agg: 'sum', as: 'files' },
    ],
    orderBy: [{ key: 'loc', dir: 'desc' }],
  },
  formula: { kind: 'none' },
  unit: 'lines',
  chart: 'treemap',
  feasibility: 'proxy',
  proxyFor: 'cyclomatic complexity',
  proxyNote: 'Lines of code stand in for complexity: no complexity scan is run, and a larger module is read as a more complex one.',
};

/** Each module's package, imports and fan: the card draws the matrix from the import lists. */
export const COUPLING: MetricDefinition = {
  id: 'arch.coupling',
  title: 'Coupling',
  lenses: ['architect'],
  description: 'One row per module folder: its package, the @open-tomato packages it imports (a JSON array), and its fan-in and fan-out; the card draws the dependency matrix from the import lists.',
  sourceId: MODULES_SOURCE,
  params: {
    fields: ['path', 'package', 'imports_json', 'fan_in', 'fan_out'],
    orderBy: [{ key: 'path', dir: 'asc' }],
  },
  formula: { kind: 'none' },
  unit: 'modules',
  chart: 'heatmap',
  feasibility: 'proxy',
  proxyFor: 'coupling / cohesion',
  proxyNote: 'Coupling is read from the @open-tomato imports between module packages, found by an import scan; relative imports and cohesion inside a module are not measured.',
};

/** The upward edges of each module the cut table covers, the most first. */
export const VIOLATIONS: MetricDefinition = {
  id: 'arch.violations',
  title: 'Architecture violations',
  lenses: ['architect'],
  description: 'Per module folder the cut table covers, the upward imports docs/survey/cut-table.json lists from its files, the most first; no rows when the project has no cut table.',
  sourceId: MODULES_SOURCE,
  params: {
    filters: [{ field: 'upward_edges', op: 'is_null', value: false }],
    groupBy: ['path'],
    measures: [{ field: 'upward_edges', agg: 'sum', as: 'edges' }],
    orderBy: [{ key: 'edges', dir: 'desc' }],
  },
  formula: { kind: 'none' },
  unit: 'edges',
  chart: 'bar',
  feasibility: 'proxy',
  proxyFor: 'architecture violations',
  proxyNote: 'A violation is an upward import the survey\'s cut table lists: a module it does not cover, or a project with no cut table, shows none.',
};

/** The architect lens's PoC metrics, in the order section G lists them. */
export const ARCHITECT_POC_METRICS: readonly MetricDefinition[] = [DEBT_RATIO, TASK_MINUTES_P50_P90, TOKENS_BY_MODEL, PREFLIGHT_HALTS];

/** The architect lens's metrics: the PoC cut, then those over the module source. */
export const ARCHITECT_METRICS: readonly MetricDefinition[] = [...ARCHITECT_POC_METRICS, LOC_PER_MODULE, COUPLING, VIOLATIONS];
