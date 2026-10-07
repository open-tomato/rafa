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
 * The project refresh after the create is a recorded seam too: each
 * blocked case shows it is never asked, the control to the opened case
 * that asks it for the issue the body closes. {@link refreshClosedIssues}
 * is driven with a stand-in refresh and a runner opener that counts its
 * calls, so no case reaches `gh`.
 *
 * {@link runnerPrSeamsIn}'s tree reading and {@link fragmentNotesIn} are
 * effects, so they run over REAL git and real files under the case's
 * own `mkdtemp` directory, with `GIT_CONFIG_GLOBAL` and
 * `GIT_CONFIG_SYSTEM` at `/dev/null` and the author named by
 * `gitIdentityEnv`, whose variables win over the repo's own config.
 */
import type { ClosedIssuesRefreshOptions, RunnerPrInput, RunnerPrSeams, WorkingTreeReading } from './runner-pr.js';
import type { GhRunner } from '../adapters/tracker/github.js';
import type { ProjectRefresh } from '../board/project/refresh.js';
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
  refreshClosedIssues,
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
  readonly refresh?: (issues: readonly number[]) => Promise<readonly string[]>;
} = {}): {
  seams: RunnerPrSeams;
  steps: () => readonly string[];
  drafts: () => readonly PullRequestDraft[];
  refreshed: () => readonly (readonly number[])[];
} {
  let steps: readonly string[] = [];
  let drafts: readonly PullRequestDraft[] = [];
  let refreshed: readonly (readonly number[])[] = [];
  const refresh = answers.refresh ?? (() => Promise.resolve([]));
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
    refreshProject: (issues) => {
      // Recorded with how many creates were sent by then, to read that it ran after the create.
      refreshed = [...refreshed, [double.sent().length, ...issues]];
      return refresh(issues);
    },
  };
  return {
    seams,
    steps: () => [...steps, ...double.sent().map((line) => line.split(' ')[0] ?? '')],
    drafts: () => drafts,
    refreshed: () => refreshed,
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
    const { seams, steps, refreshed } = seamsWith({ tree: { ok: true, entries: [' M src/start.ts', '?? notes.txt'] } });

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
    expect(refreshed()).toEqual([]);
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
    const { seams, steps, refreshed } = seamsWith({ push: { ok: false, output: said } });

    const outcome = await openRunnerPullRequest(INPUT, seams);

    expect(outcome.kind).toBe('blocked');
    if (outcome.kind !== 'blocked') return;
    expect(outcome.step).toBe('push');
    expect(outcome.detail).toBe(said);
    expect(outcome.message).toContain(`for ${BRANCH} at the push step`);
    expect(outcome.message).toContain(said);
    expect(steps()).toEqual(['tree', `push ${BRANCH}`]);
    expect(refreshed()).toEqual([]);
  });

  test('names a push that failed in silence rather than leaving the detail empty', async () => {
    const { seams } = seamsWith({ push: { ok: false, output: '' } });

    const outcome = await openRunnerPullRequest(INPUT, seams);

    expect(outcome.kind === 'blocked'
      ? outcome.detail
      : null).toBe('git push failed and said nothing');
  });

  test('is blocked at the create step with what the provider said', async () => {
    const { seams, steps, refreshed } = seamsWith({ create: () => Promise.reject(new Error('gh: a pull request already exists')) });

    const outcome = await openRunnerPullRequest(INPUT, seams);

    expect(outcome.kind).toBe('blocked');
    if (outcome.kind !== 'blocked') return;
    expect(outcome.step).toBe('create');
    expect(outcome.detail).toBe('gh: a pull request already exists');
    expect(outcome.message).toContain(`for ${BRANCH} at the create step`);
    expect(steps()).toEqual(['tree', `push ${BRANCH}`, 'create']);
    expect(refreshed()).toEqual([]);
  });
});

