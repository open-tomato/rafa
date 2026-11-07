/**
 * Tests for the check of the wrap-up session's `rafa:promoted` answer
 * (`promoted-check.ts`).
 *
 * Nothing here spawns git or gh. Git is a {@link GitRunner} stub that
 * answers from a table and records every call. Gh is the recorded fake
 * (`pr/gh-fake.ts`) behind the real provider, so the body edit that
 * reaches it is the `gh pr edit` argument list the provider builds. The
 * learning adapter is a stub recording each push and answering a
 * planted blessed set, apart from two cases that run the real `local`
 * adapter over a scratch directory, where `promoted_to` and leaving the
 * blessed set are read back from disk: one lesson alone, and one
 * action held under three triggers, whose every member leaves.
 *
 * Every case that asserts something present has a control where the
 * same input moves across the line: a changed path beside an unchanged
 * one, an answered lesson beside an unanswered one, a body written
 * beside a body left alone. Without it, a check that reported every
 * lesson, or none, would pass.
 *
 * The last group hands the check a null `pulls`, as the wrap-up does
 * under `pr.provider: none` (#1051): a line to report is printed behind
 * the reason, and no line to report prints nothing. The two are each
 * other's control, and the same answer over a `gh` provider is the
 * control for the reason, which is absent there.
 */
import type { PromotedCheck } from './promoted-check.js';
import type { Learning, SyncPayload } from '@open-tomato/rafa/ports';
import type { InstinctRecord } from '@open-tomato/rafa-inventory/learning/index';
import type { Instinct } from '@open-tomato/rafa-inventory/schema/instinct';
import type { GitResult, GitRunner } from '@open-tomato/rafa-pr/pr/index';

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { setActiveOutput } from '@open-tomato/rafa/core/output';
import { sinkOutput } from '@open-tomato/rafa/tests/output-sinks';
import { createLocalLearning, localInstinctsDir } from '@open-tomato/rafa-inventory/adapters/learning/local';
import { actionHash } from '@open-tomato/rafa-inventory/learning/index';
import { parseInstinct, writeInstinct } from '@open-tomato/rafa-inventory/schema/instinct';
import { createFakePrGh } from '@open-tomato/rafa-pr/pr/gh-fake';
import { createGhPullRequests } from '@open-tomato/rafa-pr/pr/index';
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  changedSince,
  checkPromoted,
  checkWrapUpAnswer,
  NO_PROVIDER_REASON,
  readHead,
  recordPromotions,
  repoPath,
  reportUnpromoted,
  unpromotedLine,
} from './promoted-check.js';
import { parsePromoted } from './promoted.js';

/** A fence, spelled out so no fence in this file is a real one. */
const FENCE = '```';

/** The repository root every case names. */
const ROOT = '/repo/stand-in';

/** The commit read before the session. */
const HEAD = '1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d';

/** The branch whose pull request carries the line. */
const BRANCH = 'feat/rafa-25-rafa-learns-own-runs';

/** A lesson as `promotable` answers one, with any field replaced. */
function lesson(id: string, overrides: Partial<InstinctRecord> = {}): InstinctRecord {
  const action = overrides.action ?? `the action of ${id}`;
  return {
    id,
    trigger: `the trigger of ${id}`,
    action,
    action_hash: actionHash(action),
    confidence: 0.8,
    usage_count: 3,
    sources: ['session-a', 'session-b', 'session-c'],
    signal: 'loud',
    status: 'active',
    created_at: '2026-09-20T10:00:00.000Z',
    updated_at: '2026-09-21T10:00:00.000Z',
    ...overrides,
  };
}

/** Session output ending in a `rafa:promoted` block of `lines`. */
function answered(...lines: string[]): string {
  return ['Promoted what was listed.', '', `${FENCE}rafa:promoted`, ...lines, FENCE, ''].join('\n');
}

/** A git stub answering from `table`, keyed by the arguments joined with spaces. */
function stubGit(table: Record<string, GitResult>): { git: GitRunner; calls: string[][] } {
  const calls: string[][] = [];
  const git: GitRunner = (args) => {
    calls.push([...args]);
    return table[args.join(' ')] ?? { ok: false, stdout: '', stderr: `fatal: no stub for git ${args.join(' ')}` };
  };
  return { git, calls };
}

