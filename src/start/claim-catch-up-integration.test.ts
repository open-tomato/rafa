/**
 * `addRunWorktree` over a real temporary repository with a real bare
 * `origin`, proving the claim catch-up the unit tests pin over a git seam:
 *
 *  - a `feat/<stub>` holding only claim commits, cut before `main` moved,
 *    is merged with `origin/main`, so the run's worktree holds the base's
 *    new commit;
 *  - a `feat/<stub>` holding a non-claim commit is reported as behind
 *    `origin/main` and left unmerged: the worktree lacks the base's new
 *    commit and the branch tip is where it was.
 */
import type { GitRunner } from '../pr/git.js';

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '../adapters/output/active.js';
import { gitIdentityEnv } from '../tests/git-identity.js';
import { sinkOutput } from '../tests/output-sinks.js';

import { addRunWorktree } from './worktree.js';

const BASE = 'main';
const WORKTREE_DIR = '.rafa/worktrees';
const BASE_FILE = 'base-moved.txt';

const scratch: string[] = [];

/** The environment every git here runs under: isolated config, scratch HOME, fixed identity. */
function isolatedGitEnv(cwd: string): Record<string, string> {
  return {
    PATH: process.env.PATH ?? '',
    HOME: cwd,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    ...gitIdentityEnv(),
  };
}

/** Runs git in `cwd` under an isolated config and a fixed identity; answers trimmed stdout. */
function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: isolatedGitEnv(cwd) }).trim();
}

/** The `seams.git` runner: the same isolated environment, so the catch-up merge has an identity. */
const isolatedGitRunner = (root: string): GitRunner => (args) => {
  const result = spawnSync('git', [...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...isolatedGitEnv(root), LC_ALL: 'C' },
  });
  if (result.error !== undefined) {
    return { ok: false, stdout: '', stderr: `could not run git in ${root}: ${result.error.message}` };
  }
  return { ok: result.status === 0, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
};

/** A project cloned from a bare origin holding one commit on `main`, plus the origin's path. */
function plantProject(): { readonly project: string; readonly origin: string } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'claim-catch-up-')));
  scratch.push(root);
  const origin = join(root, 'origin.git');
  const project = join(root, 'project');
  mkdirSync(origin);
  git(origin, 'init', '--bare', '--initial-branch', BASE);
  mkdirSync(project);
  git(project, 'init', '--initial-branch', BASE);
  git(project, 'remote', 'add', 'origin', origin);
  writeFileSync(join(project, 'seed.txt'), 'seed\n');
  git(project, 'add', '-A');
  git(project, 'commit', '-m', 'seed');
  git(project, 'push', 'origin', BASE);
  return { project, origin };
}

/** Moves `origin/main` on by one commit adding {@link BASE_FILE}, pushed from a second clone. */
function moveBase(project: string, origin: string): string {
  const other = join(project, '..', 'other');
  git(project, 'clone', origin, other);
  writeFileSync(join(other, BASE_FILE), 'moved\n');
  git(other, 'add', '-A');
  git(other, 'commit', '-m', 'base moves on');
  git(other, 'push', 'origin', BASE);
  return git(other, 'rev-parse', 'HEAD');
}

let lines: string[] = [];
let warnings: string[] = [];

beforeEach(() => {
  lines = [];
  warnings = [];
  setActiveOutput(sinkOutput({
    info: (message) => {
      lines.push(message);
    },
    warn: (message) => {
      warnings.push(message);
    },
  }));
});

afterEach(() => {
  setActiveOutput(null);
});

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

describe('addRunWorktree over a real repository: claim catch-up', () => {
  it('merges the moved base into a claim-only branch, so the worktree holds its new commit', () => {
    const stub = 'rafa-1001';
    const { project, origin } = plantProject();
    git(project, 'branch', `feat/${stub}`);
    git(project, 'checkout', `feat/${stub}`);
    git(project, 'commit', '--allow-empty', '-m', 'claim(rafa-1001): start');
    git(project, 'checkout', BASE);
    const baseTip = moveBase(project, origin);

    const outcome = addRunWorktree({ projectRoot: project, worktreeDir: WORKTREE_DIR, planStub: stub, base: BASE }, { git: isolatedGitRunner });

    expect(outcome.route).toBe('switch-local');
    expect(outcome.catchUp?.reading.kind).toBe('catch-up');
    expect(existsSync(join(outcome.path, BASE_FILE))).toBe(true);
    expect(git(outcome.path, 'merge-base', '--is-ancestor', baseTip, 'HEAD')).toBe('');
    expect(lines.some((line) => line.includes('Merged 1 commit of origin/main'))).toBe(true);
    expect(warnings).toEqual([]);
  });

  it('reports a branch with a non-claim commit as behind and leaves it unmerged', () => {
    const stub = 'rafa-1002';
    const { project, origin } = plantProject();
    git(project, 'checkout', '-b', `feat/${stub}`);
    git(project, 'commit', '--allow-empty', '-m', 'claim(rafa-1002): start');
    writeFileSync(join(project, 'work.txt'), 'work\n');
    git(project, 'add', '-A');
    git(project, 'commit', '-m', 'feat: real work');
    const branchTip = git(project, 'rev-parse', 'HEAD');
    git(project, 'checkout', BASE);
    moveBase(project, origin);

    const outcome = addRunWorktree({ projectRoot: project, worktreeDir: WORKTREE_DIR, planStub: stub, base: BASE }, { git: isolatedGitRunner });

    expect(outcome.catchUp?.reading).toMatchObject({ kind: 'behind', behind: 1, workCommits: 1 });
    expect(existsSync(join(outcome.path, BASE_FILE))).toBe(false);
    expect(git(project, 'rev-parse', `feat/${stub}`)).toBe(branchTip);
    expect(warnings.some((line) => line.includes('1 commit behind origin/main') && line.includes('was not merged'))).toBe(true);
    expect(lines.some((line) => line.includes('Merged'))).toBe(false);
  });
});
