/**
 * Tests for the retry wrap-up prompt (`wrap-up-retry.ts`).
 *
 * The first wrap-up prompt, built from the same arguments, is the
 * control throughout: what a case asserts present in the retry prompt
 * it asserts absent from the first one, so a `toContain` cannot pass on
 * a phrase both prompts carry anyway. The classifier key is read with
 * the classifier itself, as `wrap-up.test.ts` reads it.
 *
 * The retry's create bullet names the run's base, `integration` here as
 * `pr.base: integration` resolves it, and the cases read that the
 * session `retryWrapUp` spawns is handed the same base.
 *
 * `retryWrapUp` is driven through a stand-in spawner with no learning
 * and no serving, so no session, git or `gh` is reached: the cases read
 * the prompt it spawned, the directory it spawned in, and the message it
 * answered.
 */
import type { ReleaseSkipped } from '../release/prepare.js';
import type { CapturedSpawnOptions } from '../utils/claude.js';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { setActiveOutput } from '../adapters/output/active.js';
import { classifyPromptContent } from '../effort/classify.js';
import { sinkOutput } from '../tests/output-sinks.js';

import { withStamp } from './stamp.js';
import { buildWrapUpRetryPrompt, missingPullRequestBullet, retryWrapUp } from './wrap-up-retry.js';
import { buildWrapUpPrompt } from './wrap-up.js';

/** The branch a case builds its prompt on. */
const BRANCH = 'feat/rafa-579-loop-run-ends-delivered';

/** A plan body standing in for the `full` rendering appended below. */
const PLAN = '# Plan: loop run ends delivered\n\n- [ ] A task\n';

/** The run's base, as `runWrapUp` resolves it under `pr.base: integration`. */
const BASE = 'integration';

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
    base: BASE,
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
    const first = buildWrapUpPrompt(BRANCH, BASE, PLAN, null);

    expect(retryPrompt()).toContain(`The pull request is MISSING. An earlier wrap-up session on this run ended, and no open pull request exists for ${BRANCH}.`);
    expect(first).not.toContain('MISSING');
  });

  test('puts the missing-pull-request bullet second, above every other step', () => {
    const lines = retryPrompt().split('\n');

    expect(lines[1]).toStartWith('* The pull request is MISSING.');
    expect(lines.findIndex((line) => line.includes(`git fetch origin ${BASE}`))).toBeGreaterThan(1);
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

  test('asks for `gh pr create --base integration`, never the edit of an open pull request', () => {
    const prompt = retryPrompt();

    expect(prompt).toContain(`No open PR was found for ${BRANCH}: open one with \`gh pr create --base integration\`.`);
    expect(prompt).not.toContain('`gh pr create`');
    expect(prompt).not.toContain('is already open for');
  });

  test('names the base it is handed, not a default', () => {
    const onMain = buildWrapUpRetryPrompt({
      branch: BRANCH,
      base: 'main',
      planContent: PLAN,
      release: null,
      lessons: [],
      previousMessage: MESSAGE,
    });

    // The control for the case above: the same retry over another base
    // names that base and not `integration`.
    expect(onMain).toContain('`gh pr create --base main`');
    expect(onMain).not.toContain('--base integration');
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
    const first = buildWrapUpPrompt(BRANCH, BASE, PLAN, null, skipped, []);
    const retry = buildWrapUpRetryPrompt({
      branch: BRANCH,
      base: BASE,
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

/** What one stand-in spawn was handed. */
interface Spawned {
  readonly prompt: string;
  readonly options: CapturedSpawnOptions | undefined;
}

describe('retryWrapUp', () => {
  const errors: string[] = [];
  const infos: string[] = [];

  beforeEach(() => {
    errors.length = 0;
    infos.length = 0;
    setActiveOutput(sinkOutput({ error: (line) => errors.push(line), info: (line) => infos.push(line) }));
  });

  afterEach(() => {
    setActiveOutput(null);
  });

  /** One retry over a stand-in spawner answering `exitCode` and `stdout`. */
  async function retryWith(exitCode: number, stdout: string): Promise<{ readonly answer: string; readonly spawned: readonly Spawned[] }> {
    const spawned: Spawned[] = [];
    const answer = await retryWrapUp({
      previousMessage: MESSAGE,
      branch: BRANCH,
      base: BASE,
      planContent: PLAN,
      settingSources: ['project'],
      serving: null,
      learning: null,
      checkout: '/scratch/checkout',
      spawn: (_args, prompt, options) => {
        spawned.push({ prompt, options });
        return Promise.resolve({ exitCode, stdout });
      },
    });
    return { answer, spawned };
  }

  test('spawns one session in the checkout with the stamped retry prompt and no release record', async () => {
    const { spawned } = await retryWith(0, 'Opened #601.');

    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.options?.cwd).toBe('/scratch/checkout');
    // No release bullet of any kind: the fragment is already committed
    // when a retry runs (see the module note).
    expect(spawned[0]?.prompt).toBe(withStamp(retryPrompt()));
    expect(spawned[0]?.prompt).toContain('  > Merged origin/main and pushed the branch.');
    expect(spawned[0]?.prompt).toContain('`gh pr create --base integration`');
  });

  test('answers its own final message, so the next retry quotes this one', async () => {
    const { answer } = await retryWith(0, 'Retry message.\n');

    expect(answer).toBe('Retry message.\n');
    expect(infos).toEqual(['\n✅ Retry wrap-up session ended; the loop checks for the pull request again.']);
  });

  test('answers the final message of a session that failed too, reporting the failure', async () => {
    const { answer } = await retryWith(1, 'Stopped before gh pr create.');

    expect(answer).toBe('Stopped before gh pr create.');
    expect(errors).toEqual(['\n❌ Failed to preserve progress (exit 1). Please try again.']);
    expect(infos).toEqual([]);
  });
});
