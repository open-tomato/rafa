/**
 * `CATALOGUE_ENTRIES`: the 35 metrics of spec section B4, four lenses'
 * worth, each with its feasibility, what it is read from (or its nearest
 * proxy), its chart and the catalogue metrics that draw it today.
 *
 * Feasibility has four values (`Feasibility` in the contract): `direct`,
 * measured as named; `proxy`, a nearest measure the card labels with a
 * `ProxyNote`; `gh`, which needs the GitHub source; and `collect`, which
 * needs a collector rafa does not have, so its card shows an empty state.
 *
 * `metricIds` names the definitions of `METRIC_CATALOGUE` that draw an
 * entry, and is empty for an entry that waits on a later source. A
 * served metric can be a nearer reading than its entry's: entry 24, the
 * change failure rate, is drawn by `dev.red-ci-share`, the red share of
 * CI readings, and entry 28, defect leakage, by `qa.filed-share`, the
 * share of routed bugs per route, and entry 7, scope creep, by
 * `pm.out-of-scope-per-week`, every out-of-scope entry per week (spec
 * C1), with no ratio over planned tasks. Entry 8 reads a blocker as
 * active by its task's outcome, `blocked`: the store keeps no open or
 * closed state of a blocker.
 *
 * Entries 1 and 25 are offline (D17): milestone completion and WIP read
 * only states and labels, which the board cache holds. The four `gh`
 * entries with a metric (22, 29 and 33, and 20's lead time, which waits)
 * are drawn by a metric that answers rows only after a `--github` build.
 * The bug backlog metrics, the task pile and the work done ({@link UNNUMBERED_METRIC_IDS})
 * came after the B4 table and have no row in it.
 */
import type { Feasibility, Lens } from '@open-tomato/atlas-data/contract';

/** One metric of the section B4 table. */
export interface CatalogueEntry {
  /** The row number of the B4 table, 1 to 35. */
  readonly number: number;
  readonly lens: Lens;
  readonly name: string;
  readonly feasibility: Feasibility;
  /** The source and formula, or the nearest proxy. */
  readonly basis: string;
  /** The chart the entry is drawn as. */
  readonly chart: string;
  /** The catalogue metrics that draw this entry; none while it waits on a source. */
  readonly metricIds: readonly string[];
}

function entry(
  number: number,
  lens: Lens,
  name: string,
  feasibility: Feasibility,
  basis: string,
  chart: string,
  metricIds: readonly string[] = [],
): CatalogueEntry {
  return { number, lens, name, feasibility, basis, chart, metricIds };
}

