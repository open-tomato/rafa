/**
 * Tests for the spec-review comment (`src/board/review-comment.ts`):
 * the body a gap list makes, which marker comment a rerun may edit once
 * its author has been read through `./trust.ts`, and the two writes.
 *
 * The board is a fake holding comments in memory and recording every
 * call, and the trust is a fake permission lookup counting the logins it
 * was asked about, so no case spawns `gh`. The body is a pure function
 * and is driven from literals.
 *
 * Two readings here could pass while wrong, and each has a case that
 * would have caught it:
 *
 *   - The EDIT. A writer that posted every time would satisfy every case
 *     asserting a comment came back, so each write case asserts the CALL
 *     the board took and the edit case asserts that no second comment
 *     was posted.
 *   - The IGNORING. A reader that spent the trust reading and then
 *     edited the comment anyway would answer the same `ignored` list, so
 *     the planted-comment case asserts that the board was asked to
 *     `comment` and never to `editComment` on the planted id.
 *
 * One mutation of `review-comment.ts` was driven on 2026-09-19 over
 * `env -u CLAUDECODE bun test src/board/ src/plan.test.ts`, the module
 * restored from a scratch copy and verified with `shasum -c`: a writer
 * that posts whatever it found left 194 pass and 3 fail against 197
 * pass either side — the edit case here and the rerun case in
 * `gate.test.ts`. A second was driven on 2026-09-21 for the trust
 * filter, and is recorded beside the case it reddened.
 */
import type { BoardComment, IssueBoard } from './issue-board.js';
import type { SpecReviewGap } from './spec-review.js';
import type { BoardTrust, PermissionReading, TrustReading } from './trust.js';

import { describe, expect, it } from 'bun:test';

import {
  COMMENT_REMEDY,
  ignoredReviewCommentMessage,
  readTrustedSpecReviewComment,
  SPEC_REVIEW_COMMENT_NAME,
  SPEC_REVIEW_MARKER,
  specReviewCommentBody,
  specReviewComments,
  writeSpecReviewComment,
} from './review-comment.js';

/** Two gaps, as the planner's review names them. */
const GAPS: readonly SpecReviewGap[] = [
  { heading: 'Definition of done', what: 'no item says how the merge clean-up is verified' },
  { heading: 'Tasks the plan must carry', what: 'the third task does not name what it changes' },
];

/** What a refusal calls the repository in these cases. */
const REPO = 'open-tomato/rafa';

/** What a failed lookup wrote, as a reading carries it. */
const LOOKUP_FAILURE = 'gh api repos/{owner}/{repo}/collaborators/octocat/permission failed: HTTP 401';

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

/** What the fake lookup answers for one login: a permission, or a failure. */
function readingFor(login: string, answer: string | null): PermissionReading {
  return answer === null
    ? { login, permission: null, roleName: null, detail: LOOKUP_FAILURE }
    : { login, permission: answer, roleName: answer, detail: '' };
}

/**
 * A trust whose lookup answers `access` per login — `null` for a lookup
 * that failed, `read` for a login it does not name — counting every
 * login it was asked about.
 */
function fakeTrust(
  access: ReadonlyMap<string, string | null>,
  trustedAuthors: readonly string[] = [],
): { trust: BoardTrust; looked: readonly string[] } {
  const looked: string[] = [];
  const trust: BoardTrust = {
    permissions: (login) => {
      looked.push(login);
      const answer = access.has(login)
        ? access.get(login) ?? null
        : 'read';
      return Promise.resolve(readingFor(login, answer));
    },
    trustedAuthors,
    repo: REPO,
  };
  return { trust, looked };
}