/** What `git diff --name-only -z <HEAD>` answers when `paths` changed. */
function diffOf(...paths: string[]): Record<string, GitResult> {
  return {
    [`diff --name-only -z ${HEAD} --`]: { ok: true, stdout: paths.map((path) => `${path}\0`).join(''), stderr: '' },
  };
}

/** The changes a case reads, as the stub git answers them. */
function changed(...paths: string[]): ReturnType<typeof changedSince> {
  return changedSince(stubGit(diffOf(...paths)).git, HEAD);
}

/**
 * A learning adapter recording each push, refusing the ids in `refused`,
 * whose pull answers `blessed`, or is refused when `blessed` is null.
 */
function stubLearning(
  refused: readonly string[] = [],
  blessed: readonly InstinctRecord[] | null = [],
): { learning: Learning; pushes: SyncPayload[]; pulls: () => number } {
  const pushes: SyncPayload[] = [];
  let pulled = 0;
  const learning: Learning = {
    push: (payload) => {
      pushes.push(payload);
      const id = payload.instincts[0]?.id ?? '';
      return refused.includes(id)
        ? Promise.reject(new Error(`no held member describes ${id}`))
        : Promise.resolve({ decisions: [], discarded: [] } as never);
    },
    pullBlessed: () => {
      pulled += 1;
      return blessed === null
        ? Promise.reject(new Error('the store could not be read'))
        : Promise.resolve({ version: 'stub', instincts: [...blessed] });
    },
    flag: () => Promise.reject(new Error('the check flags nothing')),
  };
  return { learning, pushes, pulls: () => pulled };
}

describe('readHead and changedSince', () => {
  test('reads HEAD with rev-parse, and null when git refuses', () => {
    const { git, calls } = stubGit({ 'rev-parse --verify HEAD': { ok: true, stdout: `${HEAD}\n`, stderr: '' } });
    expect(readHead(git)).toBe(HEAD);
    expect(calls).toEqual([['rev-parse', '--verify', 'HEAD']]);

    // The control: the same call refused answers no commit.
    expect(readHead(stubGit({}).git)).toBeNull();
  });

  test('reads every NUL-separated path of the diff against the working tree', () => {
    const { git, calls } = stubGit(diffOf('context/source.md', 'ctx/é.md', 'a b.md'));

    const reading = changedSince(git, HEAD);

    expect(calls).toEqual([['diff', '--name-only', '-z', HEAD, '--']]);
    expect(reading).toEqual({ ok: true, head: HEAD, paths: new Set(['context/source.md', 'ctx/é.md', 'a b.md']) });
  });

  test('answers why when the diff is refused, naming what git said', () => {
    const reading = changedSince(stubGit({}).git, HEAD);

    expect(reading.ok).toBe(false);
    const reason = reading.ok
      ? ''
      : reading.reason;
    expect(reason).toBe(`the changes since 1a2b3c4 could not be read, git said: fatal: no stub for git diff --name-only -z ${HEAD} --`);
  });

  test('runs no git when the HEAD before the session was never read', () => {
    const { git, calls } = stubGit(diffOf('context/source.md'));

    expect(changedSince(git, null)).toEqual({ ok: false, reason: 'the HEAD before the session could not be read' });
    expect(calls).toEqual([]);
  });
});

describe('repoPath', () => {
  test.each([
    ['context/source.md', 'context/source.md'],
    ['./context/source.md', 'context/source.md'],
    ['context/../README.md', 'README.md'],
    [`${ROOT}/context/cli.md`, 'context/cli.md'],
  ])('reads %p as %p', (named, spelled) => {
    expect(repoPath(named, ROOT)).toBe(spelled);
  });

  test.each([
    ['../outside.md'],
    ['/elsewhere/context/cli.md'],
    ['.'],
  ])('reads %p as no path of the repository', (named) => {
    expect(repoPath(named, ROOT)).toBeNull();
  });
});

