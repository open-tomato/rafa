/**
 * The developer lens's PoC metrics (spec section G): tasks done per week
 * by work type, task cycle minutes, the red share of CI readings and
 * plans completed per week.
 *
 * `local.plans` buckets a plan by the week of its first session, its
 * time field, as the store records no time a plan completed; so
 * `dev.plans-completed-per-week` is a proxy, and says so.
 *
 * Past the PoC cut, three read the git, board and GitHub sources:
 * release tags per week (entry 21), WIP (entry 25) and the pull request
 * cycle (entry 22). WIP counts the open issues whose board stage is
 * Claimed or In development (D16), never the `rafa:in-development`
 * label, which closed issues keep; it reads the board as of its cache's
 * watermark, so the card asks it with no window (`local.issues` bounds a
 * window by `created_at`, NULL offline). Its ceiling is the project's
 * `wipLimit`, laid over it as its goal by `withAtlasTargets`. The pull
 * request cycle is GitHub-only: `local.prs` holds rows only after a
 * `--github` build, and the engine computes no duration, so the metric
 * answers each merged pull request's two times and the card buckets the
 * span.
 *
 * `dev.work-done` (spec C4, no B4 row) counts the changelog entries of
 * `local.changes` over the window per `level` and `area` as stored: the
 * engine groups by the raw column, so a NULL area and each spelling of
 * one area answer apart, and the card tidies, merges and folds them.
 *
 * The balance radar (spec C5) reads weekly rows and computes each index
 * itself, this week over the median of the 12 before, as the engine
 * computes no median over buckets. Four metrics give it the weeks the
 * catalogue lacked: `dev.changes-per-week`, the changelog entries per
 * week, level and raw area; `dev.sessions-per-week`, the task sessions
 * per week, work type and report status with their minutes;
 * `dev.repeat-sessions-per-week`, the task sessions with an attempt past
 * the first; and `dev.ci-verdicts-per-week` (entry 31), the green and red
 * readings per week, since `dev.red-ci-share` answers one share over the
 * window and no week. The sessions read `local.tasks`, not `local.daily`:
 * `daily_rollup` holds the task and blocked counts but splits minutes by
 * session kind, never by work type, and holds no repeat count, while the
 * engine has no conditional measure, so the repeat sessions are a query of
 * their own over the `attempt` filter. {@link BALANCE_INDEX_METRICS} lists
 * which metrics each index reads.
 */
import type { MetricDefinition } from '@open-tomato/atlas-data/contract';

import { PLANS_SOURCE } from '../build/derive.js';
import { ISSUES_SOURCE } from '../ingest/board.js';
import { TASKS_SOURCE } from '../ingest/effort.js';
import { CHANGES_SOURCE, CI_SOURCE } from '../ingest/facts.js';
import { COMMITS_SOURCE } from '../ingest/git.js';
import { PRS_SOURCE } from '../ingest/github.js';

/** How many task sessions the cycle scatter answers at most: past the store's 11 weeks of about 3,000. */
const TASK_CYCLE_LIMIT = 5_000;

/** The red share above which the CI tile draws as danger. */
const RED_CI_THRESHOLD = 0.1;

/** How many merged pull requests the cycle histogram answers at most. */
const PR_CYCLE_LIMIT = 5_000;

/** The board stages an open issue is work in progress in (D16). */
export const WIP_STAGES: readonly string[] = ['Claimed', 'In development'];

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

/** The release tags per week: a `v*` tag on a commit of the base branch is a deploy (D13). */
export const DEPLOYS_PER_WEEK: MetricDefinition = {
  id: 'dev.deploys-per-week',
  title: 'Deploys per week',
  lenses: ['developer'],
  description: 'The first-parent commits of the base branch carrying a v* release tag, per ISO week of the tagged commit.',
  sourceId: COMMITS_SOURCE,
  params: {
    grain: 'week',
    filters: [{ field: 'release_tag', op: 'is_null', value: false }],
    measures: [{ field: 'release_tag', agg: 'count', as: 'deploys' }],
    orderBy: [{ key: 'week', dir: 'asc' }],
  },
  formula: { kind: 'none' },
  unit: 'releases',
  chart: 'line',
  feasibility: 'direct',
};

