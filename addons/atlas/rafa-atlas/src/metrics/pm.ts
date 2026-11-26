/**
 * The project management lens's PoC metrics (spec section G): budget
 * burn, tokens per day, plan completion, planned tasks against sessions
 * and the active blockers.
 *
 * `pm.budget-burn` carries no `goal` here: the weekly token budget is
 * the project's `budget.tokensPerWeek` (decision D10), which `serve`
 * reads with `loadAtlasConfig` and lays over the served metric as its
 * goal (`withAtlasTargets`, `src/config.ts`). With none set, the card
 * draws the spend with no target set.
 *
 * Past the PoC cut, `pm.milestone-completion` (entry 1) reads the epics of
 * the board cache, offline (D17): the epics closed as completed over the
 * epics in Now or Done. The engine counts no condition per row, so it
 * answers the epics by horizon, state and close reason, and the card
 * takes the share: the numerator is the CLOSED rows with reason
 * COMPLETED, the denominator those rows with every open epic in the
 * `now` horizon and every closed one. It reads the board as of its
 * cache's watermark, so the card asks it with no window
 * (`local.issues` bounds a window by `created_at`, NULL offline).
 *
 * `pm.minutes-per-agent` (entry 10) sums the minutes of the task sessions
 * per agent over the window: a proxy for resource utilization, as the
 * store records no wall-clock capacity to divide by. A task session
 * naming no agent counts under a NULL agent, which the card names.
 *
 * `pm.out-of-scope-per-week` (entry 7, spec C1) counts every out-of-scope
 * entry a task reported per ISO week: the `local.bugs` rows with
 * `source` `out_of_scope`, leaving out `scope` `machine` and `module`
 * `cli-gap` as every bug count does ({@link NOT_MACHINE_OR_CLI_GAP}).
 * The engine reads `ne` as true for a NULL, so a row stored before the
 * store recorded a scope, or naming no module, stays in. It measures
 * what the tile names, so it is `direct` and carries no proxy note,
 * though entry 7's own basis is a ratio over planned tasks.
 *
 * `pm.task-pile` (spec C3, no B4 row) answers the open issues of the
 * board cache that carry a `type:` label, grouped by that type
 * (`issue_type`, the first `type:` label) and by each issue's
 * `created_at`, which the card buckets by age to the replica's build
 * time. Epics and the roadmap issue hold other issues, so `type:epic`
 * and `type:roadmap` are left out, and `is_epic` with them for an epic
 * whose first type label is another. `module` `cli-gap` is left out
 * ({@link CLI_GAP_OUT}) so the bug slice matches the open bug issues; the
 * filters are a conjunction, so the cut reaches any issue so labelled,
 * and `cli-gap` is a value only bugs carry. A NULL module stays in. The
 * open time comes from GitHub only ({@link READ_FROM_GITHUB}), so it is
 * `gh`: a replica built without `--github` answers no row. It reads the
 * board as of its cache, so the card asks it with no window.
 */
import type { Filter, MetricDefinition } from '@open-tomato/atlas-data/contract';

import { DAILY_SOURCE } from '../build/daily.js';
import { PLANS_SOURCE } from '../build/derive.js';
import { ISSUES_SOURCE } from '../ingest/board.js';
import { TASKS_SOURCE } from '../ingest/effort.js';
import { BUGS_SOURCE, FINDINGS_SOURCE } from '../ingest/facts.js';

import { CLI_GAP_OUT, READ_FROM_GITHUB } from './qa.js';

/** How many blockers the active-blockers list answers, the newest first. */
const ACTIVE_BLOCKERS_LIMIT = 50;

/** Tokens spent per week, against the weekly budget once one is set. */
export const BUDGET_BURN: MetricDefinition = {
  id: 'pm.budget-burn',
  title: 'Budget burn',
  lenses: ['pm'],
  description: 'Tokens of every session summed per ISO week, against the weekly token budget, budget.tokensPerWeek of the Atlas config; with none set, the spend alone, no target set.',
  sourceId: DAILY_SOURCE,
  params: {
    grain: 'week',
    measures: [{ field: 'tokens_total', agg: 'sum', as: 'tokens' }],
    orderBy: [{ key: 'week', dir: 'asc' }],
  },
  formula: { kind: 'none' },
  unit: 'tokens',
  chart: 'gauge',
  feasibility: 'direct',
};

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

