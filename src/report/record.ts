/**
 * Recording what a task session reported: the store writes one captured
 * output comes to, once the loop knows what became of its task.
 *
 * {@link recordTaskReport} reads the output with `parseReport` and writes
 * one of two things, never both:
 *
 *   - A report. Its findings go through `writeFindings`, its blockers and
 *     out-of-scope bugs through `writeTriage`, its change notes through
 *     `writeChanges`, and its `status` through `writeTaskReport`, one
 *     `task_reports` row per session. A report whose four lists are all
 *     empty writes no finding, blocker, bug or change row, as each list
 *     writer does with nothing to insert, and still writes its status
 *     row, creating the store when it is absent. Each list writer still
 *     opens a store that exists, for its schema check, so a store past
 *     this rafa's version is refused before any row is written.
 *   - No report, for whatever reason. One telemetry row goes through
 *     `writeReportAbsence`, so a session that reported nothing is still a
 *     row.
 *
 * Every row one output writes carries the same dispatch and the same
 * outcome, so the tables it fills join on `session_id`. The report's own
 * `status` is the session's claim and the outcome is the loop's; the
 * `task_reports` row holds the two side by side, so a claim the loop did
 * not take reads back beside what the loop made of the task.
 *
 * A writer that refuses throws, and nothing here catches it: what a store
 * the loop cannot write means for the run is `start.ts`'s decision.
 * Findings are written first, then triage, then the change notes, then
 * the status row, each writer in its own transaction, so a writer that
 * throws leaves what the writers before it stored. Every table is
 * deduplicated per session, so recording the same output for the same
 * session again adds no row.
 *
 * `writeChanges` takes no outcome, and none is passed to it: a change
 * note is about the diff the session left, which is in the commit
 * whatever the loop made of the task (`effort/store/changes.ts`). The
 * session's own verdict is in the `task_reports` row under the same
 * session id.
 *
 * {@link describeTaskReportRecord} is the operator's view of a record:
 * a summary of what was stored, and one warning for each thing that was
 * not kept as written. It is pure, so what the loop prints is tested
 * beside what it stores.
 */
import type { ReportAbsent, ReportPresent } from './parse.js';
import type { ReportAbsenceWriteResult } from '../effort/store/absences.js';
import type { ChangesWriteResult } from '../effort/store/changes.js';
import type {
  FindingOutcome,
  FindingsDispatch,
  FindingsWriterSeams,
  FindingsWriteResult,
} from '../effort/store/findings.js';
import type { TaskReportWriteResult } from '../effort/store/reports.js';
import type { TriageListResult, TriageWriteResult } from '../effort/store/triage.js';

import { writeReportAbsence } from '../effort/store/absences.js';
import { writeChanges } from '../effort/store/changes.js';
import { writeFindings } from '../effort/store/findings.js';
import { writeTaskReport } from '../effort/store/reports.js';
import { writeTriage } from '../effort/store/triage.js';

import { parseReport } from './parse.js';

/** One captured output, the dispatch it came from, and the loop's outcome. */
export interface TaskReportInput {
  readonly dispatch: FindingsDispatch;
  readonly outcome: FindingOutcome;
  /** Everything the session wrote to stdout. */
  readonly output: string;
}

/** What recording an output that held a report did. */
export interface RecordedReport {
  readonly present: true;
  readonly reading: ReportPresent;
  readonly findings: FindingsWriteResult;
  readonly triage: TriageWriteResult;
  /** What the report's `changes` list wrote, one row per note kept. */
  readonly changes: ChangesWriteResult;
  /** The session's one `task_reports` row, its status beside the outcome. */
  readonly taskReport: TaskReportWriteResult;
}

/** What recording an output that held no report did. */
export interface RecordedAbsence {
  readonly present: false;
  readonly reading: ReportAbsent;
  readonly absence: ReportAbsenceWriteResult;
}

/** What {@link recordTaskReport} answers. */
export type TaskReportRecord = RecordedReport | RecordedAbsence;

/** What the operator is told about one record. */
export interface TaskReportLines {
  /** What was stored, for the log. Empty for an output with no report. */
  readonly notes: readonly string[];
  /** Everything not kept as written, in the order it was found. */
  readonly warnings: readonly string[];
}

/**
 * Reads the report out of one task session's output and stores it under
 * the dispatch and the loop's outcome, or stores why there was none.
 *
 * Throws whatever the writers throw: a dispatch, an outcome or an absence
 * they refuse, or a store they cannot open. See the module note.
 */
export function recordTaskReport(
  repoRoot: string,
  input: TaskReportInput,
  seams: FindingsWriterSeams = {},
): TaskReportRecord {
  const { dispatch, outcome } = input;
  const reading = parseReport(input.output);
  if (!reading.present) {
    const absence = writeReportAbsence(repoRoot, { dispatch, outcome, absence: reading }, seams);
    return { present: false, reading, absence };
  }

  const { report } = reading;
  const findings = writeFindings(
    repoRoot,
    { dispatch, outcome, findings: report.findings },
    seams,
  );
  const triage = writeTriage(
    repoRoot,
    { dispatch, outcome, blockers: report.blockers, outOfScopeBugs: report.outOfScopeBugs },
    seams,
  );
  const changes = writeChanges(repoRoot, { dispatch, changes: report.changes }, seams);
  const taskReport = writeTaskReport(repoRoot, { dispatch, outcome, report }, seams);
  return { present: true, reading, findings, triage, changes, taskReport };
}

/** One writer's counts for one list, whichever writer answered them. */
type ListCounts = Pick<TriageListResult, 'appended' | 'skipped'> & {
  readonly rejected: readonly unknown[];
};

/** One list's counts, as the summary line reads them. */
function tally(list: string, result: ListCounts): string {
  const { appended, skipped, rejected } = result;
  return `${list} ${appended} stored, ${skipped} already held, ${rejected.length} refused`;
}

/**
 * What the operator is told about one record: a summary line, and a
 * warning for each report issue and each entry a writer refused. An
 * output with no report is one warning, naming why and that it was
 * recorded.
 */
export function describeTaskReportRecord(record: TaskReportRecord): TaskReportLines {
  if (!record.present) {
    const recorded = record.absence.appended === 0
      ? 'already recorded for this session'
      : 'recorded as telemetry';
    return { notes: [], warnings: [`No task report: ${record.reading.text}; ${recorded}`] };
  }

  const { reading, findings, triage, changes } = record;
  const summary = [
    `Report: status ${reading.report.status ?? 'not given'}`,
    tally('findings', findings),
    tally('blockers', triage.blockers),
    tally('out-of-scope bugs', triage.outOfScopeBugs),
    tally('changes', changes),
  ].join('; ');

  const warnings = [
    ...reading.issues,
    ...findings.rejected,
    ...triage.blockers.rejected,
    ...triage.outOfScopeBugs.rejected,
    ...changes.rejected,
  ].map(({ text }) => `Report: ${text}`);
  return { notes: [summary], warnings };
}
