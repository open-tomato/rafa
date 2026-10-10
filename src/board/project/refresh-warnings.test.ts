/**
 * Tests for the refresh's warning lines (`refresh-warnings.ts`): each of
 * the four lines of "What can go wrong" names its fix, the not-refreshed
 * line and the added-but-not-filled line each name the issue and the
 * reason, and the scope reading tells the `project` scope apart from
 * other refusals. The scope refusals here are GitHub's documented
 * wording, NOT readings; see the module note there.
 */
import type { FieldMismatch } from './port.js';

import { describe, expect, it } from 'bun:test';

import { matchProjectFields, ProjectPortError } from './port.js';
import {
  addedNotFilledWarning,
  BOARD_SYNC_FIX,
  DOCTOR_FIX,
  INIT_BOARD_FIX,
  isMissingProjectScope,
  notFoundWarning,
  notRefreshedWarning,
  PROJECT_SCOPE_FIX,
  rateLimitWarning,
  scopeWarning,
  skippedFieldWarning,
} from './refresh-warnings.js';

/** GitHub's documented message for a token without the project scope. */
const GRANTED = 'gh: Your token has not been granted the required scopes to execute this query. The \'projectV2\' field requires one of the following scopes: [\'read:project\'], but your token has only been granted the: [\'repo\'] scopes.';

/** The hint `gh` adds to a scope refusal. */
const HINT = 'This API operation needs the "read:project" scope. To request it, run:  gh auth refresh -h github.com -s read:project';

/** The Rank field of a project holding no field, as `matchProjectFields` reads it. */
const MISSING_RANK: FieldMismatch | undefined = matchProjectFields({ fields: [] }).mismatched.find(({ template }) => template.name === 'Rank');

/** {@link MISSING_RANK}, refused when the match did not answer it. */
function missingRank(): FieldMismatch {
  if (MISSING_RANK === undefined) throw new Error('test: matchProjectFields answered no Rank mismatch for a project with no field');
  return MISSING_RANK;
}

describe('isMissingProjectScope', () => {
  it('answers false for a refusal that names no scope, an error of another class, and a scope refusal over another scope', () => {
    expect(isMissingProjectScope(new ProjectPortError('gh api graphql failed', 'gh: HTTP 502: Bad gateway'))).toBe(false);
    expect(isMissingProjectScope(new Error(GRANTED))).toBe(false);
    expect(isMissingProjectScope(new ProjectPortError('failed', GRANTED.replaceAll('read:project', 'read:org').replace('projectV2', 'organization')))).toBe(false);
  });

  it('answers true for GitHub\'s message, the hint gh adds, and the error type on stdout', () => {
    expect(isMissingProjectScope(new ProjectPortError('failed', GRANTED))).toBe(true);
    expect(isMissingProjectScope(new ProjectPortError('failed', HINT))).toBe(true);
    const stdout = JSON.stringify({ errors: [{ type: 'INSUFFICIENT_SCOPES', message: 'requires one of the following scopes: [\'read:project\']' }] });
    expect(isMissingProjectScope(new ProjectPortError('failed', stdout))).toBe(true);
  });
});

describe('the warning lines', () => {
  it('names the project scope and its fix on the scope line', () => {
    expect(scopeWarning()).toBe('The project was not updated: the gh token has no `project` scope. Run `gh auth refresh -s project`, then `rafa board sync`.');
    expect(scopeWarning()).toContain(PROJECT_SCOPE_FIX);
  });

  it('counts the issues not updated on the rate-limit line, one and several, and names the sync', () => {
    expect(rateLimitWarning(1)).toContain('and 1 issue was not updated');
    expect(rateLimitWarning(7)).toBe('The project was not fully updated: GitHub\'s rate limit refused the writes, and 7 issues were not updated. Run `rafa board sync` to catch up.');
    expect(rateLimitWarning(7)).toContain(BOARD_SYNC_FIX);
  });

  it('names the number, the owner and init on the not-found line', () => {
    expect(notFoundWarning({ owner: 'acme', number: 42 })).toBe('The project was not updated: board.project.number 42 was not found among acme\'s projects. Run `rafa init --board` to make one.');
    expect(notFoundWarning({ owner: 'acme', number: 42 })).toContain(INIT_BOARD_FIX);
  });

  it('names the field, what is wrong with it and the doctor on the skipped line', () => {
    expect(skippedFieldWarning(missingRank())).toBe('The project\'s field "Rank" was skipped and the rest were written: The project has no field named "Rank". Run `rafa doctor`.');
    expect(skippedFieldWarning(missingRank())).toContain(DOCTOR_FIX);
  });

  it('names the issue and the reason on the not-refreshed line', () => {
    expect(notRefreshedWarning({ number: 485, reason: 'gh api graphql failed: read: operation timed out' }))
      .toBe('#485 not refreshed: gh api graphql failed: read: operation timed out');
  });

  it('names the issue and the reason on the added-but-not-filled line', () => {
    expect(addedNotFilledWarning({ number: 939, reason: 'gh api graphql failed: read: operation timed out' }))
      .toBe('#939 added but not filled: gh api graphql failed: read: operation timed out');
  });

  it('writes each line on one line', () => {
    const lines = [
      scopeWarning(),
      rateLimitWarning(3),
      notFoundWarning({ owner: 'acme', number: 1 }),
      skippedFieldWarning(missingRank()),
      notRefreshedWarning({ number: 1, reason: 'a reason' }),
      addedNotFilledWarning({ number: 1, reason: 'a reason' }),
    ];
    expect(lines.filter((line) => line.includes('\n'))).toEqual([]);
  });
});
