/**
 * Tests for `readFragmentTree` (`fragment-tree.ts`): the fragments
 * present in a git tree, ordered by the first-parent commit that added
 * each, read off real repositories.
 *
 * Every case builds its own scratch repository, because what is being
 * measured IS git's answer: which commit a first-parent walk names for a
 * fragment a merge brought in, one settle deleted and a plan wrote
 * again, or one edited after it landed. A table of planted answers
 * would measure the planting.
 *
 * Commit dates are set per commit and deliberately out of step with
 * the chain in the ordering case, so an order that followed the dates
 * rather than the chain would fail it.
 */
import type { Fragment } from './fragment.js';

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createGitRunner } from '../pr/index.js';

import { readFragmentTree } from './fragment-tree.js';
import { serializeFragment } from './fragment.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-fragment-tree-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** How many repositories this file has made, so each gets its own. */
let repoCount = 0;

/** The fragments directory every case writes under. */
const DIR = '.changes';

/** A date every commit gets unless a case names another. */
const DEFAULT_DATE = '2026-09-01T12:00:00Z';

/** The fragment text of plan `plan`, level `patch`, one note. */
function fragmentText(plan: string, note = 'Loop: a change'): string {
  const fragment: Fragment = { plan, title: `title of ${plan}`, level: 'patch', notes: [`- ${note}`] };
  return serializeFragment(fragment);
}

/** A repository of this case's own, on `main`, with helpers to commit into it. */
interface Repo {
  readonly root: string;
  /** Runs git in the repository, isolated from the operator's config, and answers stdout trimmed. */
  readonly git: (args: readonly string[], date?: string) => string;
  /** Writes each path's text and commits them all at `date`, answering the new commit. */
  readonly commit: (files: Readonly<Record<string, string>>, message: string, date?: string) => string;
  /** Removes `path` and commits that, answering the new commit. */
  readonly remove: (path: string, message: string, date?: string) => string;
}

/** Makes a repository on `main` holding one commit of a README. */
function scratchRepo(): Repo {
  repoCount += 1;
  const root = join(tempBase, `repo-${String(repoCount)}`);
  const home = join(tempBase, `home-${String(repoCount)}`);
  mkdirSync(root, { recursive: true });
  mkdirSync(home, { recursive: true });
  const git = (args: readonly string[], date = DEFAULT_DATE): string => execFileSync('git', [...args], {
    cwd: root,
    encoding: 'utf8',
    env: {
      PATH: process.env['PATH'] ?? '',
      HOME: home,
      GIT_CONFIG_GLOBAL: join(home, '.gitconfig'),
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'rafa test',
      GIT_AUTHOR_EMAIL: 'test@example.invalid',
      GIT_COMMITTER_NAME: 'rafa test',
      GIT_COMMITTER_EMAIL: 'test@example.invalid',
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_DATE: date,
      LC_ALL: 'C',
    },
  }).trim();
  const commit = (files: Readonly<Record<string, string>>, message: string, date = DEFAULT_DATE): string => {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text, 'utf8');
    }
    git(['add', '-A']);
    git(['commit', '-q', '-m', message], date);
    return git(['rev-parse', 'HEAD']);
  };
  const remove = (path: string, message: string, date = DEFAULT_DATE): string => {
    unlinkSync(join(root, path));
    git(['add', '-A']);
    git(['commit', '-q', '-m', message], date);
    return git(['rev-parse', 'HEAD']);
  };
  git(['init', '-q', '--initial-branch=main', '.']);
  commit({ 'README.md': 'scratch\n' }, 'first');
  return { root, git, commit, remove };
}

/** The fragments `repo`'s `tree` holds under {@link DIR}, failing the case on a problem. */
function fragmentsOf(repo: Repo, tree = 'HEAD', directory = DIR) {
  const reading = readFragmentTree(createGitRunner(repo.root), tree, directory);
  if (!reading.ok) throw new Error(reading.problem);
  return reading.fragments;
}

