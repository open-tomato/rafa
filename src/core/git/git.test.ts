/**
 * Tests for the git runner (`git.ts`): what it answers for a command
 * that worked, one git refused, and one it could not start, and what
 * {@link gitSaid} makes of each.
 *
 * These cases spawn the REAL git, in a repository of their own under
 * this file's temporary directory. That is the point of them: the
 * runner exists to spawn git, and a fake git would measure nothing
 * about the two failure shapes the module note records as measured. No
 * case touches the repository this file lives in — every runner is made
 * for a directory under `tmpdir()` — and none reaches a network: the
 * repository has no remote.
 */
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createGitRunner, gitSaid } from './git.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-pr-git-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** A repository of this case's own, with one commit and an identity of its own. */
function plantRepo(name: string): string {
  const root = join(tempBase, name);
  const git = createGitRunner(tempBase);
  git(['init', '--quiet', root]);
  const inside = createGitRunner(root);
  inside(['config', 'user.email', 'rafa@example.test']);
  inside(['config', 'user.name', 'rafa test']);
  writeFileSync(join(root, 'kept.txt'), 'kept\n', 'utf8');
  inside(['add', '--all']);
  inside(['commit', '--quiet', '--message', 'first']);
  return root;
}

describe('a command that worked', () => {
  it('answers ok with git standard output, and nothing on standard error', () => {
    const root = plantRepo('worked');
    const head = createGitRunner(root)(['rev-parse', '--abbrev-ref', 'HEAD']);

    expect(head.ok).toBe(true);
    expect(head.stdout.trim().length).toBeGreaterThan(0);
    expect(head.stderr).toBe('');
  });

  it('answers a clean working tree as empty output, where an untracked file is a porcelain line', () => {
    const root = plantRepo('porcelain');
    const git = createGitRunner(root);
    const clean = git(['status', '--porcelain']);
    writeFileSync(join(root, 'new.txt'), 'new\n', 'utf8');
    const dirty = git(['status', '--porcelain']);

    expect([clean.ok, clean.stdout]).toEqual([true, '']);
    expect([dirty.ok, dirty.stdout]).toEqual([true, '?? new.txt\n']);
  });
});

describe('a command git refused', () => {
  it('answers ok false with what git wrote, and throws nothing', () => {
    const outside = join(tempBase, 'no-repository');
    const git = createGitRunner(tempBase);
    git(['init', '--quiet', outside]);
    rmSync(join(outside, '.git'), { recursive: true, force: true });
    const said = createGitRunner(outside)(['rev-parse', '--abbrev-ref', 'HEAD']);

    expect(said.ok).toBe(false);
    expect(said.stderr).toContain('not a git repository');
    expect(said.stdout).toBe('');
  });

  it('answers ok false for a branch delete of a branch that is not there', () => {
    const root = plantRepo('no-branch');
    const deleted = createGitRunner(root)(['branch', '-D', 'feat/never-existed']);

    expect(deleted.ok).toBe(false);
    expect(deleted.stderr).toContain('feat/never-existed');
  });
});

describe('a git that could not be started', () => {
  it('answers ok false naming the directory, where the message git gives names only the executable', () => {
    const missing = join(tempBase, 'no-such-directory');
    const said = createGitRunner(missing)(['status', '--porcelain']);

    expect(said.ok).toBe(false);
    expect(said.stderr).toContain(`could not run git in ${missing}`);
    expect(said.stdout).toBe('');
  });
});

describe('what git said', () => {
  it('puts standard error first, where git writes its refusals and its progress', () => {
    expect(gitSaid({ ok: false, stdout: 'out\n', stderr: 'err\n' })).toBe('err\nout');
  });

  it('gives the one stream that carried anything, and nothing for a command that said nothing', () => {
    expect(gitSaid({ ok: true, stdout: '  main\n', stderr: '' })).toBe('main');
    expect(gitSaid({ ok: true, stdout: '', stderr: ' pushed\n' })).toBe('pushed');
    expect(gitSaid({ ok: true, stdout: '  \n', stderr: '' })).toBe('');
  });
});
