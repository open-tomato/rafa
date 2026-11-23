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
 *
 * Past the PoC cut, seven more. Six read the bug issues of `local.issues`
 * ({@link BOARD_BUGS}: labelled `type:bug` or `bug`, `module` not
 * `cli-gap`, a NULL module kept in, trap 7). A closed bug with reason
 * COMPLETED is fixed, one closed with any other reason dropped, an open
 * one open.
 *
 * - `qa.bug-outcome-by-loop-start` and `qa.drop-rate` read only states
 *   and plans, which the board cache holds, so they are offline. The
 *   outcome chart counts each bug filed by a loop on the day its loop
 *   started, a view of origin and not a burndown (trap 8): the metric
 *   answers the bugs per plan, state and close reason, and the card dates
 *   each plan by its `first_at` in `local.plans`. Both ask with no window,
 *   as `local.issues` bounds a window by `created_at`, NULL offline.
 * - `qa.defect-age`, `qa.resolution-time`, `qa.open-bugs-per-day` and
 *   `qa.bugs-per-stretch` need the open and close times only GitHub has
 *   (trap 3): their filters keep only rows with a `created_at`, so they
 *   answer no rows unless the build ran with `--github`. The engine
 *   computes no span and no level over time, so each answers the times
 *   and the card does the arithmetic: the age of each open bug, the span
 *   of each fixed one by priority, the bugs open on each day (all of
 *   them, and those a loop filed), and the bugs filed and closed in each
 *   stretch window, cut at the lane M ends of `local.marks`. Open bugs
 *   per day asks with no window, or a bug opened before it and still
 *   open would drop out.
 *
 * `qa.defect-density` (entry 27) reads `local.modules`: the bugs the
 * effort store attributes to each module folder over its lines of code.
 * `module_facts.bugs` counts `bug_facts` rows whose `module` is the
 * folder's path, and `cli-gap` is a label value, never a module path
 * (every folder the module globs find holds a `/`), so a `cli-gap` bug
 * cannot reach it and `local.modules` has no `module` field to filter.
 */
import type { Filter, MetricDefinition } from '@open-tomato/atlas-data/contract';

import { ISSUES_SOURCE } from '../ingest/board.js';
import { BUGS_SOURCE, CI_SOURCE } from '../ingest/facts.js';
import { MODULES_SOURCE } from '../ingest/modules.js';

/** How many bug issues a row-mode bug metric answers at most: past the 864 the board held on 2026-11-23. */
const BUG_ROWS_LIMIT = 5_000;

/** Leaves out the gaps in rafa's own CLI; `ne` reads true for a NULL module, so a bug naming none stays in. */
export const CLI_GAP_OUT: Filter = { field: 'module', op: 'ne', value: 'cli-gap' };

/** The bug rows a bug metric reads: routed, and not a gap in rafa's own CLI. */
export const NOT_CLI_GAP: readonly Filter[] = [
  { field: 'source', op: 'eq', value: 'routed' },
  CLI_GAP_OUT,
];

/** The issues a board bug metric reads: labelled a bug, and not a gap in rafa's own CLI. */
export const BOARD_BUGS: readonly Filter[] = [
  { field: 'is_bug', op: 'eq', value: 1 },
  CLI_GAP_OUT,
];

/** The board bugs a loop filed: those whose body names a plan. */
const FILED_BY_A_LOOP: Filter = { field: 'plan_stub', op: 'is_null', value: false };

/** The board bugs with an open time: only a build run with --github fills one. */
const READ_FROM_GITHUB: Filter = { field: 'created_at', op: 'is_null', value: false };

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

/** The bugs each module's folder holds per line of its code, the densest first. */
export const DEFECT_DENSITY: MetricDefinition = {
  id: 'qa.defect-density',
  title: 'Defect density',
  lenses: ['qa'],
  description: 'Per module folder, the out-of-scope bugs the effort store attributes to it and its lines of code, test files left out, with the bugs per line; the card shows it per 1,000 lines.',
  sourceId: MODULES_SOURCE,
  params: {
    groupBy: ['path'],
    measures: [
      { field: 'bugs', agg: 'sum', as: 'bugs' },
      { field: 'loc', agg: 'sum', as: 'loc' },
    ],
    orderBy: [{ key: 'bugs', dir: 'desc' }],
  },
  formula: { kind: 'ratio', numerator: 'bugs', denominator: 'loc', as: 'bugs_per_line' },
  unit: 'bugs',
  chart: 'bar',
  feasibility: 'proxy',
  proxyFor: 'defect density',
  proxyNote: 'A bug counts in the module its report names a path of, and lines of code stand in for size: a bug naming no module path counts in no module.',
};

/** The bugs loops filed, per plan, state and close reason: the card counts each on its loop's start day. */
export const BUG_OUTCOME_BY_LOOP_START: MetricDefinition = {
  id: 'qa.bug-outcome-by-loop-start',
  title: 'Bug outcome by loop start',
  lenses: ['qa'],
  description: 'The bug issues a loop filed, per plan, state and close reason; the card counts each on the day its plan\'s first session started, as fixed (closed completed), dropped (closed with another reason) or open.',
  sourceId: ISSUES_SOURCE,
  params: {
    filters: [...BOARD_BUGS, FILED_BY_A_LOOP],
    groupBy: ['plan_stub', 'state', 'state_reason'],
    measures: [{ field: 'number', agg: 'count', as: 'bugs' }],
    orderBy: [{ key: 'plan_stub', dir: 'asc' }],
  },
  formula: { kind: 'none' },
  unit: 'bugs',
  chart: 'stacked-bar',
  feasibility: 'direct',
};

