/**
 * `readCleanup` over scripted seams, for the order it reads in, what it
 * passes from one reader to the next and every failure it answers, and
 * `cleanupCounts` over its reading; then once over a real clone of a
 * bare remote, where the same branch is and is not `[gone]` depending
 * on whether the fetch was asked for, so the fetch is shown to change
 * the reading rather than assumed to.
 */
import type { CleanupSeams, CleanupSettings } from './index.js';
import type { GitResult, GitRunner } from '../pr/git.js';
import type { MergedPullRequest } from '../pr/types.js';

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createPullRequestsDouble } from '../pr/pull-requests-double.js';

import { BRANCH_FORMAT } from './branches.js';
import { unreachableNote } from './groups.js';
import { GIT_DIR, WORKTREE_LIST, WORKTREE_STATUS } from './worktrees.js';

import {
  cleanupCounts,
  defaultCleanupSeams,
  FETCH_PRUNE,
  fetchFailedNote,
  readCleanup,
} from './index.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-09-24T12:00:00Z');
const RECENT = Math.floor((NOW.getTime() - DAY) / 1000);
const OLD = Math.floor((NOW.getTime() - 90 * DAY) / 1000);

const REPO = '/repo';
const HOME = '/home/me';
const CLAUDE = `${REPO}/.claude/worktrees`;

const FETCH = FETCH_PRUNE.join(' ');
const FOR_EACH_REF = `for-each-ref --format=${BRANCH_FORMAT} refs/heads`;
const MERGED_CALL = 'branch --merged refs/heads/main --format=%(refname:lstrip=2)';
const COUNT_WIP = 'rev-list --count refs/heads/wip --not --remotes refs/heads/main --';
const TIPS_CALL = 'for-each-ref --format=%(refname:lstrip=2)%09%(objectname) refs/heads';

/** One line of {@link BRANCH_FORMAT} output. */
function ref(name: string, upstream: string, track: string, unix: number, head = ' '): string {
  return [name, upstream, track, String(unix), head].join('\t');
}

/** `done` merged into main, `old` stale, `wip` never pushed, `here` checked out, and the base. */
const BRANCHES = [
  ref('done', 'origin/done', '', RECENT),
  ref('here', 'origin/here', '', RECENT, '*'),
  ref('main', 'origin/main', '', RECENT),
  ref('old', 'origin/old', '', OLD),
  ref('wip', '', '', RECENT),
].join('\n') + '\n';

function said(stdout: string): GitResult {
  return { ok: true, stdout, stderr: '' };
}

function refused(stderr: string): GitResult {
  return { ok: false, stdout: '', stderr };
}

/** One `git worktree list --porcelain` block. */
function block(path: string, branch: string): string {
  return `worktree ${path}\nHEAD 5158da744601f648211affb9554adc0b7498dadd\nbranch refs/heads/${branch}\n\n`;
}

/** The main worktree, and a clean one on `done` and one on `old` under `.claude/worktrees/`. */
const WORKTREES = block(REPO, 'here') + block(`${CLAUDE}/a`, 'done') + block(`${CLAUDE}/b`, 'old');

/** The answers of the repository the scripted git reads. */
const ANSWERS: Readonly<Record<string, GitResult>> = {
  [FETCH]: said(''),
  [FOR_EACH_REF]: said(BRANCHES),
  [MERGED_CALL]: said('done\n'),
  [COUNT_WIP]: said('2\n'),
  [WORKTREE_LIST.join(' ')]: said(WORKTREES),
};

/** Seams answering `answers` in the command's directory, every call written to `log`. */
function scripted(
  overrides: Record<string, GitResult> = {},
  pulls: CleanupSeams['pulls'] = null,
): { seams: CleanupSeams; log: string[] } {
  const log: string[] = [];
  const answers = { ...ANSWERS, ...overrides };
  const git: GitRunner = (args) => {
    const call = args.join(' ');
    log.push(call);
    const answer = answers[call];
    if (answer === undefined) {
      throw new Error(`unscripted git call: ${call}`);
    }
    return answer;
  };
  const gitAt = (dir: string): GitRunner => (args) => {
    const call = args.join(' ');
    if (call === GIT_DIR.join(' ')) {
      return said(`${REPO}/.git/worktrees/${dir.split('/').pop() ?? ''}\n`);
    }
    if (call === WORKTREE_STATUS.join(' ')) {
      return said('');
    }
    throw new Error(`unscripted git call in ${dir}: ${call}`);
  };
  const seams: CleanupSeams = {
    git,
    gitAt,
    sessions: () => [],
    modifiedAt: () => new Date(NOW.getTime() - 30 * DAY),
    realPath: (path) => path,
    pulls,
  };
  return { seams, log };
}