/** The 35 metrics of section B4, in its order. */
export const CATALOGUE_ENTRIES: readonly CatalogueEntry[] = [
  entry(1, 'pm', 'Milestone completion', 'direct', 'epics closed completed / epics in Now or Done (issue_facts, offline, D17)', 'bullet', ['pm.milestone-completion']),
  entry(2, 'pm', 'Schedule variance', 'proxy', 'plan burn-up: cumulative tasks done vs tasks_planned (plan_facts, task_facts)', 'burn-up line'),
  entry(3, 'pm', 'Sprint predictability', 'proxy', 'plans completed per week / plans started per week', 'grouped bar', ['pm.plan-completion', 'dev.plans-completed-per-week']),
  entry(4, 'pm', 'On-time delivery', 'collect', 'needs a due date on plans; no proxy', 'KPI empty'),
  entry(5, 'pm', 'Budget burn', 'direct', 'tokens_total cumulative vs budget.tokensPerWeek (daily_rollup)', 'KPI + goal, line + baseline', ['pm.budget-burn', 'pm.tokens-per-day']),
  entry(6, 'pm', 'Actual vs planned', 'direct', 'tasks_planned vs task_sessions per plan', 'grouped bar', ['pm.planned-vs-sessions']),
  entry(7, 'pm', 'Scope creep', 'proxy', 'bug_routes follow-up + filed per tasks_planned', 'stacked column', ['pm.out-of-scope-per-week']),
  entry(8, 'pm', 'Active blockers and risks', 'direct', 'finding_facts source=blocker, outcome blocked; issue_facts stage Blocked', 'row list, risk heatmap', ['pm.active-blockers']),
  entry(9, 'pm', 'Defect / rework rate', 'direct', 'repeat_sessions + ci_repair_sessions / task_sessions', 'KPI + trend'),
  entry(10, 'pm', 'Resource utilization', 'proxy', 'task session minutes per agent; no wall-clock capacity is recorded', 'horizontal bar', ['pm.minutes-per-agent']),
  entry(11, 'architect', 'Tech debt ratio', 'proxy', 'minutes of fix and chore work (D4, from change level) / all task minutes', 'KPI grade', ['arch.debt-ratio']),
  entry(12, 'architect', 'Duplication', 'collect', 'needs a duplication scan; no proxy', 'KPI empty'),
  entry(13, 'architect', 'Architecture violations', 'proxy', 'module_facts.upward_edges from docs/survey/cut-table.json, when present', 'dependency matrix', ['arch.violations']),
  entry(14, 'architect', 'Latency p50/p99', 'proxy', 'task minutes p50/p90 per week as loop latency', 'dual line', ['arch.task-minutes-p50-p90']),
  entry(15, 'architect', 'Resource utilization trend', 'direct', 'tokens by model per day', 'stacked area', ['arch.tokens-by-model']),
  entry(16, 'architect', 'Uptime / SLA', 'proxy', 'preflight halts per day', 'calendar heatmap', ['arch.preflight-halts']),
  entry(17, 'architect', 'Cyclomatic complexity', 'proxy', 'LOC per module', 'treemap', ['arch.loc-per-module']),
  entry(18, 'architect', 'Coupling / cohesion', 'proxy', 'fan_in, fan_out from the import scan', 'dependency matrix', ['arch.coupling']),
  entry(19, 'developer', 'Sprint velocity', 'proxy', 'tasks done per week, stacked by work type (D4)', 'stacked bar', ['dev.tasks-done-per-week']),
  entry(20, 'developer', 'Cycle / lead time', 'direct', 'task minutes (cycle); plan first_at to merged_at (lead, gh)', 'scatter + moving average, histogram', ['dev.task-cycle']),
  entry(21, 'developer', 'Deployment frequency', 'direct', 'release tags per week (commit_facts.release_tag)', 'sparkline', ['dev.deploys-per-week']),
  entry(22, 'developer', 'PR cycle time', 'gh', 'created_at to merged_at; buckets <4h, 4–24h, 1–3d, >3d', 'histogram', ['dev.pr-cycle-time']),
  entry(23, 'developer', 'Review turnaround', 'gh', 'created_at to first_review_at; sparse in a solo repo', 'leaderboard'),
  entry(24, 'developer', 'Change failure rate', 'direct', 'plans with any red CI reading / plans with a reading', 'KPI + threshold', ['dev.red-ci-share']),
  entry(25, 'developer', 'WIP', 'direct', 'open issues in Claimed or In development by stage, never by label (D16), vs wipLimit', 'horizontal gauge', ['dev.wip']),
  entry(26, 'developer', 'Active blockers', 'direct', 'as entry 8, by plan', 'row list', ['pm.active-blockers']),
  entry(27, 'qa', 'Defect density', 'proxy', 'bugs per module / module LOC (per 1k)', 'horizontal bar', ['qa.defect-density']),
  entry(28, 'qa', 'Defect leakage', 'proxy', 'bug-labelled issues with no loop match / all bugs', '100% stacked bar', ['qa.filed-share']),
  entry(29, 'qa', 'Defect resolution time', 'gh', 'linked issue created_at to closed_at, by priority', 'box plot', ['qa.resolution-time']),
  entry(30, 'qa', 'Test coverage', 'collect', 'needs bun test --coverage lcov collection', 'radial gauge empty'),
  entry(31, 'qa', 'Test pass/fail trend', 'proxy', 'CI verdicts per week, green vs red', 'stacked column'),
  entry(32, 'qa', 'Flaky tests', 'direct', 'ci_facts.flipped, failing names top 10', 'top-10 table', ['qa.flaky-checks']),
  entry(33, 'qa', 'Defect age', 'gh', 'open bug issues in buckets 0–7d, 8–30d, 30d+', 'ageing bar', ['qa.defect-age']),
  entry(34, 'qa', 'Regression defects', 'direct', 'bug_facts kind own-fallout per week', 'line', ['qa.regressions']),
  entry(35, 'qa', 'Bugs by kind', 'direct', 'bug_facts by kind and route', 'stacked bar', ['qa.bugs-by-kind']),
];

/**
 * The served metrics no B4 row names: the task pile (spec C3), the open
 * typed issues by type and open time, which needs the GitHub times; the
 * work done (spec C4), the changelog entries per level and raw area; then
 * the bug backlog metrics, added from the burndown session after the
 * table was written. Outcome by loop start and the drop rate are offline;
 * open bugs per day and bugs per stretch need the GitHub times.
 */
export const UNNUMBERED_METRIC_IDS: readonly string[] = [
  'pm.task-pile',
  'dev.work-done',
  'qa.bug-outcome-by-loop-start',
  'qa.drop-rate',
  'qa.open-bugs-per-day',
  'qa.bugs-per-stretch',
];
