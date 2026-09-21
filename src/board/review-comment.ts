/**
 * The spec-review comment: the one comment the readiness gate leaves on
 * an issue whose spec is not ready to plan from, the edit that replaces
 * it on a rerun, and the body both are made of.
 *
 * The spec gives ONE spec-review comment per issue, marked
 * `<!-- rafa:spec-review v1 -->` and edited on a rerun
 * (`.rafa/specs/rafa-20-pr-commands.md`), the rule `src/pr/triage/comment.ts`
 * keeps for the triage comment on a pull request. The two are separate
 * modules because they mark different things and carry different
 * bodies: a triage comment is also a STORE, whose `rafa:triage` block
 * the next run reads back, and this one is a REPORT and nothing else.
 *
 * ## Nothing in this comment is ever read back
 *
 * {@link findSpecReviewComment} takes a comment's ID and nothing else.
 * The gaps are re-derived from the planner's own review on every run, so
 * a comment somebody edited in between changes no verdict, supplies no
 * prompt and moves no label. That is why no trust reading
 * (`./trust.ts`) is spent here, where `pr triage` spends one on the
 * marker comment it reads its stored head and its follow-up prompt out
 * of: text that reaches a prompt must come from an account that may
 * change the repository, and text nobody reads cannot reach one.
 *
 * The one thing a planted marker comment can do is take the edit: the
 * gate would PATCH it rather than post beside it. GitHub refuses an edit
 * of another account's comment, and the gate reports a failed write and
 * keeps its verdict, so the worst case is a gap list that did not get
 * posted and said so.
 *
 * ## The newest marker comment is the one edited
 *
 * A body written by an older rafa, or a marker that ended up on the
 * issue twice, leaves more than one. The newest is the one a reader
 * would scroll to, so it is the one replaced; the older ones are left as
 * they are rather than deleted, because deleting a person's comment is
 * not a thing a gate should do and the marker cannot prove rafa wrote
 * it.
 *
 * ## The body
 *
 * The marker opens the body, so the reader finds it whatever the
 * comment grew into, and the gaps are a plain markdown list: this
 * comment is read by a person, and nothing rafa writes parses it back.
 * Each gap's sentence is collapsed onto one line ({@link ONE_LINE}) —
 * the sentences come out of a model's YAML, where a folded scalar can
 * carry a newline, and one of those would end the list item and leave
 * the rest of the sentence as a paragraph of its own.
 *
 * Nothing here decides WHETHER to comment: `--no-comment` prints the
 * gaps and writes nothing, and that is the gate's decision
 * (`./gate.ts`). Nothing here posts, either, until
 * {@link writeSpecReviewComment} is called with a board
 * (`./issue-board.ts`).
 */
import type { BoardComment, IssueBoard } from './issue-board.js';
import type { SpecReviewGap } from './spec-review.js';

/** The HTML comment a rafa spec-review comment carries, and is found by. */
export const SPEC_REVIEW_MARKER = '<!-- rafa:spec-review v1 -->';

/** What a gap's sentence has every run of whitespace collapsed to. */
const ONE_LINE = /\s+/gu;

/** What the comment tells the author to do once the gaps are closed. */
export const COMMENT_REMEDY = 'Close the gaps, label the issue `spec:ready` again, and plan from it again.';

/** What the comment says about its own edits, so a reader knows there is one of it. */
const COMMENT_HISTORY = 'This comment is edited in place each time the spec is reviewed.';

/** Whether a write posted a new comment or edited the one that was there. */
export type SpecReviewCommentAction = 'posted' | 'edited';

/** What {@link writeSpecReviewComment} did. */
export interface SpecReviewCommentWrite {
  /** Which of the two writes it made. */
  readonly action: SpecReviewCommentAction;
  /** The comment as the board answered it. */
  readonly comment: BoardComment;
}

/** What {@link writeSpecReviewComment} is asked. */
export interface WriteSpecReviewCommentOptions {
  /** The issue the comment goes on. */
  readonly issue: number;
  /** The body, normally {@link specReviewCommentBody}'s. */
  readonly body: string;
  /** The board the write goes through. */
  readonly board: IssueBoard;
  /**
   * The marker comment already there, when the caller has read the
   * comments itself. The board is asked for them when this is left out.
   */
  readonly existing?: BoardComment | null;
}

/** `count` of `noun`, pluralised the only way this noun needs. */
function counted(count: number, noun: string): string {
  return count === 1
    ? `1 ${noun}`
    : `${String(count)} ${noun}s`;
}

/** One gap as its list item: the heading in bold, then the sentence. */
function gapItem(gap: SpecReviewGap): string {
  return `- **${gap.heading.replace(ONE_LINE, ' ').trim()}** — ${gap.what.replace(ONE_LINE, ' ').trim()}`;
}

/**
 * The comment's body: the marker, what the review found, one list item
 * per gap, and what to do about it.
 *
 * @throws TypeError for an empty gap list, as `./leak.ts` and
 * `./readiness.ts` throw for a clean reading: a comment naming no gap
 * tells the author nothing, and a gate that has no gap to post has
 * nothing to refuse either.
 */
export function specReviewCommentBody(gaps: readonly SpecReviewGap[]): string {
  if (gaps.length === 0) {
    throw new TypeError('board review comment: no gap was named, and there is no comment to write');
  }

  return [
    SPEC_REVIEW_MARKER,
    `**rafa reviewed this spec before planning and found ${counted(gaps.length, 'gap')}.**`,
    'No plan was written.',
    '',
    ...gaps.map(gapItem),
    '',
    COMMENT_REMEDY,
    '',
    COMMENT_HISTORY,
    '',
  ].join('\n');
}

/**
 * The newest comment carrying {@link SPEC_REVIEW_MARKER}, or null when
 * none does. `comments` is taken in the board's order, oldest first.
 */
export function findSpecReviewComment(comments: readonly BoardComment[]): BoardComment | null {
  return [...comments].reverse().find((comment) => comment.body.includes(SPEC_REVIEW_MARKER)) ?? null;
}

/**
 * Writes the spec-review comment: an EDIT of the marker comment already
 * on the issue, or a new comment when there is none.
 *
 * One comment per issue with its history in its edits is the spec's
 * rule, so this never posts beside a marker comment it found.
 */
export async function writeSpecReviewComment(
  options: WriteSpecReviewCommentOptions,
): Promise<SpecReviewCommentWrite> {
  const { body, issue, board } = options;
  const existing = options.existing === undefined
    ? findSpecReviewComment(await board.comments(issue))
    : options.existing;
  if (existing === null) {
    return { action: 'posted', comment: await board.comment(issue, body) };
  }
  return { action: 'edited', comment: await board.editComment(existing.id, body) };
}
