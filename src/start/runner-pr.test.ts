/**
 * Tests for the runner-opened pull request (`runner-pr.ts`).
 *
 * {@link openRunnerPullRequest} is driven through stand-in seams that
 * record each call, so every case reads both the outcome and which
 * steps ran: a blocked step is a control on the opened case, since the
 * same input with one seam failing answers `blocked` at that step and
 * sends nothing after it. The provider is the port's double
 * (`pr/pull-requests-double.ts`), which refuses any member a case did
 * not name, so a create sent where none should be fails the case.
 *
 * {@link runnerPrSeamsIn}'s tree reading and {@link fragmentNotesIn} are
 * effects, so they run over REAL git and real files under the case's
 * own `mkdtemp` directory, with `GIT_CONFIG_GLOBAL` and
 * `GIT_CONFIG_SYSTEM` at `/dev/null` and the author named by
 * `gitIdentityEnv`, whose variables win over the repo's own config.
 */
import type { RunnerPrInput, RunnerPrSeams, WorkingTreeReading } from './runner-pr.js';
import type { PullRequestDraft, PullRequestSummary, PushOutcome } from '../pr/index.js';

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, test } from 'bun:test';

import { createPullRequestsDouble } from '../pr/pull-requests-double.js';
import { gitIdentityEnv } from '../tests/git-identity.js';

import {
  fragmentNotesIn,
  openRunnerPullRequest,
  RELEASE_NOTES_HEADING,
  runnerPrSeamsIn,
  runnerPullRequestBody,
  UNFINISHED_WRAP_UP_LINE,
} from './runner-pr.js';

const BRANCH = 'feat/rafa-579-loop-run-ends-delivered';

const NOTES = ['- start: a run ends with its pull request', '- config: loop.wrapUp.retries'];

const INPUT: RunnerPrInput = {
  branch: BRANCH,
  base: 'main',
  issue: 579,
  planTitle: 'A loop run ends delivered — eight loop bugs fixed',
  notes: NOTES,
};

/** The summary the double's create answers. */
function summary(draft: PullRequestDraft): PullRequestSummary {
  return {
    number: 601,
    title: draft.title,
    url: 'https://github.com/o/r/pull/601',
    state: 'open',
    headRefName: draft.head,
    baseRefName: draft.base,
    author: { login: 'rafa', isBot: false },
    isCrossRepository: false,
    updatedAt: '2026-10-01T00:00:00Z',
  };
}

/** Stand-in seams recording each step, with the given answers. */
function seamsWith(answers: {
  readonly tree?: WorkingTreeReading;
  readonly push?: PushOutcome;
  readonly create?: (draft: PullRequestDraft) => Promise<PullRequestSummary>;
} = {}): { seams: RunnerPrSeams; steps: () => readonly string[]; drafts: () => readonly PullRequestDraft[] } {
  let steps: readonly string[] = [];
  let drafts: readonly PullRequestDraft[] = [];
  const create = answers.create ?? ((draft) => Promise.resolve(summary(draft)));
  const double = createPullRequestsDouble({
    create: (draft) => {
      drafts = [...drafts, draft];
      return create(draft);
    },
  });
  const seams: RunnerPrSeams = {
    readWorkingTree: () => {
      steps = [...steps, 'tree'];
      return answers.tree ?? { ok: true, entries: [] };
    },
    pushBranch: (branch) => {
      steps = [...steps, `push ${branch}`];
      return Promise.resolve(answers.push ?? { ok: true, output: '' });
    },
    pulls: double.pulls,
  };
  return {
    seams,
    steps: () => [...steps, ...double.sent().map((line) => line.split(' ')[0] ?? '')],
    drafts: () => drafts,
  };
}