describe('checkPromoted', () => {
  const lessons = [lesson('promoted-one'), lesson('skipped-one'), lesson('unanswered-one'), lesson('unchanged-one')];

  test('settles each listed lesson one way, in the order listed', () => {
    const reading = parsePromoted(answered(
      'unchanged-one → context/cli.md',
      'skipped-one → skipped: a skill already covers it',
      'promoted-one -> ./context/source.md',
    ));

    const check = checkPromoted(lessons, reading, changed('context/source.md', 'README.md'), ROOT);

    expect(check.promoted.map(({ lesson: each, path }) => [each.id, path])).toEqual([['promoted-one', 'context/source.md']]);
    expect(check.skipped.map((each) => [each.id, each.reason])).toEqual([['skipped-one', 'a skill already covers it']]);
    expect(check.unpromoted).toEqual([
      { kind: 'unanswered', id: 'unanswered-one' },
      { kind: 'unchanged', id: 'unchanged-one', path: 'context/cli.md' },
    ]);
    expect(check.unlisted).toEqual([]);
  });

  test('promotes the unchanged lesson once its path is among the changes', () => {
    // The control for the case above: only the diff differs.
    const reading = parsePromoted(answered('unchanged-one → context/cli.md'));

    const before = checkPromoted([lesson('unchanged-one')], reading, changed('README.md'), ROOT);
    const after = checkPromoted([lesson('unchanged-one')], reading, changed('README.md', 'context/cli.md'), ROOT);

    expect(before.promoted).toEqual([]);
    expect(after.promoted.map(({ path }) => path)).toEqual(['context/cli.md']);
    expect(after.unpromoted).toEqual([]);
  });

  test.each([
    ['no block at all', 'The session forgot the block.'],
    ['a block never closed', `${FENCE}rafa:promoted\npromoted-one → context/source.md\n`],
  ])('reads every listed lesson as unanswered under %s', (_label, output) => {
    const check = checkPromoted(lessons, parsePromoted(output), changed('context/source.md'), ROOT);

    expect(check.unpromoted).toEqual(lessons.map((each) => ({ kind: 'unanswered', id: each.id })));
    expect(check.promoted).toEqual([]);
  });

  test('leaves an answer for an id the list did not hold out of every lesson', () => {
    const reading = parsePromoted(answered('promoted-one → context/source.md', 'invented-one → context/source.md'));

    const check = checkPromoted([lesson('promoted-one')], reading, changed('context/source.md'), ROOT);

    expect(check.unlisted).toEqual(['invented-one']);
    expect(check.promoted.map(({ lesson: each }) => each.id)).toEqual(['promoted-one']);
  });

  test('marks a promoted path unchecked, and promotes nothing, when the changes were not read', () => {
    const reading = parsePromoted(answered('promoted-one → context/source.md', 'skipped-one → skipped: covered'));

    const check = checkPromoted(lessons.slice(0, 2), reading, changedSince(stubGit({}).git, null), ROOT);

    expect(check.promoted).toEqual([]);
    expect(check.unpromoted).toEqual([{
      kind: 'unchecked',
      id: 'promoted-one',
      path: 'context/source.md',
      reason: 'the HEAD before the session could not be read',
    }]);
    expect(check.skipped.map((each) => each.id)).toEqual(['skipped-one']);
  });
});

describe('unpromotedLine', () => {
  test('names every unanswered, unchanged and unchecked id on one line', () => {
    const check: PromotedCheck = {
      promoted: [],
      skipped: [],
      unlisted: [],
      unpromoted: [
        { kind: 'unanswered', id: 'lesson-a' },
        { kind: 'unchanged', id: 'lesson-b', path: 'context/cli.md' },
        { kind: 'unchecked', id: 'lesson-c', path: 'README.md', reason: 'the HEAD before the session could not be read' },
      ],
    };

    const line = unpromotedLine(check, HEAD);

    expect(line).not.toBeNull();
    expect(line).not.toContain('\n');
    expect(line).toBe('Lessons listed for promotion that this pull request does not carry: '
      + '`lesson-a` (no answer in the `rafa:promoted` block); '
      + '`lesson-b` (names `context/cli.md`, which has not changed since 1a2b3c4); '
      + '`lesson-c` (names `README.md`, which could not be checked: the HEAD before the session could not be read).');
  });

  test('writes no line when every listed lesson was promoted or skipped', () => {
    expect(unpromotedLine({ promoted: [], skipped: [], unlisted: ['stray'], unpromoted: [] }, HEAD)).toBeNull();
  });
});

