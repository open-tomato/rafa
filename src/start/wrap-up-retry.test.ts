/**
 * Tests for the retry wrap-up prompt (`wrap-up-retry.ts`).
 *
 * The first wrap-up prompt, built from the same arguments, is the
 * control throughout: what a case asserts present in the retry prompt
 * it asserts absent from the first one, so a `toContain` cannot pass on
 * a phrase both prompts carry anyway. The classifier key is read with
 * the classifier itself, as `wrap-up.test.ts` reads it.
 */
import type { ReleaseSkipped } from '../release/prepare.js';

import { describe, expect, test } from 'bun:test';

import { classifyPromptContent } from '../effort/classify.js';

import { buildWrapUpRetryPrompt, missingPullRequestBullet } from './wrap-up-retry.js';
import { buildWrapUpPrompt } from './wrap-up.js';

/** The branch a case builds its prompt on. */
const BRANCH = 'feat/rafa-579-loop-run-ends-delivered';

/** A plan body standing in for the `full` rendering appended below. */
const PLAN = '# Plan: loop run ends delivered\n\n- [ ] A task\n';

/** A final message as a session that stopped before `gh pr create` might write it. */
const MESSAGE = [
  'Merged origin/main and pushed the branch.',
  '',
  '```rafa:promoted',
  'lesson-a → context/workflow.md',
  '```',
].join('\n');

/** The retry prompt over {@link MESSAGE}, with no release and no lesson. */
function retryPrompt(previousMessage: string = MESSAGE): string {
  return buildWrapUpRetryPrompt({
    branch: BRANCH,
    planContent: PLAN,
    release: null,
    lessons: [],
    previousMessage,
  });
}

describe('the retry wrap-up prompt', () => {
  test('keeps the wrap-up classifier key as its first line', () => {
    const prompt = retryPrompt();

    expect(prompt.split('\n')[0]).toBe('* Read `@progress.txt` in full.');
    expect(classifyPromptContent(prompt)).toBe('wrap-up');
  });

  test('says the pull request is missing, naming the branch, where the first prompt does not', () => {
    const first = buildWrapUpPrompt(BRANCH, PLAN, null);

    expect(retryPrompt()).toContain(`The pull request is MISSING. An earlier wrap-up session on this run ended, and no open pull request exists for ${BRANCH}.`);
    expect(first).not.toContain('MISSING');
  });

  test('puts the missing-pull-request bullet second, above every other step', () => {
    const lines = retryPrompt().split('\n');

    expect(lines[1]).toStartWith('* The pull request is MISSING.');
    expect(lines.findIndex((line) => line.includes('git fetch origin main'))).toBeGreaterThan(1);
  });

  test('quotes every line of the earlier final message under the bullet', () => {
    const prompt = retryPrompt();

    expect(prompt).toContain([
      '  Its final message follows, quoted:',
      '',
      '  > Merged origin/main and pushed the branch.',
      '  >',
      '  > ```rafa:promoted',
      '  > lesson-a → context/workflow.md',
      '  > ```',
      '',
    ].join('\n'));
  });

  test('leaves no line of the message unquoted, so its fence cannot open a block of the prompt', () => {
    const prompt = retryPrompt();

    expect(prompt.split('\n')).not.toContain('```rafa:promoted');
    expect(prompt.split('\n')).toContain('  > ```rafa:promoted');
  });

  test('says the earlier session left no message instead of quoting an empty one', () => {
    for (const empty of ['', '  \n\n ']) {
      const prompt = retryPrompt(empty);

      expect(prompt).toContain('  The earlier session left no final message.');
      expect(prompt).not.toContain('Its final message follows');
      expect(prompt).not.toContain('  >');
    }
  });

  test('a message answers the quote and not the no-message line', () => {
    const prompt = retryPrompt();

    expect(prompt).toContain('Its final message follows');
    expect(prompt).not.toContain('left no final message');
  });

  test('drops trailing whitespace and trailing blank lines of the message', () => {
    expect(missingPullRequestBullet(BRANCH, 'done.  \n\n\n')).toEqual([
      expect.stringContaining('* The pull request is MISSING.') as unknown as string,
      '  Its final message follows, quoted:',
      '',
      '  > done.',
      '',
    ]);
  });

  test('asks for `gh pr create`, never the edit of an open pull request', () => {
    const prompt = retryPrompt();

    expect(prompt).toContain(`No open PR was found for ${BRANCH}: open one with \`gh pr create\`.`);
    expect(prompt).not.toContain('is already open for');
  });

  test('is the first wrap-up prompt with the bullet inserted, the plan still appended whole', () => {
    const skipped: ReleaseSkipped = {
      kind: 'skipped',
      reason: 'disabled',
      sentence: 'no release fragment: release.enabled is false in this project',
      level: 'minor',
      levelSource: 'plan',
      notesLevel: null,
      problems: [],
    };
    const first = buildWrapUpPrompt(BRANCH, PLAN, null, skipped, []);
    const retry = buildWrapUpRetryPrompt({
      branch: BRANCH,
      planContent: PLAN,
      release: skipped,
      lessons: [],
      previousMessage: MESSAGE,
    });
    const bullet = missingPullRequestBullet(BRANCH, MESSAGE);
    const retryLines = retry.split('\n');

    expect([retryLines[0], ...retryLines.slice(1 + bullet.length)].join('\n')).toBe(first);
    expect(retry).toEndWith(PLAN);
    expect(retry).toContain('This pull request ships NO release fragment: no release fragment: release.enabled is false in this project.');
  });
});
