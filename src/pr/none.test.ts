/**
 * Tests for what a `none` provider gets (`src/pr/none.ts`).
 *
 * {@link compareUrl} is pure, so its cases are a table of remotes in
 * every spelling git writes one — https, scp-style, `ssh://` with a
 * port, `git://`, a filesystem path and a `file://` URL — against the
 * URL each yields, or against null where there is nothing to build one
 * from. The lowercasing and the kept port are asserted rather than
 * assumed: both are `normalizeRemote`'s behaviour and not this module's,
 * so a change there surfaces here.
 *
 * {@link pushBranch} is an effect, so it runs against REAL git in a
 * temporary directory and never against this checkout or a network: a
 * bare repository plays `origin`, so the push is a local file-to-file
 * one. Each case reads the outcome AND the state git was left in, since
 * a `pushBranch` that reported `ok` while pushing nothing passes the
 * first alone. The failing case is a control on the succeeding one: the
 * same call against a repository whose `origin` does not exist answers
 * `ok: false` and carries git's own words, which is what proves the
 * green reading could have come out red.
 *
 * Four mutations of `none.ts` were driven against this file on
 * 2026-09-18, one run each, the module restored sha256-identical after
 * every one and 14 pass either side: the branch encoded whole rather
 * than segment by segment, so its slashes become `%2F`, 6 cases; the
 * host taken from `remoteHost` so a port is dropped, 1; `--set-upstream`
 * dropped from the push, 1; and the outcome always reporting `ok`, 3.
 *
 * Nothing here touches `~`, `~/.rafa` or a real remote: every path is
 * under the case's own `mkdtemp` directory, which the case removes.
 * The {@link git} helper that plants each fixture points
 * `GIT_CONFIG_GLOBAL` and `GIT_CONFIG_SYSTEM` at `/dev/null` and names
 * its own author, so a user `.gitconfig` changes nothing about what is
 * planted. {@link pushBranch} itself inherits the process environment,
 * as it must to reach the operator's git, and its `origin` is a bare
 * repository beside the work tree, so the push stays on this
 * filesystem.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'bun:test';

import { compareUrl, pushBranch } from './none.js';

const BRANCH = 'feat/ci-gate';

describe('compareUrl', () => {
  it('builds GitHub\'s compare shape from an https remote', () => {
    expect(compareUrl('https://github.com/o/r.git', BRANCH))
      .toBe('https://github.com/o/r/compare/feat/ci-gate?expand=1');
  });

  it('builds the same URL from the scp-style spelling of that remote', () => {
    expect(compareUrl('git@github.com:o/r.git', BRANCH))
      .toBe('https://github.com/o/r/compare/feat/ci-gate?expand=1');
  });

  it('keeps a port the remote names, since the host is reached on it', () => {
    expect(compareUrl('ssh://git@ssh.github.com:443/o/r', BRANCH))
      .toBe('https://ssh.github.com:443/o/r/compare/feat/ci-gate?expand=1');
  });

  it('builds one for a host that is not github.com', () => {
    expect(compareUrl('git://github.example.com/team/app.git', BRANCH))
      .toBe('https://github.example.com/team/app/compare/feat/ci-gate?expand=1');
  });

  it('lowercases owner and repo, as the shared remote parser does', () => {
    // `normalizeRemote` lowercases every network remote. Asserted so the
    // reading is the module note's and not a guess.
    expect(compareUrl('git@github.com:Open-Tomato/Rafa.git', BRANCH))
      .toBe('https://github.com/open-tomato/rafa/compare/feat/ci-gate?expand=1');
  });

  it('keeps the branch\'s case and its slashes, encoding the rest', () => {
    expect(compareUrl('https://github.com/o/r', 'Feat/CI gate#1'))
      .toBe('https://github.com/o/r/compare/Feat/CI%20gate%231?expand=1');
  });

  it('answers null for a filesystem remote, however it is spelled', () => {
    expect(compareUrl('/Users/marcos/repos/rafa', BRANCH)).toBeNull();
    expect(compareUrl('../rafa', BRANCH)).toBeNull();
    expect(compareUrl('file:///Users/marcos/repos/rafa', BRANCH)).toBeNull();
  });

  it('answers null when there is no origin at all', () => {
    expect(compareUrl(null, BRANCH)).toBeNull();
  });

  it('answers null for a remote naming no owner and repo', () => {
    expect(compareUrl('https://github.com/o', BRANCH)).toBeNull();
    expect(compareUrl('https://localhost/o/r', BRANCH)).toBeNull();
  });

  it('answers null for a branch that is blank', () => {
    expect(compareUrl('https://github.com/o/r', '  ')).toBeNull();
  });
});

/** Runs git in `cwd` with no user config read, and answers its status. */
function git(cwd: string, ...args: readonly string[]): { status: number; stdout: string } {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH ?? '',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
      GIT_AUTHOR_NAME: 'rafa test',
      GIT_AUTHOR_EMAIL: 'test@example.invalid',
      GIT_COMMITTER_NAME: 'rafa test',
      GIT_COMMITTER_EMAIL: 'test@example.invalid',
      LC_ALL: 'C',
    },
  });
  return { status: result.status ?? -1, stdout: (result.stdout ?? '').trim() };
}

