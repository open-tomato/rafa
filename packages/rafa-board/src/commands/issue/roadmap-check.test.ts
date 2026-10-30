/**
 * Cases for `./roadmap-check.ts`, each over a literal listing read by
 * `readEpics`, so the disagreement lines checked are the ones the epic
 * table prints.
 *
 *  - An agreeing board passes, and so does a board with no epic; the
 *    control beside them is the same epic left open with its one member
 *    closed, which must fail, so a pass is not a check that cannot fail.
 *  - Each of the two disagreements fails with its line, one line per
 *    epic in ascending number, and the head counts them.
 *  - An epic closed as not planned agrees whatever its members say.
 *  - A failed listing fails with its reason.
 */
import type { BoardIssue } from '../../board/roadmap-board.js';

import { describe, expect, it } from 'bun:test';

import { typeOfLabels } from '../../adapters/tracker/github.js';
import { readEpics } from '../../board/epics.js';

import { EPIC_CHECK_EXIT, epicCheckFailure } from './roadmap-check.js';

/** A listing row with `labels`, open unless `closed` names its reason. */
function issue(number: number, labels: readonly string[], closed: string | null = null): BoardIssue {
  return {
    number,
    title: `issue ${String(number)}`,
    body: '',
    state: closed === null
      ? 'OPEN'
      : 'CLOSED',
    stateReason: closed,
    labels,
    type: typeOfLabels(labels),
    module: 'unassigned',
  };
}

/** An epic for `slug`, open unless `closed` names its reason. */
function epic(number: number, slug: string, closed: string | null = null): BoardIssue {
  return issue(number, ['type:epic', `epic:${slug}`, 'horizon:now'], closed);
}

/** A member of `slug`, open unless `closed` names its reason. */
function member(number: number, slug: string, closed: string | null = null): BoardIssue {
  return issue(number, [`epic:${slug}`], closed);
}

/** The check's answer over `issues`. */
function checked(issues: readonly BoardIssue[]): string | null {
  return epicCheckFailure(readEpics({ issues, claims: new Set(), today: new Date(2026, 8, 27) }));
}

describe('epicCheckFailure', () => {
  it('passes a board whose every epic agrees, and a board with no epic', () => {
    expect(checked([epic(10, 'alpha'), member(11, 'alpha'), epic(20, 'beta', 'COMPLETED'), member(21, 'beta', 'COMPLETED')]))
      .toBeNull();
    expect(checked([member(11, 'alpha')])).toBeNull();
  });

  it('fails an open epic whose every member is closed, the control for the passing board', () => {
    expect(checked([epic(10, 'alpha'), member(11, 'alpha', 'COMPLETED')])).toBe([
      '❌ 1 epic\'s stored state disagrees with its computed one:',
      '  done, but epic #10 is still open',
    ].join('\n'));
  });

  it('names every disagreeing epic in ascending number and counts them', () => {
    expect(checked([
      epic(30, 'gamma', 'COMPLETED'),
      epic(10, 'alpha'),
      member(11, 'alpha', 'COMPLETED'),
      epic(20, 'beta'),
      member(21, 'beta'),
    ])).toBe([
      '❌ 2 epics\' stored states disagree with their computed ones:',
      '  done, but epic #10 is still open',
      '  empty, but epic #30 is closed',
    ].join('\n'));
  });

  it('passes an epic closed as not planned, whatever its members say', () => {
    expect(checked([epic(10, 'alpha', 'NOT_PLANNED'), member(11, 'alpha')])).toBeNull();
  });

  it('fails a listing that could not be read, with its reason', () => {
    expect(epicCheckFailure(readEpics({ issues: null, reason: 'gh: offline', claims: new Set(), today: new Date() })))
      .toBe('❌ Could not check the epics: gh: offline');
  });

  it('ends with exit code 1', () => {
    expect(EPIC_CHECK_EXIT).toBe(1);
  });
});
