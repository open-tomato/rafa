/**
 * Tests for `withSettleWorktree` (`settle-worktree.ts`): the scratch
 * worktree of `origin/<base>` settle builds its commit in, read off real
 * repositories — a bare origin and two clones of it.
 *
 * What is measured is git's own state after each path out: the
 * worktree list, the scratch directory and the caller's checkout. Each
 * "it is gone" reading is paired with a reading taken INSIDE the body
 * that shows the same probe seeing the worktree while it exists, so an
 * empty list after the call cannot be a probe that never saw anything.
 */
import type { GitRunner } from '../pr/git.js';

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createGitRunner } from '../pr/git.js';

import { SETTLE_SCRATCH_PREFIX, withSettleWorktree } from './settle-worktree.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-settle-worktree-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** How many worlds this file has made, so each gets its own directories. */
let worldCount = 0;

/** The environment every setup git runs under, isolated from the operator's config. */
function isolatedEnv(home: string): Record<string, string> {
  return {
    PATH: process.env['PATH'] ?? '',
    HOME: home,
    GIT_CONFIG_GLOBAL: join(home, '.gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'rafa test',
    GIT_AUTHOR_EMAIL: 'test@example.invalid',
    GIT_COMMITTER_NAME: 'rafa test',
    GIT_COMMITTER_EMAIL: 'test@example.invalid',
    LC_ALL: 'C',
  };
}

/** A bare origin, the caller's clone on a feature branch with work in flight, and another clone. */
interface World {
  readonly caller: string;
  readonly other: string;
  /** An empty directory scratch directories are made in, so a leftover is visible. */
  readonly scratchRoot: string;
  /** Runs git in `cwd` and answers stdout trimmed. */
  readonly git: (cwd: string, args: readonly string[]) => string;
}

/** Builds a {@link World}: origin's `main` holds one commit, the caller is on `feat` with an uncommitted edit. */
function world(): World {
  worldCount += 1;
  const dir = join(tempBase, `world-${String(worldCount)}`);
  const home = join(dir, 'home');
  const origin = join(dir, 'origin.git');
  const caller = join(dir, 'caller');
  const other = join(dir, 'other');
  const scratchRoot = join(dir, 'scratch');
  for (const path of [home, scratchRoot]) mkdirSync(path, { recursive: true });
  const env = isolatedEnv(home);
  const git = (cwd: string, args: readonly string[]): string => execFileSync('git', [...args], { cwd, encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] }).trim();

  git(dir, ['init', '-q', '--bare', '--initial-branch=main', origin]);
  git(dir, ['clone', '-q', origin, other]);
  writeFileSync(join(other, 'README.md'), 'first\n');
  git(other, ['add', '-A']);
  git(other, ['commit', '-q', '-m', 'first']);
  git(other, ['push', '-q', 'origin', 'main']);

  git(dir, ['clone', '-q', origin, caller]);
  git(caller, ['switch', '-q', '-c', 'feat']);
  writeFileSync(join(caller, 'README.md'), 'work in flight\n');
  return { caller, other, scratchRoot, git };
}

/** Pushes a new commit to origin's `main` from the other clone, answering its hash. */
function pushFromOther(w: World, text: string): string {
  writeFileSync(join(w.other, 'README.md'), text);
  w.git(w.other, ['commit', '-q', '-am', text.trim()]);
  w.git(w.other, ['push', '-q', 'origin', 'main']);
  return w.git(w.other, ['rev-parse', 'HEAD']);
}

/** How many worktrees `git worktree list` names for the caller's repository. */
function worktreeCount(w: World): number {
  return w.git(w.caller, ['worktree', 'list', '--porcelain'])
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .length;
}

/** The caller's checkout as a person would read it: branch, HEAD, status. */
function callerState(w: World): { branch: string; head: string; status: string } {
  return {
    branch: w.git(w.caller, ['branch', '--show-current']),
    head: w.git(w.caller, ['rev-parse', 'HEAD']),
    status: w.git(w.caller, ['status', '--porcelain']),
  };
}

/** A runner at the caller's root that fails any argv starting with `failing` and runs the rest. */
function failingOn(w: World, failing: readonly string[]): GitRunner {
  const real = createGitRunner(w.caller);
  return (args) => failing.every((word, index) => args[index] === word)
    ? { ok: false, stdout: '', stderr: `planted failure of git ${failing.join(' ')}` }
    : real(args);
}

