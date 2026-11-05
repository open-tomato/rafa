/**
 * `rafa release fragment` spawned as the real binary in a linked worktree
 * of a project, the shape of #1268: the main checkout holds
 * `.rafa/config.yaml` and a bare origin, the worktree at
 * `<main>/.claude/worktrees/w` holds no `.rafa/`. The dispatcher resolves
 * the project to the main checkout, yet the fragment is written under the
 * worktree's `.changes/`, its absolute path is the last line printed, and
 * the main checkout's `.changes/` is left as it was.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { gitIdentityEnv } from '@open-tomato/rafa/tests/git-identity';
import { scratchHomeEnv } from '@open-tomato/rafa/tests/scratch-home-env';

import { expectExit, plantProjectConfig, plantScratchRepo, runRafa } from './cli-capture.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-fragment-worktree-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

describe('rafa release fragment in a linked worktree with no .rafa/', () => {
  it('writes under the worktree, prints the absolute path last and leaves the main checkout alone', () => {
    // Arrange: a main checkout that is a project, a bare origin, a linked worktree inside it.
    const scratch = plantScratchRepo(tempBase, { project: false });
    plantProjectConfig(scratch.repo, 'release:\n  enabled: true\n');
    const env = { TMPDIR: tmpdir(), ...scratchHomeEnv(scratch.home), PATH: scratch.path, GIT_CONFIG_GLOBAL: join(scratch.home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1', ...gitIdentityEnv() };
    const git = (args: readonly string[], cwd = scratch.repo): void => {
      execFileSync('git', [...args], { cwd, env, stdio: 'pipe' });
    };
    const origin = join(scratch.home, '..', 'origin.git');
    mkdirSync(origin, { recursive: true });
    git(['init', '-q', '--bare', '--initial-branch=main', origin], origin);
    writeFileSync(join(scratch.repo, 'README.md'), 'demo\n');
    git(['switch', '-q', '-c', 'main']);
    git(['add', 'README.md']);
    git(['commit', '-q', '-m', 'first']);
    git(['remote', 'add', 'origin', origin]);
    git(['push', '-q', 'origin', 'main']);
    git(['fetch', '-q', 'origin']);
    const worktree = join(scratch.repo, '.claude', 'worktrees', 'w');
    git(['worktree', 'add', '-q', '-b', 'feature', worktree]);
    expect(existsSync(join(worktree, '.rafa'))).toBe(false);

    // Act
    const run = runRafa(scratch, worktree, ['release', 'fragment', '--plan=dependabot-7', '--level=none', '--title=Bump zod']);

    // Assert
    expectExit(run, 0, scratch);
    const written = join(worktree, '.changes', 'dependabot-7.md');
    expect(readFileSync(written, 'utf8')).toContain('Bump zod');
    const lines = run.stdout.trim().split('\n');
    expect(lines[lines.length - 1]).toBe(written);
    expect(existsSync(join(scratch.repo, '.changes'))).toBe(false);
  });
});