describe('openRunnerPullRequest', () => {
  test('on a clean tree, pushes the branch then creates the pull request from it', async () => {
    const { seams, steps, drafts } = seamsWith();

    const outcome = await openRunnerPullRequest(INPUT, seams);

    expect(outcome.kind).toBe('opened');
    expect(steps()).toEqual(['tree', `push ${BRANCH}`, 'create']);
    expect(drafts()).toHaveLength(1);
    expect(drafts()[0]?.head).toBe(BRANCH);
    expect(drafts()[0]?.base).toBe('main');
  });

  test('titles the pull request rafa-<n>: <plan title>', async () => {
    const { seams, drafts } = seamsWith();

    await openRunnerPullRequest(INPUT, seams);

    expect(drafts()[0]?.title).toBe('rafa-579: A loop run ends delivered — eight loop bugs fixed');
  });

  test('gives the pull request a body opening Closes #<n>, with the notes and the unfinished line', async () => {
    const { seams, drafts } = seamsWith();

    await openRunnerPullRequest(INPUT, seams);

    const body = drafts()[0]?.body ?? '';
    expect(body.split('\n')[0]).toBe('Closes #579');
    expect(body).toBe(runnerPullRequestBody(579, NOTES));
  });

  test('answers the pull request the provider opened', async () => {
    const { seams } = seamsWith();

    const outcome = await openRunnerPullRequest(INPUT, seams);

    expect(outcome.kind === 'opened'
      ? outcome.pull.number
      : null).toBe(601);
  });

  test('is blocked at the dirty tree step naming each uncommitted file, pushing and creating nothing', async () => {
    const { seams, steps } = seamsWith({ tree: { ok: true, entries: [' M src/start.ts', '?? notes.txt'] } });

    const outcome = await openRunnerPullRequest(INPUT, seams);

    expect(outcome.kind).toBe('blocked');
    if (outcome.kind !== 'blocked') return;
    expect(outcome.step).toBe('dirty tree');
    expect(outcome.branch).toBe(BRANCH);
    expect(outcome.detail).toContain(' M src/start.ts');
    expect(outcome.detail).toContain('?? notes.txt');
    expect(outcome.message).toContain(BRANCH);
    expect(outcome.message).toContain('dirty tree');
    expect(steps()).toEqual(['tree']);
  });

  test('is blocked at the dirty tree step when the tree cannot be read', async () => {
    const { seams, steps } = seamsWith({ tree: { ok: false, reason: 'fatal: not a git repository' } });

    const outcome = await openRunnerPullRequest(INPUT, seams);

    expect(outcome.kind === 'blocked'
      ? [outcome.step, outcome.detail]
      : null).toEqual(['dirty tree', 'The working tree could not be read: fatal: not a git repository']);
    expect(steps()).toEqual(['tree']);
  });

  test('is blocked at the push step with what git said, creating nothing', async () => {
    const said = '! [rejected]        feat/x -> feat/x (non-fast-forward)';
    const { seams, steps } = seamsWith({ push: { ok: false, output: said } });

    const outcome = await openRunnerPullRequest(INPUT, seams);

    expect(outcome.kind).toBe('blocked');
    if (outcome.kind !== 'blocked') return;
    expect(outcome.step).toBe('push');
    expect(outcome.detail).toBe(said);
    expect(outcome.message).toContain(`for ${BRANCH} at the push step`);
    expect(outcome.message).toContain(said);
    expect(steps()).toEqual(['tree', `push ${BRANCH}`]);
  });

  test('names a push that failed in silence rather than leaving the detail empty', async () => {
    const { seams } = seamsWith({ push: { ok: false, output: '' } });

    const outcome = await openRunnerPullRequest(INPUT, seams);

    expect(outcome.kind === 'blocked'
      ? outcome.detail
      : null).toBe('git push failed and said nothing');
  });

  test('is blocked at the create step with what the provider said', async () => {
    const { seams, steps } = seamsWith({ create: () => Promise.reject(new Error('gh: a pull request already exists')) });

    const outcome = await openRunnerPullRequest(INPUT, seams);

    expect(outcome.kind).toBe('blocked');
    if (outcome.kind !== 'blocked') return;
    expect(outcome.step).toBe('create');
    expect(outcome.detail).toBe('gh: a pull request already exists');
    expect(outcome.message).toContain(`for ${BRANCH} at the create step`);
    expect(steps()).toEqual(['tree', `push ${BRANCH}`, 'create']);
  });
});

