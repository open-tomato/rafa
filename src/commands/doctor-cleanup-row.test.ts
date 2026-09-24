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

import { createScratchRepository } from '../cleanup/scratch-repository.js';
import { plantProjectConfig, plantScratchRepo, runRafa } from '../tests/cli-capture.js';

const SPAWN_TIMEOUT = 60_000;

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-doctor-cleanup-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The spawn environment for a repository at `repo`, its HOME beside it. */
function around(repo: string, home: string): ScratchRepo {
  const planted = plantScratchRepo(tempBase, { project: false });
  return { ...planted, repo, home };
}

describe('rafa doctor over the cleanup scratch repository', () => {
  let scratch: ScratchRepository;
  let target: ScratchRepo;

  beforeAll(() => {
    scratch = createScratchRepository();
    plantProjectConfig(scratch.clone);
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
      Bun.spawnSync(['git', ...args], { cwd: plain.repo, env: { PATH: plain.path, HOME: plain.home, GIT_CONFIG_GLOBAL: '/dev/null' } });
    }

    const run = runRafa(plain, plain.repo, ['doctor']);

    expect(run.stdout).not.toContain('Cleanup:');
    expect(run.stdout).not.toContain('rafa cleanup');
  }, SPAWN_TIMEOUT);
});
