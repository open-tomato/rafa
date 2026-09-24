/**
 * `./cleanup-render.ts` over hand-built readings — the four groups'
 * lines, the empty groups, the notes, the column padding, the Stale
 * row's remote delete line and the JSON data — and once over the
 * scratch repository, where the line a Stale row names is run against
 * the bare remote.
 *
 * ## The control
 *
 * That the Stale row's `git push origin --delete <b>` line is right is
 * read from git, not from this file: the line is run in the scratch
 * clone and the bare remote no longer lists the branch. The same
 * remote is read BEFORE the line runs and does list it, so a line that
 * deleted nothing, or a remote that never held the branch, would
 * redden the case.
 */
import type {
  CleanupRead,
  LocalBranch,
  MergedRow,
  NotPushedRow,
  StaleRow,
  WorktreeRow,
} from '../cleanup/index.js';
import type { ScratchRepository } from '../cleanup/scratch-repository.js';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { defaultCleanupSeams, readCleanup } from '../cleanup/index.js';
import { createScratchRepository, SCRATCH_NOW } from '../cleanup/scratch-repository.js';
import { createPullRequestsDouble } from '../pr/pull-requests-double.js';

import {
  CLEANUP_GROUP_TITLES,
  NO_ROWS_TEXT,
  UNKNOWN_DATE,
  branchRowLine,
  cleanupData,
  cleanupDate,
  cleanupNameWidth,
  remoteDeleteLine,
  renderCleanup,
  worktreeRowLine,
} from './cleanup-render.js';

const WHEN = new Date('2026-09-20T08:30:00Z');
const OLD = new Date('2026-06-26T23:59:59Z');

function branch(name: string, overrides: Partial<LocalBranch> = {}): LocalBranch {
  return { name, upstream: `origin/${name}`, gone: false, ahead: 0, lastCommit: WHEN, ...overrides };
}

const MERGED: MergedRow = {
  group: 'merged',
  branch: branch('done'),
  ticked: true,
  mergedBy: ['base', 'pull-request'],
  pullRequest: { number: 12, headRefName: 'done', headRefOid: 'abc', mergedAt: WHEN.toISOString() },
  reason: 'merged into main; pull request #12 merged',
};

const STALE: StaleRow = {
  group: 'stale',
  branch: branch('old-idea', { lastCommit: OLD }),
  ticked: false,
  idleDays: 90,
  reason: 'no commit in 90 days',
};

const NOT_PUSHED: NotPushedRow = {
  group: 'not-pushed',
  branch: branch('wip', { upstream: null, ahead: null }),
  ticked: false,
  commits: 2,
  reason: 'no upstream; 2 commits not on any remote',
};

const WORKTREE: WorktreeRow = {
  path: '/repo/.claude/worktrees/wt-a',
  branch: 'wt-a',
  lastModified: WHEN,
  branchMerged: false,
  blockers: [{ kind: 'dirty', reason: '1 untracked' }, { kind: 'locked', reason: 'locked' }],
  tickable: false,
  ticked: false,
  reason: '1 untracked; locked',
};

function reading(overrides: Partial<CleanupRead> = {}): CleanupRead {
  return {
    ok: true,
    base: 'main',
    fetched: true,
    merged: [MERGED],
    stale: [STALE],
    notPushed: [NOT_PUSHED],
    worktrees: [WORKTREE],
    notes: [],
    ...overrides,
  };
}

describe('cleanupDate', () => {
  it('is the UTC calendar day, whatever the hour', () => {
    expect(cleanupDate(WHEN)).toBe('2026-09-20');
    expect(cleanupDate(OLD)).toBe('2026-06-26');
  });
});

describe('remoteDeleteLine', () => {
  it('names git push origin --delete <b> for the usual origin/<b> upstream', () => {
    expect(remoteDeleteLine('old-idea', 'origin/old-idea')).toBe('git push origin --delete old-idea');
  });

  it('reads the remote and the remote name off an upstream that differs from the local one', () => {
    expect(remoteDeleteLine('local', 'fork/feature/x')).toBe('git push fork --delete feature/x');
  });

  it('falls back to origin and the local name when the upstream is absent or has no slash', () => {
    expect(remoteDeleteLine('b', null)).toBe('git push origin --delete b');
    expect(remoteDeleteLine('b', 'origin')).toBe('git push origin --delete b');
    expect(remoteDeleteLine('b', 'origin/')).toBe('git push origin --delete b');
  });

  it('shell-quotes a name a shell would split', () => {
    expect(remoteDeleteLine('it\'s', 'origin/it\'s')).toBe('git push origin --delete \'it\'\\\'\'s\'');
  });
});

describe('row lines', () => {
  it('shows a branch row as name, last commit date and reason', () => {
    expect(branchRowLine(MERGED)).toBe('done  2026-09-20  merged into main; pull request #12 merged');
    expect(branchRowLine(NOT_PUSHED)).toBe('wip  2026-09-20  no upstream; 2 commits not on any remote');
  });

  it('ends a Stale row naming the remote delete for the person to run', () => {
    expect(branchRowLine(STALE)).toBe(
      'old-idea  2026-06-26  no commit in 90 days; to delete the remote branch: git push origin --delete old-idea',
    );
  });

  it('names the remote delete on no other group\'s row', () => {
    for (const row of [MERGED, NOT_PUSHED]) {
      expect(branchRowLine(row)).not.toContain('git push');
    }
  });

  it('shows a worktree row as path, modification date and reason, or unknown when that was not read', () => {
    expect(worktreeRowLine(WORKTREE)).toBe('/repo/.claude/worktrees/wt-a  2026-09-20  1 untracked; locked');
    expect(worktreeRowLine({ ...WORKTREE, lastModified: null }))
      .toBe(`/repo/.claude/worktrees/wt-a  ${UNKNOWN_DATE}  1 untracked; locked`);
  });

  it('pads the name to the width it is given', () => {
    expect(branchRowLine(NOT_PUSHED, 6)).toBe('wip     2026-09-20  no upstream; 2 commits not on any remote');
  });
});