/** Of the plans started in a week, the share whose every task is done. */
export const PLAN_COMPLETION: MetricDefinition = {
  id: 'pm.plan-completion',
  title: 'Plan completion',
  lenses: ['pm'],
  description: 'Plans started per ISO week (by their first session), how many of them hold every task done, and that share.',
  sourceId: PLANS_SOURCE,
  params: {
    grain: 'week',
    measures: [
      { field: 'plan_stub', agg: 'count', as: 'started' },
      { field: 'completed', agg: 'sum', as: 'completed' },
    ],
    orderBy: [{ key: 'week', dir: 'asc' }],
  },
  formula: { kind: 'ratio', numerator: 'completed', denominator: 'started', as: 'completion' },
  chart: 'kpi',
  feasibility: 'proxy',
  proxyFor: 'sprint predictability',
  proxyNote: 'Plans stand in for sprints, which rafa does not have: a plan counts in the week its first session started, and as completed once its plan file holds every task done.',
};

/** The tasks each plan holds against the task sessions it took. */
export const PLANNED_VS_SESSIONS: MetricDefinition = {
  id: 'pm.planned-vs-sessions',
  title: 'Planned tasks vs sessions',
  lenses: ['pm'],
  description: 'Per plan, the tasks its plan file holds and the task sessions the loop ran for it; sessions above the plan are rework.',
  sourceId: PLANS_SOURCE,
  params: {
    grain: 'plan',
    measures: [
      { field: 'tasks_planned', agg: 'sum', as: 'planned' },
      { field: 'task_sessions', agg: 'sum', as: 'sessions' },
    ],
    orderBy: [{ key: 'plan_stub', dir: 'asc' }],
  },
  formula: { kind: 'none' },
  unit: 'tasks',
  chart: 'bar',
  feasibility: 'direct',
};

/** The blockers that stopped a task, the newest first. */
export const ACTIVE_BLOCKERS: MetricDefinition = {
  id: 'pm.active-blockers',
  title: 'Active blockers',
  lenses: ['pm'],
  description: 'Each blocker a task reported when it stopped blocked, with its plan and task line, the newest first.',
  sourceId: FINDINGS_SOURCE,
  params: {
    fields: ['day', 'plan_stub', 'task_line', 'what'],
    filters: [
      { field: 'source', op: 'eq', value: 'blocker' },
      { field: 'outcome', op: 'eq', value: 'blocked' },
    ],
    orderBy: [{ key: 'day', dir: 'desc' }],
    limit: ACTIVE_BLOCKERS_LIMIT,
  },
  formula: { kind: 'none' },
  unit: 'blockers',
  chart: 'list',
  feasibility: 'direct',
};

/** The epics by horizon, state and close reason: the card reads the completed share of those in Now or Done. */
export const MILESTONE_COMPLETION: MetricDefinition = {
  id: 'pm.milestone-completion',
  title: 'Milestone completion',
  lenses: ['pm'],
  description: 'The epics of the board cache by horizon, state and close reason; the card divides the epics closed as completed by the epics in the now horizon or closed.',
  sourceId: ISSUES_SOURCE,
  params: {
    filters: [{ field: 'is_epic', op: 'eq', value: 1 }],
    groupBy: ['horizon', 'state', 'state_reason'],
    measures: [{ field: 'number', agg: 'count', as: 'epics' }],
    orderBy: [{ key: 'epics', dir: 'desc' }],
  },
  formula: { kind: 'none' },
  unit: 'epics',
  chart: 'bullet',
  feasibility: 'direct',
};

