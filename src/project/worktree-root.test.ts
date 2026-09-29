/**
 * `mainCheckoutOf` over stubbed listings, then over scratch repositories
 * under the temporary root: a main checkout with one worktree beside it
 * and one under its `.rafa/worktrees`, a bare repository, and a
 * directory in no repository. Every git here, the one under test
 * included, runs with its global and system config switched off and
 * its home in the temporary root, as `position.integration.test.ts`
 * runs it, so no case reads the operator's own repository or config.
 */
import type { GitResult, GitRunner } from '../pr/git.js';

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { NOT_A_REPOSITORY } from './roots.js';
import { mainCheckoutOf, WORKTREE_LIST_ARGS, WorktreeRootError } from './worktree-root.js';

const tempRoot = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-worktree-root-')));
const gitHome = join(tempRoot, 'git-home');
mkdirSync(gitHome);

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

/** The environment every git here runs with; see the module note. */
function gitEnv(): Record<string, string | undefined> {
  const inherited = Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'));
  return {
    ...Object.fromEntries(inherited),
    HOME: gitHome,
    XDG_CONFIG_HOME: gitHome,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    LC_ALL: 'C',
  };
}

/** A runner spawning the real git in `cwd` under {@link gitEnv}. */
function isolatedGit(cwd: string): GitRunner {
  return (args) => {
    const run = spawnSync('git', [...args], { cwd, encoding: 'utf8', env: gitEnv() });
    if (run.error !== undefined) throw run.error;
    return { ok: run.status === 0, stdout: run.stdout, stderr: run.stderr };
  };
}

/** Runs git in `cwd`, throwing with what it said when it fails. */
function git(cwd: string, args: readonly string[]): string {
  const result = isolatedGit(cwd)(args);
  if (!result.ok) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout;
}

let planted = 0;

/** A fresh directory under the temporary root, as a real path. */
function freshDir(): string {
  planted += 1;
  const dir = join(tempRoot, `case-${String(planted)}`);
  mkdirSync(dir);
  return realpathSync(dir);
}

