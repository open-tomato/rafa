/**
 * Tests for the closing-references reader (`src/pr/gh-closing-issues.ts`).
 *
 * The references below are the ones recorded on 2026-10-05 off `gh`
 * 2.102.0, copied verbatim, so a reader that drifts from what `gh`
 * writes reddens a case here rather than a pull request read in the
 * field. Each malformed case changes exactly one key of the recorded
 * same-repository reference, and the recorded reference itself is read
 * cleanly in its own case, so a refusal can only come from the key that
 * changed.
 */
import { describe, expect, it } from 'bun:test';

import { CLOSING_ISSUES_FIELD, readClosingIssues } from './gh-closing-issues.js';

/** The command a refusal names. */
const COMMAND = 'gh pr view 7';

/** Where the list sits, as `./gh.ts` names it. */
const WHERE = 'the pull request.closingIssuesReferences';

/** `cli/cli#14540`'s one reference, to an issue of its own repository. */
const SAME_REPOSITORY: Readonly<Record<string, unknown>> = Object.freeze({
  id: 'I_kwDODKw3uc8AAAABTRXg1w',
  number: 14521,
  repository: {
    id: 'MDEwOlJlcG9zaXRvcnkyMTI2MTMwNDk=',
    name: 'cli',
    owner: { id: 'MDEyOk9yZ2FuaXphdGlvbjU5NzA0NzEx', login: 'cli' },
  },
  url: 'https://github.com/cli/cli/issues/14521',
});

/** The first reference of `GoogleCloudPlatform/scion#2453`, to an issue of the fork `ptone/scion`. */
const OTHER_REPOSITORY: Readonly<Record<string, unknown>> = Object.freeze({
  id: 'I_kwDORvdnm88AAAABLMvdRA',
  number: 765,
  repository: {
    id: 'R_kgDORvdnmw',
    name: 'scion',
    owner: { id: 'MDQ6VXNlcjQwODQ1', login: 'ptone' },
  },
  url: 'https://github.com/ptone/scion/issues/765',
});

/** The recorded same-repository reference with its repository's `owner` replaced. */
function withOwner(owner: unknown): Record<string, unknown> {
  const repository = SAME_REPOSITORY['repository'] as Record<string, unknown>;
  return { ...SAME_REPOSITORY, repository: { ...repository, owner } };
}

/** The recorded same-repository reference with its repository's `name` replaced. */
function withName(name: unknown): Record<string, unknown> {
  const repository = SAME_REPOSITORY['repository'] as Record<string, unknown>;
  return { ...SAME_REPOSITORY, repository: { ...repository, name } };
}

describe('CLOSING_ISSUES_FIELD', () => {
  it('is the --json field gh writes the references under', () => {
    expect(CLOSING_ISSUES_FIELD).toBe('closingIssuesReferences');
  });
});

describe('readClosingIssues', () => {
  it('reads the empty list cli/cli#14354 wrote as no issues', () => {
    expect(readClosingIssues([], COMMAND, WHERE)).toEqual([]);
  });

  it('reads a reference to the pull request\'s own repository as its number, owner/name and URL', () => {
    expect(readClosingIssues([SAME_REPOSITORY], COMMAND, WHERE)).toEqual([
      { number: 14521, repository: 'cli/cli', url: 'https://github.com/cli/cli/issues/14521' },
    ]);
  });

  it('reads a reference to another repository under that repository, not the pull request\'s', () => {
    expect(readClosingIssues([OTHER_REPOSITORY], COMMAND, WHERE)).toEqual([
      { number: 765, repository: 'ptone/scion', url: 'https://github.com/ptone/scion/issues/765' },
    ]);
  });

  it('keeps the order written, and the repository each reference names, across both kinds', () => {
    const read = readClosingIssues([OTHER_REPOSITORY, SAME_REPOSITORY], COMMAND, WHERE);

    expect(read.map((issue) => `${issue.repository}#${String(issue.number)}`)).toEqual(['ptone/scion#765', 'cli/cli#14521']);
  });

  it.each([
    ['null', null, 'is null, expected a list'],
    ['a mapping', {}, 'is a mapping, expected a list'],
    ['missing', undefined, 'is undefined, expected a list'],
  ])('refuses a value that is %s rather than a list', (_label, value, problem) => {
    expect(() => readClosingIssues(value, COMMAND, WHERE)).toThrow(
      `gh pull requests: gh pr view 7 answered ${WHERE} ${problem}`,
    );
  });

  it.each([
    ['an entry that is not a mapping', 'cli/cli#14521', '[0] is "cli/cli#14521", expected a mapping'],
    ['a number written as a string', { ...SAME_REPOSITORY, number: '14521' }, '[0].number is "14521", expected a positive whole number'],
    ['a number of zero', { ...SAME_REPOSITORY, number: 0 }, '[0].number is 0, expected a positive whole number'],
    ['no repository', { ...SAME_REPOSITORY, repository: undefined }, '[0].repository is undefined, expected a mapping'],
    ['no owner', withOwner(null), '[0].repository.owner is null, expected a mapping'],
    ['an owner with no login', withOwner({ id: 'MDEy' }), '[0].repository.owner.login is undefined, expected a string'],
    ['an empty login', withOwner({ id: 'MDEy', login: '' }), '[0].repository.owner.login is an empty string, expected a name'],
    ['an empty repository name', withName(''), '[0].repository.name is an empty string, expected a name'],
    ['a url that is not a string', { ...SAME_REPOSITORY, url: null }, '[0].url is null, expected a string'],
  ])('refuses %s, naming the key, rather than dropping the entry', (_label, entry, problem) => {
    expect(() => readClosingIssues([entry], COMMAND, WHERE)).toThrow(
      `gh pull requests: gh pr view 7 answered ${WHERE}${problem}`,
    );
  });

  it('refuses a malformed entry after a well-formed one, so the list is never answered short', () => {
    expect(() => readClosingIssues([SAME_REPOSITORY, { ...OTHER_REPOSITORY, number: null }], COMMAND, WHERE)).toThrow(
      `${WHERE}[1].number is null`,
    );
  });
});
