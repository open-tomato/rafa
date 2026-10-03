/**
 * `rafa loop start --as-worktree` refused end to end, spawned as
 * `bun src/rafa.ts loop start` through `runRafa` in scratch git
 * repositories, for the three ways the flag is refused before a session
 * ever runs:
 *
 *   - beside `--create-branch` (`refuseWorktreeBesideCreateBranch`,
 *     `src/start/run-setup.ts`), the words alone;
 *   - while any of `tracking.specs`, `tracking.plans` or `tracking.all`
 *     is on (`refuseWorktreeWhileTracking`, same module), the words and
 *     the loaded config;
 *   - on a plan branch already checked out in another worktree
 *     (`addRunWorktree`, `src/start/worktree.ts`), which only a real git
 *     can refuse.
 *
 * `src/start/run-setup.test.ts` already pins the first two refusals'
 * wording and ordering over the functions directly, and
 * `src/start/worktree.test.ts` pins the third over a real repository
 * calling `addRunWorktree` alone. What none of them proves is that a
 * spawned `rafa loop start` reaches the same refusal through the whole
 * command — refusing before any preflight check runs, any session is
 * dispatched or any git state changes — which is what every case here
 * asserts: exit code 1, the stand-in `claude`'s call log absent, no
 * `.rafa/worktrees` directory created, and the main checkout's branch
 * and working tree exactly as they were.
 */
import type { ScratchRepo } from './cli-capture.js';

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { plantProjectConfig, plantScratchRepo, plantStandInClaude, runRafa } from './cli-capture.js';
import { gitIdentityEnv } from './git-identity.js';

const RUN_TIMEOUT = { timeout: 60_000 };

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-worktree-start-refusals-')));
afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** Runs git in `scratch`'s repository under a fixed identity and no gpg signing. */
function git(scratch: ScratchRepo, ...args: string[]): string {
  return execFileSync(
    'git',
    ['-c', 'user.email=loop@example.test', '-c', 'user.name=Rafa Loop', '-c', 'commit.gpgsign=false', ...args],
    {
      cwd: scratch.repo,
      encoding: 'utf8',
      stdio: 'pipe',
      env: { ...process.env, HOME: scratch.home, GIT_CONFIG_GLOBAL: join(scratch.home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1', ...gitIdentityEnv() },
    },
  ).trim();
}

/** The branch checked out in `scratch`'s repository right now. */
function currentBranch(scratch: ScratchRepo): string {
  return git(scratch, 'rev-parse', '--abbrev-ref', 'HEAD');
}

/**
 * A scratch project with a stand-in `claude`, one commit on its initial
 * branch. `.rafa/` is gitignored, as it is in a real project, so neither
 * the config the run reads nor the state it writes under it (a
 * `status-seen.json`, among others) ever shows as tracked or untracked
 * in `git status`.
 */
function plantLoopScratch(): ScratchRepo {
  const scratch = plantScratchRepo(tempBase);
  plantStandInClaude(scratch);
  writeFileSync(join(scratch.repo, '.gitignore'), '.rafa/\n', 'utf8');
  writeFileSync(join(scratch.repo, 'kept.txt'), 'kept\n', 'utf8');
  git(scratch, 'add', '-A');
  git(scratch, 'commit', '-q', '--no-verify', '-m', 'seed');
  return scratch;
}

/** Whether `dir`, resolved against `scratch`'s repository, was ever created. */
function existsUnder(scratch: ScratchRepo, ...parts: string[]): boolean {
  return existsSync(join(scratch.repo, ...parts));
}

describe('rafa loop start --as-worktree beside --create-branch', () => {
  it('refuses before any config is loaded, dispatching nothing and touching nothing', () => {
    const scratch = plantLoopScratch();
    const base = currentBranch(scratch);

    const run = runRafa(scratch, scratch.repo, ['loop', 'start', '--as-worktree', '--create-branch']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('❌ Refusing --as-worktree beside --create-branch:');
    expect(run.stderr).toContain('--as-worktree alone');
    expect(run.stderr).toContain('--create-branch alone');
    expect(run.stderr).toContain('Nothing was checked and nothing was dispatched.');
    expect(existsSync(scratch.callLog)).toBe(false);
    expect(existsUnder(scratch, '.rafa', 'worktrees')).toBe(false);
    expect(currentBranch(scratch)).toBe(base);
    expect(git(scratch, 'status', '--porcelain')).toBe('');
  }, RUN_TIMEOUT);
});

describe('rafa loop start --as-worktree while a tracking setting is on', () => {
  it.each([
    ['tracking.specs', 'specs'],
    ['tracking.plans', 'plans'],
    ['tracking.all', 'all'],
  ])('refuses naming `%s`, dispatching nothing and touching nothing', (key, field) => {
    const scratch = plantLoopScratch();
    const base = currentBranch(scratch);
    plantProjectConfig(scratch.repo, `tracking:\n  ${field}: true\n`);

    const run = runRafa(scratch, scratch.repo, ['loop', 'start', '--as-worktree']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(`❌ Refusing --as-worktree while \`${key}\` is on:`);
    expect(run.stderr).toContain('Nothing was checked and nothing was dispatched.');
    expect(existsSync(scratch.callLog)).toBe(false);
    expect(existsUnder(scratch, '.rafa', 'worktrees')).toBe(false);
    expect(currentBranch(scratch)).toBe(base);
    expect(git(scratch, 'status', '--porcelain')).toBe('');
  }, RUN_TIMEOUT);
});

describe('rafa loop start --as-worktree on a plan branch checked out elsewhere', () => {
  it('refuses naming the other worktree\'s path, dispatching nothing and leaving the main checkout as it was', () => {
    const scratch = plantLoopScratch();
    const base = currentBranch(scratch);
    writeFileSync(join(scratch.repo, 'PLAN-held.md'), '# Plan: held\n\n- [ ] A task no session runs\n', 'utf8');
    git(scratch, 'add', '-A');
    git(scratch, 'commit', '-q', '--no-verify', '-m', 'plan');

    const elsewhere = join(tempBase, 'elsewhere-held');
    git(scratch, 'worktree', 'add', '-q', '-b', 'feat/held', elsewhere, base);

    const run = runRafa(scratch, scratch.repo, ['loop', 'start', '--plan=PLAN-held.md', '--as-worktree']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('❌ Refusing to add a worktree for feat/held: it is checked out in another worktree');
    expect(run.stderr).toContain(`at ${elsewhere}.`);
    expect(run.stderr).toContain('The main checkout\'s branch and working tree were not touched.');
    expect(existsSync(scratch.callLog)).toBe(false);
    expect(currentBranch(scratch)).toBe(base);
    expect(git(scratch, 'status', '--porcelain')).toBe('');
  }, RUN_TIMEOUT);
});
