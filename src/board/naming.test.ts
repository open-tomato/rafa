/**
 * Tests for the board naming convention (`src/board/naming.ts`): the
 * slug read off a title, and the spec path, the plan stub, the branch
 * and the pull-request title spelled from it.
 *
 * Every function here is pure, so there is no seam to plant and nothing
 * to isolate: each case is a title in and a string out. What that buys
 * in simplicity it loses in signal, because a string assertion passes
 * for the wrong reason easily — a slugger that dropped every rule and
 * answered `title.toLowerCase().replace(/\W+/g, '-')` still satisfies
 * the plainest case below. So each rule is asserted through a title
 * whose expected answer is only reachable WITH that rule, and paired
 * with a title that switches the rule off:
 *
 *  - the clause cut is asserted on a title whose second clause would
 *    otherwise reach the slug, and beside a list-shaped title where the
 *    cut is deliberately not taken;
 *  - the stop-word drop is asserted on a title whose stop words sit in
 *    the middle, where a leading-only drop would leave them, and beside
 *    a title that is nothing but stop words, which keeps them;
 *  - the leading-id strip is asserted beside a title that merely
 *    mentions a number, which keeps it;
 *  - each number refusal is asserted beside the same call with a valid
 *    number, which must answer.
 *
 * The cross-surface cases are the point of the module and not an extra:
 * `plan create --issue` writes the snapshot, `plan create --next` calls
 * a line taken by matching a branch, and `src/effort/attribution.ts`
 * matches a branch back to its plan, so the stub, the spec basename and
 * the branch tail must be one string. A case asserts they are, rather
 * than asserting each against a literal that could drift one at a time.
 *
 * Six mutations of `naming.ts` were driven against this file on
 * 2026-09-19, one at a time, the module restored from a scratch copy
 * and verified with `shasum -c` after each. 23 pass either side, and
 * each count below is that run's own:
 *
 *  - the clause cut taken unconditionally: 1 fail, the list-shaped
 *    title, which answers `plan` rather than `plan-review-merge`.
 *  - the clause cut dropped altogether: 6 fail, the qualified title,
 *    the three other clause breaks, and the stub, spec file, spec path
 *    and branch built on the qualified title.
 *  - the stop-word drop dropped: 4 fail, the plain title, the
 *    list-shaped one, the mid-title stop words, and the four-word cap
 *    case, which only reaches its fourth word once they go.
 *  - the stop-word drop applied unconditionally, with no fallback to
 *    the original words: 1 fail, the all-stop-words title, which
 *    answers `untitled`.
 *  - the leading-id strip dropped from both callers: 3 fail, the
 *    id-carrying titles and the two pull-request titles that strip the
 *    same prefix. The cross-surface case over the same title does NOT
 *    see it, because the doubled id lands in every spelling alike.
 *  - `requireIssueNumber` weakened to a `Number.isFinite` check: 3
 *    fail, the refusal case, the sentence over it, and the refusal
 *    asserted across the other four spellings.
 */
import { describe, expect, it } from 'bun:test';

import {
  boardId,
  BRANCH_PREFIX,
  branchName,
  FALLBACK_SLUG,
  ID_PREFIX,
  MAX_SLUG_WORDS,
  planStub,
  pullRequestTitle,
  slugFromTitle,
  specFileName,
  specPath,
} from './naming.js';

/** The issue every spelling case is about. */
const ISSUE = 20;

/** The title the four spellings are measured against, end to end. */
const TITLE = 'Pull request commands, the GitHub CLI as a declared dependency';

describe('slugFromTitle', () => {
  it('joins a plain title into hyphenated lower-case words', () => {
    expect(slugFromTitle('Merge the pull request')).toBe('merge-pull-request');
  });

  it('cuts a qualified title at its first clause', () => {
    expect(slugFromTitle(TITLE)).toBe('pull-request-commands');
  });

  it('keeps the whole title when the first clause is too short', () => {
    expect(slugFromTitle('Plan, review and merge')).toBe('plan-review-merge');
  });

  it('cuts at a dash, a colon and a bracket as well as a comma', () => {
    expect(slugFromTitle('Board setup - labels and templates')).toBe('board-setup');
    expect(slugFromTitle('Board setup: labels and templates')).toBe('board-setup');
    expect(slugFromTitle('Board setup (labels and templates)')).toBe('board-setup');
  });

  it('drops stop words from the middle of a title, not only the front', () => {
    expect(slugFromTitle('Plans from the board')).toBe('plans-board');
  });

  it('keeps stop words when a title is made of nothing else', () => {
    expect(slugFromTitle('As it is')).toBe('as-it-is');
  });

  it('keeps the first four words of a longer title', () => {
    const slug = slugFromTitle('Triage assesses a failing pull request and resolves it');

    expect(slug).toBe('triage-assesses-failing-pull');
    expect(slug.split('-')).toHaveLength(MAX_SLUG_WORDS);
  });

  it('drops an id the title already carries', () => {
    expect(slugFromTitle('rafa-20: pull request commands')).toBe('pull-request-commands');
    expect(slugFromTitle('#rafa-20 - pull request commands')).toBe('pull-request-commands');
  });

  it('keeps a number the title merely mentions', () => {
    expect(slugFromTitle('Retry 3 times before giving up')).toBe('retry-3-times-before');
  });

  it('answers the fallback for a title with no word character', () => {
    expect(slugFromTitle('  —  ')).toBe(FALLBACK_SLUG);
    expect(slugFromTitle('')).toBe(FALLBACK_SLUG);
  });
});

