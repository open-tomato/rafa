/**
 * Recording what a task session reported: the store writes one captured
 * output comes to, once the loop knows what became of its task.
 *
 * {@link recordTaskReport} reads the output with `parseReport` and writes
 * one of two things, never both:
 *
 *   - A report. Its findings go through `writeFindings`, then its
 *     blockers and out-of-scope bugs through `writeTriage`. A report whose
 *     three lists are all empty writes no row and opens no store, as each
 *     writer does with nothing to insert.
 *   - No report, for whatever reason. One telemetry row goes through
 *     `writeReportAbsence`, so a session that reported nothing is still a
 *     row.
 *
 * Every row one output writes carries the same dispatch and the same
 * outcome, so the tables it fills join on `session_id`. The report's own
 * `status` is the session's claim and is not stored; the loop's outcome
 * is.
 *
 * A writer that refuses throws, and nothing here catches it: what a store
 * the loop cannot write means for the run is `start.ts`'s decision.
 * Findings are written before triage, each writer in its own transaction,
 * so a triage write that throws leaves the findings stored. Every table is
 * deduplicated per session, so recording the same output for the same
 * session again adds no row.
 *
 * {@link describeTaskReportRecord} is the operator's view of a record:
 * a summary of what was stored, and one warning for each thing that was
 * not kept as written. It is pure, so what the loop prints is tested
 * beside what it stores.
 */
import type { ReportAbsent, ReportPresent } from './parse.js';
import type { ReportAbsenceWriteResult } from '../effort/store/absences.js';
import type {
  FindingOutcome,
  FindingsDispatch,
  FindingsWriterSeams,
  FindingsWriteResult,
} from '../effort/store/findings.js';
import type { TriageListResult, TriageWriteResult } from '../effort/store/triage.js';

import { writeReportAbsence } from '../effort/store/absences.js';
import { writeFindings } from '../effort/store/findings.js';
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
  return { present: true, reading, findings, triage };
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

  const { reading, findings, triage } = record;
  const summary = [
    `Report: status ${reading.report.status ?? 'not given'}`,
    tally('findings', findings),
    tally('blockers', triage.blockers),
    tally('out-of-scope bugs', triage.outOfScopeBugs),
  ].join('; ');

  const warnings = [
    ...reading.issues,
    ...findings.rejected,
    ...triage.blockers.rejected,
    ...triage.outOfScopeBugs.rejected,
  ].map(({ text }) => `Report: ${text}`);
  return { notes: [summary], warnings };
}
