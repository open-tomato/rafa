/**
 * Tests for the cleanup reading `rafa doctor` prints one row for
 * (`doctor-cleanup.ts`): the settings it reads with, that it never
 * fetches, where git runs, which provider it hands on, and the row.
 *
 * The fake cases run {@link readDoctorCleanup} over seams whose git
 * records every argv and refuses each, so no case of them spawns git or
 * `gh`. The scratch case runs it over the real repository
 * `../cleanup/scratch-repository.ts` builds, after deleting `merged` in
 * the bare remote itself, so the clone keeps `refs/remotes/origin/merged`
 * until a fetch prunes it. That ref surviving is the reading that no
 * fetch ran, and the same repository read by `readCleanup` with
 * `fetch: true` is the control proving the check could fail. The
 * scratch builder's own `gone` could not serve: it is deleted with
 * `git push origin --delete` from the clone, which drops the clone's
 * tracking ref at once (measured 2026-09-24, git 2.50.1), so no fetch
 * is needed to prune it.
 *
 * Every render case with a row sits beside one without: all four counts
 * zero, and a reading git refused.
 */
import type { DoctorCleanupInput, DoctorCleanupReading } from './doctor-cleanup.js';
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';
import type { CleanupCounts, CleanupSeams } from '../cleanup/index.js';
import type { ScratchRepository } from '../cleanup/scratch-repository.js';
import type { GitResult, GitRunner } from '../pr/git.js';
import type { PullRequests } from '../pr/types.js';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { defaultCleanupSeams, readCleanup } from '../cleanup/index.js';
import { createScratchRepository, SCRATCH_NOW } from '../cleanup/scratch-repository.js';

import {
  cleanupRow,
  doctorCleanupSettings,
  hasCleanup,
  readDoctorCleanup,
  renderDoctorCleanup,
} from './doctor-cleanup.js';

const ROOT = '/project';
const HOME = '/home/someone';

const CONFIG: DoctorCleanupInput['config'] = {
  prBase: 'trunk',
  cleanupKeep: ['release/*'],
  cleanupStaleDays: 45,
  cleanupWorktreeIdleDays: 3,
};

const ZERO: CleanupCounts = { merged: 0, stale: 0, notPushed: 0, worktrees: 0 };

/** What every git command answers in the fake: the refusal a directory that is no repository gets. */
const REFUSED: GitResult = { ok: false, stdout: '', stderr: 'fatal: not a git repository (or any of the parent directories): .git' };

/** A git that records every argv and refuses each, as a directory that is no repository does. */
function recordingGit(): { git: GitRunner; calls: string[][] } {
  const calls: string[][] = [];
  const git: GitRunner = (args) => {
    calls.push([...args]);
    return REFUSED;
  };
  return { git, calls };
}

/** Seams over `git`, capturing the directory and provider they were made for. */
function fakeSeams(git: GitRunner): {
  make: (cwd: string, pulls: PullRequests | null) => CleanupSeams;
  made: () => { cwd: string; pulls: PullRequests | null } | null;
} {
  let made: { cwd: string; pulls: PullRequests | null } | null = null;
  return {
    make: (cwd, pulls) => {
      made = { cwd, pulls };
      return {
        git,
        gitAt: () => git,
        sessions: () => [],
        modifiedAt: () => null,
        realPath: (path) => path,
        pulls,
      };
    },
    made: () => made,
  };
}

/** A `gh` runner answering every command with an empty list, recording each argv. */
function recordingGh(): { gh: GhRunner; calls: string[][] } {
  const calls: string[][] = [];
  const gh: GhRunner = (args) => {
    calls.push([...args]);
    return Promise.resolve<GhResult>({ ok: true, stdout: '[]', stderr: '' });
  };
  return { gh, calls };
}

describe('doctorCleanupSettings', () => {
  it('reads the config, never fetches, and runs in the project root', () => {
    const input: DoctorCleanupInput = { root: ROOT, home: HOME, config: CONFIG, gh: null };

    expect(doctorCleanupSettings(input, SCRATCH_NOW)).toEqual({
      fetch: false,
      base: 'trunk',
      keep: ['release/*'],
      staleDays: 45,
      worktreeIdleDays: 3,
      now: SCRATCH_NOW,
      home: HOME,
      cwd: ROOT,
      projectRoot: ROOT,
    });
  });
});

