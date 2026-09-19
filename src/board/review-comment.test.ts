/**
 * Tests for the spec-review comment (`src/board/review-comment.ts`):
 * the body a gap list makes, which comment a rerun edits, and the two
 * writes.
 *
 * The board is a fake holding comments in memory and recording every
 * call, so no case spawns `gh`. The body is a pure function and is
 * driven from literals.
 *
 * The one reading that could pass while wrong is the edit: a writer
 * that posted every time would satisfy every case asserting a comment
 * came back. So each write case asserts the CALL the board took, not
 * only the comment it answered, and the edit case asserts that no
 * second comment was posted.
 *
 * One mutation of `review-comment.ts` was driven on 2026-09-19 over
 * `env -u CLAUDECODE bun test src/board/ src/plan.test.ts`, the module
 * restored from a scratch copy and verified with `shasum -c`: a writer
 * that posts whatever it found left 194 pass and 3 fail against 197
 * pass either side — the edit case and the pre-read case here, and the
 * rerun case in `gate.test.ts`.
 */
import type { BoardComment, IssueBoard } from './issue-board.js';
import type { SpecReviewGap } from './spec-review.js';

import { describe, expect, it } from 'bun:test';

import {
  COMMENT_REMEDY,
  findSpecReviewComment,
  SPEC_REVIEW_MARKER,
  specReviewCommentBody,
  writeSpecReviewComment,
} from './review-comment.js';

/** Two gaps, as the planner's review names them. */
const GAPS: readonly SpecReviewGap[] = [
  { heading: 'Definition of done', what: 'no item says how the merge clean-up is verified' },
  { heading: 'Tasks the plan must carry', what: 'the third task does not name what it changes' },
];

/** One call the fake board took. */
interface BoardCall {
  readonly member: string;
  readonly args: readonly unknown[];
}

/** A board over `held`, recording every call; nothing here reaches `gh`. */
function fakeBoard(held: readonly BoardComment[] = []): { board: IssueBoard; calls: readonly BoardCall[] } {
  const calls: BoardCall[] = [];
  const answer = (id: string, body: string): BoardComment => ({ id, body, author: 'rafa-bot' });
  const board: IssueBoard = {
    comments: (issue) => {
      calls.push({ member: 'comments', args: [issue] });
      return Promise.resolve(held);
    },
    comment: (issue, body) => {
      calls.push({ member: 'comment', args: [issue, body] });
      return Promise.resolve(answer('99', body));
    },
    editComment: (id, body) => {
      calls.push({ member: 'editComment', args: [id, body] });
      return Promise.resolve(answer(id, body));
    },
    swapLabels: (issue, removed, added) => {
      calls.push({ member: 'swapLabels', args: [issue, removed, added] });
      return Promise.resolve();
    },
  };
  return { board, calls };
}

describe('specReviewCommentBody', () => {
  it('opens with the marker and carries one list item per gap, then the remedy', () => {
    const body = specReviewCommentBody(GAPS);

    expect(body.startsWith(`${SPEC_REVIEW_MARKER}\n`)).toBe(true);
    expect(body).toContain('found 2 gaps');
    expect(body).toContain('- **Definition of done** — no item says how the merge clean-up is verified');
    expect(body).toContain('- **Tasks the plan must carry** — the third task does not name what it changes');
    expect(body).toContain(COMMENT_REMEDY);
  });

  it('counts one gap as one', () => {
    const one: SpecReviewGap = { heading: 'the review', what: 'the review block was not returned' };

    expect(specReviewCommentBody([one])).toContain('found 1 gap.');
  });

  it('collapses a sentence a model wrote over several lines onto its list item', () => {
    const folded: SpecReviewGap = { heading: 'Design\n', what: 'the store\nis  not named\n' };

    const body = specReviewCommentBody([folded]);

    expect(body).toContain('- **Design** — the store is not named\n');
    expect(body.split('\n').filter((line) => line.startsWith('- '))).toHaveLength(1);
  });

  it('refuses to write a comment naming no gap', () => {
    expect(() => specReviewCommentBody([])).toThrow(TypeError);
  });
});

describe('findSpecReviewComment', () => {
  it('answers the newest marker comment, and null when none carries the marker', () => {
    const older: BoardComment = { id: '1', body: `${SPEC_REVIEW_MARKER}\nold gaps`, author: 'rafa-bot' };
    const plain: BoardComment = { id: '2', body: 'a person replying', author: 'octocat' };
    const newer: BoardComment = { id: '3', body: `${SPEC_REVIEW_MARKER}\nnew gaps`, author: 'rafa-bot' };

    expect(findSpecReviewComment([older, plain, newer])).toBe(newer);
    expect(findSpecReviewComment([plain])).toBeNull();
    expect(findSpecReviewComment([])).toBeNull();
  });
});

describe('writeSpecReviewComment', () => {
  it('posts one comment when the issue carries no marker comment', async () => {
    const { board, calls } = fakeBoard([{ id: '1', body: 'a person replying', author: 'octocat' }]);

    const write = await writeSpecReviewComment({ issue: 7, body: 'the gaps', board });

    expect(write.action).toBe('posted');
    expect(calls).toEqual([
      { member: 'comments', args: [7] },
      { member: 'comment', args: [7, 'the gaps'] },
    ]);
  });

  it('edits the marker comment that is there, and posts nothing beside it', async () => {
    const marker: BoardComment = { id: '42', body: `${SPEC_REVIEW_MARKER}\nold gaps`, author: 'rafa-bot' };
    const { board, calls } = fakeBoard([marker]);

    const write = await writeSpecReviewComment({ issue: 7, body: 'the new gaps', board });

    expect(write).toEqual({ action: 'edited', comment: { id: '42', body: 'the new gaps', author: 'rafa-bot' } });
    expect(calls).toEqual([
      { member: 'comments', args: [7] },
      { member: 'editComment', args: ['42', 'the new gaps'] },
    ]);
  });

  it('spends no read when the caller has already found the comment, or found none', async () => {
    const marker: BoardComment = { id: '42', body: SPEC_REVIEW_MARKER, author: 'rafa-bot' };
    const found = fakeBoard();
    const none = fakeBoard();

    await writeSpecReviewComment({ issue: 7, body: 'x', board: found.board, existing: marker });
    await writeSpecReviewComment({ issue: 7, body: 'x', board: none.board, existing: null });

    expect(found.calls).toEqual([{ member: 'editComment', args: ['42', 'x'] }]);
    expect(none.calls).toEqual([{ member: 'comment', args: [7, 'x'] }]);
  });
});
