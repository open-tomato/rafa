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

  it('never pairs codes of two families', () => {
    expect(nearDuplicates(LIST)).toEqual([]);
  });
});
