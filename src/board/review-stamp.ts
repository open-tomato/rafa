/**
 * What the readiness gate leaves behind in a plan it did not refuse:
 * `review: skipped` for `--skip-review`, `review: missing` for a
 * session whose `rafa:spec-review` block could not be read, and
 * `review: assumed` for a review that found gaps and none of them
 * blocking.
 *
 * `--skip-review` bypasses check 3 of the readiness gate — the
 * planner's own first pass over the spec — and ALONE
 * (`.rafa/specs/rafa-20-pr-commands.md`): the label check and the code
 * checks still run, and the session still writes its
 * `rafa:spec-review` block, which nothing then acts on. A plan written
 * that way was planned from a spec nobody judged, and the spec says the
 * plan records it, so the next person to open the plan, and every
 * command that parses it, can see which gate it came through.
 *
 * `review: missing` records the other way a plan comes through check 3
 * unjudged: the session ran to the end and returned no readable review
 * block, and the plan it wrote reads as written, so `./gate.ts` lets it
 * stand rather than removing it. The two values are kept apart because
 * the causes are: one is an operator's flag, the other a session that
 * said nothing, and a plan carrying either was planned from a spec no
 * review passed.
 *
 * `review: assumed` records the third way: the review read, the spec
 * judged not ready, and every gap it named non-blocking, so the plan
 * IS written under the assumptions the reviewer would plan by. It is
 * kept apart from the other two because the spec WAS judged here — a
 * reader seeing `assumed` knows a review ran, named what it did not
 * know, and guessed; `skipped` and `missing` both mean nobody judged.
 *
 * `review` is not one of `PLAN_HEADER_FIELDS` (`src/plan/parse.ts`), so
 * the plan reader keeps it as a `PlanHeaderExtra`: retained, acting on
 * nothing, and listed by `plan show`. That is the shape an unrecognised
 * key is supposed to have, and it is why this needs no change to the
 * reader — a later phase that wants to ACT on the field promotes it to
 * a header field there.
 *
 * ## Written bare, and what it reads back as
 *
 * The value is written as the spec spells it, `review: skipped`, and
 * not through `JSON.stringify` as `src/pr/triage/comment.ts` writes
 * every value of its block. That module quotes because a sha, a date
 * and a path each come back retyped or cut short by the YAML core
 * schema; this value is one lower-case word, and it was measured on bun
 * 1.3.14 on 2026-09-19: `Bun.YAML.parse('stub: a\nreview: skipped\n')`
 * answers `{"stub":"a","review":"skipped"}`, the string, beside the
 * field the plan already carried. `missing` is the same shape of word
 * and reads back the same way, which `./review-stamp.test.ts` holds
 * through `parsePlan` for both values.
 *
 * ## What it does to the file
 *
 * One line, inserted directly above the block's closing fence with the
 * opening fence's indentation, or the existing `review:` line replaced
 * where the block already carries one, and every other byte of the plan
 * left as it was. That placing is `./plan-field.ts`'s
 * {@link stampPlanField}, which the `issue: <n>` a plan off the board
 * carries shares: this module is the `review` field's own meaning, and
 * the shape of the write is one source for both.
 *
 * A plan with no `rafa:plan` block, or one the document never closed,
 * is left untouched and reported. Writing a block for it would put a
 * header on a plan whose own header was unreadable, and the stamp is a
 * record, not a repair: {@link ReviewStamp.recorded} is false and
 * {@link ReviewStamp.note} says what was in the way, for the caller to
 * warn with.
 */
import type { PlanFieldAnswer, PlanFieldStamp } from './plan-field.js';

import { stampPlanField } from './plan-field.js';

/** The `rafa:plan` field the stamp records. */
export const REVIEW_FIELD = 'review';

/** What the field is set to when check 3 was bypassed. */
export const REVIEW_SKIPPED = 'skipped';

/** What the field is set to when the session returned no readable review. */
export const REVIEW_MISSING = 'missing';

/** What the field is set to when every gap the review found was non-blocking. */
export const REVIEW_ASSUMED = 'assumed';

/** The line `--skip-review` leaves behind, indentation aside. */
export const REVIEW_SKIPPED_LINE = `${REVIEW_FIELD}: ${REVIEW_SKIPPED}`;

/** The line an unread review leaves behind, indentation aside. */
export const REVIEW_MISSING_LINE = `${REVIEW_FIELD}: ${REVIEW_MISSING}`;

/** The line a review of non-blocking gaps leaves behind, indentation aside. */
export const REVIEW_ASSUMED_LINE = `${REVIEW_FIELD}: ${REVIEW_ASSUMED}`;

/** What a stamp did, or what stopped it; `./plan-field.ts` spells the five. */
export type ReviewStampAnswer = PlanFieldAnswer;

/** One plan, stamped. */
export type ReviewStamp = PlanFieldStamp;

/**
 * The plan with `review: skipped` recorded in its `rafa:plan` block.
 *
 * Takes the plan as read and answers the text to write; never throws
 * and never touches a file. See the module note for where the line
 * goes, what is left alone, and what a plan with no readable block
 * answers.
 */
export function stampReviewSkipped(plan: string): ReviewStamp {
  return stampPlanField(plan, REVIEW_FIELD, REVIEW_SKIPPED);
}

/**
 * The plan with `review: missing` recorded in its `rafa:plan` block.
 *
 * What `./gate.ts` answers `unread` for: a session that returned no
 * readable `rafa:spec-review` block over a plan that reads as written.
 * Takes the plan as read and answers the text to write, as
 * {@link stampReviewSkipped} does.
 */
export function stampReviewMissing(plan: string): ReviewStamp {
  return stampPlanField(plan, REVIEW_FIELD, REVIEW_MISSING);
}

/**
 * The plan with `review: assumed` recorded in its `rafa:plan` block.
 *
 * What `./gate.ts` writes over a `not-ready` review whose every gap is
 * non-blocking: the plan stands, its opening heading carries the
 * assumptions, and this line records that it was planned under them.
 * Takes the plan as read and answers the text to write, as
 * {@link stampReviewSkipped} does.
 */
export function stampReviewAssumed(plan: string): ReviewStamp {
  return stampPlanField(plan, REVIEW_FIELD, REVIEW_ASSUMED);
}
