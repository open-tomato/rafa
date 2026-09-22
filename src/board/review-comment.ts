/**
 * The spec-review comment: the one comment the readiness gate leaves on
 * an issue whose spec is not ready to plan from, the edit that replaces
 * it on a rerun, the trust reading that decides which comment that edit
 * may touch, and the body both writes are made of.
 *
 * The spec gives ONE spec-review comment per issue, marked
 * `<!-- rafa:spec-review v1 -->` and edited on a rerun
 * (`.rafa/specs/rafa-20-pr-commands.md`), the rule `src/pr/triage/comment.ts`
 * keeps for the triage comment on a pull request. The two are separate
 * modules because they mark different things and carry different
 * bodies: a triage comment is also a STORE, whose `rafa:triage` block
 * the next run reads back, and this one is a REPORT and nothing else.
 *
 * ## The trust reading buys the EDIT, not the text
 *
 * Nothing in this comment is ever read back into a prompt.
 * {@link readTrustedSpecReviewComment} takes a comment's ID and its
 * AUTHOR and nothing else; the gaps are re-derived from the planner's
 * own review on every run, so a comment somebody edited in between
 * changes no verdict and supplies no prompt. That is what the other
 * two marker-comment readers spend a trust reading for
 * (`src/commands/pr/triage-trust.ts`), and it is why this module said
 * for a while that it needed none.
 *
 * What a planted marker comment CAN take is the EDIT. The gate keeps
 * one spec-review comment per issue and edits the newest marked one, so
 * a comment a stranger marked is the one it would PATCH. GitHub refuses
 * an edit of another account's comment, so the outcome is not a changed
 * verdict but a LOST REPORT: the gap list the author needed is never
 * posted, run after run, and what a person reading the issue finds is
 * whatever the planted comment says. A write that fails is only a
 * warning here (`./gate.ts`), so nothing downstream would notice.
 *
 * So the author is read through `./trust.ts` — the allow-list, then the
 * one permission lookup, with a failed lookup refused rather than
 * passed — and a marker comment whose author that reading refuses is
 * IGNORED: passed over, reported by its id and its author
 * ({@link ignoredReviewCommentMessage}), and left exactly as it is. The
 * gate then edits rafa's own comment if there is one under it, and
 * otherwise POSTS BESIDE the planted one, which is the report landing
 * where a person will read it.
 *
 * Ignored and never refused, the rule
 * `src/commands/pr/triage-trust.ts` keeps for the triage marker comment
 * and for the same reason: anyone at all can comment on a public issue,
 * and a gate that exited over one would hand a stranger a way to stop
 * rafa reviewing specs on that repository at all.
 *
 * ## The newest TRUSTED marker comment is the one edited
 *
 * A body written by an older rafa, or a marker that ended up on the
 * issue twice, leaves more than one. The walk is newest first and
 * answers the FIRST trusted one, so a comment planted after rafa's own
 * does not hide it: the alternative — reading the newest marker comment
 * and posting beside it when its author is refused — would let one
 * planted comment turn every rerun into a new comment, and the issue
 * would collect one gap list per run.
 *
 * Older trusted markers are left as they are rather than deleted,
 * because deleting a person's comment is not a thing a gate should do
 * and the marker cannot prove rafa wrote it.
 *
 * One lookup per LOGIN and not per comment: the readings are memoised
 * for the walk, so an issue carrying six marker comments from one
 * account spends one `gh api`.
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
 * There are TWO bodies, because the gate now has two things to report
 * about one gap list. {@link specReviewCommentBody} is the refusal's:
 * a plan was removed, the label moved, and closing the gaps is what
 * gets the spec planned. {@link assumedReviewCommentBody} is the one a
 * review whose every gap is non-blocking gets: the plan WAS written,
 * each item carries the assumption it was written under, and no label
 * moved, so its remedy says so (`./gate.ts`). They share the marker, so
 * a rerun that switches between them edits the one comment the issue
 * already carries rather than posting a second.
 *
 * A body that said "No plan was written" over a plan that stands would
 * be the one sentence in this comment a person acts on, and it would be
 * false; that is why the two bodies are two functions rather than one
 * with a gap list that cannot tell the caller which run wrote it.
 *
 * Nothing here decides WHETHER to comment: `--no-comment` prints the
 * gaps and writes nothing, and that is the gate's decision
 * (`./gate.ts`). Nothing here posts, either, until
 * {@link writeSpecReviewComment} is called with a board
 * (`./issue-board.ts`) and the trust the gate's issue carries.
 */