describe('recordPromotions', () => {
  test('pushes each lesson back with promoted_to, from a source it already holds', async () => {
    const { learning, pushes } = stubLearning();
    const first = lesson('lesson-a');
    const bare = lesson('lesson-b', { sources: undefined, usage_count: 1 });

    const problems = await recordPromotions(learning, [
      { lesson: first, path: 'context/source.md' },
      { lesson: bare, path: 'README.md' },
    ]);

    expect(problems).toEqual([]);
    expect(pushes).toEqual([
      { source_id: 'session-a', instincts: [{ ...first, promoted_to: 'context/source.md' }] },
      { source_id: 'lesson-b', instincts: [{ ...bare, promoted_to: 'README.md' }] },
    ]);
  });

  test('answers one problem per refused push and still pushes the rest', async () => {
    const { learning, pushes } = stubLearning(['from-the-user-scope']);

    const problems = await recordPromotions(learning, [
      { lesson: lesson('from-the-user-scope'), path: 'context/source.md' },
      { lesson: lesson('held-here'), path: 'context/cli.md' },
    ]);

    expect(pushes.map((each) => each.instincts[0]?.id)).toEqual(['from-the-user-scope', 'held-here']);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('`from-the-user-scope` is in context/source.md');
    expect(problems[0]).toContain('no held member describes from-the-user-scope');
  });
});

describe('recordPromotions over a same-action group', () => {
  /** One action, learned under three wordings from three sources. */
  const ACTION = 'write the list to a file and pipe it through xargs';
  const named = lesson('xargs-a', { action: ACTION, confidence: 0.8, sources: ['session-a'] });
  const second = lesson('xargs-b', { action: ACTION, confidence: 0.7, sources: ['session-b'] });
  const third = lesson('xargs-c', { action: ACTION, confidence: 0.6, sources: ['session-c', 'session-d'] });
  const stranger = lesson('another-action');

  /** The id, source and `promoted_to` of each push, in order. */
  function pushed(pushes: readonly SyncPayload[]): (string | undefined)[][] {
    return pushes.map((each) => [each.instincts[0]?.id, each.source_id, each.instincts[0]?.promoted_to]);
  }

  test('pushes promoted_to to every blessed member of the group, each from a source it holds', async () => {
    const { learning, pushes, pulls } = stubLearning([], [stranger, third, named, second]);

    const problems = await recordPromotions(learning, [{ lesson: named, path: 'context/source.md' }]);

    expect(problems).toEqual([]);
    expect(pulls()).toBe(1);
    expect(pushed(pushes)).toEqual([
      ['xargs-a', 'session-a', 'context/source.md'],
      ['xargs-b', 'session-b', 'context/source.md'],
      ['xargs-c', 'session-c', 'context/source.md'],
    ]);
    // Each member is pushed as it is held, only promoted_to added.
    expect(pushes[2]?.instincts).toEqual([{ ...third, promoted_to: 'context/source.md' }]);
    // The control: the blessed record taking another action is not pushed.
    expect(pushes.map((each) => each.instincts[0]?.id)).not.toContain('another-action');
  });

  test('pushes no flagged record taking the action', async () => {
    const flagged = lesson('xargs-flagged', { action: ACTION, status: 'flagged', sources: ['session-e'] });
    const { learning, pushes } = stubLearning([], [named, second, flagged]);

    await recordPromotions(learning, [{ lesson: named, path: 'context/source.md' }]);

    expect(pushes.map((each) => each.instincts[0]?.id)).toEqual(['xargs-a', 'xargs-b']);
  });

  test('answers one problem line for a refused member and still records the rest', async () => {
    const { learning, pushes } = stubLearning(['xargs-b'], [named, second, third, stranger]);

    const problems = await recordPromotions(learning, [
      { lesson: named, path: 'context/source.md' },
      { lesson: stranger, path: 'context/cli.md' },
    ]);

    expect(pushes.map((each) => each.instincts[0]?.id)).toEqual(['xargs-a', 'xargs-b', 'xargs-c', 'another-action']);
    expect(problems).toEqual([
      '`xargs-b` (same action as `xargs-a`) is in context/source.md, but its promoted_to could not be recorded: '
      + 'no held member describes xargs-b',
    ]);
  });

  test('pushes a member once when two confirmed lessons share its group', async () => {
    const { learning, pushes } = stubLearning([], [named, second, third]);

    await recordPromotions(learning, [
      { lesson: named, path: 'context/source.md' },
      { lesson: second, path: 'context/cli.md' },
    ]);

    expect(pushed(pushes)).toEqual([
      ['xargs-a', 'session-a', 'context/source.md'],
      ['xargs-b', 'session-b', 'context/source.md'],
      ['xargs-c', 'session-c', 'context/source.md'],
    ]);
  });

  test('pushes the lesson alone, with one problem line, when the blessed set cannot be pulled', async () => {
    const { learning, pushes } = stubLearning([], null);

    const problems = await recordPromotions(learning, [{ lesson: named, path: 'context/source.md' }]);

    expect(pushed(pushes)).toEqual([['xargs-a', 'session-a', 'context/source.md']]);
    expect(problems).toEqual([
      '`xargs-a` is in context/source.md, but the rest of its same-action group was not recorded, '
      + 'as the blessed set could not be read: the store could not be read',
    ]);
  });

  test('pulls nothing when no lesson was confirmed', async () => {
    const { learning, pushes, pulls } = stubLearning([], null);

    expect(await recordPromotions(learning, [])).toEqual([]);
    expect(pulls()).toBe(0);
    expect(pushes).toEqual([]);
  });
});

