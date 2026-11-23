/**
 * The developer lens's PoC metrics (spec section G): tasks done per week
 * by work type, task cycle minutes, the red share of CI readings and
 * plans completed per week.
 *
 * `local.plans` buckets a plan by the week of its first session, its
 * time field, as the store records no time a plan completed; so
 * `dev.plans-completed-per-week` is a proxy, and says so.
 */
import type { MetricDefinition } from '@open-tomato/atlas-data/contract';

import { PLANS_SOURCE } from '../build/derive.js';
import { TASKS_SOURCE } from '../ingest/effort.js';
import { CI_SOURCE } from '../ingest/facts.js';

/** How many task sessions the cycle scatter answers at most: past the store's 11 weeks of about 3,000. */
const TASK_CYCLE_LIMIT = 5_000;

/** The red share above which the CI tile draws as danger. */
const RED_CI_THRESHOLD = 0.1;

/** Task sessions reported done per week, stacked by work type. */
export const TASKS_DONE_PER_WEEK: MetricDefinition = {
  id: 'dev.tasks-done-per-week',
  title: 'Tasks done per week',
  lenses: ['developer'],
  description: 'Task sessions whose report said done, per ISO week, split by work type (feature, fix, chore).',
  sourceId: TASKS_SOURCE,
  params: {
    grain: 'week',
    filters: [
      { field: 'kind', op: 'eq', value: 'task' },
      { field: 'status', op: 'eq', value: 'done' },
    ],
    groupBy: ['work_type'],
    measures: [{ field: 'session_id', agg: 'count', as: 'tasks' }],
    orderBy: [{ key: 'week', dir: 'asc' }],
  },
  formula: { kind: 'none' },
  unit: 'tasks',
  chart: 'stacked-bar',
  feasibility: 'proxy',
  proxyFor: 'sprint velocity',
  proxyNote: 'Tasks done stand in for story points, which rafa does not have; work type is read from the change level each task reported, as loop branches carry no type.',
};

/** The minutes of each task session, by when it started. */
export const TASK_CYCLE: MetricDefinition = {
  id: 'dev.task-cycle',
  title: 'Task cycle time',
  lenses: ['developer'],
  description: 'One point per task session: when it started and the minutes it ran, with its plan and task line.',
  sourceId: TASKS_SOURCE,
  params: {
    fields: ['started_at', 'plan_stub', 'task_line', 'minutes'],
    filters: [{ field: 'kind', op: 'eq', value: 'task' }],
    orderBy: [{ key: 'started_at', dir: 'asc' }],
    limit: TASK_CYCLE_LIMIT,
  },
  formula: { kind: 'none' },
  unit: 'min',
  chart: 'scatter',
  feasibility: 'direct',
};

/** The CI readings by verdict, each with its share: red's is the tile. */
export const RED_CI_SHARE: MetricDefinition = {
  id: 'dev.red-ci-share',
  title: 'Red CI share',
  lenses: ['developer'],
  description: 'The CI readings of plan heads that ran a check, green and red, each with its share of all of them.',
  sourceId: CI_SOURCE,
  params: {
    filters: [{ field: 'verdict', op: 'in', value: ['green', 'red'] }],
    groupBy: ['verdict'],
    measures: [{ field: 'head_sha', agg: 'count', as: 'readings' }],
    orderBy: [{ key: 'verdict', dir: 'asc' }],
  },
  formula: { kind: 'share', of: 'readings', as: 'share' },
  unit: 'readings',
  chart: 'kpi',
  thresholds: [{ at: RED_CI_THRESHOLD, tone: 'danger', label: '10 % of readings red' }],
  feasibility: 'direct',
};

/** The plans completed, per week of their first session. */
export const PLANS_COMPLETED_PER_WEEK: MetricDefinition = {
  id: 'dev.plans-completed-per-week',
  title: 'Plans completed per week',
  lenses: ['developer'],
  description: 'Plans whose plan file holds every task done, counted per ISO week of their first session.',
  sourceId: PLANS_SOURCE,
  params: {
    grain: 'week',
    measures: [{ field: 'completed', agg: 'sum', as: 'completed' }],
    orderBy: [{ key: 'week', dir: 'asc' }],
  },
  formula: { kind: 'none' },
  unit: 'plans',
  chart: 'line',
  feasibility: 'proxy',
  proxyFor: 'plans completed per week',
  proxyNote: 'A plan counts in the week its first session started: the store records no time a plan completed, and merge times wait for the GitHub source.',
};

/** The developer lens's metrics, in the order section G lists them. */
export const DEVELOPER_METRICS: readonly MetricDefinition[] = [TASKS_DONE_PER_WEEK, TASK_CYCLE, RED_CI_SHARE, PLANS_COMPLETED_PER_WEEK];
