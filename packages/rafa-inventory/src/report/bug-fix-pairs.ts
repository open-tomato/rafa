/**
 * Bug-fix pairs: a bug a loop filed and the later loop that fixed it,
 * joined by the issue id into one lesson with two sources.
 *
 * {@link pairBugFixes} takes the store's rows ({@link BugFixRows}), the
 * stages of the plan files on this machine ({@link PlanStageLink}) and
 * the time, and answers `{ pairs, unpaired }`: one {@link BugFixPair} per
 * fixing loop found, and one {@link UnpairedBug} for each bug that found
 * none, with its reason. The shapes are declared here, so a reader of the
 * store maps its rows onto them and the join imports nothing from it.
 *
 * The join is pure. It opens no file, reads no clock (`now` is passed
 * in), uses no randomness and changes no value passed in. Every match is
 * exact; nothing is ranked or scored.
 *
 * ## The bug
 *
 * A bug finding ({@link BugFindingRow}) is a `findings` row with a
 * `tracker_ref` and no `resolution`. The tracker-ref writer inserts it
 * holding the dispatch, the key and the reference only, so its own words
 * are not on it. They are the `what` of the {@link OutOfScopeBugRow} of
 * the same session whose `artifact`, its whitespace runs collapsed, the
 * key ends with, the key collapsed the same way. When several rows match,
 * the one with the longest artifact is taken, the one that leaves least
 * of the key unmatched; rows of equal length keep their order. With no
 * such row the key itself stands for the bug: it is both its words and
 * its artifact. With one, the bug's artifact is that row's, as written.
 *
 * ## The link
 *
 * Only a `github` reference is joined, since a `rafa-<n>` stub and a
 * `#<n>` name a GitHub issue. Any other kind, `local` the one in use,
 * stays unpaired as `local-ref`, and so does a `github` one whose
 * `externalId` is no issue number. For the issue `<n>`:
 *
 *   1. every plan whose stub is `rafa-<n>`, alone or followed by `-`, is
 *      linked whole: its tasks across every stage are one unit; else
 *   2. every stage whose `rafa:stage-context` names `#<n>` as a whole
 *      token (no word character or `#` before it, no word character
 *      after) is linked, each stage its own unit.
 *
 * With neither, the bug is `no-plan-file` when a `done` report in the
 * store comes from a plan that has no link here and that the store alone
 * shows would have linked it: its stub is `rafa-<n>`, or its task line
 * names `#<n>`. A plan file's stage context is the one thing the store
 * does not hold. Otherwise it is `no-link`.
 *
 * ## The fixing task
 *
 * Inside a unit the fixing task is, the first rule that names exactly
 * one task deciding:
 *
 *   1. the one task whose own line names `#<n>`;
 *   2. the unit's only task;
 *   3. the one task holding a resolved finding ({@link ResolvedFindingRow},
 *      matched by plan stub and task line) whose artifact equals the
 *      bug's, both with whitespace runs collapsed.
 *
 * A unit no rule decides is `ambiguous-stage`. The fixing task's loop is
 * its earliest `done` report ({@link DoneReportRow}, matched by plan stub
 * and task line) recorded after the filing, the bug row's `collected_at`.
 * The filing session's own report is never its fix. With no report the
 * unit is `no-done-report`; with reports recorded at or before the filing
 * only, it is `fixed-before-filed`.
 *
 * Each unit that finds its loop gives one pair, so two plans or two
 * stages that fixed one issue give two pairs, which `merge` settles as
 * any two actions on one trigger. A bug with no pair is listed once, with
 * the reason of its first unit in link order.
 *
 * ## The lesson
 *
 * The action is the resolution of the fixing task's resolved finding
 * whose artifact equals the bug's, the fixing session's first, else any
 * of the task's; else the task's own line with its declaration block
 * stripped. The lesson is a `DescribedInstinctRecord`, as `./lessons.ts`
 * builds one, with:
 *
 *   - `trigger` and `cause` the bug's words, `artifact` the bug's;
 *   - `action` the fix and `action_hash` its {@link actionHash}, `id` by
 *     {@link lessonId};
 *   - `kind: gotcha`, `signal: loud`, `domain`
 *     {@link DEFAULT_LESSON_DOMAIN}, `scope: project`, `source:
 *     task-report` and `projectId` null;
 *   - `confidence` {@link LESSON_CONFIDENCE}, `usage_count` 2, `sources`
 *     the filing session then the fixing session, `status: active`, and
 *     `created_at` and `updated_at` both `now`;
 *   - `evidence` the {@link lessonEvidence} entry of each session, the
 *     filing one first.
 */