/** The open issues in Claimed or In development, against the project's `wipLimit`. */
export const WIP: MetricDefinition = {
  id: 'dev.wip',
  title: 'Work in progress',
  lenses: ['developer'],
  description: 'The open issues whose board stage is Claimed or In development, as of the board cache; a closed issue still labelled rafa:in-development is not counted. Drawn against wipLimit of the Atlas config, or alone with none set.',
  sourceId: ISSUES_SOURCE,
  params: {
    filters: [
      { field: 'state', op: 'eq', value: 'OPEN' },
      { field: 'stage', op: 'in', value: WIP_STAGES },
    ],
    measures: [{ field: 'number', agg: 'count', as: 'issues' }],
  },
  formula: { kind: 'none' },
  unit: 'issues',
  chart: 'gauge',
  feasibility: 'direct',
};

/** Each merged pull request's open and merge times: the card buckets the span. */
export const PR_CYCLE_TIME: MetricDefinition = {
  id: 'dev.pr-cycle-time',
  title: 'Pull request cycle time',
  lenses: ['developer'],
  description: 'One row per merged pull request: when it was opened and merged, with its plan; the card buckets the span under 4 hours, 4 to 24 hours, 1 to 3 days and over 3 days. Read from GitHub: only a build run with --github fills it.',
  sourceId: PRS_SOURCE,
  params: {
    fields: ['number', 'plan_stub', 'created_at', 'merged_at'],
    filters: [{ field: 'state', op: 'eq', value: 'MERGED' }],
    orderBy: [{ key: 'merged_at', dir: 'asc' }],
    limit: PR_CYCLE_LIMIT,
  },
  formula: { kind: 'none' },
  unit: 'pull requests',
  chart: 'histogram',
  feasibility: 'gh',
};

/** The changelog entries over the window, per level and raw area: the card tidies the areas. */
export const WORK_DONE: MetricDefinition = {
  id: 'dev.work-done',
  title: 'Work done',
  lenses: ['developer'],
  description: 'The changelog entries the tasks reported over the window, counted per level and per area as the task wrote it; an entry with no area counts under a NULL area.',
  sourceId: CHANGES_SOURCE,
  params: {
    groupBy: ['level', 'area'],
    measures: [{ field: 'id', agg: 'count', as: 'entries' }],
    orderBy: [{ key: 'level', dir: 'asc' }, { key: 'area', dir: 'asc' }],
  },
  formula: { kind: 'none' },
  unit: 'entries',
  chart: 'donut',
  feasibility: 'direct',
};

/** The changelog entries per week, level and raw area: the radar's features landed and docs kept current. */
export const CHANGES_PER_WEEK: MetricDefinition = {
  id: 'dev.changes-per-week',
  title: 'Changes per week',
  lenses: ['developer'],
  description: 'The changelog entries the tasks reported, per ISO week, counted per level and per area as the task wrote it; an entry with no area counts under a NULL area.',
  sourceId: CHANGES_SOURCE,
  params: {
    grain: 'week',
    groupBy: ['level', 'area'],
    measures: [{ field: 'id', agg: 'count', as: 'entries' }],
    orderBy: [{ key: 'week', dir: 'asc' }, { key: 'level', dir: 'asc' }, { key: 'area', dir: 'asc' }],
  },
  formula: { kind: 'none' },
  unit: 'entries',
  chart: 'stacked-bar',
  feasibility: 'direct',
};

/** The task sessions per week, work type and status, with their minutes: the radar's blocked and refactor + chore. */
export const SESSIONS_PER_WEEK: MetricDefinition = {
  id: 'dev.sessions-per-week',
  title: 'Task sessions per week',
  lenses: ['developer'],
  description: 'The task sessions per ISO week, counted per work type (feature, fix, chore) and report status (done, blocked), with the minutes they ran; a session with no work type or no report counts under a NULL.',
  sourceId: TASKS_SOURCE,
  params: {
    grain: 'week',
    filters: [{ field: 'kind', op: 'eq', value: 'task' }],
    groupBy: ['work_type', 'status'],
    measures: [
      { field: 'session_id', agg: 'count', as: 'sessions' },
      { field: 'minutes', agg: 'sum', as: 'minutes' },
    ],
    orderBy: [{ key: 'week', dir: 'asc' }, { key: 'work_type', dir: 'asc' }, { key: 'status', dir: 'asc' }],
  },
  formula: { kind: 'none' },
  unit: 'sessions',
  chart: 'stacked-bar',
  feasibility: 'proxy',
  proxyFor: 'minutes by kind of work',
  proxyNote: 'Work type is read from the change level each task reported (patch = fix, none = chore or docs, minor = feature): loop branches carry no type, so a refactor reads as the level it reported.',
};

