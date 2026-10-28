/**
 * `getCurrentBranch` (`packages/rafa/src/utils/git.ts`) reading the directory it is
 * handed rather than the process's own.
 *
 * Two scratch repositories under the temporary root sit on two different
 * branches, so a reading that ignored its directory and read the
 * process's working directory (this repository) would answer neither.
 * The repositories are made with global and system config switched off,
 * as `project/worktree-root.test.ts` makes them.
 *
 * `readCheckedOutBranch` is read over the same kind of repository, with
 * three more states: a detached HEAD, where it answers null and
 * `getCurrentBranch` beside it answers the word `HEAD`; a branch with no
 * commit yet, which it still names; and a directory outside every
 * repository, where it throws, so null is proven to mean a detached HEAD
 * and not any failure.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { gitIdentityEnv } from '@open-tomato/rafa/tests/git-identity';
import { getCurrentBranch, readCheckedOutBranch } from '@open-tomato/rafa/utils/git';

const tempRoot = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-utils-git-')));

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

/** Runs git in `cwd` with no global or system config, throwing with what it said when it fails. */
function git(cwd: string, args: readonly string[]): void {
  const run = spawnSync('git', [...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, HOME: tempRoot, GIT_CONFIG_NOSYSTEM: '1', ...gitIdentityEnv(), GIT_CONFIG_GLOBAL: '/dev/null', LC_ALL: 'C' },
  });
  if (run.error !== undefined) throw run.error;
  if (run.status !== 0) throw new Error(`git ${args.join(' ')}: ${run.stderr}`);
}

/** A repository at `name` under the temporary root, one empty commit on `branch`. */
function repositoryOn(name: string, branch: string): string {
  const dir = join(tempRoot, name);
  mkdirSync(dir);
  git(dir, ['init', '-q', '-b', branch]);
  git(dir, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init']);
  return dir;
}

describe('getCurrentBranch', () => {
  const first = repositoryOn('first', 'feat/first-branch');
  const second = repositoryOn('second', 'feat/second-branch');

  it('reads the branch checked out in the directory it is handed', () => {
    expect(getCurrentBranch(first)).toBe('feat/first-branch');
    expect(getCurrentBranch(second)).toBe('feat/second-branch');
  });

  it('reads the process\'s own directory when handed none', () => {
    // The control: the same reading with no directory answers this
    // repository's branch, which is neither scratch branch, so the case
    // above was read from the directories it named.
    const own = getCurrentBranch();

    expect(own).not.toBe('feat/first-branch');
    expect(own).not.toBe('feat/second-branch');
    expect(own.length).toBeGreaterThan(0);
  });
});

describe('readCheckedOutBranch', () => {
  const onBranch = repositoryOn('checked-out', 'feat/checked-out');
  const detached = repositoryOn('detached', 'feat/left-behind');
  git(detached, ['switch', '-q', '--detach']);

  it('reads the branch checked out in the directory it is handed', () => {
    expect(readCheckedOutBranch(onBranch)).toBe('feat/checked-out');
  });

  it('answers null on a detached HEAD, where getCurrentBranch answers the word HEAD', () => {
    expect(readCheckedOutBranch(detached)).toBeNull();
    // The control: the same directory through the reading this one stands beside.
    expect(getCurrentBranch(detached)).toBe('HEAD');
  });

  it('names a branch that holds no commit yet', () => {
    const unborn = join(tempRoot, 'unborn');
    mkdirSync(unborn);
    git(unborn, ['init', '-q', '-b', 'feat/unborn']);

    expect(readCheckedOutBranch(unborn)).toBe('feat/unborn');
  });

  it('throws outside a repository, naming the directory, rather than answering null', () => {
    const outside = join(tempRoot, 'outside');
    mkdirSync(outside);

    expect(() => readCheckedOutBranch(outside)).toThrow(outside);
  });

  it('reads the process\'s own directory when handed none', () => {
    // A detached checkout, as a pull request's runner has: no branch, where getCurrentBranch says HEAD.
    const current = getCurrentBranch();
    const expected = current === 'HEAD'
      ? null
      : current;

    expect(readCheckedOutBranch()).toBe(expected);
  });
});