function settings(overrides: Partial<CleanupSettings> = {}): CleanupSettings {
  return {
    fetch: true,
    base: 'main',
    keep: [],
    staleDays: 30,
    worktreeIdleDays: 7,
    now: NOW,
    home: HOME,
    cwd: REPO,
    projectRoot: REPO,
    ...overrides,
  };
}

describe('readCleanup over scripted seams', () => {
  it('fetches first, then reads the three branch groups and the worktrees', async () => {
    const { seams, log } = scripted();
    const reading = await readCleanup(seams, settings());
    if (!reading.ok) throw new Error(reading.detail);

    expect(log).toEqual([FETCH, FOR_EACH_REF, MERGED_CALL, COUNT_WIP, WORKTREE_LIST.join(' ')]);
    expect(reading.fetched).toBe(true);
    expect(reading.base).toBe('main');
    expect(reading.merged.map((row) => [row.branch.name, row.reason])).toEqual([['done', 'merged into main']]);
    expect(reading.stale.map((row) => [row.branch.name, row.reason])).toEqual([['old', 'no commit in 90 days; merged state unknown']]);
    expect(reading.notPushed.map((row) => [row.branch.name, row.commits])).toEqual([['wip', 2]]);
    expect(reading.notes).toEqual([]);
  });

  it('tells the worktrees which branches are in Merged, so only the one on a merged branch starts ticked', async () => {
    const { seams } = scripted();
    const reading = await readCleanup(seams, settings());
    if (!reading.ok) throw new Error(reading.detail);

    expect(reading.worktrees.map((row) => [row.path, row.branchMerged, row.ticked])).toEqual([
      [`${CLAUDE}/a`, true, true],
      [`${CLAUDE}/b`, false, false],
    ]);
  });

  it('runs no fetch when it is not asked for, as rafa doctor reads', async () => {
    const { seams, log } = scripted();
    const reading = await readCleanup(seams, settings({ fetch: false }));
    if (!reading.ok) throw new Error(reading.detail);

    expect(log).not.toContain(FETCH);
    expect(log[0]).toBe(FOR_EACH_REF);
    expect(reading.fetched).toBe(false);
  });

  it('reads on past a failed fetch, saying so in one note ahead of the groups\' notes', async () => {
    const pulls = createPullRequestsDouble({ listMerged: () => Promise.reject(new Error('HTTP 502')) });
    const { seams } = scripted({
      [FETCH]: refused('fatal: \'origin\' does not appear to be a git repository\nfatal: Could not read from remote repository.\n'),
    }, pulls.pulls);
    const reading = await readCleanup(seams, settings());
    if (!reading.ok) throw new Error(reading.detail);

    expect(reading.fetched).toBe(false);
    expect(reading.notes).toEqual([
      fetchFailedNote('fatal: \'origin\' does not appear to be a git repository'),
      unreachableNote('HTTP 502'),
    ]);
    expect(reading.merged.map((row) => row.branch.name)).toEqual(['done']);
  });

  it('says git said nothing when a failed fetch wrote nothing', async () => {
    const { seams } = scripted({ [FETCH]: refused('') });
    const reading = await readCleanup(seams, settings());
    if (!reading.ok) throw new Error(reading.detail);

    expect(reading.notes).toEqual([fetchFailedNote('git said nothing')]);
  });

  it('hands the provider\'s merged pull requests to the groups, after the branches are read', async () => {
    const merged: readonly MergedPullRequest[] = [
      { number: 7, headRefName: 'old', headRefOid: 'abc', mergedAt: '2026-09-01T00:00:00Z' },
    ];
    const pulls = createPullRequestsDouble({ listMerged: () => Promise.resolve(merged) });
    const { seams } = scripted({ [TIPS_CALL]: said('done\tfff\nold\tabc\nwip\teee\n') }, pulls.pulls);
    const reading = await readCleanup(seams, settings());
    if (!reading.ok) throw new Error(reading.detail);

    expect(pulls.sent()).toEqual(['listMerged']);
    expect(reading.merged.map((row) => [row.branch.name, row.reason])).toEqual([
      ['done', 'merged into main'],
      ['old', 'pull request #7 merged'],
    ]);
    expect(reading.stale).toEqual([]);
    expect(reading.worktrees.map((row) => [row.branch, row.ticked])).toEqual([['done', true], ['old', true]]);
  });

  it('passes on the branch reader\'s failure, asking no provider and listing no worktree', async () => {
    const pulls = createPullRequestsDouble({});
    const { seams, log } = scripted({ [FOR_EACH_REF]: refused('fatal: not a git repository\n') }, pulls.pulls);

    expect(await readCleanup(seams, settings()))
      .toEqual({ ok: false, detail: 'git for-each-ref failed: fatal: not a git repository' });
    expect(pulls.calls()).toEqual([]);
    expect(log).not.toContain(WORKTREE_LIST.join(' '));
  });

  it('passes on the groups\' failure', async () => {
    const { seams } = scripted({ [COUNT_WIP]: refused('fatal: bad revision\n') });

    expect(await readCleanup(seams, settings()))
      .toEqual({ ok: false, detail: 'git rev-list --count wip failed: fatal: bad revision' });
  });

  it('passes on the worktree listing\'s failure rather than reading the group as empty', async () => {
    const { seams } = scripted({ [WORKTREE_LIST.join(' ')]: refused('fatal: broken\n') });

    expect(await readCleanup(seams, settings()))
      .toEqual({ ok: false, detail: 'git worktree list failed: fatal: broken' });
  });

  it('drops the base, the current branch and the cleanup.keep matches before grouping', async () => {
    const { seams, log } = scripted();
    const reading = await readCleanup(seams, settings({ keep: ['w*'] }));
    if (!reading.ok) throw new Error(reading.detail);

    const listed = [...reading.merged, ...reading.stale, ...reading.notPushed].map((row) => row.branch.name);
    expect(listed).toEqual(['done', 'old']);
    expect(log).not.toContain(COUNT_WIP);
  });
});