describe('recordPromotions through the local adapter', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'rafa-promoted-check-'));

  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  /** A held `.md` lesson from three task reports at 0.8, with any field replaced. */
  function held(id: string, overrides: Partial<Instinct> = {}): Instinct {
    const action = overrides.action ?? `the action of ${id}`;
    return {
      id,
      trigger: `the trigger of ${id}`,
      kind: 'gotcha',
      domain: 'workflow',
      confidence: 0.8,
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
      ...overrides,
    };
  }

  test('sets promoted_to on disk, keeps the count, and takes the lesson out of the blessed set', async () => {
    const root = join(scratch, 'repo');
    const dir = localInstinctsDir(root);
    mkdirSync(dir, { recursive: true });
    for (const id of ['promoted-here', 'left-alone']) writeFileSync(join(dir, `${id}.md`), writeInstinct(held(id)));
    setActiveOutput(sinkOutput({}));
    const adapter = createLocalLearning({
      instinctsDir: dir,
      home: join(scratch, 'home'),
      minConfidence: 0.5,
      now: () => '2026-09-25T10:00:00.000Z',
    });

    const before = await adapter.pullBlessed();
    const target = before.instincts.find((each) => each.id === 'promoted-here');
    if (target === undefined) throw new Error('the planted lesson was not blessed');
    const problems = await recordPromotions(adapter, [{ lesson: target, path: 'context/source.md' }]);
    const after = await adapter.pullBlessed();
    setActiveOutput(null);

    expect(problems).toEqual([]);
    // The control: both lessons were blessed before, and only the promoted one left.
    expect(before.instincts.map((each) => each.id).sort()).toEqual(['left-alone', 'promoted-here']);
    expect(after.instincts.map((each) => each.id)).toEqual(['left-alone']);

    const parsed = parseInstinct(readFileSync(join(dir, 'promoted-here.md'), 'utf8'));
    expect(parsed.issues).toEqual([]);
    expect(parsed.instinct).toMatchObject({ promotedTo: 'context/source.md', usageCount: 3, confidence: 0.8 });
    const untouched = parseInstinct(readFileSync(join(dir, 'left-alone.md'), 'utf8'));
    expect(untouched.instinct?.promotedTo).toBeNull();
  });

  test('takes every member of the group out of the blessed set, and leaves the other lesson', async () => {
    const root = join(scratch, 'group-repo');
    const dir = localInstinctsDir(root);
    mkdirSync(dir, { recursive: true });
    const action = 'write the list to a file and pipe it through xargs';
    const wordings = [
      held('xargs-a', { action, confidence: 0.5, usageCount: 1, sources: ['session-a'] }),
      held('xargs-b', { action, confidence: 0.5, usageCount: 1, sources: ['session-b'] }),
      held('xargs-c', { action, confidence: 0.5, usageCount: 1, sources: ['session-c'] }),
      held('left-alone'),
    ];
    for (const each of wordings) writeFileSync(join(dir, `${each.id}.md`), writeInstinct(each));
    setActiveOutput(sinkOutput({}));
    const adapter = createLocalLearning({
      instinctsDir: dir,
      home: join(scratch, 'group-home'),
      minConfidence: 0.5,
      now: () => '2026-11-07T10:00:00.000Z',
    });

    const before = await adapter.pullBlessed();
    const target = before.instincts.find((each) => each.id === 'xargs-a');
    if (target === undefined) throw new Error('the planted lesson was not blessed');
    const problems = await recordPromotions(adapter, [{ lesson: target, path: 'context/source.md' }]);
    const after = await adapter.pullBlessed();
    setActiveOutput(null);

    expect(problems).toEqual([]);
    expect(before.instincts.map((each) => each.id).sort()).toEqual(['left-alone', 'xargs-a', 'xargs-b', 'xargs-c']);
    expect(after.instincts.map((each) => each.id)).toEqual(['left-alone']);
    for (const id of ['xargs-a', 'xargs-b', 'xargs-c']) {
      const parsed = parseInstinct(readFileSync(join(dir, `${id}.md`), 'utf8'));
      expect(parsed.instinct).toMatchObject({ promotedTo: 'context/source.md', usageCount: 1, confidence: 0.5 });
    }
  });
});

