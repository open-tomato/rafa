/**
 * The shapes and the text of `rafa bug recheck` (#953): one
 * {@link RecheckRow} per bug, the {@link RecheckReport} json mode gives as
 * the terminal result's data, the text {@link renderRecheck} prints, and
 * the comment {@link recheckComment} writes on a `gone` or `flaky` bug.
 *
 * A `gone` row whose bug body holds a `## Trigger removed` section
 * (`triggerRemovedOf`, `../../bugs/recheck-verdict.ts`) carries
 * `triggerRemoved: true`, which json mode gives as written. Its verdict
 * stays `gone`; the text prints it `gone (trigger removed?)`, and its
 * comment says the rerun passes because the trigger was removed, not
 * that the bug is fixed (#1521).
 * Pure: nothing here spawns, reads a file or redacts; the caller passes
 * the comment through the record's redaction before it posts it.
 */
import type { RecheckVerdict } from '../../bugs/recheck-verdict.js';
import type { RunnableReference } from '../../bugs/test-reference.js';
import type { IssueTrackerData } from '@open-tomato/rafa-board';

/** What a `gone` row whose trigger was removed prints after its verdict. */
export const TRIGGER_REMOVED_MARK = '(trigger removed?)';

/** The indent of the reproduce text under a `manual` row. */
const REPRODUCE_INDENT = '    ';

/** One bug's result. */
export interface RecheckRow {
  readonly issue: number;
  readonly title: string;
  readonly verdict: RecheckVerdict;
  /** The reference that ran or would have, or null when the `Rerun` value is not runnable. */
  readonly reference: Pick<RunnableReference, 'file' | 'pattern'> | null;
  /** How many runs ran. */
  readonly runs: number;
  /** How many runs failed, on `flaky` only, else null. */
  readonly failedRuns: number | null;
  /** Why the row is `manual`, `skipped` or `stale`, else null. */
  readonly reason: string | null;
  /** The record's reproduce text, on a `manual` row only, else null. */
  readonly reproduce: string | null;
  /** True when a comment was posted on the bug. */
  readonly commented: boolean;
  /** Set on a `gone` row whose bug body holds a `## Trigger removed` section, left out otherwise. */
  readonly triggerRemoved?: true;
}

/** What a recheck answers, as json mode gives it. */
export interface RecheckReport {
  /** `RAFA_VERSION`. */
  readonly rafa: string;
  /** The code version, with `-dirty` when the checkout has changes. */
  readonly code: string;
  readonly checkout: string;
  /** The variable names left out of the child's environment, sorted. */
  readonly secretsLeftOut: readonly string[];
  readonly tracker: IssueTrackerData;
  readonly rows: readonly RecheckRow[];
}

/** `reference` as one line: the file, and `-t "<pattern>"` when it has one. */
export function referenceText(reference: Pick<RunnableReference, 'file' | 'pattern'>): string {
  return reference.pattern === null
    ? reference.file
    : `${reference.file} -t "${reference.pattern}"`;
}

/** The count note of a row: failed runs on `flaky`, passed runs on `gone`, else empty. */
function runsNote(row: RecheckRow): string {
  if (row.verdict === 'flaky') return ` (${row.failedRuns ?? 0} of ${row.runs} runs failed)`;
  if (row.verdict === 'gone') return ` (${row.runs} runs passed)`;
  return '';
}

/** The line or lines of one row. */
function rowLines(row: RecheckRow): string[] {
  const detail = row.reason ?? (row.reference === null
    ? null
    : referenceText(row.reference));
  const verdict = row.triggerRemoved === true
    ? `${row.verdict} ${TRIGGER_REMOVED_MARK}`
    : row.verdict;
  const head = `#${row.issue} ${verdict}${detail === null
    ? ''
    : ` ${detail}`}${runsNote(row)}`;
  if (row.verdict !== 'manual' || row.reproduce === null) return [head];
  const reproduce = row.reproduce.split('\n').map((line) => `${REPRODUCE_INDENT}${line}`);
  return [head, ...reproduce];
}

/** The text of `report`: a header, the variables left out when any are, then one line per row. */
export function renderRecheck(report: RecheckReport): string {
  const lines = [`rafa bug recheck at rafa ${report.rafa}, code ${report.code}, checkout ${report.checkout}`];
  if (report.secretsLeftOut.length > 0) {
    lines.push(`left out of the environment: ${report.secretsLeftOut.join(', ')}`);
  }
  for (const row of report.rows) lines.push(...rowLines(row));
  return lines.join('\n');
}

/** The comment on `row`, for `gone` and `flaky` only, else null; one line, unredacted. */
export function recheckComment(row: RecheckRow, report: RecheckReport): string | null {
  if (row.reference === null) return null;
  const reference = referenceText(row.reference);
  if (row.verdict === 'gone' && row.triggerRemoved === true) {
    return `gone ${TRIGGER_REMOVED_MARK} at rafa ${report.rafa}, \`${report.code}\`: \`${reference}\` passed ${row.runs} runs `
      + 'because the bug\'s trigger was removed, not because the bug is fixed';
  }
  if (row.verdict === 'gone') {
    return `gone at rafa ${report.rafa}, \`${report.code}\`: \`${reference}\` passed ${row.runs} runs`;
  }
  if (row.verdict === 'flaky') {
    return `flaky at rafa ${report.rafa}, \`${report.code}\`: \`${reference}\` failed ${row.failedRuns ?? 0} of ${row.runs} runs`;
  }
  return null;
}
