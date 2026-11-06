/**
 * Tests for the issues a runner-opened pull request closes, driven from a
 * whole plan document: the `rafa:plan` header is read by
 * {@link runnerPrInputFor} and the body written by
 * {@link runnerPullRequestBody}, with no seam between them.
 */
import { describe, expect, test } from 'bun:test';

import { runnerPullRequestBody } from './runner-pr.js';
import { runnerPrInputFor } from './wrap-up-run.js';

const BRANCH = 'feat/rafa-11-some-plan';

/** A plan document whose `rafa:plan` block holds `headerLines`. */
function planWith(...headerLines: string[]): string {
  return ['# Plan: Some plan', '', '```rafa:plan', ...headerLines, '```', '', '- [ ] a task', ''].join('\n');
}

/** The pull request body the runner writes for `planContent`. */
function bodyFor(planContent: string): string {
  const input = runnerPrInputFor({ branch: BRANCH, base: 'main', planContent, planStub: null, notes: [] });
  if (input === null) throw new Error('the plan names no issue');
  return runnerPullRequestBody(input.issue, input.closes, input.notes);
}

/** The `Closes #<n>` lines of `body`, in order. */
function closesLines(body: string): string[] {
  return body.split('\n').filter((line) => line.startsWith('Closes #'));
}

describe('the issues a plan document closes', () => {
  test.each([
    ['a scalar closes', 'closes: "12"'],
    ['a list holding a string', 'closes: [12, "x"]'],
    ['no closes', ''],
  ])('closes the plan\'s own issue alone for %s', (_label, closesLine) => {
    const lines = ['issue: 11', closesLine].filter((line) => line !== '');
    expect(closesLines(bodyFor(planWith(...lines)))).toEqual(['Closes #11']);
  });

  test('closes the plan\'s issue first and then each listed issue once', () => {
    const body = bodyFor(planWith('issue: 11', 'closes: [12, 13]'));
    expect(closesLines(body)).toEqual(['Closes #11', 'Closes #12', 'Closes #13']);
  });

  test('drops the plan\'s own issue and duplicates from closes', () => {
    const body = bodyFor(planWith('issue: 11', 'closes: [11, 12, 12]'));
    expect(closesLines(body)).toEqual(['Closes #11', 'Closes #12']);
  });
});