/** A marker comment by `author`, as the board answers one. */
function marker(id: string, author: string): BoardComment {
  return { id, body: `${SPEC_REVIEW_MARKER}\ngaps from ${author}`, author };
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

describe('specReviewComments', () => {
  it('answers the marker comments newest first, and none of the others', () => {
    const older = marker('1', 'rafa-bot');
    const plain: BoardComment = { id: '2', body: 'a person replying', author: 'octocat' };
    const newer = marker('3', 'rafa-bot');

    expect(specReviewComments([older, plain, newer])).toEqual([newer, older]);
    expect(specReviewComments([plain])).toEqual([]);
    expect(specReviewComments([])).toEqual([]);
  });
});

describe('ignoredReviewCommentMessage', () => {
  it('names the comment, its author and what GitHub said about their access', async () => {
    const { trust } = fakeTrust(new Map([['octocat', 'read']]));
    const found = await readTrustedSpecReviewComment([marker('7', 'octocat')], trust);
    const [ignored] = found.ignored;

    expect(ignored?.reason).toBe(
      `the ${SPEC_REVIEW_COMMENT_NAME} comment 7 was written by octocat,`
        + ` who has no write access to ${REPO};`
        + ' it was left alone and the gaps went in a comment of their own',
    );
  });

  it('refuses to report a trusted reading, which has nothing to report', () => {
    const reading: TrustReading = {
      login: 'maintainer',
      trusted: true,
      source: 'allow-list',
      refusal: null,
      permission: null,
    };

    expect(() => ignoredReviewCommentMessage(marker('7', 'maintainer'), reading, REPO)).toThrow(TypeError);
  });
});

describe('readTrustedSpecReviewComment', () => {
  it('answers the newest marker comment when a write-holder wrote it', async () => {
    const { trust, looked } = fakeTrust(new Map([['rafa-bot', 'write']]));
    const newest = marker('3', 'rafa-bot');

    const found = await readTrustedSpecReviewComment([marker('1', 'rafa-bot'), newest], trust);

    expect(found).toEqual({ comment: newest, ignored: [] });
    expect(looked).toEqual(['rafa-bot']);
  });

  it('spends no lookup on a login in board.trustedAuthors', async () => {
    const { trust, looked } = fakeTrust(new Map(), ['Rafa-Bot']);

    const found = await readTrustedSpecReviewComment([marker('3', 'rafa-bot')], trust);

    expect(found.comment?.id).toBe('3');
    expect(looked).toEqual([]);
  });

  it('passes over a planted marker comment and answers rafa own one under it', async () => {
    const { trust } = fakeTrust(new Map([['rafa-bot', 'write'], ['stranger', 'read']]));
    const ours = marker('1', 'rafa-bot');

    const found = await readTrustedSpecReviewComment([ours, marker('2', 'stranger')], trust);

    expect(found.comment).toBe(ours);
    expect(found.ignored.map((passed) => passed.id)).toEqual(['2']);
    expect(found.ignored[0]?.author).toBe('stranger');
  });

  it('answers no comment when every marker comment is one the reading refuses', async () => {
    const { trust } = fakeTrust(new Map([['stranger', 'read']]));

    const found = await readTrustedSpecReviewComment([marker('1', 'stranger'), marker('2', 'stranger')], trust);

    expect(found.comment).toBeNull();
    expect(found.ignored.map((passed) => passed.id)).toEqual(['2', '1']);
  });

  it('ignores a comment whose lookup failed, and says so rather than naming access', async () => {
    const { trust } = fakeTrust(new Map([['octocat', null]]));

    const found = await readTrustedSpecReviewComment([marker('1', 'octocat')], trust);

    expect(found.comment).toBeNull();
    expect(found.ignored[0]?.reason).toContain(`could not be read (${LOOKUP_FAILURE})`);
    expect(found.ignored[0]?.reason).not.toContain('has no write access');
  });

  it('spends one lookup per login, not one per comment', async () => {
    const { trust, looked } = fakeTrust(new Map([['stranger', 'read']]));

    await readTrustedSpecReviewComment(
      [marker('1', 'stranger'), marker('2', 'stranger'), marker('3', 'stranger')],
      trust,
    );

    expect(looked).toEqual(['stranger']);
  });
});

describe('writeSpecReviewComment', () => {
  it('posts one comment when the issue carries no marker comment', async () => {
    const { board, calls } = fakeBoard([{ id: '1', body: 'a person replying', author: 'octocat' }]);
    const { trust } = fakeTrust(new Map());

    const write = await writeSpecReviewComment({ issue: 7, body: 'the gaps', board, trust });

    expect(write.action).toBe('posted');
    expect(write.ignored).toEqual([]);
    expect(calls).toEqual([
      { member: 'comments', args: [7] },
      { member: 'comment', args: [7, 'the gaps'] },
    ]);
  });

  it('edits the trusted marker comment that is there, and posts nothing beside it', async () => {
    const { board, calls } = fakeBoard([marker('42', 'rafa-bot')]);
    const { trust } = fakeTrust(new Map([['rafa-bot', 'admin']]));

    const write = await writeSpecReviewComment({ issue: 7, body: 'the new gaps', board, trust });

    expect(write).toEqual({
      action: 'edited',
      comment: { id: '42', body: 'the new gaps', author: 'rafa-bot' },
      ignored: [],
    });
    expect(calls).toEqual([
      { member: 'comments', args: [7] },
      { member: 'editComment', args: ['42', 'the new gaps'] },
    ]);
  });

  /**
   * The mutation driven on 2026-09-21 over `bun test src/board/`, the
   * module restored from a scratch copy and verified with `shasum -c`:
   * `readTrustedSpecReviewComment` made to answer
   * `specReviewComments(comments)[0] ?? null` with an empty `ignored`,
   * which is the reader as it stood before the trust filter. 431 pass
   * and 7 fail against 438 pass and 0 fail either side — this case,
   * every case in the `readTrustedSpecReviewComment` block but the
   * allow-list one, and the message case. This one is the reading that
   * would otherwise have passed while wrong: the mutant EDITS the
   * planted comment 42 where a post beside it is asserted.
   */
  it('posts beside a marker comment the reading refuses, and never edits it', async () => {
    const { board, calls } = fakeBoard([marker('42', 'stranger')]);
    const { trust } = fakeTrust(new Map([['stranger', 'read']]));

    const write = await writeSpecReviewComment({ issue: 7, body: 'the gaps', board, trust });

    expect(write.action).toBe('posted');
    expect(write.ignored.map((passed) => passed.id)).toEqual(['42']);
    expect(calls).toEqual([
      { member: 'comments', args: [7] },
      { member: 'comment', args: [7, 'the gaps'] },
    ]);
  });
});
