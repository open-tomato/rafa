/**
 * Tests for the word matching over cause codes: what `suggestCodes`
 * ranks and leaves out, filler words and the shared-word floor
 * included, what `suggestWithProposals` ranks beside the list's codes,
 * and which leaves `nearDuplicates` pairs.
 */
import type { IssueRef } from '@open-tomato/rafa/ports';

import { describe, expect, it } from 'bun:test';

import { defineErrorCodes } from '@open-tomato/rafa/errors/codes';

import { nearDuplicates, suggestCodes, suggestWithProposals } from './match.js';

const LIST = defineErrorCodes([
  { code: 'git:no-identity', description: 'a git commit runs with no author identity set', hint: 'set user.name and user.email', level: 'error', since: '#949' },
  { code: 'git:filesystem-boundary', description: 'git prints an extra line when run outside a repository', hint: 'run inside a repository', level: 'warn', since: '#949' },
  { code: 'tsc:tests-excluded', description: 'type errors in test files stay hidden because tsc excludes tests', hint: 'type-check the test files', level: 'error', since: '#949' },
]);

describe('suggestCodes', () => {
  it('ranks the code sharing most of the text first', () => {
    const ranked = suggestCodes('git commit has no author identity', LIST);
    expect(ranked[0]?.code).toBe('git:no-identity');
  });

  it('leaves out entries sharing no word', () => {
    expect(suggestCodes('quantum flux', LIST)).toEqual([]);
  });

  it('leaves out an entry sharing only filler words', () => {
    expect(suggestCodes('a', LIST)).toEqual([]);
    expect(suggestCodes('the set is in an extra line', [LIST[0] as (typeof LIST)[number]])).toEqual([]);
  });

  it('leaves out an entry sharing one word with a text of three or more', () => {
    expect(suggestCodes('docker build runs out of memory', LIST)).toEqual([]);
  });

  it('keeps an entry sharing the one word a one-word text holds', () => {
    expect(suggestCodes('tsc', LIST).map((row) => row.code)).toEqual(['tsc:tests-excluded']);
  });

  it('answers at most the limit', () => {
    expect(suggestCodes('git', LIST, 1)).toHaveLength(1);
  });

  it('answers issue null and proposal false on every row', () => {
    const ranked = suggestCodes('git', LIST);
    expect(ranked.length).toBeGreaterThan(1);
    expect(ranked.map((row) => [row.issue, row.proposal])).toEqual(ranked.map(() => [null, false]));
  });
});

/** A GitHub issue reference numbered `id`. */
function refOf(id: number): IssueRef {
  return { opt: id, kind: 'github', externalId: String(id), url: null };
}

describe('suggestWithProposals', () => {
  it('ranks a proposal on its leaf words, naming the bug that proposed it', () => {
    const proposals = [{ code: 'git:branch-not-found', title: 'the loop stops early', issue: refOf(7) }];
    const ranked = suggestWithProposals('branch not found', LIST, proposals);
    expect(ranked).toEqual([{ code: 'git:branch-not-found', score: 1, proposal: true, issue: refOf(7) }]);
  });

  it('ranks the list codes beside a proposal, each with issue null', () => {
    const proposals = [{ code: 'git:branch-not-found', title: 'checkout fails', issue: refOf(7) }];
    const ranked = suggestWithProposals('git', LIST, proposals);
    expect(ranked.map((row) => [row.code, row.issue])).toEqual([
      ['git:branch-not-found', refOf(7)],
      ['git:no-identity', null],
      ['git:filesystem-boundary', null],
    ]);
  });

  it('leaves out a proposal that is already a code of the list', () => {
    const proposals = [{ code: 'git:no-identity', title: 'git commit has no author identity', issue: refOf(7) }];
    const ranked = suggestWithProposals('git commit has no author identity', LIST, proposals);
    expect(ranked.map((row) => [row.code, row.proposal, row.issue])).toEqual([['git:no-identity', false, null]]);
  });

  it('lists a code two bugs proposed once, naming the first', () => {
    const proposals = [
      { code: 'git:branch-not-found', title: 'checkout fails', issue: refOf(7) },
      { code: 'git:branch-not-found', title: 'branch not found on push', issue: refOf(9) },
    ];
    const ranked = suggestWithProposals('branch not found', LIST, proposals);
    expect(ranked).toEqual([{ code: 'git:branch-not-found', score: 1, proposal: true, issue: refOf(7) }]);
  });

  it('applies the shared-word floor to a proposal', () => {
    const proposals = [{ code: 'docker:out-of-memory', title: 'the build stops', issue: refOf(7) }];
    expect(suggestWithProposals('docker image pull fails', LIST, proposals)).toEqual([]);
  });

  it('cuts the ranked list at the limit', () => {
    const proposals = [{ code: 'git:branch-not-found', title: 'checkout fails', issue: refOf(7) }];
    expect(suggestWithProposals('git', LIST, proposals, 2)).toHaveLength(2);
  });
});

describe('nearDuplicates', () => {
  it('finds two leaves of one family that read alike', () => {
    const list = defineErrorCodes([
      ...LIST,
      { code: 'git:no-author', description: 'a git commit runs with no author identity set', hint: 'set the author', level: 'error', since: '#949' },
    ]);
    expect(nearDuplicates(list).map((pair) => [pair.first, pair.second])).toEqual([['git:no-identity', 'git:no-author']]);
  });

  it('finds a leaf whose description says the same in fewer words', () => {
    const list = defineErrorCodes([
      { code: 'git:no-identity', description: 'a git commit runs with no author identity set, often in a scratch home', hint: 'set user.name and user.email', level: 'error', since: '#949' },
      { code: 'git:no-author', description: 'git commit has no author identity', hint: 'set the author', level: 'error', since: '#949' },
    ]);
    expect(nearDuplicates(list).map((pair) => [pair.first, pair.second])).toEqual([['git:no-identity', 'git:no-author']]);
  });

  it('does not find a leaf that names the same cause in other words', () => {
    const list = defineErrorCodes([
      ...LIST,
      { code: 'git:no-author', description: 'the commit author is missing in the test home', hint: 'set the author', level: 'error', since: '#949' },
    ]);
    expect(nearDuplicates(list)).toEqual([]);
  });

  it('never pairs codes of two families', () => {
    expect(nearDuplicates(LIST)).toEqual([]);
  });
});
