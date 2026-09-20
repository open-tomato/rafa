/**
 * What `--skip-review` leaves behind: `review: skipped` recorded in the
 * generated plan's `rafa:plan` block.
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
 * field the plan already carried.
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

/** The line the stamp writes, indentation aside. */
export const REVIEW_SKIPPED_LINE = `${REVIEW_FIELD}: ${REVIEW_SKIPPED}`;

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
