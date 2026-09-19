/**
 * What `--skip-review` leaves behind: `review: skipped` recorded in the
 * generated plan's `rafa:plan` block.
 *
 * `--skip-review` bypasses check 3 of the readiness gate — the
 * planner's own first pass over the spec — and ALONE
 * (`.specs/rafa-20-pr-commands.md`): the label check and the code
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
 * where the block already carries one. Every other byte of the plan is
 * left as it was, the line endings included: the document is split on
 * `\n` and joined on `\n`, so a `\r` that ended a line still ends it,
 * and the inserted line takes the `\r` of the fence it follows. The
 * plan is a file a person reads and a session wrote; a stamp that
 * reformatted it would turn one recorded field into a diff nobody
 * asked for.
 *
 * A plan with no `rafa:plan` block, or one the document never closed,
 * is left untouched and reported. Writing a block for it would put a
 * header on a plan whose own header was unreadable, and the stamp is a
 * record, not a repair: {@link ReviewStamp.recorded} is false and
 * {@link ReviewStamp.note} says what was in the way, for the caller to
 * warn with.
 */
import { readRafaBlocks } from '../plan/blocks.js';

/** The `rafa:plan` field the stamp records. */
export const REVIEW_FIELD = 'review';

/** What the field is set to when check 3 was bypassed. */
export const REVIEW_SKIPPED = 'skipped';

/** The line the stamp writes, indentation aside. */
export const REVIEW_SKIPPED_LINE = `${REVIEW_FIELD}: ${REVIEW_SKIPPED}`;

/** The block kind the field is recorded in. */
const PLAN_BLOCK_KIND = 'plan';

/** A `review:` key at the top level of a block body, with its value captured. */
const REVIEW_LINE = /^(\s*)review\s*:(.*)$/u;

/** What a stamp did, or what stopped it. */
export type ReviewStampAnswer =
  /** The block carried no `review` key, so the line was added. */
  | 'inserted'
  /** The block carried another `review` value, which was replaced. */
  | 'replaced'
  /** The block already recorded `review: skipped`; no byte changed. */
  | 'unchanged'
  /** The plan holds no `rafa:plan` block. Nothing was recorded. */
  | 'no-block'
  /** The plan's `rafa:plan` block is never closed. Nothing was recorded. */
  | 'unclosed-block';

/** One plan, stamped. */
export interface ReviewStamp {
  /** What happened; see {@link ReviewStampAnswer}. */
  readonly answer: ReviewStampAnswer;
  /** The plan as it now stands, byte-identical to the input when nothing was recorded. */
  readonly text: string;
  /** True when the plan records `review: skipped` once this text is written. */
  readonly recorded: boolean;
  /** One sentence for an operator to read. */
  readonly note: string;
}

/** A reading that recorded nothing, carrying why. */
function unrecorded(answer: ReviewStampAnswer, text: string, note: string): ReviewStamp {
  return { answer, text, recorded: false, note };
}

/** The whitespace a line opens with. */
function indentOf(line: string): string {
  return /^\s*/u.exec(line)?.[0] ?? '';
}

/** The `\r` a line carries before its newline, or the empty string. */
function carriageOf(line: string): string {
  return line.endsWith('\r')
    ? '\r'
    : '';
}

/**
 * The plan with `review: skipped` recorded in its `rafa:plan` block.
 *
 * Takes the plan as read and answers the text to write; never throws
 * and never touches a file. See the module note for where the line
 * goes, what is left alone, and what a plan with no readable block
 * answers.
 */
export function stampReviewSkipped(plan: string): ReviewStamp {
  const block = readRafaBlocks(plan).find((found) => found.kind === PLAN_BLOCK_KIND);
  if (block === undefined) {
    return unrecorded('no-block', plan, 'the plan holds no rafa:plan block to record it in');
  }
  if (!block.closed) {
    return unrecorded(
      'unclosed-block',
      plan,
      `the rafa:plan block at line ${String(block.span.first)} is never closed, so nothing was recorded in it`,
    );
  }

  const lines = plan.split('\n');
  const opening = lines[block.span.first - 1] ?? '';
  const indent = indentOf(opening);
  const written = `${indent}${REVIEW_SKIPPED_LINE}${carriageOf(opening)}`;

  for (let index = block.span.first; index < block.span.last - 1; index += 1) {
    const found = REVIEW_LINE.exec(lines[index] ?? '');
    // Only a key at the block's own indentation is the field: one
    // indented further sits inside another key's mapping.
    if (found === null || found[1] !== indent) continue;
    if ((found[2] ?? '').trim() === REVIEW_SKIPPED) {
      return { answer: 'unchanged', text: plan, recorded: true, note: 'the plan already records review: skipped' };
    }
    const replaced = [...lines];
    replaced[index] = written;
    return {
      answer: 'replaced',
      text: replaced.join('\n'),
      recorded: true,
      note: `line ${String(index + 1)} of the plan now records ${REVIEW_SKIPPED_LINE}`,
    };
  }

  const at = block.span.last - 1;
  const stamped = [...lines.slice(0, at), written, ...lines.slice(at)];
  return {
    answer: 'inserted',
    text: stamped.join('\n'),
    recorded: true,
    note: `line ${String(at + 1)} of the plan now records ${REVIEW_SKIPPED_LINE}`,
  };
}
