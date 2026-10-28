/**
 * Integration tests for the upstream step of `addRunWorktree` on route
 * `switch-remote` (`./worktree.ts`, `./worktree-upstream.ts`), over real
 * git: a clone of a bare remote holding `feat/<stub>` branches the clone
 * has no local branch for.
 *
 * A lock is held the way the module notes measured it: `.git/config.lock`
 * created by hand in the clone's git directory. The pause seam is how a
 * case releases it, deleting that file on its nth call, and it waits for
 * nothing. Every case uses a stub of its own, so no case reads another's
 * branch, and the lock is cleared after each.
 *
 * The planted project turns git's wait off (`core.configLockTimeout` 0, read
 * back by the first case), since git 2.56 retries a held config lock for a
 * second per try on its own, past bun's test timeout.
 *
 * The active output is module state shared by every test file, so each
 * case sets a sink and the last one sets it back.
 */
import type { WorktreeOutcome } from '@open-tomato/rafa-run/start/worktree';

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';

import { CommandExit } from '@open-tomato/rafa/core/command';
import { setActiveOutput } from '@open-tomato/rafa/core/output';
import { sinkOutput } from '@open-tomato/rafa/tests/output-sinks';
import { addRunWorktree } from '@open-tomato/rafa-run/start/worktree';
import { UPSTREAM_TRIES } from '@open-tomato/rafa-run/start/worktree-upstream';

import { CONFIG_DEFAULTS } from '../config-registry.js';

describe('addRunWorktree upstream step against a real repository', () => {
  let scratch = '';
  let project = '';
  let lock = '';

  /** Runs git in `cwd` with a fixed identity, under `LC_ALL=C`, and answers its trimmed stdout. */
  const run = (cwd: string, args: readonly string[]): string => execFileSync(
    'git',
    ['-c', 'user.name=rafa', '-c', 'user.email=rafa@example.invalid', ...args],
    { cwd, encoding: 'utf8', stdio: 'pipe', env: { ...process.env, LC_ALL: 'C' } },
  ).trim();

  /** Puts `feat/<stub>` on the remote alone, answering the stub. */
  const remoteOnly = (stub: string): string => {
    run(project, ['push', '-q', 'origin', `main:feat/${stub}`]);
    run(project, ['fetch', '-q', 'origin']);
    return stub;
  };

  /** The worktree path a run for `stub` adds at. */
  const pathOf = (stub: string): string => join(project, '.rafa', 'worktrees', stub);

  /** Runs the worktree for `stub` with `sleep`, answering the outcome. */
  const add = (stub: string, sleep: (ms: number) => void): WorktreeOutcome => addRunWorktree(
    { projectRoot: project, worktreeDir: CONFIG_DEFAULTS.loopWorktreeDir, planStub: stub, base: 'main' },
    { sleep },
  );

  beforeAll(() => {
    scratch = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-upstream-')));
    const remote = join(scratch, 'remote.git');
    project = join(scratch, 'project');
    lock = join(project, '.git', 'config.lock');
    run(scratch, ['init', '-q', '--bare', remote]);
    run(scratch, ['init', '-q', '-b', 'main', project]);
    // git 2.56.0 added core.configLockTimeout (default 1000 ms, read from the
    // configuration on disk before the lock is taken), so git itself retries a
    // held .git/config.lock for about a second per try (#1371). Earlier git
    // ignores the key, so the cases read the same on every version and the
    // pauses they count are rafa's alone. The worktrees this file adds share
    // the project's .git/config, so the one key covers them.
    run(project, ['config', 'core.configLockTimeout', '0']);
    run(project, ['commit', '-q', '--allow-empty', '-m', 'one']);
    run(project, ['remote', 'add', 'origin', remote]);
    run(project, ['push', '-q', 'origin', 'main']);
  });

  beforeEach(() => {
    setActiveOutput(sinkOutput({}));
  });

  afterEach(() => {
    rmSync(lock, { force: true });
    setActiveOutput(null);
  });

  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it('plants the project with git\'s config lock wait turned off', () => {
    expect(run(project, ['config', 'core.configLockTimeout'])).toBe('0');
  });

  it('refuses after the last try on a lock never released, leaving no worktree and a clean main checkout', () => {
    const stub = remoteOnly('held');
    const path = pathOf(stub);
    writeFileSync(lock, '');
    let pauses = 0;

    let refusal: CommandExit | null = null;
    try {
      add(stub, () => {
        pauses += 1;
      });
    } catch (error) {
      if (!(error instanceof CommandExit)) throw error;
      refusal = error;
    }

    expect(refusal).not.toBeNull();
    expect(refusal?.exitCode).toBe(1);
    expect(refusal?.message).toContain(`Could not set the upstream of feat/${stub}`);
    expect(refusal?.message).toContain(`git branch --set-upstream-to=origin/feat/${stub} feat/${stub}`);
    expect(pauses).toBe(UPSTREAM_TRIES - 1);
    expect(run(project, ['worktree', 'list', '--porcelain'])).not.toContain(path);
    expect(existsSync(path)).toBe(false);
    expect(run(project, ['status', '--short'])).toBe('');
    expect(run(project, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('main');
  });

  it('sets the upstream when the lock is released on the second pause', () => {
    const stub = remoteOnly('released');
    writeFileSync(lock, '');
    let pauses = 0;

    const outcome = add(stub, () => {
      pauses += 1;
      if (pauses === 2) rmSync(lock, { force: true });
    });

    expect(outcome.route).toBe('switch-remote');
    expect(pauses).toBe(2);
    expect(run(project, ['config', `branch.feat/${stub}.merge`])).toBe(`refs/heads/feat/${stub}`);
    expect(run(project, ['worktree', 'list', '--porcelain'])).toContain(pathOf(stub));
  });

  it('gives two stubs added one after the other each its own upstream', () => {
    const first = remoteOnly('first');
    const second = remoteOnly('second');
    let pauses = 0;
    const sleep = (): void => {
      pauses += 1;
    };

    add(first, sleep);
    add(second, sleep);

    expect(pauses).toBe(0);
    expect(run(project, ['config', `branch.feat/${first}.merge`])).toBe(`refs/heads/feat/${first}`);
    expect(run(project, ['config', `branch.feat/${second}.merge`])).toBe(`refs/heads/feat/${second}`);
    expect(run(pathOf(first), ['rev-parse', '--abbrev-ref', '@{upstream}'])).toBe(`origin/feat/${first}`);
    expect(run(pathOf(second), ['rev-parse', '--abbrev-ref', '@{upstream}'])).toBe(`origin/feat/${second}`);
  });
});
