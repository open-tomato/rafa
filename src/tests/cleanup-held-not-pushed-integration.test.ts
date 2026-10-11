/**
 * `rafa cleanup`, dispatched, over the scratch repository of
 * `src/cleanup/scratch-repository.ts` and real git, holding a Not-pushed
 * branch (`unpushed`) checked out in a dirty worktree (#860).
 *
 * With that row ticked and a recording prompter, the command asks no
 * commit-count question about it, leaves the branch and its worktree in
 * place, and prints the row as withheld (`not removed:`). The control
 * runs the same keys over the repository without the holding worktree:
 * there the question IS asked, so the missing question is read against a
 * run that asks.
 */
import type { CapturedRun } from './cli-capture.js';
import type { ScratchRepository } from '../cleanup/scratch-repository.js';
import type { Prompter } from '../cli/prompt/confirm.js';
import type { Key, Terminal } from '../cli/prompt/terminal.js';
import type { CleanupCommandSeams } from '../commands/cleanup.js';

import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { createScratchRepository, SCRATCH_NOW } from '../cleanup/scratch-repository.js';
import { createCleanupCommand } from '../commands/cleanup.js';
import { createPullRequestsDouble } from '../pr/pull-requests-double.js';

import { dispatchInProject, plantProjectConfig } from './cli-capture.js';

const ENTER: Key = { name: 'enter' };
const DOWN: Key = { name: 'down' };
const SPACE: Key = { name: 'char', char: ' ' };

/** Rows before the Not-pushed row: three Merged, one Stale. */
const ROWS_BEFORE_NOT_PUSHED = 4;

const CLOCK_AHEAD_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

let repo: ScratchRepository;

beforeEach(() => {
  repo = createScratchRepository();
  plantProjectConfig(repo.clone);
  repo.git(['branch', '-D', 'gone']);
});

afterEach(() => {
  repo.dispose();
});

/** Checks `unpushed` out in a worktree of its own, dirty when `dirty`. */
function holdUnpushed(dirty: boolean): string {
  const path = join(repo.clone, '.claude', 'worktrees', 'wt-unpushed');
  repo.git(['worktree', 'add', '--quiet', path, 'unpushed']);
  if (dirty) writeFileSync(join(path, 'scratch.txt'), 'uncommitted\n');
  return path;
}

/** Runs `rafa cleanup` ticking the Not-pushed row, answering every question `y`. */
async function cleanupTickingNotPushed(): Promise<{ readonly run: CapturedRun; readonly asked: string[] }> {
  const asked: string[] = [];
  const keys = [...Array<Key>(ROWS_BEFORE_NOT_PUSHED).fill(DOWN), SPACE, ENTER];
  const double = createPullRequestsDouble({
    listMerged: () => Promise.resolve([{
      number: 7,
      headRefName: 'squashed',
      headRefOid: repo.squashedTip,
      mergedAt: SCRATCH_NOW.toISOString(),
    }]),
  });
  const terminal: Terminal = {
    isTTY: true,
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
      yield* keys;
    },
    openPrompter: (): Prompter => ({
      say: () => undefined,
      ask: (question) => {
        asked.push(question);
        return Promise.resolve('y');
      },
      close: () => undefined,
    }),
    cwd: () => repo.clone,
  };
  const run = await dispatchInProject(['cleanup'], [], [createCleanupCommand(seams)], { root: repo.clone, home: repo.home });
  return { run, asked };
}

function branches(): string[] {
  return repo.git(['for-each-ref', '--format=%(refname:short)', 'refs/heads']).split('\n')
    .filter((name) => name !== '');
}

describe('rafa cleanup with a Not-pushed branch held by a dirty worktree', () => {
  it('asks no commit-count question, keeps the branch and prints it as withheld', async () => {
    const worktree = holdUnpushed(true);
    const { run, asked } = await cleanupTickingNotPushed();
    expect(run.exitCode).toBe(0);
    expect(asked.filter((question) => question.includes('unpushed'))).toEqual([]);
    expect(branches()).toContain('unpushed');
    expect(existsSync(worktree)).toBe(true);
    expect(run.stdout).toMatch(/not removed:.*unpushed/);
  });

  it('asks the commit-count question for the same row when no worktree holds it (control)', async () => {
    const { asked } = await cleanupTickingNotPushed();
    expect(asked.some((question) => question.includes('unpushed holds 2 commits'))).toBe(true);
  });
});