import type { BoardComment, IssueBoard } from './issue-board.js';
import type { SpecReviewGap } from './spec-review.js';
import type { BoardTrust, TrustReading } from './trust.js';

import { readBoardTrust, trustRefusalClause } from './trust.js';

/** The HTML comment a rafa spec-review comment carries, and is found by. */
export const SPEC_REVIEW_MARKER = '<!-- rafa:spec-review v1 -->';

/** What a report calls an ignored comment, which is the marker without its HTML. */
export const SPEC_REVIEW_COMMENT_NAME = 'rafa:spec-review';

/** What a gap's sentence has every run of whitespace collapsed to. */
const ONE_LINE = /\s+/gu;

/** What the comment tells the author to do once the gaps are closed. */
export const COMMENT_REMEDY = 'Close the gaps, label the issue `spec:ready` again, and plan from it again.';

/** What the comment tells the author when the plan was written anyway. */
export const ASSUMED_COMMENT_REMEDY = 'Answer these in the spec where an assumption is wrong, and plan from it'
  + ' again. No label changed: none of these gaps blocked planning.';

/** What the comment says about its own edits, so a reader knows there is one of it. */
const COMMENT_HISTORY = 'This comment is edited in place each time the spec is reviewed.';

/** Whether a write posted a new comment or edited the one that was there. */
export type SpecReviewCommentAction = 'posted' | 'edited';

/** One marker comment the trust reading refused, and why. */
export interface IgnoredSpecReviewComment {
  /** The comment's REST id, so a report can be matched to a comment. */
  readonly id: string;
  /** The login that wrote it. */
  readonly author: string;
  /** The whole sentence reporting it; see {@link ignoredReviewCommentMessage}. */
  readonly reason: string;
}

/** The marker comment a rerun may edit, and the ones it passed over. */
export interface TrustedSpecReviewComment {
  /** The newest marker comment from a trusted author, or null when there is none. */
  readonly comment: BoardComment | null;
  /** Every newer marker comment that was ignored, newest first. */
  readonly ignored: readonly IgnoredSpecReviewComment[];
}

/** What {@link writeSpecReviewComment} did. */
export interface SpecReviewCommentWrite {
  /** Which of the two writes it made. */
  readonly action: SpecReviewCommentAction;
  /** The comment as the board answered it. */
  readonly comment: BoardComment;
  /** The marker comments the trust reading refused, newest first. */
  readonly ignored: readonly IgnoredSpecReviewComment[];
}

