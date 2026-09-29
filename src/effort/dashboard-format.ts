/**
 * Renders the dashboard as the lines `rafa effort dashboard` prints in
 * text mode: one block per widget, each opened by an upper-case heading,
 * in the order `dashboard.ts` lists them. The trend and loops blocks are
 * `report-trend-format.ts`'s own, so they read as `--trend` prints them.
 *
 * Pure over a {@link Dashboard}. Durations are written as `rafa loop
 * status` writes them (`12m`, `1h 5m`), token counts compact, and
 * instants as UTC minutes.
 */
import type { Estimate, StatusLoop, StatusWidget } from './dashboard-status.js';
import type { Dashboard, SkillsPlanSummary, TotalsWidget } from './dashboard.js';
import type { SkillsMetric } from './report-skills.js';

import { formatDuration } from '../commands/loop/loop-sessions.js';
import { formatCounts } from '../commands/plan/plan-files.js';

import { alignRows } from './report-format.js';
import { formatLoopsSegment, formatTokens, formatTrendSegment } from './report-trend-format.js';

/** Minutes in one hour. */
const MINUTES_PER_HOUR = 60;

/** A duration in seconds, or a dash for none. */
function duration(seconds: number | null | undefined): string {
  return seconds === null || seconds === undefined
    ? '-'
    : formatDuration(seconds);
}

/** An estimate as `left (per task)`, or a dash for none. */
function estimateCell(estimate: Estimate | null): string {
  return estimate === null
    ? '-'
    : `${duration(estimate.seconds)} (${duration(estimate.secondsPerTask)}/task)`;
}

/** One live loop's row. */
function statusCells(loop: StatusLoop): string[] {
  return [
    loop.planStub ?? loop.branch,
    loop.state,
    loop.tasks === null
      ? '-'
      : `${loop.tasks.done}/${loop.tasks.total}`,
    estimateCell(loop.byTask),
    estimateCell(loop.byProgress),
    loop.bySession === null || loop.bySession.seconds === null || loop.bySession.secondsPerTask === null
      ? '-'
      : `${duration(loop.bySession.seconds)} (${duration(loop.bySession.secondsPerTask)}/task)`,
    loop.task === null
      ? '-'
      : `line ${loop.task.line}`,
  ];
}

/** The status block. */
export function formatStatus(status: StatusWidget): string[] {
  const head = `STATUS  ${status.running} running, ${status.paused} paused`;
  if (status.loops.length === 0) return [head, '  no loop is running'];

  const columns = ['loop', 'state', 'done', 'left by task', 'left by progress', 'left this session', 'task now'];
  return [
    head,
    `  tasks  ${formatCounts(status.tasks)}`,
    `  left   longest by task ${duration(status.longest.byTask)},`
    + ` by progress ${duration(status.longest.byProgress)}, this session ${duration(status.longest.bySession)}`,
    '',
    ...alignRows(columns, status.loops.map(statusCells), new Set(columns.slice(2, 6))),
    '',
    '  by task: mean task session; by progress: since the plan\'s first start per task done;'
    + ' this session: `rafa loop status`',
  ];
}

/** A metric as `3/10 30%`, or a dash with no denominator. */
function metricCell(metric: SkillsMetric): string {
  return metric.percent === null
    ? '-'
    : `${metric.numerator}/${metric.denominator} ${Math.round(metric.percent)}%`;
}

/** One plan's skills row. */
function skillsCells(plan: SkillsPlanSummary): string[] {
  return [
    plan.planStub ?? '(no plan)',
    String(plan.sessions),
    String(plan.skillsOffered),
    String(plan.lessonsInjected),
    metricCell(plan.m1),
    metricCell(plan.m2),
  ];
}

/** The skills block, over the plans the loops block lists, in its order: newest first. */
export function formatSkills(dashboard: Dashboard): string[] {
  const plans = dashboard.loops.rows
    .map((row) => dashboard.skills.plans.find((plan) => plan.planStub === row.key))
    .filter((plan): plan is SkillsPlanSummary => plan !== undefined);
  const head = ['', 'SKILLS', '  plans in the loops block, newest first; M1 task lines invoking a skill, M2 offered skills invoked'];
  if (plans.length === 0) return [...head, '  no skills reading for these plans'];

  const columns = ['plan', 'sessions', 'offered', 'lessons', 'M1', 'M2'];
  return [...head, '', ...alignRows(columns, plans.map(skillsCells), new Set(columns.slice(1)))];
}

/** The totals block. */
export function formatTotals(totals: TotalsWidget): string[] {
  const columns = ['sessions', 'work-h', 'input', 'output', 'cache-read', 'cache-write', 'done', 'not done', 'halts', 'budgeted'];
  return [
    '',
    'TOTALS',
    '  every stored session; done and not done count task reports, halts count preflight halts',
    '',
    ...alignRows(columns, [[
      String(totals.sessions),
      (totals.workMinutes / MINUTES_PER_HOUR).toFixed(1),
      formatTokens(totals.tokens.input),
      formatTokens(totals.tokens.output),
      formatTokens(totals.tokens.cacheRead),
      formatTokens(totals.tokens.cacheWrite),
      String(totals.taskReports.done),
      String(totals.taskReports.notDone),
      String(totals.preflightHalts),
      String(totals.budgetedSessions),
    ]], new Set(columns)),
  ];
}

/** Every line of the dashboard. */
export function formatDashboard(dashboard: Dashboard): string[] {
  const stamp = `${dashboard.generatedAt.slice(0, 10)} ${dashboard.generatedAt.slice(11, 16)}`;
  return [
    `effort dashboard: ${stamp} UTC`,
    '',
    ...formatStatus(dashboard.status),
    '',
    ...formatTrendSegment(dashboard.trend),
    ...formatLoopsSegment(dashboard.loops),
    ...formatSkills(dashboard),
    ...formatTotals(dashboard.totals),
  ];
}
