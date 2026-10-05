/**
 * A spawned test of `rafa cleanup --dry-run`: the real command, run as
 * `bun src/rafa.ts` in a scratch project whose `pr.base` is
 * `integration`, with `main` behind it and `origin/HEAD` naming `main`,
 * and a clean loop worktree under `.rafa/worktrees/<stub>` whose branch
 * was pushed and then deleted in the remote (`[gone]`).
 *
 * Two facts are held: no row names `main`, because the branch
 * `origin/HEAD` names is never listed beside `pr.base`; and the loop
 * worktree is listed as removable, because `loop.worktreeDir` is a root
 * of the worktree reading. With no terminal the command prints its four
 * groups and removes nothing, so the listing is what is read.
 *
 * `pr.provider: none` keeps the run off GitHub; no `gh` is planted.
 */
import type { ScratchRepo } from './cli-capture.js';

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { ADMIN_FILES, GIT_DIR } from '../cleanup/worktrees.js';

import { eventsOf, expectExit, plantProjectConfig, plantScratchRepo, runRafa } from './cli-capture.js';
import { gitIdentityEnv } from './git-identity.js';

const RUN_TIMEOUT = { timeout: 60_000 };

const STUB = 'rafa-950-cleanup-probe';
const LOOP_BRANCH = `feat/${STUB}`;

/** Older than the default `cleanup.worktreeIdleDays` (7), so the worktree is not `recent`. */
const AGED_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const scratchBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-cleanup-base-')));

afterAll(() => {
  rmSync(scratchBase, { recursive: true, force: true });
});

/** Runs git in `cwd` under the scratch home, answering its stdout. */
function git(scratch: ScratchRepo, cwd: string, args: readonly string[]): string {
  return execFileSync('git', [...args], {
    cwd,
    stdio: 'pipe',
    encoding: 'utf8',
    env: {
      PATH: scratch.path,
      HOME: scratch.home,
      GIT_CONFIG_GLOBAL: join(scratch.home, '.gitconfig'),
      GIT_CONFIG_NOSYSTEM: '1',
      ...gitIdentityEnv(),
    },
  });
}

/** Writes `text` to `path`, making its directories. */
function plant(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf8');
}

/** Commits one file on the checked-out branch. */
function commitFile(scratch: ScratchRepo, cwd: string, name: string): void {
  plant(join(cwd, name), `${name}\n`);
  git(scratch, cwd, ['add', '-A']);
  git(scratch, cwd, ['commit', '-q', '-m', `add ${name}`]);
}

/** Plants the scratch project described in the module note; answers it and the worktree path. */
function plantWorld(): { scratch: ScratchRepo; worktree: string } {
  const scratch = plantScratchRepo(scratchBase);
  const { repo } = scratch;
  plantProjectConfig(repo, 'pr:\n  provider: none\n  base: integration\n');
  const bare = join(dirname(repo), 'origin.git');
  git(scratch, dirname(repo), ['init', '-q', '--bare', bare]);
  git(scratch, repo, ['checkout', '-q', '-B', 'main']);
  plant(join(repo, '.gitignore'), '.rafa/\n');
  commitFile(scratch, repo, 'README.md');
  git(scratch, repo, ['remote', 'add', 'origin', bare]);
  git(scratch, repo, ['push', '-q', '-u', 'origin', 'main']);
  git(scratch, repo, ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main']);

  git(scratch, repo, ['checkout', '-q', '-b', 'integration']);
  commitFile(scratch, repo, 'integration.txt');
  git(scratch, repo, ['push', '-q', '-u', 'origin', 'integration']);

  const worktree = join(repo, '.rafa', 'worktrees', STUB);
  git(scratch, repo, ['worktree', 'add', '-q', '-b', LOOP_BRANCH, worktree, 'integration']);
  commitFile(scratch, worktree, 'loop-work.txt');
  git(scratch, worktree, ['push', '-q', '-u', 'origin', LOOP_BRANCH]);
  git(scratch, repo, ['push', '-q', 'origin', '--delete', LOOP_BRANCH]);
  git(scratch, repo, ['fetch', '-q', '--prune', 'origin']);

  // Last, so no git call after it moves a time again: the idle rule reads file times.
  const adminDir = git(scratch, worktree, GIT_DIR).trim();
  const aged = new Date(Date.now() - AGED_DAYS * MS_PER_DAY);
  for (const file of [worktree, ...ADMIN_FILES.map((name) => join(adminDir, name))]) utimesSync(file, aged, aged);
  return { scratch, worktree };
}

describe('rafa cleanup --dry-run, spawned', () => {
  it('lists no main row and lists the loop worktree of a gone branch as removable', RUN_TIMEOUT, () => {
    const { scratch, worktree } = plantWorld();

    const run = runRafa(scratch, scratch.repo, ['cleanup', '--dry-run']);

    expectExit(run, 0, scratch);
    const lines = run.stdout.split('\n');
    expect(lines.filter((line) => /^\s+main\b/.test(line))).toEqual([]);
    const row = lines.find((line) => line.includes(`.rafa/worktrees/${STUB}`));
    expect(row).toBeDefined();
    expect(row).not.toMatch(/within cleanup.worktreeIdleDays/);
    const json = runRafa(scratch, scratch.repo, ['cleanup', '--output=json']);
    const result = eventsOf(json.stdout).find((event) => event.type === 'result');
    const data = (result as unknown as { data: { worktrees: { path: string; tickable: boolean; blockers: string[] }[] } }).data;
    expect(data.worktrees.map((entry) => [entry.path, entry.tickable, entry.blockers])).toEqual([[worktree, true, []]]);
    expect(existsSync(worktree)).toBe(true);
  });
});
