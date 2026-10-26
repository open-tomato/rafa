/**
 * `rafa doctor`, spawned, over the scratch repository
 * `../cleanup/scratch-repository.ts` builds: the cleanup row names the
 * count of each group, in text and in json's `cleanup`, and over a
 * repository with nothing to clean (one commit, one branch) there is
 * no row.
 */
import type { ScratchRepository } from '../cleanup/scratch-repository.js';
import type { ScratchRepo } from '../tests/cli-capture.js';

import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { createScratchRepository, SCRATCH_NOW, STALE_AGE_DAYS } from '../cleanup/scratch-repository.js';
import { projectConfigText } from '../project/scaffold.js';
import { plantProjectConfig, plantScratchRepo, runRafa } from '../tests/cli-capture.js';
import { gitIdentityEnv } from '../tests/git-identity.js';

const SPAWN_TIMEOUT = 60_000;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-doctor-cleanup-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The spawn environment for a repository at `repo`, its HOME beside it. */
function around(repo: string, home: string): ScratchRepo {
  const planted = plantScratchRepo(tempBase, { project: false });
  return { ...planted, repo, home };
}

/**
 * The project config with a `cleanup.staleDays` read off the real clock.
 * The spawned doctor reads ages against `new Date()`, not
 * {@link SCRATCH_NOW}, so with the default 30 days every branch dated
 * {@link SCRATCH_NOW} read stale from 2026-10-24 12:00 UTC on. The days
 * since {@link SCRATCH_NOW}, plus half of {@link STALE_AGE_DAYS}, keep
 * `stale` past the line and every other branch short of it on any date.
 */
function clockProofConfig(): string {
  const elapsedDays = Math.ceil((Date.now() - SCRATCH_NOW.getTime()) / MS_PER_DAY);
  const staleDays = Math.max(elapsedDays, 0) + STALE_AGE_DAYS / 2;
  return `${projectConfigText()}cleanup:\n  staleDays: ${String(staleDays)}\n`;
}

describe('rafa doctor over the cleanup scratch repository', () => {
  let scratch: ScratchRepository;
  let target: ScratchRepo;

  beforeAll(() => {
    scratch = createScratchRepository();
    plantProjectConfig(scratch.clone, clockProofConfig());
    target = around(scratch.clone, scratch.home);
  });

  afterAll(() => {
    scratch.dispose();
  });

  it('prints the row with the count of every group and names rafa cleanup', () => {
    const run = runRafa(target, scratch.clone, ['doctor']);

    expect(run.stdout).toMatch(/^Cleanup: \d+ merged, \d+ stale, \d+ not pushed, \d+ worktrees; run rafa cleanup to review and remove them\.$/m);
    expect(run.stdout).toContain('Cleanup: 3 merged, 1 stale, 1 not pushed, 3 worktrees;');
  }, SPAWN_TIMEOUT);
});

describe('rafa doctor over a repository with nothing to clean', () => {
  it('prints no cleanup row', () => {
    const plain = plantScratchRepo(tempBase);
    writeFileSync(join(plain.repo, 'a.txt'), 'a\n');
    for (const args of [['add', '.'], ['-c', 'user.name=T', '-c', 'user.email=t@e.x', 'commit', '-q', '-m', 'first']]) {
      Bun.spawnSync(['git', ...args], { cwd: plain.repo, env: { PATH: plain.path, HOME: plain.home, GIT_CONFIG_GLOBAL: '/dev/null', ...gitIdentityEnv() } });
    }

    const run = runRafa(plain, plain.repo, ['doctor']);

    expect(run.stdout).not.toContain('Cleanup:');
    expect(run.stdout).not.toContain('rafa cleanup');
  }, SPAWN_TIMEOUT);
});
