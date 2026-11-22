/**
 * The table sources the registry serves so far, one spec per replica
 * bucket: `local.tasks` over `task_facts`, `local.daily` over
 * `daily_rollup` and `local.plans` over `plan_facts`. The build stamps
 * the finding, bug, change and CI buckets' sources too, and no spec here
 * defines them yet. Each spec is the descriptor without its build stamps,
 * which `defineTableSource` reads from the replica's `atlas_sources` rows
 * at each call.
 *
 * Only the descriptor's field keys reach the engine's SQL, so a column
 * left out here cannot be read: `task_facts`'s `origin_store` and
 * `origin_seq` are the dedupe key of the build and are not exposed.
 */
import type { Aggregate, FieldDescriptor, FieldType } from '@open-tomato/atlas-data/contract';
import type { TableSourceSpec } from '@open-tomato/atlas-data/source';

import { DAILY_SOURCE } from './build/daily.js';
import { PLANS_SOURCE } from './build/derive.js';
import { TASKS_SOURCE } from './ingest/effort.js';

/** The aggregates a numeric measure takes. */
const MEASURE_AGGREGATES: readonly Aggregate[] = ['sum', 'mean', 'min', 'max', 'p50', 'p90', 'p99'];

/** The aggregates a group key or an id takes. */
const COUNT_AGGREGATES: readonly Aggregate[] = ['count', 'count_distinct'];

/** A text field to group and filter by. */
function dimension(key: string, label: string, description?: string): FieldDescriptor {
  return {
    key,
    label,
    type: 'string',
    role: 'dimension',
    ...(description === undefined
      ? {}
      : { description }),
    aggregates: COUNT_AGGREGATES,
    filterable: true,
    groupable: true,
  };
}

/** A numeric field to aggregate and filter on. */
function measure(key: string, label: string, type: FieldType, unit: string): FieldDescriptor {
  return { key, label, type, role: 'measure', unit, aggregates: MEASURE_AGGREGATES, filterable: true, groupable: false };
}

/** A time field: the axis a window bounds and a grain buckets. */
function time(key: string, label: string, type: FieldType): FieldDescriptor {
  return { key, label, type, role: 'time', aggregates: ['count', 'min', 'max'], filterable: true, groupable: true };
}

/** The five kind suffixes of the `daily_rollup` columns, with their labels. */
const DAILY_KINDS: readonly (readonly [string, string])[] = [
  ['task', 'task'],
  ['plan', 'plan generation'],
  ['wrap_up', 'wrap-up'],
  ['ci_repair', 'ci-repair'],
  ['other', 'other'],
];

/** `local.tasks`: one row per Claude Code session, from `task_facts`. */
export const TASKS_SPEC: TableSourceSpec = {
  descriptor: {
    id: TASKS_SOURCE,
    source: 'local',
    channel: 'tasks',
    title: 'Sessions',
    description: 'One row per Claude Code session of the loop, read from the effort store.',
    timeField: 'started_at',
    grains: ['day', 'week', 'month', 'plan', 'all'],
    fields: [
      { key: 'session_id', label: 'Session', type: 'string', role: 'id', aggregates: COUNT_AGGREGATES, filterable: true, groupable: false },
      dimension('kind', 'Kind', 'task, plan-generation, wrap-up, ci-repair, search or other'),
      dimension('plan_stub', 'Plan'),
      dimension('task_line', 'Task line'),
      dimension('branch_type', 'Branch type', 'feat on every loop branch; split by change level instead'),
      dimension('work_type', 'Work type', 'feature, fix or chore, read from the session\'s highest change level (a proxy)'),
      dimension('agent', 'Agent'),
      dimension('model', 'Model', 'the model that answered most of the session\'s turns'),
      dimension('effort', 'Effort'),
      dimension('status', 'Status', 'the task report\'s status: done or blocked'),
      measure('budget_usd', 'Budget', 'number', 'USD'),
      time('started_at', 'Started', 'datetime'),
      time('ended_at', 'Ended', 'datetime'),
      { ...time('day', 'Day', 'date'), role: 'dimension' },
      measure('minutes', 'Minutes', 'number', 'min'),
      measure('input_tokens', 'Input tokens', 'integer', 'tokens'),
      measure('output_tokens', 'Output tokens', 'integer', 'tokens'),
      measure('cache_read_tokens', 'Cache read tokens', 'integer', 'tokens'),
      measure('cache_creation_tokens', 'Cache creation tokens', 'integer', 'tokens'),
      measure('tokens', 'Tokens', 'integer', 'tokens'),
      measure('attempt', 'Attempt', 'integer', 'attempts'),
      measure('findings', 'Findings', 'integer', 'findings'),
      measure('bugs', 'Bugs', 'integer', 'bugs'),
      measure('blockers', 'Blockers', 'integer', 'blockers'),
      measure('skills_used', 'Skills used', 'integer', 'skills'),
    ],
  },
  table: 'task_facts',
};

