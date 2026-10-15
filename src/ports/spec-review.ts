/**
 * The shapes a spec review is read into: the verdicts and readings a
 * `rafa:spec-review` block answers, the gaps it names and the issues it
 * reports. Core's `Planner` port names {@link SpecReviewReading}, so they
 * sit here, below the board; `src/board/spec-review.ts` reads the block
 * into them, re-exports them under the same names, and keeps the parser,
 * the headings and the two fallback gaps.
 */
import type { RafaBlock } from '../core/plan/block-reader.js';

/** The two words the block's `verdict` is spelled with. */
export const SPEC_REVIEW_VERDICTS = ['ready', 'not-ready'] as const;

/** One of the two verdicts a session can write. */
export type SpecReviewVerdict = (typeof SPEC_REVIEW_VERDICTS)[number];

/**
 * The four readings a session output answers. The first two are the
 * verdicts as written; the last two are a block that could not be read,
 * and are not-ready all the same.
 */
export const SPEC_REVIEW_ANSWERS = ['ready', 'not-ready', 'absent', 'malformed'] as const;

/** One of the four readings; see {@link SPEC_REVIEW_ANSWERS}. */
export type SpecReviewAnswer = (typeof SPEC_REVIEW_ANSWERS)[number];

/** One thing the planner found keeping a spec from being planned from. */
export interface SpecReviewGap {
  /** The spec heading it sits under, as the comment names it. */
  readonly heading: string;
  /** What is wrong under that heading, as the session wrote it. */
  readonly what: string;
  /**
   * True when guessing wrong here changes what ships or what is safe,
   * so nothing can be planned until the spec answers it. True for
   * every gap whose `blocking` was unreadable and for every
   * non-blocking one that named no assumption; see the module note.
   */
  readonly blocking: boolean;
  /**
   * What the planner would plan under, as the session wrote it. Never
   * null for a gap that is not blocking; null for a blocking gap that
   * named none.
   */
  readonly assumption: string | null;
}

/** One thing the block said that this reading does not hold as written. */
export interface SpecReviewIssue {
  /** Where, in the block's own key names: `gaps[2].what`. */
  readonly field: string;
  /** One sentence for an operator to read. */
  readonly text: string;
}

/** A session output, read for its `rafa:spec-review` block. */
export interface SpecReviewReading {
  /** Which of the four readings this is. */
  readonly answer: SpecReviewAnswer;
  /** True for `ready` alone; what the gate acts on. */
  readonly ready: boolean;
  /**
   * Every gap to post. Empty only for a ready reading; see the module
   * note for what fills it when the session named none.
   */
  readonly gaps: readonly SpecReviewGap[];
  /** The last `rafa:spec-review` block, or null when there is none. */
  readonly block: RafaBlock | null;
  /** One sentence for an operator to read. */
  readonly text: string;
  /** What was not read as written. Empty for a clean block. */
  readonly issues: readonly SpecReviewIssue[];
}
