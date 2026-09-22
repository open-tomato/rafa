/**
 * The lines a `rafa plan create` run records in the plan its session
 * wrote: the issue a board route planned from, and the two words the
 * readiness gate leaves behind when no verdict stands on the spec.
 *
 * Each is one field of the plan's `rafa:plan` block, stamped by a
 * reader-and-writer under `src/board/` — `plan-field.ts` for the issue,
 * `review-stamp.ts` for the two review words — and this module is what
 * `plan create` reaches for them through: read the file, stamp the
 * text, write it back if the stamp changed anything, and say so.
 *
 * ## What a plan off the board records
 *
 * A plan the issue routes generated records the issue it was planned
 * from, `issue: <n>` in its `rafa:plan` block, as the spec asks
 * ({@link recordPlanIssue}, `board/plan-field.ts`). The number is
 * written QUOTED, since the plan reader takes that field as a string
 * and reports a number as unusable; the note in `board/plan-field.ts`
 * holds the measurement.
 *
 * `--skip-review` keeps a plan no session judged, and it records
 * `review: skipped` ({@link recordSkippedReview}); a session whose
 * review block could not be read over a plan that reads as written
 * records `review: missing` ({@link recordMissingReview}). Which of
 * those a run writes is `./review-gate.ts`'s decision, never this
 * module's.
 *
 * The third review word has no record here. `review: assumed` — a
 * verdict no gap of which blocked planning — is written by the GATE
 * itself, in the same write that opens the plan with the assumptions,
 * because the two together are what that verdict does
 * (`src/board/gate.ts`). Nothing in this module runs for it.
 *
 * ## A record that fails is a warning, never a refusal
 *
 * Every record is written AFTER the gate, so a plan the gate moved
 * aside is never stamped. A plan that cannot be read, cannot be
 * written, or holds no readable `rafa:plan` block is WARNED about and
 * nothing else: the plan itself is what the operator asked for, and a
 * stamp that refused it would throw away a session already paid for.
 * {@link recordInPlan} is where that rule is spelled once, and the
 * three records share it.
 *
 * Every line goes through the active output
 * (`adapters/output/active.ts`), as every line `plan create` prints
 * does, so `./plan-record.test.ts` reads the bytes of each message off
 * a sink.
 */
import type { PlanFieldStamp } from '../../board/plan-field.js';

import fs from 'fs';
import path from 'path';

import { activeOutput } from '../../adapters/output/active.js';
import { SKIP_REVIEW_FLAG } from '../../board/gate.js';
import { issueFieldLine, stampPlanIssue } from '../../board/plan-field.js';
import {
  REVIEW_MISSING_LINE,
  REVIEW_SKIPPED_LINE,
  stampReviewMissing,
  stampReviewSkipped,
} from '../../board/review-stamp.js';
import { messageOf } from '../../config-sections.js';

/**
 * Records one line in the generated plan's `rafa:plan` block, answering
 * whether the plan now carries it.
 *
 * A plan that cannot be read, cannot be written, or holds no readable
 * `rafa:plan` block is WARNED about and nothing else, and answers false;
 * the module note holds why. `line` is what the warning calls the
 * record.
 */
function recordInPlan(
  repoRoot: string,
  planPath: string,
  stamp: (written: string) => PlanFieldStamp,
  line: string,
): boolean {
  const file = path.resolve(repoRoot, planPath);
  const unrecorded = (why: string): boolean => {
    activeOutput().warn(`${planPath} does not record ${line}: ${why}`);
    return false;
  };

  let written: string;
  try {
    written = fs.readFileSync(file, 'utf8');
  } catch (error) {
    return unrecorded(messageOf(error));
  }

  const stamped = stamp(written);
  if (!stamped.recorded) return unrecorded(stamped.note);
  if (stamped.answer !== 'unchanged') {
    try {
      fs.writeFileSync(file, stamped.text, 'utf8');
    } catch (error) {
      return unrecorded(messageOf(error));
    }
  }
  return true;
}

/** Records `review: skipped` in the plan `--skip-review` kept, and says so. */
export function recordSkippedReview(repoRoot: string, planPath: string): void {
  if (!recordInPlan(repoRoot, planPath, stampReviewSkipped, REVIEW_SKIPPED_LINE)) return;
  activeOutput().info(`⏭  ${SKIP_REVIEW_FLAG}: the spec was not reviewed, and ${planPath} records ${REVIEW_SKIPPED_LINE}.`);
}

/** Records `review: missing` in the plan an unread review left standing, and says so. */
export function recordMissingReview(repoRoot: string, planPath: string): void {
  if (!recordInPlan(repoRoot, planPath, stampReviewMissing, REVIEW_MISSING_LINE)) return;
  activeOutput().info(`🔍 ${planPath} records ${REVIEW_MISSING_LINE}: the session returned no readable rafa:spec-review block.`);
}

/** Records the issue a board route planned from in the plan it wrote, and says so. */
export function recordPlanIssue(repoRoot: string, planPath: string, issue: number): void {
  const line = issueFieldLine(issue);
  if (!recordInPlan(repoRoot, planPath, (written) => stampPlanIssue(written, issue), line)) return;
  activeOutput().info(`🔖 ${planPath} records ${line}, the issue it was planned from.`);
}