describe('boardId', () => {
  it('spells the issue number under the rafa prefix', () => {
    expect(boardId(ISSUE)).toBe('rafa-20');
    expect(boardId(ISSUE).startsWith(`${ID_PREFIX}-`)).toBe(true);
  });

  it('refuses a number that is not a positive integer', () => {
    expect(() => boardId(0)).toThrow(RangeError);
    expect(() => boardId(-1)).toThrow(RangeError);
    expect(() => boardId(1.5)).toThrow(RangeError);
    expect(() => boardId(Number.NaN)).toThrow(RangeError);
    expect(boardId(1)).toBe('rafa-1');
  });

  it('names the value it was handed in the refusal', () => {
    expect(() => boardId(-1)).toThrow('not -1');
  });
});

describe('the four spellings', () => {
  it('spells the plan stub as the id and the slug', () => {
    expect(planStub(ISSUE, TITLE)).toBe('rafa-20-pull-request-commands');
  });

  it('spells the spec file as the stub under .md', () => {
    expect(specFileName(ISSUE, TITLE)).toBe('rafa-20-pull-request-commands.md');
  });

  it('spells the spec path under the specs directory it is given', () => {
    expect(specPath('.specs', ISSUE, TITLE))
      .toBe('.specs/rafa-20-pull-request-commands.md');
    expect(specPath('/tmp/proj/.rafa/specs', ISSUE, TITLE))
      .toBe('/tmp/proj/.rafa/specs/rafa-20-pull-request-commands.md');
  });

  it('spells the branch as the stub under the feat prefix', () => {
    expect(branchName(ISSUE, TITLE)).toBe('feat/rafa-20-pull-request-commands');
    expect(branchName(ISSUE, TITLE).startsWith(`${BRANCH_PREFIX}/`)).toBe(true);
  });

  it('spells the pull-request title as the id and the whole title', () => {
    expect(pullRequestTitle(ISSUE, TITLE)).toBe(`rafa-20: ${TITLE}`);
  });

  it('does not repeat an id the pull-request title already carries', () => {
    expect(pullRequestTitle(ISSUE, 'rafa-20: Pull request commands'))
      .toBe('rafa-20: Pull request commands');
  });

  it('answers the id alone when the title is nothing but the id', () => {
    expect(pullRequestTitle(ISSUE, 'rafa-20')).toBe('rafa-20');
  });

  it('refuses a number that is not a positive integer, in every spelling', () => {
    expect(() => planStub(0, TITLE)).toThrow(RangeError);
    expect(() => specFileName(0, TITLE)).toThrow(RangeError);
    expect(() => specPath('.specs', 0, TITLE)).toThrow(RangeError);
    expect(() => branchName(0, TITLE)).toThrow(RangeError);
    expect(() => pullRequestTitle(0, TITLE)).toThrow(RangeError);
  });
});

describe('the spellings agree with one another', () => {
  const titles = [
    TITLE,
    'Plan, review and merge',
    'As it is',
    '  —  ',
    'rafa-20: pull request commands',
  ];

  it('carries the stub whole in the spec file, the spec path and the branch', () => {
    for (const title of titles) {
      const stub = planStub(ISSUE, title);

      expect(specFileName(ISSUE, title)).toBe(`${stub}.md`);
      expect(specPath('.specs', ISSUE, title)).toBe(`.specs/${stub}.md`);
      expect(branchName(ISSUE, title)).toBe(`feat/${stub}`);
      expect(pullRequestTitle(ISSUE, title).startsWith(`${boardId(ISSUE)}`)).toBe(true);
    }
  });

  it('spells a stub a branch name and a path can both carry', () => {
    for (const title of titles) {
      expect(planStub(ISSUE, title)).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });
});