import type { DescribedInstinctRecord } from '../adapters/learning/local.js';

import { stripTaskDeclaration } from '@open-tomato/rafa/core/plan';

import { actionHash } from '../learning/index.js';

import { DEFAULT_LESSON_DOMAIN, LESSON_CONFIDENCE, lessonEvidence, lessonId } from './lessons.js';

/** The tracker reference a bug finding holds, as much of it as the join reads. */
export interface BugTrackerRef {
  /** The tracker: `github`, `local`, or another adapter's name. */
  readonly kind: string;
  /** The GitHub issue number as a string, for a `github` reference. */
  readonly externalId: string;
  readonly url: string | null;
}

/** A `findings` row with a `tracker_ref` and no `resolution`. */
export interface BugFindingRow {
  /** The row's `id`. */
  readonly id: string;
  /** The filing session. */
  readonly sessionId: string;
  readonly planStub: string | null;
  readonly taskLine: string;
  /** The key the reference is kept under: `PLAN_TRACKER-<stub>.md: <artifact>`, or older shapes. */
  readonly artifact: string;
  readonly trackerRef: BugTrackerRef;
  readonly outcome: string;
  /** When the row was written, an ISO 8601 instant: the filing. */
  readonly collectedAt: string;
}

/** An `out_of_scope_bugs` row: a bug as its session reported it. */
export interface OutOfScopeBugRow {
  readonly sessionId: string;
  readonly what: string;
  readonly artifact: string | null;
}

/** A `findings` row with a `resolution`. */
export interface ResolvedFindingRow {
  readonly sessionId: string;
  readonly planStub: string | null;
  readonly taskLine: string;
  readonly artifact: string | null;
  readonly resolution: string;
}

/** A `task_reports` row whose `status` is `done`. */
export interface DoneReportRow {
  readonly sessionId: string;
  readonly planStub: string | null;
  readonly taskLine: string;
  readonly outcome: string;
  /** When the report was recorded, an ISO 8601 instant. */
  readonly collectedAt: string;
}

/** The store's rows the join reads. */
export interface BugFixRows {
  readonly bugs: readonly BugFindingRow[];
  readonly outOfScope: readonly OutOfScopeBugRow[];
  readonly resolved: readonly ResolvedFindingRow[];
  readonly reports: readonly DoneReportRow[];
}

/** One stage of a plan file on this machine. */
export interface PlanStageLink {
  /** The plan's stub. */
  readonly stub: string;
  /** The stage's name, its heading after `# Stage: `. */
  readonly stage: string;
  /** The body of its `rafa:stage-context` block, or null without one. */
  readonly context: string | null;
  /**
   * Its task lines as the dispatch quotes them, the store's `task_line`:
   * the text after the checkbox, declaration included.
   */
  readonly tasks: readonly string[];
}

/** Which link joined a pair. */
export type BugFixLink = 'stub' | 'stage-context';

/** Why a bug found no fixing loop. See the module note. */
export type UnpairedReason =
  | 'local-ref'
  | 'no-link'
  | 'no-plan-file'
  | 'ambiguous-stage'
  | 'no-done-report'
  | 'fixed-before-filed';

/** A bug and the loop that fixed it, as one lesson. */
export interface BugFixPair {
  readonly bug: BugFindingRow;
  /** The issue number. */
  readonly issue: string;
  readonly link: BugFixLink;
  /** The fixing plan's stub. */
  readonly plan: string;
  /** The linked stage's name; for a `stub` link, the fixing task's stage. */
  readonly stage: string;
  /** The fixing task's `done` report. */
  readonly fix: DoneReportRow;
  readonly lesson: DescribedInstinctRecord;
}

/** A bug no fixing loop was found for, and why. */
export interface UnpairedBug {
  readonly bug: BugFindingRow;
  /** The reference's `externalId`. */
  readonly issue: string;
  readonly reason: UnpairedReason;
}

/** What {@link pairBugFixes} answers. */
export interface BugFixPairs {
  readonly pairs: readonly BugFixPair[];
  readonly unpaired: readonly UnpairedBug[];
}

/** The only tracker kind a `rafa-<n>` stub or a `#<n>` names. */
const JOINED_KIND = 'github';

/** An issue number. */
const ISSUE_NUMBER = /^\d+$/;

/** A bug's words and artifact, read from its session's out-of-scope rows. */
interface BugText {
  readonly words: string;
  readonly artifact: string;
}