describe('reportUnpromoted', () => {
  const LINE = 'Lessons listed for promotion that this pull request does not carry: `lesson-a` (no answer).';

  test('appends the line to the open pull request body with gh pr edit, once', async () => {
    const fakeGh = createFakePrGh();
    fakeGh.plant({ number: 42, headRefName: BRANCH, body: 'What this pull request does.\n' });
    const pulls = createGhPullRequests({ gh: fakeGh.run });

    const first = await reportUnpromoted(pulls, BRANCH, LINE);
    const edits = (): number => fakeGh.calls().filter((call) => call[0] === 'pr' && call[1] === 'edit').length;
    const afterFirst = edits();
    const second = await reportUnpromoted(pulls, BRANCH, LINE);

    expect(first).toEqual({ written: true, number: 42, already: false });
    expect(fakeGh.pull(42)?.body).toBe(`What this pull request does.\n\n${LINE}`);
    expect(afterFirst).toBe(1);
    // The control: a body that already carries the line is not written again.
    expect(second).toEqual({ written: true, number: 42, already: true });
    expect(edits()).toBe(1);
  });

  test('writes nothing and says why when the branch has no open pull request', async () => {
    const fakeGh = createFakePrGh();
    fakeGh.plant({ number: 7, headRefName: 'feat/another-branch', body: 'Another.' });

    const report = await reportUnpromoted(createGhPullRequests({ gh: fakeGh.run }), BRANCH, LINE);

    expect(report).toEqual({ written: false, problem: `no open pull request was found for ${BRANCH}` });
    expect(fakeGh.pull(7)?.body).toBe('Another.');
  });

  test('answers a gh that fails rather than throwing', async () => {
    const pulls = createGhPullRequests({ gh: () => Promise.resolve({ ok: false, stdout: '', stderr: 'error connecting to api.github.com' }) });

    const report = await reportUnpromoted(pulls, BRANCH, LINE);

    const problem = report.written
      ? ''
      : report.problem;
    expect(problem).toStartWith('the pull request body could not be written: ');
    expect(problem).toContain('error connecting to api.github.com');
  });
});