/** A main checkout with one commit, a worktree beside it and one under `.rafa/worktrees`. */
function plantRepository(): { main: string; beside: string; nested: string } {
  const base = freshDir();
  const main = join(base, 'main');
  mkdirSync(main);
  git(main, ['init', '-q']);
  git(main, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init']);
  const beside = join(base, 'beside');
  const nested = join(main, '.rafa', 'worktrees', 'task');
  git(main, ['worktree', 'add', '-q', '-b', 'beside', beside]);
  git(main, ['worktree', 'add', '-q', '-b', 'nested', nested]);
  return { main, beside, nested };
}

/** A runner answering `result` and recording the argv it was handed. */
function stubGit(result: GitResult, calls: string[][] = []): (dir: string) => GitRunner {
  return (dir) => (args) => {
    calls.push([dir, ...args]);
    return result;
  };
}

const MAIN = '/work/main';
const LISTING = [
  `worktree ${MAIN}`,
  'HEAD 81596424d42051383d8420904d049a3ce438edda',
  'branch refs/heads/main',
  '',
  'worktree /work/beside',
  'HEAD 81596424d42051383d8420904d049a3ce438edda',
  'branch refs/heads/beside',
  '',
  '',
].join('\0');

describe('mainCheckoutOf over a stubbed listing', () => {
  it('runs the NUL-terminated porcelain listing in the directory it was given', () => {
    const calls: string[][] = [];
    mainCheckoutOf('/work/beside', { openGit: stubGit({ ok: true, stdout: LISTING, stderr: '' }, calls) });
    expect(calls).toEqual([['/work/beside', 'worktree', 'list', '--porcelain', '-z']]);
    expect([...WORKTREE_LIST_ARGS]).toEqual(['worktree', 'list', '--porcelain', '-z']);
  });

  it('answers the first record\'s path, not a later one', () => {
    const openGit = stubGit({ ok: true, stdout: LISTING, stderr: '' });
    expect(mainCheckoutOf('/work/beside', { openGit })).toBe(MAIN);
  });

  it('reads a path holding a newline whole', () => {
    const odd = '/work/odd\nname';
    const stdout = [`worktree ${odd}`, 'HEAD abc', 'detached', '', ''].join('\0');
    expect(mainCheckoutOf('/work/x', { openGit: stubGit({ ok: true, stdout, stderr: '' }) })).toBe(odd);
  });

  it('answers null for a bare repository\'s first record', () => {
    const stdout = ['worktree /work/repo.git', 'bare', '', ''].join('\0');
    expect(mainCheckoutOf('/work/repo.git', { openGit: stubGit({ ok: true, stdout, stderr: '' }) })).toBeNull();
  });

  it('answers null when git says no repository holds the directory', () => {
    const stderr = `${NOT_A_REPOSITORY}parent directories): .git\n`;
    expect(mainCheckoutOf('/work/x', { openGit: stubGit({ ok: false, stdout: '', stderr }) })).toBeNull();
  });

  it('throws naming what git said for any other failure', () => {
    const stderr = 'fatal: not a git repository: /work/gone/.git\n';
    const openGit = stubGit({ ok: false, stdout: '', stderr });
    expect(() => mainCheckoutOf('/work/x', { openGit })).toThrow(WorktreeRootError);
    expect(() => mainCheckoutOf('/work/x', { openGit })).toThrow('fatal: not a git repository: /work/gone/.git');
  });

  it('throws when the listing opens with no worktree line', () => {
    const openGit = stubGit({ ok: true, stdout: '', stderr: '' });
    expect(() => mainCheckoutOf('/work/x', { openGit })).toThrow('printed no worktree line first');
  });

  it('refuses a relative directory without running git', () => {
    const calls: string[][] = [];
    const openGit = stubGit({ ok: true, stdout: LISTING, stderr: '' }, calls);
    expect(() => mainCheckoutOf('work/x', { openGit })).toThrow('is not an absolute path');
    expect(calls).toEqual([]);
  });
});

describe('mainCheckoutOf over scratch repositories', () => {
  const { main, beside, nested } = plantRepository();

  it('answers the main checkout from the main checkout itself', () => {
    expect(mainCheckoutOf(main, { openGit: isolatedGit })).toBe(main);
  });

  it('answers the main checkout from a worktree beside it, not the worktree\'s own toplevel', () => {
    // The control: the worktree's toplevel is itself, so an answer equal
    // to it would have passed a reading of the wrong command.
    expect(git(beside, ['rev-parse', '--show-toplevel']).trim()).toBe(beside);
    expect(mainCheckoutOf(beside, { openGit: isolatedGit })).toBe(main);
  });

  it('answers the main checkout from a worktree under its .rafa/worktrees', () => {
    expect(git(nested, ['rev-parse', '--show-toplevel']).trim()).toBe(nested);
    expect(mainCheckoutOf(nested, { openGit: isolatedGit })).toBe(main);
  });

  it('answers the main checkout from a directory nested in a linked worktree', () => {
    const deep = join(beside, 'src', 'deep');
    mkdirSync(deep, { recursive: true });
    expect(mainCheckoutOf(deep, { openGit: isolatedGit })).toBe(main);
  });

  it('answers null for a bare repository', () => {
    const bare = join(freshDir(), 'repo.git');
    mkdirSync(bare);
    git(bare, ['init', '-q', '--bare']);
    expect(mainCheckoutOf(bare, { openGit: isolatedGit })).toBeNull();
  });

  it('answers null in a directory no repository holds', () => {
    expect(mainCheckoutOf(freshDir(), { openGit: isolatedGit })).toBeNull();
  });

  it('answers the main checkout through the default runner too', () => {
    expect(mainCheckoutOf(beside)).toBe(main);
  });
});
