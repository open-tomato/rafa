/**
 * `settleRunCheckout` under `--as-worktree` over real git: a clone of a
 * bare remote, started from somewhere other than the run's base
 * (`./run-checkout.ts`, "The base"), proving the worktree is cut from, or
 * caught up with, the base `resolveBaseBranch` reads and never the branch
 * the run was started on:
 *
 *  - from a local-only branch onto a claimed remote `feat/<stub>`: the
 *    output names the base, holds no `Could not fetch` line, and the
 *    catch-up reading is against `origin/main`;
 *  - from a detached HEAD: `feat/<stub>` is cut at the tip of
 *    `origin/main`, and no git call fetches `origin HEAD`;
 *  - with `prBase` naming a second remote branch: the worktree is cut
 *    from that branch.
 */
import type { GitRunner } from '../pr/git.js';

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '../adapters/output/active.js';
import { gitIdentityEnv } from '../tests/git-identity.js';
import { sinkOutput } from '../tests/output-sinks.js';

import { settleRunCheckout } from './run-checkout.js';
import { addRunWorktree } from './worktree.js';

const BASE = 'main';
const WORKTREE_DIR = '.rafa/worktrees';
const AS_WORKTREE = ['--as-worktree'];

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
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe', env: isolatedGitEnv(cwd) }).trim();
}

/** A git runner under the same environment that records every argv it is given into `calls`. */
function recordingRunner(calls: string[][]): (root: string) => GitRunner {
  return (root) => (args) => {
    calls.push([...args]);
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
}

/** Commits `name` with a line in the clone at `dir` and answers the new tip. */
function commitFile(dir: string, name: string): string {
  writeFileSync(join(dir, name), `${name}\n`);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-m', `add ${name}`);
  return git(dir, 'rev-parse', 'HEAD');
}

/** A clone of a bare origin whose `main` holds one commit, plus a second clone to move the origin from. */
function plantClone(): { readonly project: string; readonly other: string } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'run-checkout-base-')));
  scratch.push(root);
  const origin = join(root, 'origin.git');
  const seed = join(root, 'seed');
  const project = join(root, 'project');
  const other = join(root, 'other');
  mkdirSync(origin);
  git(origin, 'init', '--bare', '--initial-branch', BASE);
  mkdirSync(seed);
  git(seed, 'init', '--initial-branch', BASE);
  git(seed, 'remote', 'add', 'origin', origin);
  commitFile(seed, 'seed.txt');
  git(seed, 'push', 'origin', BASE);
  git(root, 'clone', origin, project);
  git(root, 'clone', origin, other);
  return { project, other };
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

/** Settles the checkout of a run on `project` with `--as-worktree`, recording git. */
function settle(project: string, stub: string, prBase: string | null, calls: string[][]): ReturnType<typeof settleRunCheckout> {
  return settleRunCheckout(
    { projectRoot: project, worktreeDir: WORKTREE_DIR, prBase, planStub: stub, args: AS_WORKTREE },
    {
      dirs: () => ({ projectRoot: project, checkout: project }),
      worktree: (request) => addRunWorktree(request, { git: recordingRunner(calls) }),
    },
  );
}

describe('settleRunCheckout --as-worktree over a real repository: the base', () => {
  it('names the base and catches a claimed remote branch up with origin/main from a local-only branch', async () => {
    const stub = 'rafa-2001';
    const { project, other } = plantClone();
    git(other, 'checkout', '-b', `feat/${stub}`);
    git(other, 'commit', '--allow-empty', '-m', `claim(${stub}): start`);
    git(other, 'push', 'origin', `feat/${stub}`);
    git(other, 'checkout', BASE);
    const baseTip = commitFile(other, 'base-moved.txt');
    git(other, 'push', 'origin', BASE);
    git(project, 'fetch', 'origin');
    git(project, 'checkout', '-b', 'local-only');
    const calls: string[][] = [];

    const run = await settle(project, stub, null, calls);

    expect(run.branch).toBe(`feat/${stub}`);
    expect(lines.some((line) => line.includes(`base is ${BASE}`) && line.includes('local-only'))).toBe(true);
    expect([...lines, ...warnings].some((line) => line.includes('Could not fetch'))).toBe(false);
    expect(warnings).toEqual([]);
    expect(calls).toContainEqual(['fetch', 'origin', BASE]);
    expect(calls.some((args) => args[0] === 'fetch' && args.includes('local-only'))).toBe(false);
    expect(git(run.checkout, 'merge-base', '--is-ancestor', baseTip, 'HEAD')).toBe('');
    expect(lines.some((line) => line.includes('Merged 1 commit of origin/main'))).toBe(true);
  });

  it('cuts feat/<stub> at the tip of origin/main from a detached HEAD, fetching no origin HEAD', async () => {
    const stub = 'rafa-2002';
    const { project, other } = plantClone();
    const moved = commitFile(other, 'base-moved.txt');
    git(other, 'push', 'origin', BASE);
    git(project, 'checkout', '--detach');
    const calls: string[][] = [];

    const run = await settle(project, stub, null, calls);

    expect(run.branch).toBe(`feat/${stub}`);
    expect(git(run.checkout, 'rev-parse', 'HEAD')).toBe(moved);
    expect(lines.some((line) => line.includes('a detached HEAD'))).toBe(true);
    expect(calls).toContainEqual(['fetch', 'origin', BASE]);
    expect(calls.some((args) => args[0] === 'fetch' && args.includes('HEAD'))).toBe(false);
    expect(warnings).toEqual([]);
  });

  it('cuts the worktree from the remote branch pr.base names', async () => {
    const stub = 'rafa-2003';
    const { project, other } = plantClone();
    git(other, 'checkout', '-b', 'release');
    const releaseTip = commitFile(other, 'release.txt');
    git(other, 'push', 'origin', 'release');
    const calls: string[][] = [];

    const run = await settle(project, stub, 'release', calls);

    expect(run.branch).toBe(`feat/${stub}`);
    expect(git(run.checkout, 'rev-parse', 'HEAD')).toBe(releaseTip);
    expect(lines.some((line) => line.includes('base is release') && line.includes('pr.base'))).toBe(true);
    expect(calls).toContainEqual(['fetch', 'origin', 'release']);
    expect(warnings).toEqual([]);
  });
});