/** The minutes of task sessions per agent, the most first. */
export const MINUTES_PER_AGENT: MetricDefinition = {
  id: 'pm.minutes-per-agent',
  title: 'Minutes per agent',
  lenses: ['pm'],
  description: 'The minutes of the task sessions over the window, summed per agent, the most first; a session naming no agent counts under a NULL agent.',
  sourceId: TASKS_SOURCE,
  params: {
    filters: [{ field: 'kind', op: 'eq', value: 'task' }],
    groupBy: ['agent'],
    measures: [
      { field: 'minutes', agg: 'sum', as: 'minutes' },
      { field: 'session_id', agg: 'count', as: 'sessions' },
    ],
    orderBy: [{ key: 'minutes', dir: 'desc' }],
  },
  formula: { kind: 'none' },
  unit: 'min',
  chart: 'bar',
  feasibility: 'proxy',
  proxyFor: 'resource utilization',
  proxyNote: 'Task session minutes per agent stand in for utilization: the store records no capacity to divide them by.',
};

/** Leaves out the bugs of this machine and the gaps in rafa's own CLI; `ne` keeps a NULL scope or module in. */
export const NOT_MACHINE_OR_CLI_GAP: readonly Filter[] = [
  { field: 'scope', op: 'ne', value: 'machine' },
  CLI_GAP_OUT,
];

/** Every out-of-scope entry a task reported, counted per ISO week. */
export const OUT_OF_SCOPE_PER_WEEK: MetricDefinition = {
  id: 'pm.out-of-scope-per-week',
  title: 'Out-of-scope entries per week',
  lenses: ['pm'],
  description: 'The out-of-scope entries the tasks reported, counted per ISO week; machine-scoped entries and cli-gap bugs left out, an entry with no scope or module kept.',
  sourceId: BUGS_SOURCE,
  params: {
    grain: 'week',
    filters: [{ field: 'source', op: 'eq', value: 'out_of_scope' }, ...NOT_MACHINE_OR_CLI_GAP],
    measures: [{ field: 'id', agg: 'count', as: 'entries' }],
    orderBy: [{ key: 'week', dir: 'asc' }],
  },
  formula: { kind: 'none' },
  unit: 'entries',
  chart: 'kpi',
  feasibility: 'direct',
};

/** The type labels that hold other issues, left out of the task pile. */
const CONTAINER_TYPES: readonly string[] = ['epic', 'roadmap'];

/** The open typed issues by type and open time: the card rings them by type, then by age. */
export const TASK_PILE: MetricDefinition = {
  id: 'pm.task-pile',
  title: 'Task pile',
  lenses: ['pm'],
  description: 'The open issues with a type: label, epics and the roadmap issue left out and cli-gap bugs with them, counted per type and open time; the card buckets their age. Read from GitHub: only a build run with --github fills the open time.',
  sourceId: ISSUES_SOURCE,
  params: {
    filters: [
      { field: 'state', op: 'eq', value: 'OPEN' },
      { field: 'issue_type', op: 'is_null', value: false },
      { field: 'issue_type', op: 'nin', value: CONTAINER_TYPES },
      { field: 'is_epic', op: 'ne', value: 1 },
      CLI_GAP_OUT,
      READ_FROM_GITHUB,
    ],
    groupBy: ['issue_type', 'created_at'],
    measures: [{ field: 'number', agg: 'count', as: 'issues' }],
    orderBy: [{ key: 'issue_type', dir: 'asc' }, { key: 'created_at', dir: 'asc' }],
  },
  formula: { kind: 'none' },
  unit: 'issues',
  chart: 'donut',
  feasibility: 'gh',
};

/** The project management lens's PoC metrics, in the order section G lists them. */
export const PM_POC_METRICS: readonly MetricDefinition[] = [BUDGET_BURN, TOKENS_PER_DAY, PLAN_COMPLETION, PLANNED_VS_SESSIONS, ACTIVE_BLOCKERS];

/** The project management lens's metrics: the PoC cut, the one over the board source, the minutes per agent, the out-of-scope entries per week, then the task pile. */
export const PM_METRICS: readonly MetricDefinition[] = [...PM_POC_METRICS, MILESTONE_COMPLETION, MINUTES_PER_AGENT, OUT_OF_SCOPE_PER_WEEK, TASK_PILE];