describe('checkWrapUpAnswer', () => {
  let infos: string[] = [];
  let warnings: string[] = [];

  beforeEach(() => {
    infos = [];
    warnings = [];
    setActiveOutput(sinkOutput({
      info: (message) => {
        infos.push(message);
      },
      warn: (message) => {
        warnings.push(message);
      },
    }));
  });

  afterEach(() => {
    setActiveOutput(null);
  });

  /** The check over `output`, with `paths` changed and PR #42 open on the branch. */
  async function run(output: string, paths: readonly string[], refused: readonly string[] = []) {
    const fakeGh = createFakePrGh();
    fakeGh.plant({ number: 42, headRefName: BRANCH, body: 'What this pull request does.' });
    const { learning, pushes } = stubLearning(refused);
    const check = await checkWrapUpAnswer({
      lessons: [lesson('lesson-a'), lesson('lesson-b'), lesson('lesson-c')],
      output,
      head: HEAD,
      repoRoot: ROOT,
      branch: BRANCH,
      git: stubGit(diffOf(...paths)).git,
      pulls: createGhPullRequests({ gh: fakeGh.run }),
      learning: () => learning,
    });
    return { check, pushes, body: fakeGh.pull(42)?.body ?? '' };
  }

  test('records the promoted lesson and names the omitted and unchanged ones in the body', async () => {
    const output = answered('lesson-a → context/source.md', 'lesson-b → context/cli.md');

    const { check, pushes, body } = await run(output, ['context/source.md']);

    expect(pushes.map((each) => [each.instincts[0]?.id, each.instincts[0]?.promoted_to])).toEqual([['lesson-a', 'context/source.md']]);
    expect(check.unpromoted.map((each) => each.id)).toEqual(['lesson-b', 'lesson-c']);
    const added = body.split('\n').at(-1) ?? '';
    expect(body.startsWith('What this pull request does.\n\n')).toBe(true);
    expect(added).toContain('`lesson-b` (names `context/cli.md`, which has not changed since 1a2b3c4)');
    expect(added).toContain('`lesson-c` (no answer in the `rafa:promoted` block)');
    expect(added).not.toContain('lesson-a');
    expect(infos).toContain('   Lesson `lesson-a` promoted to context/source.md.');
    expect(infos).toContain('   Pull request #42 now names the lessons it does not carry.');
  });

  test('leaves the body alone when every lesson is promoted or skipped', async () => {
    // The control for the case above: the same lessons, all answered, both paths changed.
    const output = answered('lesson-a → context/source.md', 'lesson-b → context/cli.md', 'lesson-c → skipped: covered by a skill');

    const { check, pushes, body } = await run(output, ['context/source.md', 'context/cli.md']);

    expect(check.unpromoted).toEqual([]);
    expect(pushes.map((each) => each.instincts[0]?.id)).toEqual(['lesson-a', 'lesson-b']);
    expect(body).toBe('What this pull request does.');
    expect(warnings).toEqual([]);
  });

  test('names every lesson and warns once when the session wrote no block', async () => {
    const { check, pushes, body } = await run('Done, and nothing else.', ['context/source.md']);

    expect(pushes).toEqual([]);
    expect(check.unpromoted.map((each) => each.kind)).toEqual(['unanswered', 'unanswered', 'unanswered']);
    expect(body).toContain('`lesson-a` (no answer in the `rafa:promoted` block); `lesson-b`');
    expect(warnings).toEqual(['   The wrap-up session wrote no `rafa:promoted` block.']);
  });

  test('warns about each unreadable line, each unlisted id and each refused push', async () => {
    const output = answered('lesson-a → context/source.md', 'lesson-b', 'stray → context/source.md', 'lesson-c → skipped: covered');

    const { check } = await run(output, ['context/source.md'], ['lesson-a']);

    expect(check.promoted.map(({ lesson: each }) => each.id)).toEqual(['lesson-a']);
    expect(warnings.some((each) => each.includes('was not read: it holds no `→` or `->`'))).toBe(true);
    expect(warnings).toContain('   The `rafa:promoted` block answers `stray`, which the wrap-up did not list.');
    expect(warnings.some((each) => each.includes('its promoted_to could not be recorded: no held member describes lesson-a'))).toBe(true);
  });

  test('warns with the line itself when the adapter cannot be made or no pull request is open', async () => {
    const fakeGh = createFakePrGh();

    await checkWrapUpAnswer({
      lessons: [lesson('lesson-a'), lesson('lesson-b')],
      output: answered('lesson-a → context/source.md'),
      head: HEAD,
      repoRoot: ROOT,
      branch: BRANCH,
      git: stubGit(diffOf('context/source.md')).git,
      pulls: createGhPullRequests({ gh: fakeGh.run }),
      learning: () => {
        throw new Error('no `learning` adapter has the kind `absent`');
      },
    });

    expect(warnings.some((each) => each.includes('the learning adapter could not be made: no `learning` adapter has the kind `absent`'))).toBe(true);
    expect(warnings.some((each) => each.includes(`no open pull request was found for ${BRANCH}`) && each.includes('`lesson-b` (no answer'))).toBe(true);
  });
});