/** What {@link writeSpecReviewComment} is asked. */
export interface WriteSpecReviewCommentOptions {
  /** The issue the comment goes on. */
  readonly issue: number;
  /** The body, normally {@link specReviewCommentBody}'s. */
  readonly body: string;
  /** The board the write goes through. */
  readonly board: IssueBoard;
  /** What the author of a marker comment is read through; see the module note. */
  readonly trust: BoardTrust;
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
 * One gap as a markdown list item, with the assumption the plan was
 * written under beneath it. A gap naming none is its item alone: a
 * blocking gap plausibly carries no assumption, and every non-blocking
 * one carries one (`./spec-review.ts`).
 *
 * Exported for `./review-stamp.ts`, which opens the plan itself with
 * the same gaps: the issue comment and the plan's own heading say what
 * was assumed in ONE spelling, so the two cannot come to disagree.
 */
export function assumedGapItem(gap: SpecReviewGap): string {
  return gap.assumption === null
    ? gapItem(gap)
    : `${gapItem(gap)}\n  - Planned under: ${gap.assumption.replace(ONE_LINE, ' ').trim()}`;
}

/**
 * Refuses a gap list a comment cannot be made of.
 *
 * @throws TypeError for an empty gap list, as `./leak.ts` and
 * `./readiness.ts` throw for a clean reading: a comment naming no gap
 * tells the author nothing, and a gate that has no gap to post has
 * nothing to refuse either.
 */
function requireGaps(gaps: readonly SpecReviewGap[]): void {
  if (gaps.length === 0) {
    throw new TypeError('board review comment: no gap was named, and there is no comment to write');
  }
}

/** The shape both bodies share: the marker, the finding, the items, the remedy. */
function commentBody(found: readonly string[], items: readonly string[], remedy: string): string {
  return [SPEC_REVIEW_MARKER, ...found, '', ...items, '', remedy, '', COMMENT_HISTORY, ''].join('\n');
}

/**
 * The comment's body for a refusal: the marker, what the review found,
 * one list item per gap, and what to do about it.
 *
 * @throws TypeError for an empty gap list; see {@link requireGaps}.
 */
export function specReviewCommentBody(gaps: readonly SpecReviewGap[]): string {
  requireGaps(gaps);
  return commentBody(
    [`**rafa reviewed this spec before planning and found ${counted(gaps.length, 'gap')}.**`, 'No plan was written.'],
    gaps.map(gapItem),
    COMMENT_REMEDY,
  );
}

/**
 * The comment's body for a review whose every gap is non-blocking: the
 * same marker and the same gaps, each with the assumption the plan was
 * written under, and a remedy that does not ask for a label nothing
 * moved. `./gate.ts` picks this one and holds when.
 *
 * @throws TypeError for an empty gap list; see {@link requireGaps}.
 */
export function assumedReviewCommentBody(gaps: readonly SpecReviewGap[]): string {
  requireGaps(gaps);
  return commentBody(
    [
      `**rafa reviewed this spec before planning and found ${counted(gaps.length, 'gap')}, none of them blocking.**`,
      'The plan was written under the assumptions below.',
    ],
    gaps.map(assumedGapItem),
    ASSUMED_COMMENT_REMEDY,
  );
}

/**
 * Every comment carrying {@link SPEC_REVIEW_MARKER}, NEWEST first.
 * `comments` is taken in the board's order, oldest first.
 */
export function specReviewComments(comments: readonly BoardComment[]): readonly BoardComment[] {
  return [...comments].reverse().filter((comment) => comment.body.includes(SPEC_REVIEW_MARKER));
}

/**
 * The sentence one ignored marker comment is reported with: which
 * comment, who wrote it, what GitHub said about their access, and that
 * it was left alone.
 *
 * The claim about access is `trustRefusalClause`'s, so this sentence and
 * the refusals `plan create` exits 2 with cannot come to disagree about
 * what a reading means.
 *
 * Throws a `TypeError` for a trusted reading, as the clause does: a
 * trusted comment is the one that gets edited and has nothing to report.
 */
export function ignoredReviewCommentMessage(
  comment: BoardComment,
  reading: TrustReading,
  repo: string,
): string {
  const who = `was written by ${reading.login}, ${trustRefusalClause(repo, reading)}`;
  return `the ${SPEC_REVIEW_COMMENT_NAME} comment ${comment.id} ${who};`
    + ' it was left alone and the gaps went in a comment of their own';
}

/**
 * The newest marker comment written by an author trusted with board
 * text, and every newer one that was passed over on the way to it.
 *
 * Answers a reading rather than throwing: an untrusted marker comment is
 * ignored and reported, never refused. See the module note for what a
 * planted one would take and why the walk does not stop at the first
 * untrusted comment.
 */
export async function readTrustedSpecReviewComment(
  comments: readonly BoardComment[],
  trust: BoardTrust,
): Promise<TrustedSpecReviewComment> {
  const trustOf = memoisedTrust(trust);
  const ignored: IgnoredSpecReviewComment[] = [];
  for (const comment of specReviewComments(comments)) {
    const reading = await trustOf(comment.author);
    if (reading.trusted) return { comment, ignored };
    ignored.push({
      id: comment.id,
      author: comment.author,
      reason: ignoredReviewCommentMessage(comment, reading, trust.repo),
    });
  }
  return { comment: null, ignored };
}

/**
 * Writes the spec-review comment: an EDIT of the newest marker comment
 * on the issue whose author is trusted, or a new comment when there is
 * none.
 *
 * One comment per issue with its history in its edits is the spec's
 * rule, so this never posts beside a marker comment it may edit. It
 * does post beside one it may NOT, and names it in the write's
 * `ignored`, for the caller to report.
 */
export async function writeSpecReviewComment(
  options: WriteSpecReviewCommentOptions,
): Promise<SpecReviewCommentWrite> {
  const { body, issue, board, trust } = options;
  const found = await readTrustedSpecReviewComment(await board.comments(issue), trust);
  const { comment: existing, ignored } = found;
  if (existing === null) {
    return { action: 'posted', comment: await board.comment(issue, body), ignored };
  }
  return { action: 'edited', comment: await board.editComment(existing.id, body), ignored };
}

/** A trust reading per login, memoised for one walk; see the module note. */
function memoisedTrust(trust: BoardTrust): (login: string) => Promise<TrustReading> {
  const read = new Map<string, Promise<TrustReading>>();
  return (login: string): Promise<TrustReading> => {
    const taken = read.get(login) ?? readBoardTrust(trust, login);
    read.set(login, taken);
    return taken;
  };
}
