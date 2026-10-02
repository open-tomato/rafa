/**
 * Tests for `readReleaseCommit` (`release-commit.ts`): which commit on
 * the release branch set the version, and how far HEAD is past it,
 * read off real repositories.
 *
 * Every case builds its own scratch repository, because what is being
 * measured IS git's answer: how `git log --first-parent -- <file>` walks
 * a squash, a merge commit and a commit that touched the version file
 * without changing the version. A table of planted answers would
 * measure the planting.
 *
 * The case this file exists for is the one measured on 2026-09-28:
 * 0.24.0 was published from the commit that set it, three merges landed
 * after it, and a tag on HEAD named a tree that was not the package.
 * `names the commit that set the version, not HEAD` is that shape.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createGitRunner } from '../../pr/index.js';
import { gitIdentityEnv } from '../../tests/git-identity.js';

import { readReleaseCommit } from './release-commit.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-release-commit-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** How many repositories this file has made, so each gets its own. */
let repoCount = 0;

/** The version file every case writes. */
const VERSION_FILE = 'package.json';

/** A manifest declaring `version`, with `extra` fields beside it. */
function manifest(version: string, extra: Record<string, unknown> = {}): string {
  return `${JSON.stringify({ name: '@open-tomato/rafa', version, ...extra }, null, 2)}\n`;
}

/** A repository of this case's own, on `main`, with helpers to commit into it. */
interface Repo {
  readonly root: string;
  /** Runs git in the repository, isolated from the operator's config, and answers stdout trimmed. */
  readonly git: (...args: readonly string[]) => string;
  /** Writes `text` to `path` and commits it, answering the new commit. */
  readonly commitFile: (path: string, text: string, message: string) => string;
}

/** Makes a repository on `main` holding one commit with `first` as its version file. */
function repoWith(first: string): Repo {
  repoCount += 1;
  const root = join(tempBase, `repo-${String(repoCount)}`);
  const home = join(root, '..', `home-${String(repoCount)}`);
  mkdirSync(root, { recursive: true });
  mkdirSync(home, { recursive: true });
  const git = (...args: readonly string[]): string => execFileSync('git', [...args], {
    cwd: root,
    encoding: 'utf8',
    env: {
      PATH: process.env['PATH'] ?? '',
      HOME: home,
      GIT_CONFIG_GLOBAL: join(home, '.gitconfig'),
      GIT_CONFIG_NOSYSTEM: '1',
      ...gitIdentityEnv(),
      LC_ALL: 'C',
    },
  }).trim();
  const commitFile = (path: string, text: string, message: string): string => {
    writeFileSync(join(root, path), text, 'utf8');
    git('add', path);
    git('commit', '-q', '-m', message);
    return git('rev-parse', 'HEAD');
  };
  git('init', '-q', '--initial-branch=main', '.');
  commitFile(VERSION_FILE, first, 'first');
  return { root, git, commitFile };
}

describe('the commit that set the version', () => {
  it('is HEAD when HEAD set it, with nothing past it', () => {
    const repo = repoWith(manifest('0.1.0'));
    const set = repo.commitFile(VERSION_FILE, manifest('0.2.0'), 'chore: release 0.2.0');

    const reading = readReleaseCommit(createGitRunner(repo.root), VERSION_FILE, '0.2.0');

    expect(reading).toEqual({ commit: set, ahead: 0, problem: null });
  });

  it('names the commit that set the version, not HEAD, and counts the commits past it', () => {
    const repo = repoWith(manifest('0.23.0'));
    const set = repo.commitFile(VERSION_FILE, manifest('0.24.0'), 'rafa-246: Epic lifecycle (#310)');
    repo.commitFile('device.ts', 'export {};\n', 'feat(device): read-only machine diagnosis (#311)');
    repo.commitFile('merge.ts', 'export {};\n', 'fix(pr): skip the local delete (#312)');
    const head = repo.commitFile('scratch.ts', 'export {};\n', 'fix(test): date the scratch worktrees (#314)');

    const reading = readReleaseCommit(createGitRunner(repo.root), VERSION_FILE, '0.24.0');

    expect(reading).toEqual({ commit: set, ahead: 3, problem: null });
    expect(reading.commit).not.toBe(head);
  });

  it('passes over a later commit that touched the version file without changing the version', () => {
    const repo = repoWith(manifest('0.1.0'));
    const set = repo.commitFile(VERSION_FILE, manifest('0.2.0'), 'chore: release 0.2.0');
    repo.commitFile(VERSION_FILE, manifest('0.2.0', { description: 'a field added' }), 'docs: describe the package');

    const reading = readReleaseCommit(createGitRunner(repo.root), VERSION_FILE, '0.2.0');

    expect(reading).toEqual({ commit: set, ahead: 1, problem: null });
  });

  it('names the merge commit that brought the version onto the branch, not the commit inside the branch', () => {
    const repo = repoWith(manifest('0.1.0'));
    repo.git('switch', '-q', '-c', 'feat/next');
    const inside = repo.commitFile(VERSION_FILE, manifest('0.2.0'), 'chore: release 0.2.0');
    repo.git('switch', '-q', 'main');
    repo.commitFile('other.ts', 'export {};\n', 'main moved meanwhile');
    repo.git('merge', '-q', '--no-ff', '-m', 'merge feat/next', 'feat/next');
    const merge = repo.git('rev-parse', 'HEAD');

    const reading = readReleaseCommit(createGitRunner(repo.root), VERSION_FILE, '0.2.0');

    expect(reading).toEqual({ commit: merge, ahead: 0, problem: null });
    expect(reading.commit).not.toBe(inside);
  });

  it('refuses a version the working tree declares and no commit holds', () => {
    const repo = repoWith(manifest('0.1.0'));
    writeFileSync(join(repo.root, VERSION_FILE), manifest('0.2.0'), 'utf8');

    const reading = readReleaseCommit(createGitRunner(repo.root), VERSION_FILE, '0.2.0');

    expect(reading.commit).toBeNull();
    expect(reading.problem).toEqual({
      reason: 'version',
      message: `${VERSION_FILE} says 0.2.0, and the last commit on this branch that changed it says 0.1.0;`
        + ' commit the version before tagging it',
    });
  });

  it('refuses a version file no commit holds at all', () => {
    const repo = repoWith(manifest('0.1.0'));
    writeFileSync(join(repo.root, 'VERSION.json'), manifest('0.2.0'), 'utf8');

    const reading = readReleaseCommit(createGitRunner(repo.root), 'VERSION.json', '0.2.0');

    expect(reading.commit).toBeNull();
    expect(reading.problem?.reason).toBe('version');
    expect(reading.problem?.message).toBe('no commit on this branch holds VERSION.json; commit it before tagging');
  });

  it('answers a git problem, rather than a commit, where git could not walk the history', () => {
    const outside = join(tempBase, 'no-repository');
    mkdirSync(outside, { recursive: true });

    const reading = readReleaseCommit(createGitRunner(outside), VERSION_FILE, '0.2.0');

    expect(reading.commit).toBeNull();
    expect(reading.problem?.reason).toBe('git');
    expect(reading.problem?.message).toContain('the history of package.json could not be read:');
  });
});
