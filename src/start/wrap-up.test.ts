/**
 * Tests for the wrap-up prompt's naming bullets (`wrap-up.ts`).
 *
 * The prompt tells the session how to TITLE the pull request, and this
 * project's convention is `rafa-<n>: <title>` with `Closes #<n>` in the
 * body. Nothing else in the tree reads that spelling back, so a drift
 * in it would be silent; the cases below pin both spellings and, with
 * them, the two places the number may be read from.
 *
 * Every one of those bullets sits BELOW the prompt's first line, which
 * is the `wrap-up` classifier key `effort/classify.ts` buckets on. A
 * case that only asserted the new spelling present would pass on a
 * prompt that had pushed a bullet above that line and stopped
 * classifying, so the key is asserted first-line here as well, with the
 * classifier itself as the reading.
 */
import { describe, expect, test } from 'bun:test';

import { classifyPromptContent } from '../effort/classify.js';

import { buildWrapUpPrompt } from './wrap-up.js';

/** The branch a case builds its prompt on. */
const BRANCH = 'feat/rafa-20-pr-commands';

/** A plan body standing in for the `full` rendering appended below. */
const PLAN = '# Plan: pull-request commands\n\n- [ ] A task\n';

describe('the wrap-up prompt\'s pull-request naming', () => {
  test('spells the title `rafa-<n>: <title>` and closes the issue from the body', () => {
    const prompt = buildWrapUpPrompt(BRANCH, PLAN, null);

    expect(prompt).toContain('Title the PR `rafa-<n>: <title>`');
    expect(prompt).toContain('`Closes #<n>`');

    // The control: the superseded spelling is gone, so the assertions
    // above could not have passed on the old bullet.
    expect(prompt).not.toContain('Implement user authentication (#42)');
    expect(prompt).not.toContain('feat/42-slug');
  });

  test('names both places the number is read from, the plan then the branch', () => {
    const prompt = buildWrapUpPrompt(BRANCH, PLAN, null);
    const fromPlan = prompt.indexOf('`issue: <n>`');
    const fromBranch = prompt.indexOf(`the branch name (${BRANCH})`);

    expect(fromPlan).toBeGreaterThan(-1);
    expect(fromBranch).toBeGreaterThan(fromPlan);
  });

  test('keeps every naming bullet below the classifier key', () => {
    const prompt = buildWrapUpPrompt(BRANCH, PLAN, null);
    const [firstLine] = prompt.split('\n');

    expect(firstLine).toBe('* Read `@progress.txt` in full.');
    expect(classifyPromptContent(prompt)).toBe('wrap-up');
    expect(prompt.indexOf('rafa-<n>: <title>')).toBeGreaterThan(firstLine.length);
  });
});