/** A linked unit: one plan for a `stub` link, one stage for a `stage-context` one. */
interface LinkedUnit {
  readonly link: BugFixLink;
  readonly stub: string;
  /** Each task with the stage it sits in. */
  readonly tasks: readonly { readonly line: string; readonly stage: string }[];
}

/** One unit's answer: a pair, or why it gave none. */
type UnitAnswer = BugFixPair | UnpairedReason;

/** `text` with every whitespace run one space, trimmed. */
function collapsed(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Two artifacts equal byte for byte once their whitespace runs are collapsed. */
function sameArtifact(left: string | null, right: string): boolean {
  return left !== null && collapsed(left) === collapsed(right);
}

/** True when `text` names `#<issue>` as a whole token. */
function namesIssue(text: string, issue: string): boolean {
  return new RegExp(`(?<![\\w#])#${issue}(?!\\w)`).test(text);
}

/** True when `stub` is the plan stub of issue `<issue>`: `rafa-<n>`, alone or followed by `-`. */
function isIssueStub(stub: string | null, issue: string): boolean {
  return stub === `rafa-${issue}` || (stub?.startsWith(`rafa-${issue}-`) ?? false);
}

/** The bug's words and artifact. See the module note. */
function bugText(bug: BugFindingRow, outOfScope: readonly OutOfScopeBugRow[]): BugText {
  const key = collapsed(bug.artifact);
  let best: OutOfScopeBugRow | null = null;
  for (const row of outOfScope) {
    if (row.sessionId !== bug.sessionId || row.artifact === null) continue;
    const tail = collapsed(row.artifact);
    if (tail === '' || !key.endsWith(tail)) continue;
    if (best === null || tail.length > collapsed(best.artifact ?? '').length) best = row;
  }
  return best === null || best.artifact === null
    ? { words: bug.artifact, artifact: bug.artifact }
    : { words: best.what, artifact: best.artifact };
}

/** The units the issue links: its `rafa-<n>` plans, else the stages naming `#<n>`. */
function linkedUnits(issue: string, links: readonly PlanStageLink[]): LinkedUnit[] {
  const byStub = new Map<string, { line: string; stage: string }[]>();
  for (const link of links) {
    if (!isIssueStub(link.stub, issue)) continue;
    const tasks = byStub.get(link.stub) ?? [];
    byStub.set(link.stub, [...tasks, ...link.tasks.map((line) => ({ line, stage: link.stage }))]);
  }
  if (byStub.size > 0) {
    return [...byStub].map(([stub, tasks]) => ({ link: 'stub', stub, tasks }));
  }
  return links
    .filter((link) => link.context !== null && namesIssue(link.context, issue))
    .map((link) => ({
      link: 'stage-context',
      stub: link.stub,
      tasks: link.tasks.map((line) => ({ line, stage: link.stage })),
    }));
}

/** Why a bug with no linked unit is unpaired. See the module note. */
function unlinkedReason(issue: string, links: readonly PlanStageLink[], rows: BugFixRows): UnpairedReason {
  const filed = new Set(links.map((link) => link.stub));
  const fileless = rows.reports.some((report) => report.planStub !== null
    && !filed.has(report.planStub)
    && (isIssueStub(report.planStub, issue) || namesIssue(report.taskLine, issue)));
  return fileless
    ? 'no-plan-file'
    : 'no-link';
}

/** The resolved findings of one task whose artifact is the bug's. */
function matchingResolutions(
  rows: BugFixRows,
  stub: string,
  line: string,
  artifact: string,
): ResolvedFindingRow[] {
  return rows.resolved.filter((row) => row.planStub === stub
    && row.taskLine === line
    && sameArtifact(row.artifact, artifact));
}

/** The unit's fixing task, or null when no rule names exactly one. */
function fixingTask(
  unit: LinkedUnit,
  issue: string,
  artifact: string,
  rows: BugFixRows,
): LinkedUnit['tasks'][number] | null {
  const naming = unit.tasks.filter((task) => namesIssue(task.line, issue));
  if (naming.length === 1) return naming[0] ?? null;
  if (unit.tasks.length === 1) return unit.tasks[0] ?? null;
  const holding = unit.tasks
    .filter((task) => matchingResolutions(rows, unit.stub, task.line, artifact).length > 0);
  return holding.length === 1
    ? holding[0] ?? null
    : null;
}

/** The earliest `done` report of the task after the filing, or why there is none. */
function fixingReport(
  bug: BugFindingRow,
  stub: string,
  line: string,
  reports: readonly DoneReportRow[],
): DoneReportRow | UnpairedReason {
  const filedAt = Date.parse(bug.collectedAt);
  const own = reports.filter((report) => report.planStub === stub
    && report.taskLine === line
    && report.sessionId !== bug.sessionId);
  if (own.length === 0) return 'no-done-report';
  const after = own
    .filter((report) => Date.parse(report.collectedAt) > filedAt)
    .sort((left, right) => Date.parse(left.collectedAt) - Date.parse(right.collectedAt));
  return after[0] ?? 'fixed-before-filed';
}

/** The fix: the matching resolution, the fixing session's first, else the task line. */
function fixAction(rows: BugFixRows, fix: DoneReportRow, line: string, artifact: string): string {
  const resolutions = matchingResolutions(rows, fix.planStub ?? '', line, artifact);
  const chosen = resolutions.find((row) => row.sessionId === fix.sessionId) ?? resolutions[0];
  return chosen?.resolution ?? stripTaskDeclaration(line);
}

/** The lesson of a pair. See the module note. */
function pairLesson(
  bug: BugFindingRow,
  text: BugText,
  fix: DoneReportRow,
  action: string,
  at: string,
): DescribedInstinctRecord {
  return {
    id: lessonId(text.words, action),
    trigger: text.words,
    action,
    action_hash: actionHash(action),
    confidence: LESSON_CONFIDENCE,
    usage_count: 2,
    sources: [bug.sessionId, fix.sessionId],
    artifact: text.artifact,
    signal: 'loud',
    status: 'active',
    created_at: at,
    updated_at: at,
    description: {
      kind: 'gotcha',
      domain: DEFAULT_LESSON_DOMAIN,
      scope: 'project',
      source: 'task-report',
      evidence: [lessonEvidence(bug), lessonEvidence(fix)],
      cause: text.words,
      projectId: null,
    },
  };
}

/** One unit's pair, or why it gives none. */
function pairUnit(
  bug: BugFindingRow,
  issue: string,
  text: BugText,
  unit: LinkedUnit,
  rows: BugFixRows,
  at: string,
): UnitAnswer {
  const task = fixingTask(unit, issue, text.artifact, rows);
  if (task === null) return 'ambiguous-stage';
  const fix = fixingReport(bug, unit.stub, task.line, rows.reports);
  if (typeof fix === 'string') return fix;
  const action = fixAction(rows, fix, task.line, text.artifact);
  return {
    bug,
    issue,
    link: unit.link,
    plan: unit.stub,
    stage: task.stage,
    fix,
    lesson: pairLesson(bug, text, fix, action, at),
  };
}

/** Every pair of one bug, or the one reason it has none. */
function pairBug(
  bug: BugFindingRow,
  rows: BugFixRows,
  links: readonly PlanStageLink[],
  at: string,
): readonly BugFixPair[] | UnpairedReason {
  const issue = bug.trackerRef.externalId;
  if (bug.trackerRef.kind !== JOINED_KIND || !ISSUE_NUMBER.test(issue)) return 'local-ref';
  const units = linkedUnits(issue, links);
  if (units.length === 0) return unlinkedReason(issue, links, rows);

  const text = bugText(bug, rows.outOfScope);
  const answers = units.map((unit) => pairUnit(bug, issue, text, unit, rows, at));
  const pairs = answers.filter((answer) => typeof answer !== 'string');
  if (pairs.length > 0) return pairs;
  return answers.find((answer) => typeof answer === 'string') ?? 'no-link';
}

/**
 * The bug-fix pairs of `rows` over the plan stages in `links`. See the
 * module note.
 *
 * @param rows - the store's bug findings, out-of-scope bugs, resolved
 *   findings and `done` reports.
 * @param links - one entry per stage of each plan file on this machine.
 * @param now - the time each lesson is created at.
 * @returns new lists: a pair per fixing loop found, in bug order then
 *   link order, and each bug with none, in bug order, with its reason.
 */
export function pairBugFixes(
  rows: BugFixRows,
  links: readonly PlanStageLink[],
  now: Date,
): BugFixPairs {
  const at = now.toISOString();
  const pairs: BugFixPair[] = [];
  const unpaired: UnpairedBug[] = [];
  for (const bug of rows.bugs) {
    const answer = pairBug(bug, rows, links, at);
    if (typeof answer === 'string') {
      unpaired.push({ bug, issue: bug.trackerRef.externalId, reason: answer });
    } else {
      pairs.push(...answer);
    }
  }
  return { pairs, unpaired };
}