/** The task sessions past their task line's first attempt, per week: the repeat half of the radar's blocked. */
export const REPEAT_SESSIONS_PER_WEEK: MetricDefinition = {
  id: 'dev.repeat-sessions-per-week',
  title: 'Repeat sessions per week',
  lenses: ['developer'],
  description: 'The task sessions per ISO week that ran a task line again: an attempt past the first of their plan and task line.',
  sourceId: TASKS_SOURCE,
  params: {
    grain: 'week',
    filters: [
      { field: 'kind', op: 'eq', value: 'task' },
      { field: 'attempt', op: 'gt', value: 1 },
    ],
    measures: [{ field: 'session_id', agg: 'count', as: 'sessions' }],
    orderBy: [{ key: 'week', dir: 'asc' }],
  },
  formula: { kind: 'none' },
  unit: 'sessions',
  chart: 'line',
  feasibility: 'direct',
};

/** The CI readings that ran a check, per week and verdict: the radar's red CI share, by week. */
export const CI_VERDICTS_PER_WEEK: MetricDefinition = {
  id: 'dev.ci-verdicts-per-week',
  title: 'CI verdicts per week',
  lenses: ['developer'],
  description: 'The CI readings of plan heads that ran a check, per ISO week of the reading, counted green and red.',
  sourceId: CI_SOURCE,
  params: {
    grain: 'week',
    filters: [{ field: 'verdict', op: 'in', value: ['green', 'red'] }],
    groupBy: ['verdict'],
    measures: [{ field: 'head_sha', agg: 'count', as: 'readings' }],
    orderBy: [{ key: 'week', dir: 'asc' }, { key: 'verdict', dir: 'asc' }],
  },
  formula: { kind: 'none' },
  unit: 'readings',
  chart: 'stacked-bar',
  feasibility: 'direct',
};

/**
 * The metrics each index of the balance radar reads (spec C5), keyed by
 * the index ids of `demo/src/data/balance.ts`, each answering weekly rows:
 *
 * - `feat-rate`: `dev.changes-per-week`, its `major` and `minor` entries
 *   (feature, D4).
 * - `plan-done`: `pm.plan-completion`, the plans started and completed
 *   per week of their first session; `dev.plans-completed-per-week`
 *   answers the completed half alone.
 * - `releases`: `dev.deploys-per-week`.
 * - `bug-intake`: `pm.out-of-scope-per-week` over the task sessions of
 *   `dev.sessions-per-week`; the out-of-scope count is the bug count that
 *   leaves out `scope` `machine` and `module` `cli-gap`.
 * - `regressions`: `qa.regressions` over the week totals of
 *   `qa.bugs-by-kind`, every bug route.
 * - `red-ci`: `dev.ci-verdicts-per-week`, red over green and red.
 * - `blocked`: the `blocked` sessions of `dev.sessions-per-week` and
 *   `dev.repeat-sessions-per-week`, over the task sessions.
 * - `refactor-share`: the `chore` minutes of `dev.sessions-per-week` over
 *   all its minutes; D4 has no refactor type.
 * - `docs-share`: the `docs` entries of `dev.changes-per-week`, after the
 *   card's C4 tidying, over all its entries; the stale docs cleared wait
 *   on a replica holding the store's `stale_docs`.
 */
export const BALANCE_INDEX_METRICS: Readonly<Record<string, readonly string[]>> = {
  'feat-rate': ['dev.changes-per-week'],
  'plan-done': ['pm.plan-completion'],
  'releases': ['dev.deploys-per-week'],
  'bug-intake': ['pm.out-of-scope-per-week', 'dev.sessions-per-week'],
  'regressions': ['qa.regressions', 'qa.bugs-by-kind'],
  'red-ci': ['dev.ci-verdicts-per-week'],
  'blocked': ['dev.sessions-per-week', 'dev.repeat-sessions-per-week'],
  'refactor-share': ['dev.sessions-per-week'],
  'docs-share': ['dev.changes-per-week'],
};

/** The developer lens's PoC metrics, in the order section G lists them. */
export const DEVELOPER_POC_METRICS: readonly MetricDefinition[] = [TASKS_DONE_PER_WEEK, TASK_CYCLE, RED_CI_SHARE, PLANS_COMPLETED_PER_WEEK];

/** The developer lens's metrics: the PoC cut, then those over the git, board and GitHub sources, then the work done and the radar's weeks. */
export const DEVELOPER_METRICS: readonly MetricDefinition[] = [
  ...DEVELOPER_POC_METRICS,
  DEPLOYS_PER_WEEK,
  WIP,
  PR_CYCLE_TIME,
  WORK_DONE,
  CHANGES_PER_WEEK,
  SESSIONS_PER_WEEK,
  REPEAT_SESSIONS_PER_WEEK,
  CI_VERDICTS_PER_WEEK,
];
