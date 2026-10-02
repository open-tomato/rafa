/**
 * `rafa loop start --create-branch` on a detached HEAD, spawned as
 * `bun src/rafa.ts loop start` through `runRafa` in a scratch git
 * repository. `src/start/run-setup.test.ts` pins the refusal over the
 * functions; this proves the whole command refuses with a non-zero exit,
 * naming both ways on, before it creates a branch or opens a session
 * record under `.rafa/runs/`.
 */
import type { ScratchRepo } from './cli-capture.js';

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { plantScratchRepo, plantStandInClaude, runRafa } from './cli-capture.js';
import { gitIdentityEnv } from './git-identity.js';

const RUN_TIMEOUT = { timeout: 60_000 };

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-detached-start-')));
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

/** A scratch project with a stand-in `claude`, one commit, then a detached HEAD. */
function plantDetachedScratch(): ScratchRepo {
  const scratch = plantScratchRepo(tempBase);
  plantStandInClaude(scratch);
  writeFileSync(join(scratch.repo, '.gitignore'), '.rafa/\n', 'utf8');
  writeFileSync(join(scratch.repo, 'kept.txt'), 'kept\n', 'utf8');
  writeFileSync(join(scratch.repo, 'PLAN.md'), '# Plan: detached\n\n- [ ] A task no session runs\n', 'utf8');
  git(scratch, 'add', '-A');
  git(scratch, 'commit', '-q', '--no-verify', '-m', 'seed');
  git(scratch, 'switch', '-q', '--detach');
  return scratch;
}

describe('rafa loop start --create-branch on a detached HEAD', () => {
  it('exits non-zero naming both ways on, creating no branch and no run record', () => {
    const scratch = plantDetachedScratch();
    const branchesBefore = git(scratch, 'branch', '--list', '--format=%(refname)');

    const run = runRafa(scratch, scratch.repo, ['loop', 'start', '--create-branch']);

    expect(run.exitCode).not.toBe(0);
    expect(run.stderr).toContain('Refusing to run on a detached HEAD');
    expect(run.stderr).toContain('git switch <base>');
    expect(run.stderr).toContain('--as-worktree');
    expect(git(scratch, 'branch', '--list', '--format=%(refname)')).toBe(branchesBefore);
    expect(git(scratch, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('HEAD');
    const runsDir = join(scratch.repo, '.rafa', 'runs');
    expect(existsSync(runsDir)
      ? readdirSync(runsDir)
      : []).toEqual([]);
    expect(existsSync(scratch.callLog)).toBe(false);
  }, RUN_TIMEOUT);
});