describe('runnerPullRequestBody', () => {
  test('opens Closes #<n>, then the notes under their heading, then the unfinished line last', () => {
    const body = runnerPullRequestBody(579, NOTES);

    expect(body).toBe([
      'Closes #579',
      '',
      RELEASE_NOTES_HEADING,
      '',
      ...NOTES,
      '',
      UNFINISHED_WRAP_UP_LINE,
    ].join('\n'));
  });

  test('gives no notes heading when the fragment has no notes', () => {
    const body = runnerPullRequestBody(579, []);

    expect(body).toBe(['Closes #579', '', UNFINISHED_WRAP_UP_LINE].join('\n'));
    expect(body).not.toContain(RELEASE_NOTES_HEADING);
  });

  test('says the wrap-up did not finish', () => {
    expect(UNFINISHED_WRAP_UP_LINE).toContain('The wrap-up did not finish');
  });
});

describe('over a real checkout', () => {
  let dirs: readonly string[] = [];

  afterEach(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    dirs = [];
  });

  /** Runs git in `cwd` with no user or system config, committing as the test identity. */
  function git(cwd: string, args: readonly string[]): void {
    const result = spawnSync('git', [...args], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, ...gitIdentityEnv(), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
    });
    if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  }

  /** A scratch repository with one commit, made under {@link gitIdentityEnv}'s author. */
  function repo(): string {
    const dir = mkdtempSync(join(tmpdir(), 'rafa-runner-pr-'));
    dirs = [...dirs, dir];
    git(dir, ['init', '--quiet', '--initial-branch', 'main']);
    git(dir, ['config', 'user.name', 'Rafa Test']);
    git(dir, ['config', 'user.email', 'rafa@example.invalid']);
    writeFileSync(join(dir, 'README.md'), '# scratch\n');
    git(dir, ['add', '--', 'README.md']);
    git(dir, ['commit', '--quiet', '-m', 'init']);
    return dir;
  }

  test('reads a committed checkout as a clean tree', () => {
    const dir = repo();

    expect(runnerPrSeamsIn(dir).readWorkingTree()).toEqual({ ok: true, entries: [] });
  });

  test('reads an edit and an untracked file as the tree\'s entries', () => {
    const dir = repo();
    writeFileSync(join(dir, 'README.md'), '# edited\n');
    writeFileSync(join(dir, 'new.txt'), 'new\n');

    expect(runnerPrSeamsIn(dir).readWorkingTree()).toEqual({ ok: true, entries: [' M README.md', '?? new.txt'] });
  });

  test('answers a directory git cannot read as a tree it could not read', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rafa-runner-pr-gone-'));
    rmSync(dir, { recursive: true, force: true });

    expect(runnerPrSeamsIn(dir).readWorkingTree().ok).toBe(false);
  });

  test('reads the fragment\'s notes from the checkout', () => {
    const dir = repo();
    mkdirSync(join(dir, '.changes'));
    writeFileSync(join(dir, '.changes', 'rafa-579.md'), [
      '---',
      'plan: rafa-579',
      'title: A loop run ends delivered',
      'level: minor',
      '---',
      '',
      ...NOTES,
      '',
    ].join('\n'));

    expect(fragmentNotesIn(dir, '.changes/rafa-579.md')).toEqual(NOTES);
  });

  test('reads no notes from a fragment that is absent, unnamed or refused', () => {
    const dir = repo();
    writeFileSync(join(dir, 'broken.md'), 'no front matter here\n');

    expect(fragmentNotesIn(dir, null)).toEqual([]);
    expect(fragmentNotesIn(dir, '.changes/missing.md')).toEqual([]);
    expect(fragmentNotesIn(dir, 'broken.md')).toEqual([]);
  });
});
