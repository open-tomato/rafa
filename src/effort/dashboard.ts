/**
 * `rafa effort dashboard`: every effort reading in one result, one key per
 * widget, so a dashboard fills all of its widgets from a single call.
 *
 * The widgets, in the order text mode prints them:
 *
 * - `status`: the loops running now, their tasks and three estimates of
 *   the time left (`dashboard-status.ts`).
 * - `trend`: the trend segment of `rafa effort report --trend`.
 * - `loops`: its loops segment, drift included (`report-trend.ts`).
 * - `skills`: per plan, the skills report's M1 and M2 summed over its
 *   resolvers, and the whole skills report beside them for the JSON.
 * - `totals`: the session report's totals row, the task reports done and
 *   not done, the preflight halts and the budgeted sessions.
 *
 * Every widget is read by the module that already owns it; this one only
 * composes them, so a figure here always matches the command that shows
 * it alone. The status reads the clock, so the result carries the instant
 * it was taken at in `generatedAt`.
 */
import type { StatusWidget } from './dashboard-status.js';
import type { SkillsMetric, SkillsReport } from './report-skills.js';
import type { TrendInputs } from './report-trend-read.js';
import type { LoopRow, LoopsSegment, TrendOptions, TrendSegment } from './report-trend.js';
import type { EffortReport } from './report.js';

import { readStatusWidget } from './dashboard-status.js';
import { readTrendInputs, trendReportOf } from './report-trend-read.js';
import { buildReport, readSkillsReport } from './report.js';

/** The outcome a finished task reports. */
const DONE_OUTCOME = 'done';

/** One plan's skills, summed over its resolvers. */
export interface SkillsPlanSummary {
  planStub: string | null;
  sessions: number;
  /** Skills offered, counted once per resolver that offered them. */
  skillsOffered: number;
  lessonsInjected: number;
  m1: SkillsMetric;
  m2: SkillsMetric;
}

/** The skills widget. */
export interface SkillsWidget {
  plans: SkillsPlanSummary[];
  report: SkillsReport;
}

/** The totals widget. */
export interface TotalsWidget {
  sessions: number;
  workMinutes: number;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
  taskReports: { done: number; notDone: number };
  preflightHalts: number;
  budgetedSessions: number;
}

/** The whole dashboard. */
export interface Dashboard {
  generatedAt: string;
  status: StatusWidget;
  trend: TrendSegment;
  loops: LoopsSegment;
  skills: SkillsWidget;
  totals: TotalsWidget;
}

/** Where the dashboard reads from. */
export interface DashboardOptions {
  repoRoot: string;
  home: string;
  trend: TrendOptions;
  now: Date;
}

/**
 * Every loop's row, whatever window the loops widget shows, so a live
 * loop's `byTask` never depends on `--days` or `--loops`.
 */
function everyLoopRow(inputs: TrendInputs): readonly LoopRow[] {
  return trendReportOf(inputs, { days: 1, recentDays: 1, loops: Number.MAX_SAFE_INTEGER, by: null }).loops.rows;
}

/** Two metrics added, the percent derived again. */
function addMetric(a: SkillsMetric, b: SkillsMetric): SkillsMetric {
  const numerator = a.numerator + b.numerator;
  const denominator = a.denominator + b.denominator;
  return {
    numerator,
    denominator,
    percent: denominator === 0
      ? null
      : numerator / denominator * 100,
  };
}

/** Each plan of the skills report, its resolvers summed. */
export function summariseSkills(report: SkillsReport): SkillsPlanSummary[] {
  const none: SkillsMetric = { numerator: 0, denominator: 0, percent: null };
  return report.plans.map((plan) => ({
    planStub: plan.planStub,
    sessions: plan.sessions,
    skillsOffered: plan.resolvers.reduce((sum, arm) => sum + arm.skills.length, 0),
    lessonsInjected: plan.resolvers.reduce((sum, arm) => sum + arm.lessons.length, 0),
    m1: plan.resolvers.reduce((sum, arm) => addMetric(sum, arm.m1), none),
    m2: plan.resolvers.reduce((sum, arm) => addMetric(sum, arm.m2), none),
  }));
}

/** The totals widget from the session report. */
export function totalsOf(report: EffortReport): TotalsWidget {
  const { totals } = report;
  const done = report.taskReports
    .filter((tally) => tally.outcome === DONE_OUTCOME)
    .reduce((sum, tally) => sum + tally.reports, 0);
  const stored = report.taskReports.reduce((sum, tally) => sum + tally.reports, 0);
  return {
    sessions: totals.sessions,
    workMinutes: totals.workMinutes,
    tokens: {
      input: totals.inputTokens,
      output: totals.outputTokens,
      cacheRead: totals.cacheReadTokens,
      cacheWrite: totals.cacheWriteTokens,
    },
    taskReports: { done, notDone: stored - done },
    preflightHalts: report.preflightHalts.length,
    budgetedSessions: report.budgets.length,
  };
}

/**
 * Reads every widget. Throws a `ConfigError`, as each report does, when a
 * config file under the repo root or the home is one the loop cannot run on.
 */
export function readDashboard(options: DashboardOptions): Dashboard {
  const { repoRoot, home, now } = options;
  const inputs = readTrendInputs(repoRoot, home);
  const trend = trendReportOf(inputs, options.trend);
  const skills = readSkillsReport({ repoRoot, home });
  return {
    generatedAt: now.toISOString(),
    status: readStatusWidget(repoRoot, { loopRows: everyLoopRow(inputs), now }),
    trend: trend.trend,
    loops: trend.loops,
    skills: { plans: summariseSkills(skills), report: skills },
    totals: totalsOf(buildReport({ repoRoot, home })),
  };
}
