/**
 * `rafa cleanup`'s sixth group, the branches only on `origin`, end to end
 * over the scratch repository of `./scratch-repository.ts` with its
 * remote-only option, and real git throughout: the reading, the fetch,
 * the checklist, and the `git push origin --delete` the ticked row turns
 * into. The terminal, its keys and the answers are scripted, and the
 * pull request provider is a double.
 *
 * What the listing shows, with and without a terminal:
 *
 *  - `remote-unmerged` with its count, two of two commits without a
 *    patch-equal copy on `main`;
 *  - `remote-copied`, whose reason says every commit has a copy;
 *  - no `stretch/9`, which is under a stretch's prefix;
 *  - no `remote-reviewed`, a branch only on `origin` that the double
 *    gives an open pull request.
 *
 * What a run does:
 *
 *  - `--dry-run` with the unmerged row ticked prints
 *    `git push origin --delete remote-unmerged` and leaves `origin` as
 *    it was;
 *  - the same keys without `--dry-run`, answered `y`, leave
 *    `git ls-remote origin` without that branch and with every other
 *    branch it had;
 *  - the same keys answered `n` delete nothing, so the deletion is read
 *    against a run that asks and is refused.
 *
 * Every case builds its own repository, since a run removes things.
 */
import type { ScratchRepository } from './scratch-repository.js';
import type { Key, Terminal } from '../cli/prompt/terminal.js';
import type { CapturedRun } from '../tests/cli-capture.js';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { cleanupGroups, cleanupQuestion, createCleanupCommand } from '../commands/cleanup.js';
import { createPullRequestsDouble } from '../pr/pull-requests-double.js';
import { dispatchInProject, plantProjectConfig } from '../tests/cli-capture.js';

import { createScratchRepository, REMOTE_ONLY_BRANCHES, REMOTE_ONLY_COMMITS, SCRATCH_NOW } from './scratch-repository.js';

import { defaultCleanupSeams, readCleanup, remoteOnlyReason } from './index.js';

const DOWN: Key = { name: 'down' };
const ENTER: Key = { name: 'enter' };
const SPACE: Key = { name: 'char', char: ' ' };

/** A branch only on `origin` that an open pull request names, so it is never listed. */
const REVIEWED = 'remote-reviewed';

/** The number of the open pull request the double gives {@link REVIEWED}. */
const REVIEWED_PULL_NUMBER = 41;

/**
 * How far past the moment the scratch repository is dated the command's
 * clock runs, so the worktrees are idle as in the other integration cases.
 */
const CLOCK_AHEAD_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * The local branches Enter leaves ticked: `merged` and `wt-clean`. The
 * double names no merged pull request, so `squashed` is not among them.
 */
const DEFAULT_LOCAL_BRANCHES = 2;

interface Case {
  readonly run: CapturedRun;
  readonly asked: string[];
}

let repo: ScratchRepository;

beforeEach(() => {
  repo = createScratchRepository({ remoteOnly: true });
  plantProjectConfig(repo.clone);
  // `gone` is a Merged row by its upstream alone, and git's `-d` refuses a
  // branch its base does not reach: a step that fails clean, and so exit 1.
  // These cases are about the rows of the sixth group.
  repo.git(['branch', '-D', 'gone']);
  addReviewedBranch();
});

afterEach(() => {
  repo.dispose();
});

/** Pushes {@link REVIEWED} to `origin` and deletes the local copy, as the set's own branches are. */
function addReviewedBranch(): void {
  repo.git(['switch', '--quiet', '-c', REVIEWED, 'main']);
  repo.git(['commit', '--quiet', '--allow-empty', '-m', `${REVIEWED} 1`]);
  repo.git(['push', '--quiet', 'origin', REVIEWED]);
  repo.git(['switch', '--quiet', 'main']);
  repo.git(['branch', '--quiet', '-D', REVIEWED]);
}

function terminal(isTTY: boolean): Terminal {
  return {
    isTTY,
    setRawMode: () => undefined,
    write: () => undefined,
    onInterrupt: () => () => undefined,
    exit: () => undefined,
  };
}

/** The provider double: `main` has one open pull request, from {@link REVIEWED}. */
function provider(): ReturnType<typeof createPullRequestsDouble> {
  return createPullRequestsDouble({
    listMerged: () => Promise.resolve([]),
    list: () => Promise.resolve([{
      number: REVIEWED_PULL_NUMBER,
      title: 'Work under review',
      url: `https://github.com/open-tomato/scratch/pull/${String(REVIEWED_PULL_NUMBER)}`,
      state: 'open',
      headRefName: REVIEWED,
      baseRefName: 'main',
      author: { login: 'someone', isBot: false },
      isCrossRepository: false,
      updatedAt: SCRATCH_NOW.toISOString(),
    }]),
  });
}

/** Runs `rafa cleanup <words>` from the clone, with scripted keys and answers. */
async function cleanup(words: readonly string[], options: { keys?: readonly Key[]; answers?: readonly string[]; isTTY?: boolean } = {}): Promise<Case> {
  const asked: string[] = [];
  const answers = [...(options.answers ?? [])];
  const command = createCleanupCommand({
    cwd: () => repo.clone,
    now: () => new Date(SCRATCH_NOW.getTime() + CLOCK_AHEAD_DAYS * MS_PER_DAY),
    readRemote: () => 'git@github.com:open-tomato/scratch.git',
    pullRequests: () => provider().pulls,
    terminal: () => terminal(options.isTTY ?? true),
    keys: async function* (): AsyncGenerator<Key> {
      yield* options.keys ?? [];
    },
    openPrompter: () => ({
      say: () => undefined,
      ask: (question) => {
        asked.push(question);
        const answer = answers.shift();
        if (answer === undefined) throw new Error(`no scripted answer for: ${question}`);
        return Promise.resolve(answer);
      },
      close: () => undefined,
    }),
  });
  const run = await dispatchInProject(['cleanup', ...words], [], [command], { root: repo.clone, home: repo.home });
  return { run, asked };
}