describe('cleanupCounts', () => {
  it('counts the rows of each group', async () => {
    const { seams } = scripted();
    const reading = await readCleanup(seams, settings());
    if (!reading.ok) throw new Error(reading.detail);

    expect(cleanupCounts(reading)).toEqual({ merged: 1, stale: 1, notPushed: 1, worktrees: 2 });
  });

  it('counts zero in every group of an empty reading', () => {
    expect(cleanupCounts({
      ok: true,
      base: 'main',
      fetched: false,
      merged: [],
      stale: [],
      notPushed: [],
      worktrees: [],
      notes: [],
    })).toEqual({ merged: 0, stale: 0, notPushed: 0, worktrees: 0 });
  });
});

describe('readCleanup over a real clone', () => {
  const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-cleanup-index-')));
  const env = {
    ...process.env,
    LC_ALL: 'C',
    GIT_AUTHOR_NAME: 'Test',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'Test',
    GIT_COMMITTER_EMAIL: 'test@example.com',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
  };

  afterAll(() => {
    rmSync(tempBase, { recursive: true, force: true });
  });

  function git(cwd: string, ...args: string[]): string {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8', env });
    if (result.status !== 0) {
      throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
    }
    return result.stdout;
  }

  /** A clone whose `gone` branch was pushed, then deleted in the remote behind its back. */
  function cloneWithGoneBranch(name: string): string {
    const bare = join(tempBase, `${name}.git`);
    const clone = join(tempBase, name);
    git(tempBase, 'init', '--quiet', '--bare', '--initial-branch=main', bare);
    git(tempBase, 'clone', '--quiet', bare, clone);
    git(clone, 'commit', '--quiet', '--allow-empty', '-m', 'first');
    git(clone, 'push', '--quiet', '-u', 'origin', 'main');
    git(clone, 'switch', '--quiet', '-c', 'gone');
    git(clone, 'commit', '--quiet', '--allow-empty', '-m', 'on gone');
    git(clone, 'push', '--quiet', '-u', 'origin', 'gone');
    git(clone, 'switch', '--quiet', 'main');
    git(bare, 'branch', '-D', 'gone');
    return clone;
  }

  function realSettings(clone: string, fetch: boolean): CleanupSettings {
    const home = join(tempBase, 'home');
    mkdirSync(home, { recursive: true });
    return settings({ fetch, base: null, now: new Date(), home, cwd: clone, projectRoot: clone });
  }

  it('lists a branch deleted in the remote as Merged only once the fetch has pruned it', async () => {
    const clone = cloneWithGoneBranch('gone-repo');

    const unfetched = await readCleanup(defaultCleanupSeams(clone, null), realSettings(clone, false));
    if (!unfetched.ok) throw new Error(unfetched.detail);
    expect(unfetched.fetched).toBe(false);
    expect(cleanupCounts(unfetched)).toEqual({ merged: 0, stale: 0, notPushed: 0, worktrees: 0 });

    const fetched = await readCleanup(defaultCleanupSeams(clone, null), realSettings(clone, true));
    if (!fetched.ok) throw new Error(fetched.detail);
    expect(fetched.fetched).toBe(true);
    expect(fetched.base).toBe('main');
    expect(fetched.merged.map((row) => [row.branch.name, row.reason, row.ticked]))
      .toEqual([['gone', 'upstream origin/gone is gone', true]]);
    expect(fetched.notes).toEqual([]);
  });
});