describe('the order of the fragments in a tree', () => {
  it('follows the first-parent chain, oldest add first, not the names or the commit dates', () => {
    const repo = scratchRepo();
    const first = repo.commit({ [`${DIR}/zeta.md`]: fragmentText('zeta') }, 'zeta', '2026-09-20T10:00:00Z');
    const second = repo.commit({ [`${DIR}/alpha.md`]: fragmentText('alpha') }, 'alpha', '2026-09-10T10:00:00Z');
    const third = repo.commit({ [`${DIR}/mid.md`]: fragmentText('mid') }, 'mid', '2026-09-15T10:00:00Z');

    const fragments = fragmentsOf(repo);

    expect(fragments.map(({ id, commit, addedOn }) => ({ id, commit, addedOn }))).toEqual([
      { id: 'zeta', commit: first, addedOn: '2026-09-20' },
      { id: 'alpha', commit: second, addedOn: '2026-09-10' },
      { id: 'mid', commit: third, addedOn: '2026-09-15' },
    ]);
  });

  it('orders fragments one commit added by id', () => {
    const repo = scratchRepo();
    const both = repo.commit({
      [`${DIR}/rafa-9.md`]: fragmentText('rafa-9'),
      [`${DIR}/rafa-10.md`]: fragmentText('rafa-10'),
      [`${DIR}/rafa-10-2.md`]: fragmentText('rafa-10'),
    }, 'three at once');

    const fragments = fragmentsOf(repo);

    expect(fragments.map(({ id }) => id)).toEqual(['rafa-10', 'rafa-10-2', 'rafa-9']);
    expect(fragments.every(({ commit }) => commit === both)).toBe(true);
  });

  it('names the merge commit that brought a branch fragment in, not the branch commit that wrote it', () => {
    const repo = scratchRepo();
    repo.git(['switch', '-q', '-c', 'feat/a']);
    const inside = repo.commit({ [`${DIR}/rafa-1.md`]: fragmentText('rafa-1') }, 'wrap-up', '2026-09-02T09:00:00Z');
    repo.git(['switch', '-q', 'main']);
    const earlier = repo.commit({ [`${DIR}/rafa-2.md`]: fragmentText('rafa-2') }, 'rafa-2', '2026-09-03T09:00:00Z');
    repo.git(['merge', '-q', '--no-ff', '-m', 'merge feat/a', 'feat/a'], '2026-09-04T09:00:00Z');
    const merge = repo.git(['rev-parse', 'HEAD']);

    const fragments = fragmentsOf(repo);

    expect(fragments.map(({ id, commit, addedOn }) => ({ id, commit, addedOn }))).toEqual([
      { id: 'rafa-2', commit: earlier, addedOn: '2026-09-03' },
      { id: 'rafa-1', commit: merge, addedOn: '2026-09-04' },
    ]);
    expect(fragments[1]?.commit).not.toBe(inside);
  });

  it('keeps a fragment where its add put it when a later commit edits it', () => {
    const repo = scratchRepo();
    const added = repo.commit({ [`${DIR}/rafa-1.md`]: fragmentText('rafa-1') }, 'rafa-1', '2026-09-02T09:00:00Z');
    const other = repo.commit({ [`${DIR}/rafa-2.md`]: fragmentText('rafa-2') }, 'rafa-2', '2026-09-03T09:00:00Z');
    repo.commit({ [`${DIR}/rafa-1.md`]: fragmentText('rafa-1', 'Loop: reworded') }, 'edit', '2026-09-04T09:00:00Z');

    const fragments = fragmentsOf(repo);

    expect(fragments.map(({ id, commit }) => ({ id, commit }))).toEqual([
      { id: 'rafa-1', commit: added },
      { id: 'rafa-2', commit: other },
    ]);
    const [edited] = fragments;
    expect(edited?.reading.ok && edited.reading.fragment.notes).toEqual(['- Loop: reworded']);
  });

  it('dates a path settle deleted and a later plan wrote again by the add that is present', () => {
    const repo = scratchRepo();
    repo.commit({ [`${DIR}/rafa-1.md`]: fragmentText('rafa-1') }, 'first life', '2026-09-02T09:00:00Z');
    repo.remove(`${DIR}/rafa-1.md`, 'chore: release 0.2.0', '2026-09-03T09:00:00Z');
    const other = repo.commit({ [`${DIR}/rafa-2.md`]: fragmentText('rafa-2') }, 'rafa-2', '2026-09-04T09:00:00Z');
    const again = repo.commit({ [`${DIR}/rafa-1.md`]: fragmentText('rafa-1') }, 'second life', '2026-09-05T09:00:00Z');

    const fragments = fragmentsOf(repo);

    expect(fragments.map(({ id, commit, addedOn }) => ({ id, commit, addedOn }))).toEqual([
      { id: 'rafa-2', commit: other, addedOn: '2026-09-04' },
      { id: 'rafa-1', commit: again, addedOn: '2026-09-05' },
    ]);
  });
});

