/**
 * `rafa cleanup`, dispatched, over the scratch repository of
 * `src/cleanup/scratch-repository.ts` and real git: the four
 * definition-of-done items of the command.
 *
 *  - Enter then `y` deletes the merged and squash-merged branches and
 *    the clean merged worktree, and keeps the stale, unpushed, dirty and
 *    locked ones;
 *  - ticking the Not-pushed branch asks the second question, and `n`
 *    keeps it (answered `y` it is deleted, so the question decides);
 *  - with no terminal the four groups print, exit 0, and nothing is
 *    removed;
 *  - `--dry-run` prints the git commands and removes nothing.
 *
 * Every case builds its own repository, since a run removes things. The
 * pull request provider is a double naming the squash-merged branch's
 * pull request; the keys and the yes-or-no answers are scripted.
 */
import type { CapturedRun } from './cli-capture.js';
import type { ScratchRepository } from '../cleanup/scratch-repository.js';
import type { Prompter } from '../cli/prompt/confirm.js';
import type { Key, Terminal } from '../cli/prompt/terminal.js';
import type { CleanupCommandSeams } from '../commands/cleanup.js';

import { existsSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { createScratchRepository, SCRATCH_NOW } from '../cleanup/scratch-repository.js';
import { cleanupQuestion, createCleanupCommand } from '../commands/cleanup.js';
import { createPullRequestsDouble } from '../pr/pull-requests-double.js';

import { dispatchInProject, plantProjectConfig } from './cli-capture.js';

const ENTER: Key = { name: 'enter' };
const DOWN: Key = { name: 'down' };
const SPACE: Key = { name: 'char', char: ' ' };

/** Rows before the Not-pushed row: three Merged, one Stale. */
const ROWS_BEFORE_NOT_PUSHED = 4;

/**
 * How far past the moment the scratch repository is dated the command's
 * clock runs: the worktrees were made a moment ago on the real disk, so
 * only a later clock finds them idle past the default `cleanup.worktreeIdleDays`.
 */
const CLOCK_AHEAD_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

interface Case {
  readonly run: CapturedRun;
  readonly asked: string[];
  readonly repo: ScratchRepository;
}

let repo: ScratchRepository;

beforeEach(() => {
  repo = createScratchRepository();
  plantProjectConfig(repo.clone);
  // `gone` is a Merged row by its upstream alone, and git's `-d` refuses a
  // branch its base does not reach: a step that fails clean, and so exit 1.
  // These cases are about the rows a `-d` or a squash-merge `-D` deletes.
  repo.git(['branch', '-D', 'gone']);
});

afterEach(() => {
  repo.dispose();
});

/** Runs `rafa cleanup <words>` from the clone, with scripted keys and answers. */
async function cleanup(words: readonly string[], options: { keys?: readonly Key[]; answers?: readonly string[]; isTTY?: boolean } = {}): Promise<Case> {
  const asked: string[] = [];
  const answers = [...(options.answers ?? [])];
  const double = createPullRequestsDouble({
    listMerged: () => Promise.resolve([{
      number: 7,
      headRefName: 'squashed',
      headRefOid: repo.squashedTip,
      mergedAt: SCRATCH_NOW.toISOString(),
    }]),
  });
  const terminal: Terminal = {
    isTTY: options.isTTY ?? true,
    setRawMode: () => undefined,
    write: () => undefined,
    onInterrupt: () => () => undefined,
    exit: () => undefined,
  };
  const seams: CleanupCommandSeams = {
    now: () => new Date(SCRATCH_NOW.getTime() + CLOCK_AHEAD_DAYS * MS_PER_DAY),
    readRemote: () => 'git@github.com:open-tomato/scratch.git',
    pullRequests: () => double.pulls,
    terminal: () => terminal,
    keys: async function* (): AsyncGenerator<Key> {
      yield* options.keys ?? [];
    },
    openPrompter: (): Prompter => ({
      say: () => undefined,
      ask: (question) => {
        asked.push(question);
        const answer = answers.shift();
        if (answer === undefined) throw new Error(`no scripted answer for: ${question}`);
        return Promise.resolve(answer);
      },
      close: () => undefined,
    }),
  };
  const run = await dispatchInProject(
    ['cleanup', ...words],
    [],
    [createCleanupCommand({ ...seams, cwd: () => repo.clone })],
    { root: repo.clone, home: repo.home },
  );
  return { run, asked, repo };
}

/** The local branch names. */
function branches(): string[] {
  return repo.git(['for-each-ref', '--format=%(refname:short)', 'refs/heads']).split('\n')
    .filter((name) => name !== '');
}

const KEPT = ['main', 'stale', 'unpushed', 'wt-dirty', 'wt-locked'];
const DELETED = ['merged', 'squashed', 'wt-clean'];

describe('rafa cleanup over the scratch repository', () => {
  it('deletes the merged and squash-merged branches and the clean merged worktree on Enter then y, keeping the rest', async () => {
    const { run, asked } = await cleanup([], { keys: [ENTER], answers: ['y'] });
    expect(run.stderr).toBe('');
    expect(run.exitCode).toBe(0);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toBe(cleanupQuestion(DELETED.length, 1));
    const left = branches();
    for (const name of DELETED) expect(left).not.toContain(name);
    for (const name of KEPT) expect(left).toContain(name);
    expect(existsSync(repo.worktrees.clean)).toBe(false);
    expect(existsSync(repo.worktrees.dirty)).toBe(true);
    expect(existsSync(repo.worktrees.locked)).toBe(true);
    expect(run.stdout).not.toContain('--force');
  });

  it('removes nothing when the final question is answered n (control)', async () => {
    const before = branches();
    const { run } = await cleanup([], { keys: [ENTER], answers: ['n'] });
    expect(run.exitCode).toBe(0);
    expect(branches()).toEqual(before);
    expect(existsSync(repo.worktrees.clean)).toBe(true);
  });

  it('asks the second question for a ticked Not-pushed branch, and n keeps it', async () => {
    const keys = [...Array<Key>(ROWS_BEFORE_NOT_PUSHED).fill(DOWN), SPACE, ENTER];
    const { run, asked } = await cleanup([], { keys, answers: ['n', 'y'] });
    expect(run.exitCode).toBe(0);
    expect(asked).toHaveLength(2);
    expect(asked[0]).toContain('unpushed holds 2 commits');
    expect(asked[1]).toBe(cleanupQuestion(DELETED.length, 1));
    const left = branches();
    expect(left).toContain('unpushed');
    for (const name of DELETED) expect(left).not.toContain(name);
  });

  it('deletes the Not-pushed branch when the second question is answered y (control)', async () => {
    const keys = [...Array<Key>(ROWS_BEFORE_NOT_PUSHED).fill(DOWN), SPACE, ENTER];
    const { asked } = await cleanup([], { keys, answers: ['y', 'y'] });
    expect(asked).toHaveLength(2);
    expect(branches()).not.toContain('unpushed');
    expect(branches()).toContain('stale');
  });

  it('prints the four groups and removes nothing without a terminal', async () => {
    const before = branches();
    const { run, asked } = await cleanup([], { isTTY: false });
    expect(run.exitCode).toBe(0);
    expect(asked).toEqual([]);
    for (const title of ['Merged', 'Stale', 'Not pushed', 'Worktrees']) expect(run.stdout).toContain(title);
    for (const name of [...DELETED, ...KEPT.slice(1)]) expect(run.stdout).toContain(name);
    expect(run.stdout).toContain('git push origin --delete stale');
    expect(branches()).toEqual(before);
    expect(existsSync(repo.worktrees.clean)).toBe(true);
  });

  it('prints the git commands and removes nothing under --dry-run', async () => {
    const before = branches();
    const { run, asked } = await cleanup(['--dry-run'], { keys: [ENTER], answers: [] });
    expect(run.exitCode).toBe(0);
    expect(asked).toEqual([]);
    expect(run.stdout).toContain(`git worktree remove ${repo.worktrees.clean}`);
    expect(run.stdout).toContain('git branch -d merged');
    expect(run.stdout).toContain('git branch -D squashed');
    expect(run.stdout).not.toContain('--force');
    expect(branches()).toEqual(before);
    expect(existsSync(repo.worktrees.clean)).toBe(true);
  });
});
