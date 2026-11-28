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
 *
 * The last block spawns `bun src/rafa.ts loop start --as-worktree` on a
 * claim branch this device's store holds, cut after a commit of an older
 * stretch (#1669): a first dispatch is refused by the claim check before
 * any session, a resume goes on at the behind line, and the recut the
 * refusal names lets the run reach its first task.
 */
import type { ScratchRepo } from '../tests/cli-capture.js';
import type { GitRunner } from '@open-tomato/rafa/core/git';

import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { makeOwnershipCommit } from '@open-tomato/rafa/claims/git';
import { setActiveOutput } from '@open-tomato/rafa/core/output';
import { writePreflightChecks } from '@open-tomato/rafa/store/preflight';
import { gitIdentityEnv } from '@open-tomato/rafa/tests/git-identity';
import { sinkOutput } from '@open-tomato/rafa/tests/output-sinks';
import { readDeviceStoreId } from '@open-tomato/rafa-run/claims/device';
import { addRunWorktree } from '@open-tomato/rafa-run/start/worktree';

import { expectExit, plantScratchRepo, runRafa } from '../tests/cli-capture.js';

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

/** The stub of the plan the spawned runs execute: issue 1669's claim branch under the default template. */
const RUN_STUB = 'rafa-1669-kept-claim';

/** The claim branch {@link RUN_STUB} names. */
const RUN_BRANCH = `feat/${RUN_STUB}`;

/** The plan, two tasks. */
const RUN_PLAN = `# Plan: ${RUN_STUB}\n\n- [ ] Write the first probe file\n- [ ] Write the second probe file\n`;

/** Where the plan sits, relative to the project root. */
const RUN_PLAN_REL = join('.plans', `PLAN-${RUN_STUB}.md`);

/** The older stretch's commit the claim branch was cut after, the one #1669's branch carried. */
const OLD_WORK_SUBJECT = 'chore: apply #1605';

/** Every run here starts under these words: a worktree run, no CI wait. */
const RUN_ARGS = ['loop', 'start', `--plan=${RUN_PLAN_REL}`, '--as-worktree', '--no-ci-wait'];

/** How long a spawned case may take, both its runs included. */
const SPAWNED_TIMEOUT = { timeout: 60_000 };

/** The scratch every spawned case plants under, removed after the file. */
const spawnBase = realpathSync(mkdtempSync(join(tmpdir(), 'claim-branch-work-')));
afterAll(() => {
  rmSync(spawnBase, { recursive: true, force: true });
});

/** Runs git in `cwd` under `scratch`'s HOME, no system config, a fixed identity; answers trimmed stdout. */
function scratchGit(scratch: ScratchRepo, cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe',
    env: { ...process.env, HOME: scratch.home, GIT_CONFIG_GLOBAL: join(scratch.home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1', ...gitIdentityEnv() },
  }).trim();
}

/**
 * Writes a stand-in `claude` that drains its prompt, logs its call and
 * fails the session, so a run that reaches its first task stops there.
 */
function plantFailingClaude(scratch: ScratchRepo): void {
  const claude = join(scratch.bin, 'claude');
  writeFileSync(claude, ['#!/bin/sh', 'while read -r _line; do :; done', `echo called >> '${scratch.callLog}'`, 'exit 1', ''].join('\n'), 'utf8');
  chmodSync(claude, 0o755);
}

/**
 * A project on `main` with a bare `origin`, and #1669's claim branch: cut
 * after an older stretch's commit `origin/main` never took, then claimed
 * by this device's store and pushed, while `main` moved on. Answers the
 * scratch and the older commit's sha.
 */
function plantKeptClaim(): { readonly scratch: ScratchRepo; readonly oldWork: string } {
  const scratch = plantScratchRepo(spawnBase);
  const { repo } = scratch;
  const origin = join(dirname(repo), 'origin.git');
  scratchGit(scratch, dirname(repo), 'init', '-q', '--bare', origin);
  for (const [key, value] of [['user.name', 'Rafa Loop'], ['user.email', 'loop@example.test'], ['commit.gpgsign', 'false']] as const) {
    scratchGit(scratch, repo, 'config', key, value);
  }
  writeFileSync(join(repo, '.gitignore'), '.plans/\n.rafa/\nprogress.txt\n', 'utf8');
  writeFileSync(join(repo, 'seed.txt'), 'seed\n', 'utf8');
  scratchGit(scratch, repo, 'add', '-A');
  scratchGit(scratch, repo, 'commit', '-q', '--no-verify', '-m', 'seed');
  scratchGit(scratch, repo, 'branch', '-M', BASE);
  scratchGit(scratch, repo, 'remote', 'add', 'origin', origin);
  scratchGit(scratch, repo, 'push', '-q', '-u', 'origin', BASE);
  scratchGit(scratch, repo, 'remote', 'set-head', 'origin', BASE);

  scratchGit(scratch, repo, 'switch', '-q', '-c', 'stretch/old');
  writeFileSync(join(repo, 'old-fragment.md'), 'used by an earlier release\n', 'utf8');
  scratchGit(scratch, repo, 'add', '-A');
  scratchGit(scratch, repo, 'commit', '-q', '--no-verify', '-m', OLD_WORK_SUBJECT);
  const oldWork = scratchGit(scratch, repo, 'rev-parse', 'HEAD');
  scratchGit(scratch, repo, 'switch', '-q', BASE);
  writeFileSync(join(repo, BASE_FILE), 'moved\n', 'utf8');
  scratchGit(scratch, repo, 'add', '-A');
  scratchGit(scratch, repo, 'commit', '-q', '--no-verify', '-m', 'base moves on');
  scratchGit(scratch, repo, 'push', '-q', 'origin', BASE);

  // The store mints its id on its first write that adds a row, once the project has its root commit and origin.
  writePreflightChecks(repo, {
    runId: 'mint',
    checks: [{ tier: 'required', item: { kind: 'tool', name: 'mint', probe: 'exit 0' }, outcome: 'pass', durationMs: 0, failure: null }],
  });
  const device = readDeviceStoreId(repo, { store: 'sqlite' });
  if (!device.ok) throw new Error(device.reason);
  const made = makeOwnershipCommit(isolatedGitRunner(repo), oldWork, { action: 'claim', issue: 1669, store: device.storeId });
  if (!made.ok) throw new Error(made.reason);
  scratchGit(scratch, repo, 'branch', RUN_BRANCH, made.sha);
  scratchGit(scratch, repo, 'push', '-q', 'origin', RUN_BRANCH);

  mkdirSync(join(repo, '.plans'));
  writeFileSync(join(repo, RUN_PLAN_REL), RUN_PLAN, 'utf8');
  plantFailingClaude(scratch);
  return { scratch, oldWork };
}

/** The refusal's lines as a first dispatch on {@link plantKeptClaim}'s branch prints them. */
function refusalLines(oldWork: string): readonly string[] {
  const sha = oldWork.slice(0, 12);
  return [
    `❌ Refusing to start: ${RUN_BRANCH} holds work that is not a claim, and no task of this plan has been committed on it.`,
    `   ${RUN_BRANCH} is 1 commit behind origin/${BASE}, and 1 of its 2 commits past it is not a claim; the first, newest first, is ${sha} ${OLD_WORK_SUBJECT}`,
    `     git rebase --onto origin/${BASE} ${sha} ${RUN_BRANCH} && git push --force-with-lease origin ${RUN_BRANCH}`,
    '   Nothing was checked and nothing was dispatched.',
  ];
}

describe('rafa loop start on a kept claim branch holding a commit that is not a claim (#1669)', () => {
  it('refuses before the first task, naming the branch, the commit and the recut; the recut branch then reaches its first task', () => {
    const { scratch, oldWork } = plantKeptClaim();
    const worktree = join(scratch.repo, WORKTREE_DIR, RUN_STUB);

    const refused = runRafa(scratch, scratch.repo, RUN_ARGS);
    const calledByRefused = existsSync(scratch.callLog);

    expectExit(refused, 1, scratch);
    const said = `${refused.stdout}\n${refused.stderr}`;
    for (const line of refusalLines(oldWork)) expect(said).toContain(line);
    expect(calledByRefused).toBe(false);
    expect(existsSync(join(worktree, BASE_FILE))).toBe(false);

    // The control: the branch recut by the refusal's own line keeps its claim and reaches its first task.
    scratchGit(scratch, worktree, 'rebase', '-q', '--onto', `origin/${BASE}`, oldWork.slice(0, 12), RUN_BRANCH);
    scratchGit(scratch, worktree, 'push', '-q', '--force-with-lease', 'origin', RUN_BRANCH);
    expect(scratchGit(scratch, worktree, 'log', '--format=%s', `origin/${BASE}..${RUN_BRANCH}`)).toBe('claim(rafa-1669): claim');

    const recut = runRafa(scratch, scratch.repo, RUN_ARGS);

    expect(`${recut.stdout}\n${recut.stderr}`).not.toContain('Refusing to start');
    expect(existsSync(scratch.callLog)).toBe(true);
  }, SPAWNED_TIMEOUT);

  it('lets a resumed run through on the same branch, at the catch-up\'s behind line', () => {
    const { scratch } = plantKeptClaim();
    writeFileSync(join(scratch.repo, '.plans', `PLAN_TRACKER-${RUN_STUB}.md`), RUN_PLAN.replace('- [ ] Write the first', '- [x] Write the first'), 'utf8');

    const resumed = runRafa(scratch, scratch.repo, RUN_ARGS);

    const said = `${resumed.stdout}\n${resumed.stderr}`;
    expect(said).not.toContain('Refusing to start');
    expect(said).toContain(`${RUN_BRANCH} is 1 commit behind origin/${BASE} and was not merged: 1 of its 2 commits past it is not a claim.`);
    expect(existsSync(scratch.callLog)).toBe(true);
  }, SPAWNED_TIMEOUT);
});
