/**
 * Integration test of the wrap-up's lesson list and answer check, over a
 * scratch git repository and the real `local` learning adapter.
 *
 * A lesson held by three sources at 0.7 is listed in the prompt; a
 * stand-in session answers a `rafa:promoted` block that omits it, and the
 * check appends the unpromoted line to the pull request body. Only gh is
 * the recorded fake; git and the adapter are real.
 */
import type { Instinct } from '../schema/instinct.js';

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';

import { localInstinctsDir } from '../adapters/learning/local.js';
import { setActiveOutput } from '../adapters/output/active.js';
import { actionHash } from '../learning/index.js';
import { createFakePrGh } from '../pr/gh-fake.js';
import { createGhPullRequests, createGitRunner } from '../pr/index.js';
import { writeInstinct } from '../schema/instinct.js';
import { sinkOutput } from '../tests/output-sinks.js';

import { checkWrapUpAnswer, readHead } from './promoted-check.js';
import { buildWrapUpPrompt, lessonsToPromote } from './wrap-up.js';

const BRANCH = 'feat/rafa-25-rafa-learns-own-runs';
const FENCE = '```';

/** A held lesson from three sources at the given confidence. */
function held(id: string, confidence: number): Instinct {
  const action = `the action of ${id}`;
  return {
    id,
    trigger: `the trigger of ${id}`,
    kind: 'gotcha',
    domain: 'workflow',
    confidence,
    usageCount: 3,
    sources: ['session-a', 'session-b', 'session-c'],
    artifact: null,
    signal: 'loud',
    scope: 'project',
    projectId: null,
    source: 'task-report',
    evidence: [{ plan: 'rafa-25', task: 'a task', session: 'session-a', outcome: 'done' }],
    promotedTo: null,
    createdAt: '2026-09-20T10:00:00.000Z',
    updatedAt: '2026-09-21T10:00:00.000Z',
    action,
    cause: 'it recurred',
    actionHash: actionHash(action),
  };
}

describe('wrap-up over a scratch repository', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'rafa-wrap-up-it-'));
  const root = join(scratch, 'repo');

  beforeAll(() => {
    mkdirSync(root, { recursive: true });
    const git = createGitRunner(root);
    for (const args of [
      ['init', '-q'],
      ['config', 'user.email', 'test@example.com'],
      ['config', 'user.name', 'Test'],
      ['config', 'commit.gpgsign', 'false'],
    ]) git(args);
    const dir = localInstinctsDir(root);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'held-three.md'), writeInstinct(held('held-three', 0.7)));
    writeFileSync(join(dir, 'too-weak.md'), writeInstinct(held('too-weak', 0.6)));
    writeFileSync(join(root, 'README.md'), 'start\n');
    git(['add', 'README.md']);
    git(['commit', '-q', '-m', 'start']);
  });

  afterEach(() => {
    setActiveOutput(null);
  });

  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  test('lists the lesson, and an answer that omits it puts the line in the PR body', async () => {
    const warnings: string[] = [];
    setActiveOutput(sinkOutput({ warn: (message) => { warnings.push(message); } }));
    const git = createGitRunner(root);

    const lessons = await lessonsToPromote({
      kind: 'local',
      home: join(scratch, 'home'),
      blessMinConfidence: 0.5,
      repoRoot: root,
      promoteAfter: 3,
      promoteMinConfidence: 0.7,
    });
    const prompt = buildWrapUpPrompt(BRANCH, '# Plan\n', null, null, lessons);

    // Listed: the lesson at 0.7; the control, at 0.6, is not.
    expect(lessons.map((each) => each.id)).toEqual(['held-three']);
    expect(prompt).toContain('## Lessons to promote');
    expect(prompt).toContain('`held-three`');
    expect(prompt).not.toContain('too-weak');

    const head = readHead(git);
    const fakeGh = createFakePrGh();
    fakeGh.plant({ number: 7, headRefName: BRANCH, body: 'What this pull request does.' });
    const output = ['Done.', `${FENCE}rafa:promoted`, `${FENCE}`].join('\n');

    const check = await checkWrapUpAnswer({
      lessons,
      output,
      head,
      repoRoot: root,
      branch: BRANCH,
      git,
      pulls: createGhPullRequests({ gh: fakeGh.run }),
      learning: () => { throw new Error('nothing was promoted, so no adapter is needed'); },
    });

    expect(check.promoted).toEqual([]);
    expect(check.unpromoted).toEqual([{ kind: 'unanswered', id: 'held-three' }]);
    const body = fakeGh.pull(7)?.body ?? '';
    expect(body.split('\n').at(-1)).toBe(
      'Lessons listed for promotion that this pull request does not carry: `held-three` (no answer in the `rafa:promoted` block).',
    );
    expect(body.startsWith('What this pull request does.\n\n')).toBe(true);
  });
});
