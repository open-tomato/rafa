/**
 * Tests for where a refused `rafa release tag` places its branch step
 * (`tag-next-steps.ts`), over real git: a main checkout holding `main`
 * and a linked worktree on another branch.
 *
 *   - from the linked worktree the step is `cd <main checkout> && rafa
 *     release tag`, since the checkout it must run in is not the top
 *     level the command ran in;
 *   - the same refusal in the checkout that holds the branch prints no
 *     `cd`. HEAD cannot be off a branch the checkout holds, so that
 *     case wraps the real runner and answers only the HEAD-branch read
 *     with another name: every other read, the worktree list and the
 *     top level included, is real git's;
 *   - a holder whose folder is gone, which `git worktree list` keeps
 *     until a prune, falls back to the `git switch` step. The control
 *     is the first case: the same holder, present, gives the `cd`.
 */
import type { PlantedProject } from '../../../cli-capture.js';
import type { RafaCommand } from '@open-tomato/rafa/core/command';
import type { GitRunner } from '@open-tomato/rafa/core/git';

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createGitRunner } from '@open-tomato/rafa/core/git';
import { gitIdentityEnv } from '@open-tomato/rafa/tests/git-identity';
import { createReleaseTagCommand } from '@open-tomato/rafa-release/commands/release/tag';

import { dispatchInProject, plantProjectConfig, plantScratchRepo } from '../../../cli-capture.js';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-release-tag-placed-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

const SUBJECTS = [{ name: 'release', summary: 'releases' }];

/** The branch the linked worktree stands on. */
const SIDE_BRANCH = 'feat/rafa-side';

/** The step the branch refusal prints at the holder. */
const HOLDER_STEP = 'rafa release tag — main is checked out there';

/** A main checkout holding `main`, and a linked worktree on {@link SIDE_BRANCH}. */
interface World {
  readonly main: string;
  readonly side: string;
  readonly home: string;
}

let worldCount = 0;

function git(cwd: string, home: string, args: readonly string[]): string {
  return execFileSync('git', [...args], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: home,
      GIT_CONFIG_GLOBAL: join(home, '.gitconfig'),
      GIT_CONFIG_NOSYSTEM: '1',
      ...gitIdentityEnv(),
    },
  });
}

/** Plants the main checkout with one commit on `main`, and the side worktree beside it, each a project. */
function plantWorld(): World {
  worldCount += 1;
  const base = join(tempBase, `world-${String(worldCount)}`);
  mkdirSync(base, { recursive: true });
  const scratch = plantScratchRepo(base, { project: false });
  const { repo: main, home } = scratch;
  git(main, home, ['checkout', '-q', '-B', 'main']);
  writeFileSync(join(main, 'package.json'), JSON.stringify({ name: 'x', version: '0.5.0' }), 'utf8');
  writeFileSync(join(main, 'CHANGELOG.md'), '# Changelog\n\n## 0.5.0 — 2026-09-15, rafa-1: a change\n', 'utf8');
  git(main, home, ['add', 'package.json', 'CHANGELOG.md']);
  git(main, home, ['commit', '-q', '-m', 'chore: release 0.5.0']);
  const side = join(scratch.repo, '..', 'side');
  git(main, home, ['worktree', 'add', '-q', '-b', SIDE_BRANCH, side]);
  const sideReal = realpathSync(side);
  plantProjectConfig(main);
  plantProjectConfig(sideReal);
  writeFileSync(join(sideReal, 'package.json'), JSON.stringify({ name: 'x', version: '0.5.0' }), 'utf8');
  writeFileSync(join(sideReal, 'CHANGELOG.md'), '# Changelog\n\n## 0.5.0 — 2026-09-15, rafa-1: a change\n', 'utf8');
  return { main, side: sideReal, home };
}

/** Dispatches `rafa release tag` from `root` over `makeGit`, or the real runner. */
async function tagFrom(
  root: string,
  home: string,
  makeGit: (root: string) => GitRunner = createGitRunner,
): Promise<{ exitCode: number | null; stderr: string }> {
  const project: PlantedProject = { root, home };
  const command: RafaCommand = createReleaseTagCommand({ git: makeGit });
  const run = await dispatchInProject(['release', 'tag'], SUBJECTS, [command], project);
  return { exitCode: run.exitCode, stderr: run.stderr };
}

/** The real runner for `root`, except that it reads HEAD as standing on another branch. */
function offBranchGit(root: string): GitRunner {
  const real = createGitRunner(root);
  return (args) => args.join(' ') === 'rev-parse --abbrev-ref HEAD'
    ? { ok: true, stdout: `${SIDE_BRANCH}\n`, stderr: '' }
    : real(args);
}

describe('the branch refusal step, placed over real git', () => {
  it('prints cd into the main checkout when run from a linked worktree', async () => {
    const world = plantWorld();

    const run = await tagFrom(world.side, world.home);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('a release is tagged on main, and feat/rafa-side is checked out\nNext:\n');
    expect(run.stderr).toContain(`  cd ${world.main} && ${HOLDER_STEP}\n`);
  });

  it('prints no cd for the same refusal in the checkout that holds the branch', async () => {
    const world = plantWorld();

    const run = await tagFrom(world.main, world.home, offBranchGit);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(`  ${HOLDER_STEP}\n`);
    expect(run.stderr).not.toContain(`cd ${world.main}`);
  });

  it('falls back to git switch when the holder path is pruned away', async () => {
    const world = plantWorld();
    // main moves to a linked worktree, which is then deleted without a prune.
    const held = join(world.main, '..', 'held');
    git(world.main, world.home, ['checkout', '-q', '--detach']);
    git(world.main, world.home, ['worktree', 'add', '-q', held, 'main']);
    const heldReal = realpathSync(held);
    const listed = git(world.side, world.home, ['worktree', 'list', '--porcelain']);
    expect(listed).toContain(`worktree ${heldReal}\nHEAD`);
    rmSync(heldReal, { recursive: true, force: true });

    const run = await tagFrom(world.side, world.home);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('git switch main, then rafa release tag — a release is tagged from main');
    expect(run.stderr).not.toContain(HOLDER_STEP);
    expect(run.stderr).not.toContain(`cd ${world.main}`);
  });
});