describe('a settle worktree', () => {
  it('is added at the fetched origin/main, detached, and the body runs git there', async () => {
    const w = world();
    const pushed = pushFromOther(w, 'second\n');
    const inside: { count: number; head: string; branch: string; readme: string; scratch: string[] }[] = [];

    const outcome = await withSettleWorktree({ git: createGitRunner(w.caller), scratchRoot: w.scratchRoot }, (worktree) => {
      inside.push({
        count: worktreeCount(w),
        head: worktree.git(['rev-parse', 'HEAD']).stdout.trim(),
        branch: worktree.git(['branch', '--show-current']).stdout.trim(),
        readme: readFileSync(join(worktree.path, 'README.md'), 'utf8'),
        scratch: readdirSync(w.scratchRoot),
      });
      return 'answered';
    });

    expect(outcome).toEqual({ ok: true, value: 'answered', ref: 'origin/main', commit: pushed, leftover: null });
    expect(inside).toHaveLength(1);
    expect(inside[0]?.count).toBe(2);
    expect(inside[0]?.head).toBe(pushed);
    expect(inside[0]?.branch).toBe('');
    expect(inside[0]?.readme).toBe('second\n');
    expect(inside[0]?.scratch).toHaveLength(1);
    expect(inside[0]?.scratch[0]?.startsWith(SETTLE_SCRATCH_PREFIX)).toBe(true);
  });

  it('is removed with its scratch directory after the body answers, leaving the caller\'s checkout as it was', async () => {
    const w = world();
    const before = callerState(w);
    const branchesBefore = w.git(w.caller, ['branch', '--list']);

    await withSettleWorktree({ git: createGitRunner(w.caller), scratchRoot: w.scratchRoot }, (worktree) => {
      writeFileSync(join(worktree.path, 'README.md'), 'half-built release\n');
      writeFileSync(join(worktree.path, 'untracked.txt'), 'left behind\n');
    });

    expect(worktreeCount(w)).toBe(1);
    expect(readdirSync(w.scratchRoot)).toEqual([]);
    expect(callerState(w)).toEqual(before);
    expect(before.status).toBe('M README.md');
    expect(w.git(w.caller, ['branch', '--list'])).toBe(branchesBefore);
  });

  it('is removed when the body throws, and the throw reaches the caller', async () => {
    const w = world();
    let seen = 0;

    const run = withSettleWorktree({ git: createGitRunner(w.caller), scratchRoot: w.scratchRoot }, () => {
      seen = worktreeCount(w);
      throw new Error('the fold threw');
    });

    await expect(run).rejects.toThrow('the fold threw');
    expect(seen).toBe(2);
    expect(worktreeCount(w)).toBe(1);
    expect(readdirSync(w.scratchRoot)).toEqual([]);
  });

  it('is removed when an async body rejects', async () => {
    const w = world();

    const run = withSettleWorktree({ git: createGitRunner(w.caller), scratchRoot: w.scratchRoot }, async () => {
      await Promise.resolve();
      throw new Error('the delivery rejected');
    });

    await expect(run).rejects.toThrow('the delivery rejected');
    expect(worktreeCount(w)).toBe(1);
    expect(readdirSync(w.scratchRoot)).toEqual([]);
  });

  it('recovers from a failed remove by deleting the directory and pruning the record', async () => {
    const w = world();

    const outcome = await withSettleWorktree({ git: failingOn(w, ['worktree', 'remove']), scratchRoot: w.scratchRoot }, () => 1);

    expect(outcome.ok).toBe(true);
    expect(outcome.leftover).toBeNull();
    expect(readdirSync(w.scratchRoot)).toEqual([]);
    expect(worktreeCount(w)).toBe(1);
  });

  it('names a failed prune alongside the body\'s throw, keeping the throw as the cause', async () => {
    const w = world();
    const git = failingOn(w, ['worktree', 'remove']);
    const pruneFails: GitRunner = (args) => args[0] === 'worktree' && args[1] === 'prune'
      ? { ok: false, stdout: '', stderr: 'planted failure of git worktree prune' }
      : git(args);
    const thrown = new Error('the fold threw');

    const run = withSettleWorktree({ git: pruneFails, scratchRoot: w.scratchRoot }, () => {
      throw thrown;
    });

    const error: unknown = await run.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('the fold threw; and removing the settle worktree left the worktree record of');
    expect((error as Error).message).toContain('planted failure of git worktree prune');
    expect((error as Error).cause).toBe(thrown);
    expect(readdirSync(w.scratchRoot)).toEqual([]);
  });
});

describe('a settle worktree that cannot be made', () => {
  it('refuses a failed fetch before any directory is made, and runs no body', async () => {
    const w = world();
    let ran = false;

    const outcome = await withSettleWorktree({ git: createGitRunner(w.caller), base: { branch: 'no-such-branch' }, scratchRoot: w.scratchRoot }, () => {
      ran = true;
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.problem).toStartWith('no-such-branch could not be fetched from origin: ');
    expect(outcome.problem).toContain('no-such-branch');
    expect(outcome.leftover).toBeNull();
    expect(ran).toBe(false);
    expect(readdirSync(w.scratchRoot)).toEqual([]);
  });

  it('refuses a remote it cannot fetch from', async () => {
    const w = world();

    const outcome = await withSettleWorktree({ git: createGitRunner(w.caller), base: { remote: 'upstream' }, scratchRoot: w.scratchRoot }, () => 0);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.problem).toStartWith('main could not be fetched from upstream: ');
  });

  it('removes the scratch directory when the add fails, and runs no body', async () => {
    const w = world();
    let ran = false;

    const outcome = await withSettleWorktree({ git: failingOn(w, ['worktree', 'add']), scratchRoot: w.scratchRoot }, () => {
      ran = true;
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.problem).toStartWith('no worktree of origin/main could be added at ');
    expect(outcome.problem).toContain('planted failure of git worktree add');
    expect(outcome.leftover).toBeNull();
    expect(ran).toBe(false);
    expect(readdirSync(w.scratchRoot)).toEqual([]);
    expect(worktreeCount(w)).toBe(1);
  });

  it('refuses a scratch root that does not exist', async () => {
    const w = world();
    const missing = join(w.scratchRoot, 'missing');

    const outcome = await withSettleWorktree({ git: createGitRunner(w.caller), scratchRoot: missing }, () => 0);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.problem).toStartWith(`no scratch directory could be made under ${missing}: `);
    expect(existsSync(missing)).toBe(false);
    expect(worktreeCount(w)).toBe(1);
  });
});