describe('which fragments a tree holds', () => {
  it('lists none once settle has deleted them, and none where the directory never existed', () => {
    const repo = scratchRepo();
    expect(fragmentsOf(repo)).toEqual([]);
    repo.commit({ [`${DIR}/rafa-1.md`]: fragmentText('rafa-1') }, 'rafa-1');
    expect(fragmentsOf(repo).map(({ id }) => id)).toEqual(['rafa-1']);
    repo.remove(`${DIR}/rafa-1.md`, 'chore: release 0.2.0');

    expect(fragmentsOf(repo)).toEqual([]);
  });

  it('passes over what is not a fragment: subdirectories, other extensions and unusable ids', () => {
    const repo = scratchRepo();
    repo.commit({
      [`${DIR}/rafa-1.md`]: fragmentText('rafa-1'),
      [`${DIR}/nested/rafa-2.md`]: fragmentText('rafa-2'),
      [`${DIR}/rafa-3.txt`]: fragmentText('rafa-3'),
      [`${DIR}/two words.md`]: fragmentText('rafa-4'),
      [`${DIR}/.hidden.md`]: fragmentText('rafa-5'),
      'rafa-6.md': fragmentText('rafa-6'),
    }, 'mixed');

    expect(fragmentsOf(repo).map(({ id, path }) => ({ id, path }))).toEqual([
      { id: 'rafa-1', path: `${DIR}/rafa-1.md` },
    ]);
  });

  it('answers a malformed fragment as its refusal rather than dropping it', () => {
    const repo = scratchRepo();
    repo.commit({ [`${DIR}/rafa-1.md`]: '---\nplan: rafa-1\ntitle: t\n---\n\n- note\n' }, 'no level');

    const [only] = fragmentsOf(repo);

    expect(only?.id).toBe('rafa-1');
    expect(only?.reading).toEqual({ ok: false, reason: 'missing-level', sentence: 'The fragment declares no level.' });
  });

  it('reads the named tree, not the checkout, and reads the directory however it is spelled', () => {
    const repo = scratchRepo();
    const base = repo.commit({ [`${DIR}/rafa-1.md`]: fragmentText('rafa-1') }, 'rafa-1');
    repo.git(['switch', '-q', '-c', 'feat/b']);
    repo.commit({ [`${DIR}/rafa-2.md`]: fragmentText('rafa-2') }, 'rafa-2 on a branch');

    const reading = readFragmentTree(createGitRunner(repo.root), 'main', `./${DIR}/`);

    expect(reading.ok && reading.commit).toBe(base);
    expect(reading.ok && reading.fragments.map(({ id }) => id)).toEqual(['rafa-1']);
    expect(fragmentsOf(repo, 'HEAD').map(({ id }) => id)).toEqual(['rafa-1', 'rafa-2']);
  });

  it('dates the add commit in UTC, not in the committer\'s offset', () => {
    const repo = scratchRepo();
    repo.commit({ [`${DIR}/rafa-1.md`]: fragmentText('rafa-1') }, 'late', '2026-09-30T01:30:00+05:00');

    expect(fragmentsOf(repo).map(({ addedOn }) => addedOn)).toEqual(['2026-09-29']);
  });
});

describe('a tree that cannot be read', () => {
  it('answers a problem naming the tree when git knows no such commit', () => {
    const repo = scratchRepo();

    const reading = readFragmentTree(createGitRunner(repo.root), 'origin/main', DIR);

    expect(reading).toEqual({
      ok: false,
      problem: 'the tree of origin/main could not be read: git names no such commit',
    });
  });

  it('answers a problem, rather than an empty list, where git runs outside a repository', () => {
    const outside = join(tempBase, 'no-repository');
    mkdirSync(outside, { recursive: true });

    const reading = readFragmentTree(createGitRunner(outside), 'HEAD', DIR);

    expect(reading.ok).toBe(false);
    expect(!reading.ok && reading.problem).toStartWith('the tree of HEAD could not be read: ');
  });

  it('reads a caller text that looks like an option as a revision, never as an option', () => {
    const repo = scratchRepo();

    const reading = readFragmentTree(createGitRunner(repo.root), '--all', DIR);

    expect(reading.ok).toBe(false);
  });
});