describe('the project refresh after the runner opens the pull request', () => {
  test('refreshes the issue the body closes, once, after the create', async () => {
    const { seams, refreshed } = seamsWith();

    const outcome = await openRunnerPullRequest(INPUT, seams);

    expect(outcome.kind).toBe('opened');
    expect(refreshed()).toEqual([[1, 579]]);
  });

  test('answers an opened pull request with no warning when the refresh answers none', async () => {
    const { seams } = seamsWith();

    const outcome = await openRunnerPullRequest(INPUT, seams);

    expect(outcome.kind === 'opened'
      ? outcome.warnings
      : null).toEqual([]);
  });

  test('answers the refresh\'s lines with the pull request, never blocking the attempt', async () => {
    const line = 'The project was not updated: run `gh auth refresh -s project`.';
    const { seams } = seamsWith({ refresh: () => Promise.resolve([line]) });

    const outcome = await openRunnerPullRequest(INPUT, seams);

    expect(outcome.kind === 'opened'
      ? [outcome.pull.number, outcome.warnings]
      : null).toEqual([601, [line]]);
  });

  test('answers a refresh that rejects as the failed line naming the issue and rafa board sync', async () => {
    const { seams } = seamsWith({ refresh: () => Promise.reject(new Error('repo view refused')) });

    const outcome = await openRunnerPullRequest(INPUT, seams);

    expect(outcome.kind).toBe('opened');
    if (outcome.kind !== 'opened') return;
    expect(outcome.warnings).toHaveLength(1);
    expect(outcome.warnings[0]).toContain('The project was not updated for #579: repo view refused.');
    expect(outcome.warnings[0]).toContain('rafa board sync');
  });
});

/** A refresh config with `board.project.number` set to `number`. */
function refreshConfig(number: number | null): ClosedIssuesRefreshOptions['config'] {
  return { boardProjectNumber: number, boardRelationships: 'labels', roadmapIssue: null, releaseFragments: '.changes' };
}

/** A runner that refuses every call: a case that reaches it sent a `gh` call it should not have. */
const REFUSING_GH: GhRunner = () => {
  throw new Error('unplanned gh call');
};

/** What one {@link refreshClosedIssues} call asked and answered. */
async function refreshRun(
  number: number | null,
  answer: () => Promise<ProjectRefresh>,
): Promise<{ asked: readonly (readonly number[])[]; opened: number; lines: readonly string[] }> {
  const asked: (readonly number[])[] = [];
  let opened = 0;
  const lines = await refreshClosedIssues({
    config: refreshConfig(number),
    openGh: () => {
      opened += 1;
      return REFUSING_GH;
    },
    refresh: (options, issues) => {
      expect(options.gh).toBe(REFUSING_GH);
      asked.push(issues);
      return answer();
    },
  }, [579]);
  return { asked, opened, lines };
}

/** A refresh answering `warnings`. */
function answering(warnings: readonly string[]): () => Promise<ProjectRefresh> {
  return () => Promise.resolve({ kind: 'skipped', reason: 'no-issues', warnings });
}

describe('refreshClosedIssues', () => {
  test('opens no runner and refreshes nothing with board.project.number unset', async () => {
    const run = await refreshRun(null, answering(['never answered']));

    expect([run.asked, run.opened, run.lines]).toEqual([[], 0, []]);
  });

  test('control: refreshes the closed issue through the runner it opened with the number set', async () => {
    const run = await refreshRun(6, answering(['the project was not updated']));

    expect([run.asked, run.opened, run.lines]).toEqual([[[579]], 1, ['the project was not updated']]);
  });

  test('answers a refresh that rejects with the failed line, never rejecting', async () => {
    const run = await refreshRun(6, () => Promise.reject(new Error('repo view refused')));

    expect(run.lines).toHaveLength(1);
    expect(run.lines[0]).toContain('The project was not updated for #579: repo view refused.');
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

    expect(runnerPrSeamsIn(dir, refreshConfig(null)).readWorkingTree()).toEqual({ ok: true, entries: [] });
  });

  test('reads an edit and an untracked file as the tree\'s entries', () => {
    const dir = repo();
    writeFileSync(join(dir, 'README.md'), '# edited\n');
    writeFileSync(join(dir, 'new.txt'), 'new\n');

    expect(runnerPrSeamsIn(dir, refreshConfig(null)).readWorkingTree()).toEqual({ ok: true, entries: [' M README.md', '?? new.txt'] });
  });

  test('answers a directory git cannot read as a tree it could not read', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rafa-runner-pr-gone-'));
    rmSync(dir, { recursive: true, force: true });

    expect(runnerPrSeamsIn(dir, refreshConfig(null)).readWorkingTree().ok).toBe(false);
  });

  test('sends no refresh from a checkout whose config sets no board.project.number', async () => {
    const dir = repo();

    expect(await runnerPrSeamsIn(dir, refreshConfig(null)).refreshProject([579])).toEqual([]);
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