/** `local.daily`: one row per calendar day, from `daily_rollup`. */
export const DAILY_SPEC: TableSourceSpec = {
  descriptor: {
    id: DAILY_SOURCE,
    source: 'local',
    channel: 'daily',
    title: 'Days',
    description: 'One row per calendar day a session started or a preflight ran on: minutes and tokens by session kind.',
    timeField: 'day',
    grains: ['day', 'week', 'month', 'all'],
    fields: [
      time('day', 'Day', 'date'),
      ...DAILY_KINDS.map(([suffix, label]) => measure(`minutes_${suffix}`, `Minutes, ${label}`, 'number', 'min')),
      ...DAILY_KINDS.map(([suffix, label]) => measure(`tokens_${suffix}`, `Tokens, ${label}`, 'integer', 'tokens')),
      measure('tokens_total', 'Tokens', 'integer', 'tokens'),
      measure('sessions', 'Sessions', 'integer', 'sessions'),
      measure('task_sessions', 'Task sessions', 'integer', 'sessions'),
      measure('tasks_done', 'Tasks done', 'integer', 'tasks'),
      measure('tasks_blocked', 'Tasks blocked', 'integer', 'tasks'),
      measure('findings', 'Findings', 'integer', 'findings'),
      measure('bugs', 'Bugs', 'integer', 'bugs'),
      measure('changes', 'Changes', 'integer', 'changes'),
      measure('commits', 'Commits', 'integer', 'commits'),
      measure('prs_merged', 'Pull requests merged', 'integer', 'pull requests'),
      measure('preflight_runs', 'Preflight runs', 'integer', 'runs'),
      measure('preflight_halts', 'Preflight halts', 'integer', 'runs'),
    ],
  },
  table: 'daily_rollup',
};

/** `local.plans`: one row per plan the plan folder holds or a session or CI reading names, from `plan_facts`. */
export const PLANS_SPEC: TableSourceSpec = {
  descriptor: {
    id: PLANS_SOURCE,
    source: 'local',
    channel: 'plans',
    title: 'Plans',
    description: 'One row per plan: its task counts from the plan file, and its sessions and CI readings from the effort store.',
    timeField: 'first_at',
    grains: ['day', 'week', 'month', 'plan', 'all'],
    fields: [
      dimension('plan_stub', 'Plan'),
      dimension('plan_source', 'Plan source', 'where the plan was read: tracker, plan or missing'),
      dimension('epic_slug', 'Epic'),
      dimension('ci_last_verdict', 'Last CI verdict'),
      { ...measure('issue_number', 'Issue', 'integer', 'issue'), role: 'id', aggregates: COUNT_AGGREGATES },
      { ...measure('pr_number', 'Pull request', 'integer', 'pull request'), role: 'id', aggregates: COUNT_AGGREGATES },
      measure('tasks_planned', 'Tasks planned', 'integer', 'tasks'),
      measure('tasks_done', 'Tasks done', 'integer', 'tasks'),
      measure('tasks_blocked', 'Tasks blocked', 'integer', 'tasks'),
      measure('sessions', 'Sessions', 'integer', 'sessions'),
      measure('task_sessions', 'Task sessions', 'integer', 'sessions'),
      measure('reports_done', 'Reports done', 'integer', 'reports'),
      measure('reports_blocked', 'Reports blocked', 'integer', 'reports'),
      measure('repeat_sessions', 'Repeat sessions', 'integer', 'sessions'),
      measure('ci_repair_sessions', 'CI-repair sessions', 'integer', 'sessions'),
      time('first_at', 'First session', 'datetime'),
      time('last_at', 'Last session', 'datetime'),
      time('merged_at', 'Merged', 'datetime'),
      measure('minutes', 'Minutes', 'number', 'min'),
      measure('tokens', 'Tokens', 'integer', 'tokens'),
      measure('ci_red_readings', 'Red CI readings', 'integer', 'readings'),
      measure('completed', 'Completed', 'integer', 'plans'),
    ],
  },
  table: 'plan_facts',
};

/** Every source spec the registry defines, in the order `/sources` lists them. */
export const SOURCE_SPECS: readonly TableSourceSpec[] = [TASKS_SPEC, DAILY_SPEC, PLANS_SPEC];
