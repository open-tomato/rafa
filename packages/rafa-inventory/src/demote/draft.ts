/**
 * The demotion pass's first write: every file the directory offers,
 * classified into the report a reviewer then edits.
 *
 * `./select.ts` says which files, `./classify.ts` says what each one
 * is, and `./report.ts` says how a report is spelled. This module is
 * the joint, plus the one rule none of the three can own: what happens
 * to a review that is already there when the report is written again.
 *
 * ## A re-run does not throw a review away
 *
 * The pass is `write`, then a human edits the file for an hour, then
 * `--apply`. A second `write` in the middle of that — a second session,
 * a mistyped command, a plan step re-run — would overwrite the file the
 * review lives in, and the review would be gone with nothing failing.
 * So {@link carryReview} copies each previous row's override and
 * override reason onto the new row for the same path, and only when
 * the hashes agree: an override is a judgement about the bytes that
 * were classified, and a file edited since is a file the reviewer has
 * not seen.
 *
 * `status` is carried the same way and more strictly. It stays
 * {@link REVIEWED_STATUS} only when the new row set and the old one are
 * the same paths with the same hashes — one file added, one removed or
 * one edited and the report goes back to {@link DRAFT_STATUS}, because
 * `reviewed` means a person looked at every row and there is now a row
 * nobody has looked at. A reviewer who re-marks it loses nothing: every
 * override they had written is still in the file.
 *
 * ## The verdict is not carried
 *
 * Only the override is. The verdict is {@link classifySkill}'s answer
 * over the file's bytes, and those bytes are what the carry rule
 * already checked, so a carried verdict could only ever equal the one
 * just computed. Copying it would add a way for the two to disagree and
 * no way to notice.
 */
import type { DemotionReport, DemotionReportRow } from './report.js';
import type { SelectedFile } from './select.js';

import { classifySkill } from './classify.js';
import { DRAFT_STATUS, REVIEWED_STATUS } from './report.js';

/** One selected file as a fresh row: classified, with no override. */
export function classifiedRow(file: SelectedFile): DemotionReportRow {
  const classification = classifySkill(file);
  return {
    path: file.path,
    hash: file.hash,
    verdict: classification.verdict,
    reason: classification.reason,
    override: null,
    overrideReason: null,
  };
}

/** Whether two rows name the same file in the same state. */
function sameFile(left: DemotionReportRow, right: DemotionReportRow): boolean {
  return left.path === right.path && left.hash === right.hash;
}

/**
 * `rows`, each carrying the override the matching row of `previous`
 * held, and the status `previous` may keep. See the module note.
 */
export function carryReview(
  rows: readonly DemotionReportRow[],
  previous: DemotionReport | null,
): DemotionReport {
  if (previous === null) return { status: DRAFT_STATUS, rows };

  const carried = rows.map((row) => {
    const match = previous.rows.find((old) => sameFile(old, row));
    if (match === undefined || match.override === null) return row;
    return { ...row, override: match.override, overrideReason: match.overrideReason };
  });

  const unchanged = carried.length === previous.rows.length
    && carried.every((row) => previous.rows.some((old) => sameFile(old, row)));
  return {
    status: unchanged && previous.status === REVIEWED_STATUS
      ? REVIEWED_STATUS
      : DRAFT_STATUS,
    rows: carried,
  };
}

/**
 * Every selected file classified into one report, with whatever of
 * `previous` still applies carried onto it. `previous` is null on the
 * first run of the pass and on a report that no longer parses, which
 * this module treats the same way: a report nothing can read holds no
 * review anything can carry.
 */
export function buildDemotionReport(
  files: readonly SelectedFile[],
  previous: DemotionReport | null,
): DemotionReport {
  return carryReview(files.map((file) => classifiedRow(file)), previous);
}
