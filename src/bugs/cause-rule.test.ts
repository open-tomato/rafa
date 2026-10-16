import type { ErrorCodeEntry } from '../errors/codes.js';

import { describe, expect, test } from 'bun:test';

import { GITHUB_LABEL_MAX_LENGTH, GITHUB_LABELS } from '../adapters/tracker/github.js';
import { listedCodes } from '../errors/rafa-codes.js';

import { causeOf } from './cause-rule.js';

/** A project entry for `code`, the other fields filled. */
function projectEntry(code: string): ErrorCodeEntry {
  return { code, description: 'a project context', hint: 'read it', level: 'error' };
}

/** `family:` and a leaf of `a`s, `length` characters in all. */
function codeOfLength(family: string, length: number): string {
  return `${family}:${'a'.repeat(length - family.length - 1)}`;
}

/** The longest code whose `cause:` label GitHub accepts. */
const LONGEST_CODE = GITHUB_LABEL_MAX_LENGTH - GITHUB_LABELS.causePrefix.length;

const CODES = listedCodes([projectEntry('deploy:missing-secret')]);

describe('causeOf', () => {
  test('a null cause is unknown:new-context, with no proposal and no suspected text', () => {
    expect(causeOf(null, CODES)).toEqual({ cause: 'unknown:new-context', proposed: null, suspected: null });
  });

  test('a blank cause is unknown:new-context, with no proposal and no suspected text', () => {
    expect(causeOf('  \t ', CODES)).toEqual({ cause: 'unknown:new-context', proposed: null, suspected: null });
  });

  test('a code of the list is used as written, rafa\'s and the project\'s alike', () => {
    expect(causeOf('git:no-identity', CODES)).toEqual({ cause: 'git:no-identity', proposed: null, suspected: null });
    expect(causeOf(' deploy:missing-secret ', CODES))
      .toEqual({ cause: 'deploy:missing-secret', proposed: null, suspected: null });
  });

  test('a reserved code the list holds is used as written', () => {
    expect(causeOf('git:new-context', CODES)).toEqual({ cause: 'git:new-context', proposed: null, suspected: null });
    expect(causeOf('unknown:new-context', CODES))
      .toEqual({ cause: 'unknown:new-context', proposed: null, suspected: null });
  });

  test('a listed family with a leaf it lacks is <family>:new-context, the code proposed', () => {
    expect(causeOf('git:detached-head-push', CODES))
      .toEqual({ cause: 'git:new-context', proposed: 'git:detached-head-push', suspected: null });
  });

  test('a family the list lacks is unknown:new-context, the code proposed', () => {
    expect(causeOf('helm:chart-missing', CODES))
      .toEqual({ cause: 'unknown:new-context', proposed: 'helm:chart-missing', suspected: null });
  });

  test('a code whose cause: label would pass 50 characters is <family>:new-context, the code proposed', () => {
    const tooLong = codeOfLength('git', LONGEST_CODE + 1);
    expect(`${GITHUB_LABELS.causePrefix}${tooLong}`.length).toBe(51);
    expect(causeOf(tooLong, CODES)).toEqual({ cause: 'git:new-context', proposed: tooLong, suspected: null });
  });

  test('a listed code whose label would pass the cap is still <family>:new-context, the code proposed', () => {
    const tooLong = codeOfLength('deploy', LONGEST_CODE + 1);
    const codes = listedCodes([projectEntry(tooLong)]);
    expect(causeOf(tooLong, codes)).toEqual({ cause: 'deploy:new-context', proposed: tooLong, suspected: null });
  });

  test('a listed code whose label is exactly 50 characters is used as written', () => {
    const longest = codeOfLength('deploy', LONGEST_CODE);
    expect(`${GITHUB_LABELS.causePrefix}${longest}`.length).toBe(50);
    expect(causeOf(longest, listedCodes([projectEntry(longest)])))
      .toEqual({ cause: longest, proposed: null, suspected: null });
  });

  test('a too-long code whose family\'s own new-context label would pass the cap is unknown:new-context', () => {
    const family = 'f'.repeat(LONGEST_CODE);
    const tooLong = `${family}:leaf`;
    expect(causeOf(tooLong, CODES)).toEqual({ cause: 'unknown:new-context', proposed: tooLong, suspected: null });
  });

  test('anything else is unknown:new-context, the trimmed text suspected', () => {
    expect(causeOf('  the lockfile was stale\n', CODES))
      .toEqual({ cause: 'unknown:new-context', proposed: null, suspected: 'the lockfile was stale' });
    expect(causeOf('Git:No-Identity', CODES))
      .toEqual({ cause: 'unknown:new-context', proposed: null, suspected: 'Git:No-Identity' });
  });

  test('a shaped code no list could declare is suspected, never proposed', () => {
    expect(causeOf('helm:new-context', CODES))
      .toEqual({ cause: 'unknown:new-context', proposed: null, suspected: 'helm:new-context' });
    expect(causeOf('unknown:stale-lock', CODES))
      .toEqual({ cause: 'unknown:new-context', proposed: null, suspected: 'unknown:stale-lock' });
  });
});
