/**
 * `readCleanup` over a real repository built by `./scratch-repository.ts`:
 * every branch lands in the group, with the reason and the default tick,
 * the design table names, and every worktree is marked by the rule that
 * holds for it.
 *
 * Then the fixture's remote-only option: the three branches it puts on
 * the remote with no local copy, what `git cherry` reads of each, and
 * the default build read side by side with it, so the option is shown
 * to add those three and move nothing else.
 *
 * Last, the fixture's clock: a build around a moment 400 days later,
 * read with that same moment, reads as the default build reads with
 * `SCRATCH_NOW`; read with `SCRATCH_NOW` instead, it reads nothing old.
 */
import type { ScratchOptions, ScratchRepository } from './scratch-repository.js';
import type { CleanupRead } from '@open-tomato/rafa-run/cleanup/index';

import { statSync } from 'node:fs';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { createPullRequestsDouble } from '@open-tomato/rafa/pr/pull-requests-double';
import { defaultCleanupSeams, cleanupCounts, readCleanup } from '@open-tomato/rafa-run/cleanup/index';
import { openUnknownNote } from '@open-tomato/rafa-run/cleanup/remote-only';

import {
  createScratchRepository,
  LOCK_REASON,
  REMOTE_ONLY_BRANCHES,
  REMOTE_ONLY_COMMITS,
  SCRATCH_NOW,
} from './scratch-repository.js';

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
      worktreeDir: '.rafa/worktrees',
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

  it('puts the merged, squash-merged, gone and clean-worktree branches in Merged, ticking all but gone', () => {
    const rows = Object.fromEntries(read.merged.map((row) => [row.branch.name, row]));
    expect(Object.keys(rows).sort()).toEqual(['gone', 'merged', 'squashed', 'wt-clean']);
    expect(rows['merged']?.mergedBy).toEqual(['base']);
    expect(rows['wt-clean']?.mergedBy).toEqual(['base']);
    expect(rows['squashed']?.mergedBy).toEqual(['pull-request']);
    expect(rows['squashed']?.pullRequest?.number).toBe(7);
    expect(rows['gone']?.mergedBy).toEqual(['gone']);
    expect(rows['gone']?.reason).toBe('upstream origin/gone is gone; main does not reach its tip');
    for (const row of read.merged) {
      expect(row.group).toBe('merged');
      expect(row.ticked).toBe(row.branch.name !== 'gone');
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

/** The branches the default build leaves on the bare remote. */
const DEFAULT_REMOTE_BRANCHES = ['main', 'merged', 'squashed', 'stale', 'wt-clean', 'wt-dirty', 'wt-locked'];

/** The local branches of the default build. */
const DEFAULT_LOCAL_BRANCHES = [
  'gone',
  'main',
  'merged',
  'squashed',
  'stale',
  'unpushed',
  'wt-clean',
  'wt-dirty',
  'wt-locked',
];

/** The short names `for-each-ref` lists under `prefix`, sorted. */
function refNames(repo: ScratchRepository, prefix: string, cwd: string = repo.clone): string[] {
  return repo.git(['for-each-ref', `--format=%(refname:lstrip=${String(prefix.split('/').length)})`, prefix], cwd)
    .split('\n')
    .filter((name) => name !== '')
    .sort();
}

/**
 * The clone's remote-tracking branches. `origin/HEAD` is left out: it
 * is a name for `main` and not a branch, and whether a clone of an
 * empty remote ends up holding it depends on the git that fetched.
 */
function remoteTracking(repo: ScratchRepository): string[] {
  return refNames(repo, 'refs/remotes/origin').filter((name) => name !== 'HEAD');
}

/** The `+` and `-` marks `git cherry` writes for `origin/<name>` against `origin/main`, in order. */
function cherryMarks(repo: ScratchRepository, name: string): string[] {
  return repo.git(['cherry', 'refs/remotes/origin/main', `refs/remotes/origin/${name}`])
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => line.slice(0, 1));
}

/** A scratch repository, the five groups it reads as, and the reading's notes. */
interface ScratchGroups {
  readonly repo: ScratchRepository;
  readonly groups: unknown;
  readonly notes: readonly string[];
  /** The whole reading the groups were projected from. */
  readonly reading: CleanupRead;
}

/**
 * The five groups of a reading, as the names in each and the ticks, and
 * its notes apart: read with no provider, the remote-only set leaves a
 * note of its own, which is no part of what the five groups read.
 *
 * Read with the clock the repository was built around unless `clock`
 * names another. Branches are projected to their names, since a
 * branch's `lastCommit` moves with the build's clock.
 */
async function groupsOf(options: ScratchOptions, clock?: Date): Promise<ScratchGroups> {
  const repo = createScratchRepository(options);
  try {
    const reading = await readCleanup(defaultCleanupSeams(repo.clone, null), {
      fetch: true,
      base: null,
      keep: [],
      staleDays: 30,
      worktreeIdleDays: 0,
      now: clock ?? repo.now,
      home: repo.home,
      cwd: repo.clone,
      projectRoot: repo.clone,
      worktreeDir: '.rafa/worktrees',
    });
    if (!reading.ok) throw new Error(reading.detail);
    const groups = {
      base: reading.base,
      merged: reading.merged.map((row) => [row.branch.name, row.ticked, row.reason]),
      stale: reading.stale.map((row) => [row.branch.name, row.ticked, row.reason]),
      notPushed: reading.notPushed.map((row) => [row.branch.name, row.ticked, row.commits]),
      worktrees: reading.worktrees.map((row) => [row.branch, row.tickable, row.ticked]),
      counts: cleanupCounts(reading),
    };
    return { repo, groups, notes: reading.notes, reading };
  } catch (error) {
    repo.dispose();
    throw error;
  }
}

describe('the scratch repository with its remote-only option', () => {
  let plain: ScratchGroups;
  let withSet: ScratchGroups;
  const added = Object.values(REMOTE_ONLY_BRANCHES);

  beforeAll(async () => {
    plain = await groupsOf({});
    withSet = await groupsOf({ remoteOnly: true });
  });

  afterAll(() => {
    plain.repo.dispose();
    withSet.repo.dispose();
  });

  it('names one unmerged branch, one copied branch and one stretch branch', () => {
    expect(REMOTE_ONLY_BRANCHES).toEqual({
      unmerged: 'remote-unmerged',
      copied: 'remote-copied',
      stretch: 'stretch/9',
    });
  });

  it('leaves the default build with no branch that is only on the remote', () => {
    expect(refNames(plain.repo, 'refs/heads', plain.repo.bare)).toEqual(DEFAULT_REMOTE_BRANCHES);
    expect(refNames(plain.repo, 'refs/heads')).toEqual(DEFAULT_LOCAL_BRANCHES);
    const local = new Set(DEFAULT_LOCAL_BRANCHES);
    expect(DEFAULT_REMOTE_BRANCHES.filter((name) => !local.has(name))).toEqual([]);
  });

  it('adds the three branches to the remote and to the remote-tracking refs, and nothing else', () => {
    const expected = [...DEFAULT_REMOTE_BRANCHES, ...added].sort();
    expect(refNames(withSet.repo, 'refs/heads', withSet.repo.bare)).toEqual(expected);
    expect(remoteTracking(withSet.repo)).toEqual(expected);
  });

  it('gives none of the three a local copy', () => {
    expect(refNames(withSet.repo, 'refs/heads')).toEqual(DEFAULT_LOCAL_BRANCHES);
  });

  it('keeps every one of the three out of reach of the base', () => {
    const merged = remoteTracking(withSet.repo).filter((name) => (
      withSet.repo.git(['rev-list', '--count', `refs/remotes/origin/main..refs/remotes/origin/${name}`]).trim() === '0'
    ));
    // The control: the listing does find the branches the base reaches.
    expect(merged).toEqual(['main', 'merged', 'wt-clean']);
    for (const name of added) {
      expect(withSet.repo.git(['rev-list', '--count', `refs/remotes/origin/main..refs/remotes/origin/${name}`]).trim())
        .toBe(String(REMOTE_ONLY_COMMITS));
    }
  });

  it('reads no patch-equal copy of the unmerged and stretch commits, and one of every copied commit', () => {
    const none = Array.from({ length: REMOTE_ONLY_COMMITS }, () => '+');
    const every = Array.from({ length: REMOTE_ONLY_COMMITS }, () => '-');
    expect(cherryMarks(withSet.repo, REMOTE_ONLY_BRANCHES.unmerged)).toEqual(none);
    expect(cherryMarks(withSet.repo, REMOTE_ONLY_BRANCHES.stretch)).toEqual(none);
    expect(cherryMarks(withSet.repo, REMOTE_ONLY_BRANCHES.copied)).toEqual(every);
  });

  it('moves main by the copies only', () => {
    const count = (repo: ScratchRepository): number => (
      Number(repo.git(['rev-list', '--count', 'refs/remotes/origin/main']).trim())
    );
    expect(count(withSet.repo) - count(plain.repo)).toBe(REMOTE_ONLY_COMMITS);
    expect(withSet.repo.git(['rev-list', '--count', 'refs/remotes/origin/main..refs/heads/main']).trim()).toBe('0');
  });

  it('leaves the five groups of the default build as they read without it', () => {
    expect(withSet.groups).toEqual(plain.groups);
    expect(withSet.repo.pastHead).toBeNull();
    // The one note is the remote-only reading's: with no provider it withholds the two branches it would list.
    expect(plain.notes).toEqual([]);
    expect(withSet.notes).toEqual([openUnknownNote(added.length - 1)]);
  });

  it('leaves every local branch but main on the commit the default build puts it on', () => {
    const tips = (repo: ScratchRepository): string[] => (
      repo.git(['for-each-ref', '--format=%(refname:short) %(objectname)', 'refs/heads'])
        .split('\n')
        .filter((line) => line !== '' && !line.startsWith('main '))
    );
    expect(tips(plain.repo)).toHaveLength(DEFAULT_LOCAL_BRANCHES.length - 1);
    expect(tips(withSet.repo)).toEqual(tips(plain.repo));
  });
});

/** How many days past `SCRATCH_NOW` the later build is built around. */
const LATER_BUILD_DAYS = 400;

describe('the scratch repository built around another moment', () => {
  const later = new Date(SCRATCH_NOW.getTime() + LATER_BUILD_DAYS * 24 * 60 * 60 * 1000);
  let fixed: ScratchGroups;
  let moved: ScratchGroups;
  let movedReadFixed: ScratchGroups;

  beforeAll(async () => {
    fixed = await groupsOf({});
    moved = await groupsOf({ now: later });
    movedReadFixed = await groupsOf({ now: later }, SCRATCH_NOW);
  }, 30_000);

  afterAll(() => {
    fixed.repo.dispose();
    moved.repo.dispose();
    movedReadFixed.repo.dispose();
  });

  it('answers the moment it was built around, SCRATCH_NOW when none is given', () => {
    expect(fixed.repo.now.getTime()).toBe(SCRATCH_NOW.getTime());
    expect(moved.repo.now.getTime()).toBe(later.getTime());
  });

  it('dates its commits and its worktrees from that moment', () => {
    const dateOf = (repo: ScratchRepository, ref: string): number => (
      Number(repo.git(['log', '-1', '--format=%ct', ref]).trim()) * 1000
    );
    expect(dateOf(moved.repo, 'refs/heads/merged')).toBe(later.getTime());
    expect(later.getTime() - dateOf(moved.repo, 'refs/heads/stale')).toBe(90 * 24 * 60 * 60 * 1000);
    expect(dateOf(fixed.repo, 'refs/heads/merged')).toBe(SCRATCH_NOW.getTime());
    // The idle rule at zero days reads an older worktree as it reads a current one; the times themselves do not.
    for (const path of Object.values(moved.repo.worktrees)) {
      expect(statSync(path).mtime.getTime()).toBe(later.getTime());
    }
  });

  it('reads with its own clock as the default build reads with SCRATCH_NOW', () => {
    expect(moved.groups).toEqual(fixed.groups);
    expect(moved.notes).toEqual(fixed.notes);
  });

  it('reads no branch stale and every worktree recent when read with SCRATCH_NOW instead', () => {
    // The control: a clock that is not the build's, the reading the fix keeps the spawned case from.
    const recent = (groups: ScratchGroups): boolean[] => groups.reading.worktrees.map((row) => (
      row.blockers.some((blocker) => blocker.kind === 'recent')
    ));
    expect(movedReadFixed.reading.stale).toEqual([]);
    expect(recent(movedReadFixed)).toEqual([true, true, true]);
    expect(fixed.reading.stale.map((row) => row.branch.name)).toEqual(['stale']);
    expect(recent(fixed)).toEqual([false, false, false]);
  });
});