/** The keys that move onto the row of branch `name` only on `origin`, tick it, and go on: Enter. */
async function tickKeys(name: string): Promise<readonly Key[]> {
  const reading = await readCleanup(defaultCleanupSeams(repo.clone, provider().pulls), {
    fetch: true,
    base: null,
    keep: [],
    staleDays: 30,
    worktreeIdleDays: 0,
    now: new Date(SCRATCH_NOW.getTime() + CLOCK_AHEAD_DAYS * MS_PER_DAY),
    home: repo.home,
    cwd: repo.clone,
    projectRoot: repo.clone,
    worktreeDir: '.rafa/worktrees',
  });
  if (!reading.ok) throw new Error(reading.detail);
  const rows = cleanupGroups(reading).flatMap((group) => group.choices.map((choice) => choice.value));
  const index = rows.findIndex((row) => 'group' in row && row.group === 'remote-only' && row.name === name);
  expect(index).toBeGreaterThanOrEqual(0);
  return [...Array.from({ length: index }, () => DOWN), SPACE, ENTER];
}

/** The branch names `git ls-remote --heads origin` answers, sorted. */
function originBranches(): string[] {
  return repo.git(['ls-remote', '--heads', 'origin'])
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => line.split('\trefs/heads/')[1] ?? '')
    .sort();
}

describe('rafa cleanup --dry-run over the remote-only set', () => {
  it('lists the unmerged branch with its count and the copied branch as having a copy of every commit', async () => {
    const before = originBranches();

    const { run, asked } = await cleanup(['--dry-run'], { isTTY: false });

    expect(run.exitCode).toBe(0);
    expect(asked).toEqual([]);
    const unmerged = run.stdout.split('\n').find((line) => line.includes(REMOTE_ONLY_BRANCHES.unmerged));
    expect(unmerged).toContain(remoteOnlyReason(REMOTE_ONLY_COMMITS, REMOTE_ONLY_COMMITS, 'main'));
    expect(unmerged).toContain(`${String(REMOTE_ONLY_COMMITS)} of ${String(REMOTE_ONLY_COMMITS)} commits with no patch-equal copy`);
    const copied = run.stdout.split('\n').find((line) => line.includes(REMOTE_ONLY_BRANCHES.copied));
    expect(copied).toContain('every commit has a patch-equal copy on origin/main');
    expect(originBranches()).toEqual(before);
  });

  it('lists neither stretch/9 nor the branch an open pull request names', async () => {
    const { run } = await cleanup(['--dry-run'], { isTTY: false });

    expect(run.exitCode).toBe(0);
    expect(run.stdout).not.toContain(REMOTE_ONLY_BRANCHES.stretch);
    expect(run.stdout).not.toContain(REVIEWED);
    // The control: both are on origin, so their absence is the reading's.
    expect(originBranches()).toContain(REMOTE_ONLY_BRANCHES.stretch);
    expect(originBranches()).toContain(REVIEWED);
  });

  it('prints the push of the ticked row and leaves origin as it was', async () => {
    const keys = await tickKeys(REMOTE_ONLY_BRANCHES.unmerged);
    const before = originBranches();

    const { run, asked } = await cleanup(['--dry-run'], { keys });

    expect(run.exitCode).toBe(0);
    expect(asked).toEqual([]);
    expect(run.stdout).toContain(`git push origin --delete ${REMOTE_ONLY_BRANCHES.unmerged}`);
    expect(run.stdout).not.toContain('--force');
    expect(originBranches()).toEqual(before);
  });
});

describe('rafa cleanup with a ticked remote-only row', () => {
  it('leaves git ls-remote origin without the branch and with every other branch', async () => {
    const keys = await tickKeys(REMOTE_ONLY_BRANCHES.unmerged);
    const before = originBranches();
    expect(before).toContain(REMOTE_ONLY_BRANCHES.unmerged);

    const { run, asked } = await cleanup([], { keys, answers: ['y'] });

    expect(run.exitCode).toBe(0);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toBe(cleanupQuestion(DEFAULT_LOCAL_BRANCHES, 1, 0, 1));
    expect(originBranches()).toEqual(before.filter((name) => name !== REMOTE_ONLY_BRANCHES.unmerged));
    expect(originBranches()).toEqual(expect.arrayContaining([
      'main',
      REMOTE_ONLY_BRANCHES.copied,
      REMOTE_ONLY_BRANCHES.stretch,
      REVIEWED,
    ]));
  });

  it('leaves origin as it was when the final question is answered n (control)', async () => {
    const keys = await tickKeys(REMOTE_ONLY_BRANCHES.unmerged);
    const before = originBranches();

    const { run, asked } = await cleanup([], { keys, answers: ['n'] });

    expect(run.exitCode).toBe(0);
    expect(asked).toHaveLength(1);
    expect(originBranches()).toEqual(before);
  });
});
