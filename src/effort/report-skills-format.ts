/**
 * Renders a {@link SkillsReport} as the lines `rafa effort report --skills`
 * prints in text mode. Pure: `report-skills.ts` decides every figure and
 * every signal, and this module decides only how each one is written. The
 * JSON output is the report itself and does not pass through here.
 *
 * ## The layout
 *
 * 1. {@link SKILLS_REPORT_HEADER}, byte for byte, always the first line.
 * 2. Per plan, after a blank line: a heading naming the stub (`no plan`
 *    for the reports dispatched under none) and its sessions, then the
 *    plan's CI reading, labelled `plan CI` and written once per plan,
 *    never per task or per resolver.
 * 3. Per resolver: a plan run under one gets its tables straight under
 *    the plan, the resolver named on the heading; a plan run under more
 *    than one gets a `resolver <name>` heading per arm, each arm with its
 *    own tables and its own M1 and M2. A null resolver reads
 *    `not recorded`.
 * 4. Within an arm: the skills table, the never-offered listing, the
 *    lessons table, then M1 and M2.
 * 5. {@link PROBE_FOOTNOTE}, after a blank line, on every report.
 *
 * A report holding no plan prints the header, a line saying so, and the
 * footnote.
 *
 * ## The cells
 *
 * The skills table's columns are `skill`, `offered`, `invoked`,
 * `reported`, `recurred` (tasks after whose invocation a failure string
 * recurred), `matched` and `signal`. `invoked` is read from the session
 * logs and `reported` from the task reports, side by side and never
 * merged. `unmeasured` is written `invoked N/M, recurrence not declared`,
 * N the rows that offered and invoked the skill and M the rows that
 * offered it. A null signal, an offered skill only `unknown` rows could
 * have invoked, is written `unknown`.
 *
 * `matched` is each recurrence's whole field value, on one line, each
 * distinct text once, in the order the signals found them, joined by
 * ` / `; a dash when nothing recurred. A lesson whose id the held set no
 * longer resolves has its artifact written `unknown`.
 *
 * M1 and M2 are written as `numerator/denominator` with the percentage at
 * one decimal place, a dash in its place when the denominator is 0. An
 * arm with `unknown` sessions says how many were left out of both.
 *
 * ## The footnote
 *
 * The Probe stage recorded a difference, written up in
 * `context/effort-store.md`: Claude Code's own usage record,
 * `pluginUsage` in `~/.claude/.claude.json`, counts per plugin and never
 * a project skill, so the `invoked` column has no CLI count to agree
 * with. The footnote names that difference on every report, since which
 * skills a reader compares against the CLI cannot be known here.
 */
import type { Recurrence } from './recurrence.js';
import type { SkillsMetric, SkillsReport, SkillsReportArm, SkillsReportPlan } from './report-skills.js';
import type { LessonSignalRow, SkillSignalRow, SkillTally } from './skill-signals.js';
import type { PlanCiRow } from './store/plan-ci.js';

import { alignRows, formatCount, oneLine } from './report-format.js';

/** The first line of the text output, byte for byte. */
export const SKILLS_REPORT_HEADER = 'Co-occurrence, not cause: a skill can be invoked and its failure recur for reasons the skill does not cover.';

/** The footnote every text report ends with. See the module note. */
export const PROBE_FOOTNOTE: readonly string[] = [
  'note: invoked counts are read from each session\'s own log. Claude Code\'s',
  '      own usage record (pluginUsage in ~/.claude/.claude.json) counts per',
  '      plugin and never a project skill, so it has no count to agree with.',
];

/** The label the plan's CI verdict is written under. */
export const PLAN_CI_LABEL = 'plan CI';

/** The skills table's columns, in order. */
export const SKILL_COLUMNS = ['skill', 'offered', 'invoked', 'reported', 'recurred', 'matched', 'signal'] as const;

/** The lessons table's columns, in order. */
export const LESSON_COLUMNS = ['lesson', 'artifact', 'injected', 'recurred', 'matched', 'signal'] as const;

/** Columns written right-aligned. */
const COUNT_COLUMNS: ReadonlySet<string> = new Set(['offered', 'invoked', 'reported', 'recurred', 'injected']);

/** Characters of a head sha the CI line keeps. */
const SHORT_SHA_LENGTH = 7;

/** Decimal places a metric's percentage carries. */
const PERCENT_DECIMALS = 1;

/** Indent of an arm's lines under a multi-resolver plan. */
const ARM_INDENT = '  ';

/** The matched texts of `matches`, one line each, each once, or a dash. */
function matchedCell(matches: readonly Recurrence[]): string {
  const texts = [...new Set(matches.map(({ text }) => oneLine(text)))];
  return texts.length === 0
    ? '-'
    : texts.join(' / ');
}

/** A skill's signal as its cell. See the module note. */
function skillSignalCell(row: SkillSignalRow): string {
  if (row.signal === null) return 'unknown';
  if (row.signal === 'unmeasured') return `invoked ${row.uptake}/${row.offered}, recurrence not declared`;
  return row.signal;
}