/** Of the closed bugs loops filed, the share per close reason: every reason but COMPLETED is a drop. */
export const DROP_RATE: MetricDefinition = {
  id: 'qa.drop-rate',
  title: 'Drop rate',
  lenses: ['qa'],
  description: 'The closed bug issues a loop filed, by close reason, each with its share; the shares of every reason but COMPLETED summed are the drop rate, dropped over fixed and dropped.',
  sourceId: ISSUES_SOURCE,
  params: {
    filters: [...BOARD_BUGS, FILED_BY_A_LOOP, { field: 'state', op: 'eq', value: 'CLOSED' }],
    groupBy: ['state_reason'],
    measures: [{ field: 'number', agg: 'count', as: 'bugs' }],
    orderBy: [{ key: 'bugs', dir: 'desc' }],
  },
  formula: { kind: 'share', of: 'bugs', as: 'share' },
  unit: 'bugs',
  chart: 'kpi',
  feasibility: 'direct',
};

/** The open bugs per day they were opened: the card buckets their age. */
export const DEFECT_AGE: MetricDefinition = {
  id: 'qa.defect-age',
  title: 'Defect age',
  lenses: ['qa'],
  description: 'The open bug issues per day they were opened; the card buckets their age at 0 to 7, 8 to 30 and over 30 days. Read from GitHub: only a build run with --github fills the open time.',
  sourceId: ISSUES_SOURCE,
  params: {
    grain: 'day',
    filters: [...BOARD_BUGS, READ_FROM_GITHUB, { field: 'state', op: 'eq', value: 'OPEN' }],
    measures: [{ field: 'number', agg: 'count', as: 'bugs' }],
    orderBy: [{ key: 'day', dir: 'asc' }],
  },
  formula: { kind: 'none' },
  unit: 'bugs',
  chart: 'bar',
  feasibility: 'gh',
};

/** Each fixed bug's open and close times with its priority: the card draws a box per priority. */
export const RESOLUTION_TIME: MetricDefinition = {
  id: 'qa.resolution-time',
  title: 'Defect resolution time',
  lenses: ['qa'],
  description: 'One row per bug issue closed as completed: its priority and when it was opened and closed; the card draws the span as a box per priority. Read from GitHub: only a build run with --github fills the times.',
  sourceId: ISSUES_SOURCE,
  params: {
    fields: ['number', 'priority', 'created_at', 'closed_at'],
    filters: [
      ...BOARD_BUGS,
      READ_FROM_GITHUB,
      { field: 'state_reason', op: 'eq', value: 'COMPLETED' },
      { field: 'closed_at', op: 'is_null', value: false },
    ],
    orderBy: [{ key: 'priority', dir: 'asc' }, { key: 'closed_at', dir: 'asc' }],
    limit: BUG_ROWS_LIMIT,
  },
  formula: { kind: 'none' },
  unit: 'bugs',
  chart: 'box',
  feasibility: 'gh',
};

/** Each bug's open and close times and plan: the card counts the bugs open on each day. */
export const OPEN_BUGS_PER_DAY: MetricDefinition = {
  id: 'qa.open-bugs-per-day',
  title: 'Open bugs per day',
  lenses: ['qa'],
  description: 'One row per bug issue: when it was opened and closed, and the plan of the loop that filed it; the card draws the bugs open on each day, all of them and those a loop filed. Read from GitHub: only a build run with --github fills the times.',
  sourceId: ISSUES_SOURCE,
  params: {
    fields: ['number', 'plan_stub', 'created_at', 'closed_at'],
    filters: [...BOARD_BUGS, READ_FROM_GITHUB],
    orderBy: [{ key: 'created_at', dir: 'asc' }],
    limit: BUG_ROWS_LIMIT,
  },
  formula: { kind: 'none' },
  unit: 'bugs',
  chart: 'line',
  feasibility: 'gh',
};

/** Each bug's times, plan and close reason: the card folds them into the stretch windows. */
export const BUGS_PER_STRETCH: MetricDefinition = {
  id: 'qa.bugs-per-stretch',
  title: 'Bugs per stretch',
  lenses: ['qa'],
  description: 'One row per bug issue: when it was opened and closed, its close reason and the plan of the loop that filed it; the card folds them into each stretch window, from the previous lane M end of local.marks to its own, as filed by loops, by hand, fixed, dropped and net. Read from GitHub: only a build run with --github fills the times.',
  sourceId: ISSUES_SOURCE,
  params: {
    fields: ['number', 'plan_stub', 'state_reason', 'created_at', 'closed_at'],
    filters: [...BOARD_BUGS, READ_FROM_GITHUB],
    orderBy: [{ key: 'created_at', dir: 'asc' }],
    limit: BUG_ROWS_LIMIT,
  },
  formula: { kind: 'none' },
  unit: 'bugs',
  chart: 'table',
  feasibility: 'gh',
};

/** The QA lens's PoC metrics, in the order section G lists them. */
export const QA_POC_METRICS: readonly MetricDefinition[] = [BUGS_BY_KIND, REGRESSIONS, FLAKY_CHECKS, FILED_SHARE];

/** The QA lens's metrics: the PoC cut, then those over the module, board and GitHub sources. */
export const QA_METRICS: readonly MetricDefinition[] = [
  ...QA_POC_METRICS,
  DEFECT_DENSITY,
  BUG_OUTCOME_BY_LOOP_START,
  DROP_RATE,
  DEFECT_AGE,
  RESOLUTION_TIME,
  OPEN_BUGS_PER_DAY,
  BUGS_PER_STRETCH,
];