/**
 * A work repository on `branch` with one commit, and a bare repository
 * as its `origin` unless `withOrigin` is false. Both under one
 * temporary directory the caller removes.
 */
function plantRepo(branch: string, withOrigin = true): { root: string; work: string; bare: string } {
  const root = mkdtempSync(join(tmpdir(), 'rafa-push-'));
  const work = join(root, 'work');
  const bare = join(root, 'origin.git');

  expect(git(root, 'init', '--bare', '--initial-branch=main', bare).status).toBe(0);
  expect(git(root, 'init', `--initial-branch=${branch}`, work).status).toBe(0);
  expect(git(work, 'commit', '--allow-empty', '-m', 'first').status).toBe(0);
  if (withOrigin) expect(git(work, 'remote', 'add', 'origin', bare).status).toBe(0);

  return { root, work, bare };
}

describe('pushBranch', () => {
  it('pushes the branch to origin and sets its upstream', () => {
    const repo = plantRepo(BRANCH);
    try {
      const outcome = pushBranch(repo.work, BRANCH);

      expect(outcome.ok).toBe(true);
      // The effect, not the report: origin holds the branch, and the
      // work tree now has an upstream for it.
      expect(git(repo.bare, 'rev-parse', BRANCH).stdout)
        .toBe(git(repo.work, 'rev-parse', BRANCH).stdout);
      expect(git(repo.work, 'rev-parse', '--abbrev-ref', `${BRANCH}@{upstream}`).stdout)
        .toBe(`origin/${BRANCH}`);
    } finally {
      rmSync(repo.root, { recursive: true, force: true });
    }
  });

  it('answers not-ok with git\'s own words when there is no origin', () => {
    // The control on the case above: the same call, one thing removed.
    const repo = plantRepo(BRANCH, false);
    try {
      const outcome = pushBranch(repo.work, BRANCH);

      expect(outcome.ok).toBe(false);
      expect(outcome.output).toContain('origin');
      expect(git(repo.bare, 'rev-parse', BRANCH).status).not.toBe(0);
    } finally {
      rmSync(repo.root, { recursive: true, force: true });
    }
  });

  it('answers not-ok for a branch the repository does not have', () => {
    const repo = plantRepo(BRANCH);
    try {
      const outcome = pushBranch(repo.work, 'no-such-branch');

      expect(outcome.ok).toBe(false);
      expect(outcome.output).toContain('no-such-branch');
    } finally {
      rmSync(repo.root, { recursive: true, force: true });
    }
  });

  it('answers not-ok rather than throwing when the directory is no repository', () => {
    const root = mkdtempSync(join(tmpdir(), 'rafa-push-'));
    try {
      const outcome = pushBranch(root, BRANCH);

      expect(outcome.ok).toBe(false);
      expect(outcome.output).not.toBe('');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
