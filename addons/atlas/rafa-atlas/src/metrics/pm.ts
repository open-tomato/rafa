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
 */
import type { MetricDefinition } from '@open-tomato/atlas-data/contract';

import { DAILY_SOURCE } from '../build/daily.js';
import { PLANS_SOURCE } from '../build/derive.js';
import { FINDINGS_SOURCE } from '../ingest/facts.js';

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

/** The project management lens's metrics, in the order section G lists them. */
export const PM_METRICS: readonly MetricDefinition[] = [BUDGET_BURN, TOKENS_PER_DAY, PLAN_COMPLETION, PLANNED_VS_SESSIONS, ACTIVE_BLOCKERS];
