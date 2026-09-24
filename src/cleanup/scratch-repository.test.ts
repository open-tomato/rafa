/**
 * `readCleanup` over a real repository built by `./scratch-repository.ts`:
 * every branch lands in the group, with the reason and the default tick,
 * the design table names, and every worktree is marked by the rule that
 * holds for it.
 */
import type { CleanupRead } from './index.js';
import type { ScratchRepository } from './scratch-repository.js';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { createPullRequestsDouble } from '../pr/pull-requests-double.js';

import { createScratchRepository, LOCK_REASON, SCRATCH_NOW } from './scratch-repository.js';

import { defaultCleanupSeams, cleanupCounts, readCleanup } from './index.js';

describe('readCleanup over a scratch repository', () => {
  let repo: ScratchRepository;
  let read: CleanupRead;

  beforeAll(async () => {
    repo = createScratchRepository();
    const double = createPullRequestsDouble({
      listMerged: () => Promise.resolve([{
        number: 7,
        headRefName: 'squashed',
        headRefOid: repo.squashedTip,
        mergedAt: SCRATCH_NOW.toISOString(),
      }]),
    });
    const reading = await readCleanup(defaultCleanupSeams(repo.clone, double.pulls), {
      fetch: true,
      base: null,
      keep: [],
      staleDays: 30,
      // Zero: the worktrees were made a moment ago, and only the idle rule reads that.
      worktreeIdleDays: 0,
      now: SCRATCH_NOW,
      home: repo.home,
      cwd: repo.clone,
      projectRoot: repo.clone,
    });
    if (!reading.ok) throw new Error(reading.detail);
    read = reading;
  });

  afterAll(() => {
    repo.dispose();
  });

  it('reads the fetch and the base, and notes nothing', () => {
    expect(read.fetched).toBe(true);
    expect(read.base).toBe('main');
    expect(read.notes).toEqual([]);
  });

  it('puts the merged, squash-merged, gone and clean-worktree branches in Merged, ticked', () => {
    const rows = Object.fromEntries(read.merged.map((row) => [row.branch.name, row]));
    expect(Object.keys(rows).sort()).toEqual(['gone', 'merged', 'squashed', 'wt-clean']);
    expect(rows['merged']?.mergedBy).toEqual(['base']);
    expect(rows['wt-clean']?.mergedBy).toEqual(['base']);
    expect(rows['squashed']?.mergedBy).toEqual(['pull-request']);
    expect(rows['squashed']?.pullRequest?.number).toBe(7);
    expect(rows['gone']?.mergedBy).toEqual(['gone']);
    expect(rows['gone']?.reason).toBe('upstream origin/gone is gone');
    for (const row of read.merged) {
      expect(row.group).toBe('merged');
      expect(row.ticked).toBe(true);
    }
  });

  it('puts the branch idle for 90 days in Stale, unticked', () => {
    expect(read.stale.map((row) => [row.branch.name, row.group, row.ticked, row.idleDays, row.reason]))
      .toEqual([['stale', 'stale', false, 90, 'no commit in 90 days']]);
  });

  it('puts the branch with no upstream in Not pushed with its commit count, unticked', () => {
    expect(read.notPushed).toHaveLength(1);
    const [row] = read.notPushed;
    expect(row?.branch.name).toBe('unpushed');
    expect(row?.group).toBe('not-pushed');
    expect(row?.ticked).toBe(false);
    expect(row?.commits).toBe(2);
  });

  it('lists neither the base, the current branch, nor a recent branch in sync with its remote', () => {
    const listed = [...read.merged, ...read.stale, ...read.notPushed].map((row) => row.branch.name);
    expect(listed).not.toContain('main');
    expect(listed).not.toContain('wt-dirty');
    expect(listed).not.toContain('wt-locked');
  });

  it('ticks the clean worktree whose branch is merged, and only that one', () => {
    const rows = Object.fromEntries(read.worktrees.map((row) => [row.branch, row]));
    expect(Object.keys(rows).sort()).toEqual(['wt-clean', 'wt-dirty', 'wt-locked']);

    const clean = rows['wt-clean'];
    expect(clean?.path).toBe(repo.worktrees.clean);
    expect(clean?.blockers).toEqual([]);
    expect(clean?.tickable).toBe(true);
    expect(clean?.branchMerged).toBe(true);
    expect(clean?.ticked).toBe(true);
  });

  it('marks the dirty worktree untickable, naming the untracked file', () => {
    const dirty = read.worktrees.find((row) => row.branch === 'wt-dirty');
    expect(dirty?.path).toBe(repo.worktrees.dirty);
    expect(dirty?.blockers.map((blocker) => blocker.kind)).toEqual(['dirty']);
    expect(dirty?.blockers[0]?.reason).toContain('untracked');
    expect(dirty?.tickable).toBe(false);
    expect(dirty?.ticked).toBe(false);
  });

  it('marks the locked worktree untickable, giving the lock reason', () => {
    const locked = read.worktrees.find((row) => row.branch === 'wt-locked');
    expect(locked?.path).toBe(repo.worktrees.locked);
    expect(locked?.blockers.map((blocker) => blocker.kind)).toEqual(['locked']);
    expect(locked?.reason).toContain(LOCK_REASON);
    expect(locked?.tickable).toBe(false);
    expect(locked?.ticked).toBe(false);
  });

  it('counts each group', () => {
    expect(cleanupCounts(read)).toEqual({ merged: 4, stale: 1, notPushed: 1, worktrees: 3 });
  });
});