/** One offered skill as its cells, in {@link SKILL_COLUMNS} order. */
function skillCells(row: SkillSignalRow): string[] {
  return [
    row.name,
    formatCount(row.offered),
    formatCount(row.invoked),
    formatCount(row.reported),
    formatCount(row.recurred),
    matchedCell(row.matches),
    skillSignalCell(row),
  ];
}

/** One injected lesson as its cells, in {@link LESSON_COLUMNS} order. */
function lessonCells(row: LessonSignalRow): string[] {
  return [
    row.id,
    row.artifact === null
      ? 'unknown'
      : oneLine(row.artifact),
    formatCount(row.injected),
    formatCount(row.recurred),
    matchedCell(row.matches),
    row.signal,
  ];
}

/** The never-offered listing: one line naming each skill, or saying there is none. */
function neverOfferedLine(tallies: readonly SkillTally[]): string {
  if (tallies.length === 0) return 'never offered: none';
  const entries = tallies.map((tally) => `${tally.name} (invoked ${formatCount(tally.invoked)}, recurred ${formatCount(tally.recurred)})`);
  return `never offered: ${entries.join(', ')}`;
}

/** A metric as `n/d, p%`, the percentage a dash when the denominator is 0. */
export function formatMetric(value: SkillsMetric): string {
  const percent = value.percent === null
    ? '-'
    : `${value.percent.toFixed(PERCENT_DECIMALS)}%`;
  return `${formatCount(value.numerator)}/${formatCount(value.denominator)}, ${percent}`;
}

/** The plan CI line: the latest reading's verdict, or that none was read. */
export function formatPlanCi(reading: PlanCiRow | null): string {
  if (reading === null) return `${PLAN_CI_LABEL}: not read`;
  const failing = reading.failing.length === 0
    ? ''
    : `, failing: ${reading.failing.map(oneLine).join(', ')}`;
  const sha = reading.headSha.slice(0, SHORT_SHA_LENGTH);
  return `${PLAN_CI_LABEL}: ${reading.verdict} on #${reading.pr} at ${sha}, read ${reading.readAt}${failing}`;
}

/** A resolver's name as written, `not recorded` for none. */
function resolverName(resolver: SkillsReportArm['resolver']): string {
  return resolver ?? 'not recorded';
}

/** One arm's tables, listing and metrics, unindented. */
export function formatSkillsArm(arm: SkillsReportArm): string[] {
  const skills = arm.skills.length === 0
    ? ['skills: none offered']
    : alignRows(SKILL_COLUMNS, arm.skills.map(skillCells), COUNT_COLUMNS);
  const lessons = arm.lessons.length === 0
    ? ['lessons: none injected']
    : alignRows(LESSON_COLUMNS, arm.lessons.map(lessonCells), COUNT_COLUMNS);
  const unknown = arm.unknownSessions === 0
    ? []
    : [`note: ${formatCount(arm.unknownSessions)} of ${formatCount(arm.sessions)} sessions have unknown invocations, left out of M1 and M2`];
  return [
    ...skills,
    neverOfferedLine(arm.neverOffered),
    '',
    ...lessons,
    '',
    `M1  ${formatMetric(arm.m1)} (task lines invoking a skill)`,
    `M2  ${formatMetric(arm.m2)} (offered skills invoked)`,
    ...unknown,
  ];
}

/** `line` indented by `indent`, an empty line kept empty. */
function indented(indent: string, line: string): string {
  return line === ''
    ? ''
    : `${indent}${line}`;
}

/** One plan: its heading, its plan CI line and each arm. See the module note. */
export function formatSkillsPlan(plan: SkillsReportPlan): string[] {
  const name = plan.planStub === null
    ? 'no plan'
    : `plan ${plan.planStub}`;
  const sessions = `${formatCount(plan.sessions)} sessions`;
  const [only] = plan.resolvers;
  if (plan.resolvers.length === 1 && only !== undefined) {
    return [
      `${name}: ${sessions}, resolver ${resolverName(only.resolver)}`,
      formatPlanCi(plan.planCi),
      '',
      ...formatSkillsArm(only),
    ];
  }
  const arms = plan.resolvers.flatMap((arm) => [
    '',
    `${ARM_INDENT}resolver ${resolverName(arm.resolver)}: ${formatCount(arm.sessions)} sessions`,
    ...formatSkillsArm(arm).map((line) => indented(`${ARM_INDENT}${ARM_INDENT}`, line)),
  ]);
  return [`${name}: ${sessions}, ${plan.resolvers.length} resolvers`, formatPlanCi(plan.planCi), ...arms];
}

/** Everything `rafa effort report --skills` prints in text mode. */
export function formatSkillsReport(report: SkillsReport): string[] {
  const plans = report.plans.length === 0
    ? ['', 'no task sessions recorded for the plans read']
    : report.plans.flatMap((plan) => ['', ...formatSkillsPlan(plan)]);
  return [SKILLS_REPORT_HEADER, ...plans, '', ...PROBE_FOOTNOTE];
}