describe('renderCleanup', () => {
  it('lists the four groups in order, each heading with its count and one line per row', () => {
    const read = reading({ worktrees: [] });
    const width = cleanupNameWidth(read);
    expect(width).toBe('old-idea'.length);
    expect(renderCleanup(read)).toEqual([
      'Merged (1)',
      `  ${branchRowLine(MERGED, width)}`,
      'Stale (1)',
      `  ${branchRowLine(STALE, width)}`,
      'Not pushed (1)',
      `  ${branchRowLine(NOT_PUSHED, width)}`,
      'Worktrees (0)',
      `  ${NO_ROWS_TEXT}`,
    ]);
  });

  it('pads every name, branch or worktree path, to one column so the dates line up', () => {
    const lines = renderCleanup(reading()).filter((line) => line.startsWith('  '));
    const dateColumns = new Set(lines.map((line) => line.search(/\d{4}-\d{2}-\d{2}/)));
    expect(dateColumns.size).toBe(1);
    expect([...dateColumns][0]).toBe(2 + WORKTREE.path.length + 2);
  });

  it('names all four groups when every one is empty', () => {
    const lines = renderCleanup(reading({ merged: [], stale: [], notPushed: [], worktrees: [] }));
    expect(lines).toEqual([
      `${CLEANUP_GROUP_TITLES.merged} (0)`,
      `  ${NO_ROWS_TEXT}`,
      `${CLEANUP_GROUP_TITLES.stale} (0)`,
      `  ${NO_ROWS_TEXT}`,
      `${CLEANUP_GROUP_TITLES.notPushed} (0)`,
      `  ${NO_ROWS_TEXT}`,
      `${CLEANUP_GROUP_TITLES.worktrees} (0)`,
      `  ${NO_ROWS_TEXT}`,
    ]);
  });

  it('puts the notes first, one line each', () => {
    const lines = renderCleanup(reading({ notes: ['fetch failed', 'provider unreachable'] }));
    expect(lines.slice(0, 3)).toEqual(['note: fetch failed', 'note: provider unreachable', 'Merged (1)']);
  });
});

describe('cleanupData', () => {
  it('carries every row with its dates as ISO strings, its reason and its default tick', () => {
    expect(cleanupData(reading({ notes: ['a note'] }))).toEqual({
      base: 'main',
      fetched: true,
      counts: { merged: 1, stale: 1, notPushed: 1, worktrees: 1 },
      merged: [{
        name: 'done',
        upstream: 'origin/done',
        lastCommit: '2026-09-20T08:30:00.000Z',
        reason: MERGED.reason,
        ticked: true,
        mergedBy: ['base', 'pull-request'],
        pullRequest: 12,
      }],
      stale: [{
        name: 'old-idea',
        upstream: 'origin/old-idea',
        lastCommit: '2026-06-26T23:59:59.000Z',
        reason: STALE.reason,
        ticked: false,
        idleDays: 90,
        remoteDelete: 'git push origin --delete old-idea',
      }],
      notPushed: [{
        name: 'wip',
        upstream: null,
        lastCommit: '2026-09-20T08:30:00.000Z',
        reason: NOT_PUSHED.reason,
        ticked: false,
        commits: 2,
      }],
      worktrees: [{
        path: WORKTREE.path,
        branch: 'wt-a',
        lastModified: '2026-09-20T08:30:00.000Z',
        reason: WORKTREE.reason,
        tickable: false,
        ticked: false,
        branchMerged: false,
        blockers: ['dirty', 'locked'],
      }],
      notes: ['a note'],
    });
  });

  it('answers null for a pull request and a modification time that are absent', () => {
    const data = cleanupData(reading({
      merged: [{ ...MERGED, pullRequest: null, mergedBy: ['gone'] }],
      worktrees: [{ ...WORKTREE, lastModified: null }],
    }));
    expect(data.merged[0]?.pullRequest).toBeNull();
    expect(data.worktrees[0]?.lastModified).toBeNull();
  });

  it('survives a JSON round trip unchanged', () => {
    const data = cleanupData(reading());
    expect(JSON.parse(JSON.stringify(data))).toEqual(data);
  });
});

describe('the scratch repository', () => {
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

  it('shows every group with a row for each branch and worktree read', () => {
    const lines = renderCleanup(read);
    expect(lines.filter((line) => !line.startsWith('  '))).toEqual([
      `Merged (${String(read.merged.length)})`,
      'Stale (1)',
      'Not pushed (1)',
      `Worktrees (${String(read.worktrees.length)})`,
    ]);
    expect(lines).toContain(`  ${branchRowLine(read.stale[0] as StaleRow, cleanupNameWidth(read))}`);
  });

  it('names a remote delete that, run, deletes the stale branch in the remote', () => {
    const [row] = read.stale;
    if (row === undefined) throw new Error('no Stale row');
    const line = remoteDeleteLine(row.branch.name, row.branch.upstream);
    expect(line).toBe('git push origin --delete stale');
    const remoteHeads = (): string => repo.git(['ls-remote', '--heads', 'origin']);
    expect(remoteHeads()).toContain('refs/heads/stale\n');

    repo.git(line.split(' ').slice(1));

    expect(remoteHeads()).not.toContain('refs/heads/stale\n');
    expect(remoteHeads()).toContain('refs/heads/main\n');
  });
});
