/**
 * The readiness gate around a `rafa plan create` session: the planner
 * call with the gate weighing what it rejects with, and the verdict
 * settled over the plan it answered.
 *
 * `src/plan.ts` builds the request and prints what came back. The
 * enforcement itself is `board/gate.ts`'s, and what this module owns is
 * the part that is the COMMAND's: which rejections carry a review worth
 * enforcing, and which record a plan the gate let stand is stamped with
 * (`./plan-record.ts`).
 *
 * ## The readiness gate's verdict
 *
 * The plan prompt asks the session to judge the spec BEFORE planning and
 * to END its final message with a `rafa:spec-review` block, which the
 * planner reads once and carries back both on the plan it answers and on
 * what it rejects with (`adapters/planner/claude.ts`). Neither of those
 * acts on it. `plan create` does, through {@link enforceSpecReview}: a
 * review that is not ready over a gap that BLOCKS planning moves the
 * plan and the prerequisites file into `rejected/` under `plan.dir`
 * when the session wrote them anyway, publishes the gaps on the issue
 * when there is one, swaps `spec:ready` for `spec:needs-work`, and
 * throws `CommandExit(3)` carrying every gap. One whose gaps are all
 * non-blocking keeps the plan instead: the gate opens it with the
 * assumptions, records `review: assumed` in it, posts the same gaps and
 * moves no label, and `plan create` goes on as it does for a ready
 * verdict (`board/gate.ts` holds both halves).
 * `--spec=<file>` has no issue and so no labels to move: that route
 * moves the files aside, prints and exits 3. The issue routes fill
 * {@link SpecReviewGateOptions.issue} with the number and the board
 * `board/plan-spec.ts` answers beside the spec, so a not-ready verdict
 * on an issue is published where the spec came from.
 *
 * A REJECTION is weighed differently from an answer, by
 * {@link rejectedReview}. One whose review block was READ and judged the
 * spec not ready is enforced: a session that judged a spec unplannable
 * writes no plan, and that rejection is the ordinary shape of a verdict
 * with a blocking gap. One carrying an `absent` or `malformed` review is not,
 * because the session did not finish and what the operator needs is the
 * failure it ended with, not a gate refusal saying the review block was
 * missing.
 *
 * On a plan the planner DID answer, an `absent` or `malformed` review
 * does not refuse it by itself: the gate weighs the plan with
 * `plan validate`'s reader and answers `unread` for one that reads as
 * written, which {@link settleReview} records as `review: missing` in
 * the plan's `rafa:plan` block (`./plan-record.ts`) beside the gate's
 * one warning. `board/gate.ts` holds why a session's silence is no
 * verdict on the spec.
 *
 * `--skip-review` bypasses that gate ALONE, and the plan it keeps
 * records `review: skipped`. Both it and `--no-comment` are read
 * through `readGateFlags` (`board/gate.ts`) rather than here, and both
 * are declared on `./create.ts` beside the board flags.
 *
 * ## The paths each half of the verdict goes on
 *
 * A {@link GateBase} is this command's own spelling of the two files,
 * built from `plan.dir` and the stub before the session runs, and it is
 * all a REJECTION leaves to go on. On an answer the paths are the
 * planner's own, which are the files it saw, so {@link settleReview}
 * puts those over the base before the gate weighs them.
 */
import type { SpecReviewGateOptions } from '../../board/gate.js';
import type { SpecReviewReading } from '../../board/spec-review.js';
import type { GeneratedPlan, Planner, PlanRequest } from '../../ports/index.js';

import { ClaudePlannerError } from '../../adapters/planner/claude.js';
import { enforceSpecReview } from '../../board/gate.js';
import { CommandExit } from '../../cli/command.js';
import { messageOf } from '../../config-sections.js';

import { recordMissingReview, recordSkippedReview } from './plan-record.js';

/** Everything the readiness gate needs of a run but the verdict itself. */
export type GateBase = Omit<SpecReviewGateOptions, 'review'>;

/**
 * The review a planner's rejection carries that the gate acts on: one
 * whose block was READ and judged the spec not ready. Every other
 * rejection answers undefined and keeps its own message; the module note
 * records why.
 */
export function rejectedReview(error: unknown): SpecReviewReading | undefined {
  if (!(error instanceof ClaudePlannerError) || error.review === null) return undefined;
  return error.review.answer === 'not-ready'
    ? error.review
    : undefined;
}

/**
 * The plan `planner` generates for `request`, or a `CommandExit` when it
 * rejects: its message the rejection's, and its exit code the one a
 * `claude` planner's rejection carries, or 1 for any other.
 *
 * A rejection is weighed by the gate first, unless `--skip-review`
 * bypassed it, so a session that judged the spec unplannable and wrote
 * no plan ends with the gate's exit code 3 and its gaps rather than with
 * the adapter's "was not created" line.
 */
export async function generateOrExit(
  planner: Planner,
  request: PlanRequest,
  gate: GateBase,
  skipReview: boolean,
): Promise<GeneratedPlan> {
  try {
    return await planner.create(request);
  } catch (error) {
    if (!skipReview) await enforceSpecReview({ ...gate, review: rejectedReview(error) });
    const exitCode = error instanceof ClaudePlannerError
      ? error.exitCode
      : 1;
    throw new CommandExit(exitCode, `\n❌ ${messageOf(error)}`);
  }
}

/**
 * Settles the verdict over the plan the session answered: the gate run
 * on it, and the record it is stamped with.
 *
 * Under `--skip-review` no gate runs and the plan records
 * `review: skipped`. Otherwise the gate weighs the review over the
 * planner's own paths, throws `CommandExit(3)` for a verdict the plan
 * does not stand on, and a plan it left standing on an unread review
 * records `review: missing`.
 *
 * `review: assumed` is NOT recorded here: the gate writes it itself,
 * together with the assumptions section it opens the plan with, because
 * the two are one write and the verdict is what they record
 * (`board/gate.ts`). So an `assumed` standing needs nothing of this
 * function, and the plan it answers over is already stamped.
 */
export async function settleReview(
  gate: GateBase,
  generated: GeneratedPlan,
  skipReview: boolean,
): Promise<void> {
  if (skipReview) {
    recordSkippedReview(gate.repoRoot, generated.planPath);
    return;
  }

  // On an answer the paths are the planner's own, which are the files
  // it saw; the ones in `gate` are this command's spelling of them,
  // and are all a rejection leaves to go on.
  const standing = await enforceSpecReview({
    ...gate,
    planPath: generated.planPath,
    prerequisitesPath: generated.prerequisitesPath ?? gate.prerequisitesPath,
    review: generated.review,
  });
  if (standing === 'unread') recordMissingReview(gate.repoRoot, generated.planPath);
}