describe('checkWrapUpAnswer with no pull request provider', () => {
  let infos: string[] = [];
  let warnings: string[] = [];

  beforeEach(() => {
    infos = [];
    warnings = [];
    setActiveOutput(sinkOutput({
      info: (message) => {
        infos.push(message);
      },
      warn: (message) => {
        warnings.push(message);
      },
    }));
  });

  afterEach(() => {
    setActiveOutput(null);
  });

  /** The check over `output` for two lessons, `context/source.md` changed, and a null `pulls`. */
  async function runWithout(output: string) {
    const { learning, pushes } = stubLearning();
    const check = await checkWrapUpAnswer({
      lessons: [lesson('lesson-a'), lesson('lesson-b')],
      output,
      head: HEAD,
      repoRoot: ROOT,
      branch: BRANCH,
      git: stubGit(diffOf('context/source.md')).git,
      pulls: null,
      learning: () => learning,
    });
    return { check, pushes };
  }

  test('prints the line behind the reason when a lesson is left unanswered', async () => {
    const { check, pushes } = await runWithout(answered('lesson-a → context/source.md'));

    const line = unpromotedLine(check, HEAD);
    expect(line).toBe('Lessons listed for promotion that this pull request does not carry: `lesson-b` (no answer in the `rafa:promoted` block).');
    expect(warnings).toEqual([`   ${NO_PROVIDER_REASON}: ${String(line)}`]);
    expect(warnings[0]).toContain('`pr.provider` is `none`');
    expect(warnings[0]).toContain('the lessons stay in the library');
    // The confirmed promotion is recorded as under any provider.
    expect(pushes.map((each) => each.instincts[0]?.promoted_to)).toEqual(['context/source.md']);
    expect(infos).toEqual(['   Lesson `lesson-a` promoted to context/source.md.']);
  });

  test('prints nothing about a pull request when there is no line to report', async () => {
    // The control for the case above: the same lessons, both answered.
    const { check } = await runWithout(answered('lesson-a → context/source.md', 'lesson-b → skipped: covered by a skill'));

    expect(check.unpromoted).toEqual([]);
    expect(warnings).toEqual([]);
    expect(infos).toEqual(['   Lesson `lesson-a` promoted to context/source.md.']);
  });

  test('names no provider as the reason when a provider is handed over', async () => {
    // The control for the reason: the same answer over `gh`, no pull request open.
    const fakeGh = createFakePrGh();
    await checkWrapUpAnswer({
      lessons: [lesson('lesson-a'), lesson('lesson-b')],
      output: answered('lesson-a → context/source.md'),
      head: HEAD,
      repoRoot: ROOT,
      branch: BRANCH,
      git: stubGit(diffOf('context/source.md')).git,
      pulls: createGhPullRequests({ gh: fakeGh.run }),
      learning: () => stubLearning().learning,
    });

    expect(fakeGh.calls().length).toBeGreaterThan(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toStartWith(`   This line is not in the pull request body, as no open pull request was found for ${BRANCH}: `);
    expect(warnings[0]).not.toContain(NO_PROVIDER_REASON);
  });
});