describe('readDoctorCleanup over fake seams', () => {
  it('runs git in the project root and sends no fetch, answering the refusal as its detail', async () => {
    const { git, calls } = recordingGit();
    const seams = fakeSeams(git);

    const reading = await readDoctorCleanup(
      { root: ROOT, home: HOME, config: CONFIG, gh: null },
      { cleanupSeams: seams.make, cleanupNow: () => SCRATCH_NOW },
    );

    expect(reading).toEqual({ ok: false, detail: expect.stringContaining('not a git repository') as unknown as string });
    expect(seams.made()?.cwd).toBe(ROOT);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.filter((argv) => argv.includes('fetch'))).toEqual([]);
  });

  it('hands on no provider without a gh runner, where a gh runner becomes one that lists through it', async () => {
    const without = fakeSeams(recordingGit().git);
    const withGh = fakeSeams(recordingGit().git);
    const { gh, calls } = recordingGh();

    await readDoctorCleanup({ root: ROOT, home: HOME, config: CONFIG, gh: null }, { cleanupSeams: without.make });
    await readDoctorCleanup({ root: ROOT, home: HOME, config: CONFIG, gh }, { cleanupSeams: withGh.make });

    expect(without.made()?.pulls).toBeNull();
    const pulls = withGh.made()?.pulls ?? null;
    expect(pulls).not.toBeNull();
    expect(await pulls?.listMerged()).toEqual([]);
    expect(calls.map((argv) => argv.slice(0, 4).join(' '))).toEqual(['pr list --state merged']);
  });
});

describe('readDoctorCleanup over a scratch repository', () => {
  let repo: ScratchRepository;
  let reading: DoctorCleanupReading;
  let refAfterDoctor: string;

  /** The clone's remote-tracking ref of `merged`, or '' once pruned. */
  const trackingRef = (): string => repo.git(['for-each-ref', '--format=%(refname)', 'refs/remotes/origin/merged']).trim();

  beforeAll(async () => {
    repo = createScratchRepository();
    repo.git(['branch', '-D', 'merged'], repo.bare);
    reading = await readDoctorCleanup(
      { root: repo.clone, home: repo.home, config: { ...CONFIG, prBase: null, cleanupKeep: [], cleanupWorktreeIdleDays: 0 }, gh: null },
      { cleanupNow: () => SCRATCH_NOW },
    );
    refAfterDoctor = trackingRef();
  });

  afterAll(() => {
    repo.dispose();
  });

  it('reads the repository and counts a row in some group', () => {
    expect(reading.ok).toBe(true);
    expect(reading.ok && hasCleanup(reading.counts)).toBe(true);
  });

  it('leaves a branch deleted in the remote with its tracking ref, where a fetching read prunes it', async () => {
    expect(refAfterDoctor).toBe('refs/remotes/origin/merged');

    const control = await readCleanup(defaultCleanupSeams(repo.clone, null), {
      ...doctorCleanupSettings({ root: repo.clone, home: repo.home, config: CONFIG, gh: null }, SCRATCH_NOW),
      fetch: true,
      base: null,
    });
    expect(control.ok && control.fetched).toBe(true);
    expect(trackingRef()).toBe('');
  });
});

describe('hasCleanup', () => {
  it('is false for four zeros and true for a single row in any group', () => {
    expect(hasCleanup(ZERO)).toBe(false);
    expect(hasCleanup({ ...ZERO, merged: 1 })).toBe(true);
    expect(hasCleanup({ ...ZERO, stale: 1 })).toBe(true);
    expect(hasCleanup({ ...ZERO, notPushed: 1 })).toBe(true);
    expect(hasCleanup({ ...ZERO, worktrees: 1 })).toBe(true);
  });
});

describe('cleanupRow', () => {
  it('names every group\'s count, zeros included, and rafa cleanup', () => {
    expect(cleanupRow({ merged: 4, stale: 0, notPushed: 1, worktrees: 3 }))
      .toBe('Cleanup: 4 merged, 0 stale, 1 not pushed, 3 worktrees; run rafa cleanup to review and remove them.');
  });

  it('says worktree for one', () => {
    expect(cleanupRow({ ...ZERO, worktrees: 1 }))
      .toBe('Cleanup: 0 merged, 0 stale, 0 not pushed, 1 worktree; run rafa cleanup to review and remove them.');
  });
});

describe('renderDoctorCleanup', () => {
  it('gives the row when any count is non-zero, and nothing for four zeros', () => {
    const counts: CleanupCounts = { merged: 2, stale: 1, notPushed: 0, worktrees: 0 };

    expect(renderDoctorCleanup({ ok: true, counts })).toEqual([cleanupRow(counts)]);
    expect(renderDoctorCleanup({ ok: true, counts: ZERO })).toEqual([]);
  });

  it('gives nothing for a reading git refused', () => {
    expect(renderDoctorCleanup({ ok: false, detail: 'fatal: not a git repository' })).toEqual([]);
  });
});
