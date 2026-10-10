/**
 * Tests for the word matching over cause codes: what `suggestCodes`
 * ranks and leaves out, filler words and the shared-word floor
 * included, and which leaves `nearDuplicates` pairs.
 */
import { describe, expect, it } from 'bun:test';

import { defineErrorCodes } from './codes.js';
import { nearDuplicates, suggestCodes } from './match.js';

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
