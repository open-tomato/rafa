/**
 * `classifyBranches` over a scripted git, for each rule of the Design
 * table and each reason, and once over a real clone of a bare remote,
 * so the argv this module spells and the commit count the module note
 * records are read from git itself rather than from this file's script.
 */
import type { BranchesRead, LocalBranch } from './branches.js';
import type { BranchGroups, BranchGroupsReading, ProviderMerges } from './groups.js';
import type { GitResult, GitRunner } from '../pr/git.js';
import type { MergedPullRequest } from '../pr/types.js';

import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createGitRunner } from '../pr/git.js';
import { createPullRequestsDouble } from '../pr/pull-requests-double.js';

import { readBranches } from './branches.js';
import {
  MERGED_STATE_UNKNOWN,
  baseUnreadNote,
  classifyBranches,
  readProviderMerges,
  unreachableNote,
} from './groups.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-09-24T12:00:00Z');
const SETTINGS = { staleDays: 30, now: NOW };

const MERGED_CALL = 'branch --merged refs/heads/main --format=%(refname:lstrip=2)';
const TIPS_CALL = 'for-each-ref --format=%(refname:lstrip=2)%09%(objectname) refs/heads';

function said(stdout: string): GitResult {
  return { ok: true, stdout, stderr: '' };
}

function refused(stderr: string): GitResult {
  return { ok: false, stdout: '', stderr };
}

/** The rev-list count call for `name`, excluding the base unless told not to. */
function countCall(name: string, withBase = true): string {
  const base = withBase
    ? ' refs/heads/main'
    : '';
  return `rev-list --count refs/heads/${name} --not --remotes${base} --`;
}

/** A git that answers `answers[argv joined by spaces]`, recording every call. */
function scriptedGit(answers: Record<string, GitResult>): { git: GitRunner; calls: string[] } {
  const calls: string[] = [];
  const git: GitRunner = (args) => {
    const call = args.join(' ');
    calls.push(call);
    const answer = answers[call];
    if (answer === undefined) {
      throw new Error(`unscripted git call: ${call}`);
    }
    return answer;
  };
  return { git, calls };
}

function branch(name: string, fields: Partial<LocalBranch> = {}): LocalBranch {
  return {
    name,
    upstream: `origin/${name}`,
    gone: false,
    ahead: 0,
    lastCommit: new Date(NOW.getTime() - DAY),
    ...fields,
  };
}

function reading(...branches: LocalBranch[]): BranchesRead {
  return { ok: true, base: 'main', branches };
}

function pull(number: number, headRefName: string, headRefOid: string): MergedPullRequest {
  return { number, headRefName, headRefOid, mergedAt: '2026-09-20T10:00:00Z' };
}

const NO_MERGES: ProviderMerges = { state: 'read', pullRequests: [] };

/** The groups, or a throw naming why they were not read. */
function groups(answer: BranchGroupsReading): BranchGroups {
  if (!answer.ok) {
    throw new Error(answer.detail);
  }
  return answer;
}

/** Every row as group, name, reason and tick, in group order. */
function rows(answer: BranchGroupsReading): { group: string; name: string; reason: string; ticked: boolean }[] {
  const read = groups(answer);
  return [...read.merged, ...read.stale, ...read.notPushed]
    .map(({ group, branch: { name }, reason, ticked }) => ({ group, name, reason, ticked }));
}

describe('classifyBranches: Merged', () => {
  it('ticks a branch git lists as merged into the base', () => {
    const { git } = scriptedGit({ [MERGED_CALL]: said('main\ndone\n') });
    const read = groups(classifyBranches(git, reading(branch('done')), NO_MERGES, SETTINGS));
    expect(read.merged).toEqual([{
      group: 'merged',
      branch: branch('done'),
      ticked: true,
      mergedBy: ['base'],
      pullRequest: null,
      reason: 'merged into main',
    }]);
  });

  it('ticks a squash-merged branch whose tip is the merged pull request\'s head commit', () => {
    const merged = pull(12, 'squashed', 'abc123');
    const { git } = scriptedGit({ [MERGED_CALL]: said(''), [TIPS_CALL]: said('squashed\tabc123\n') });
    const provider: ProviderMerges = { state: 'read', pullRequests: [merged] };
    const read = groups(classifyBranches(git, reading(branch('squashed')), provider, SETTINGS));
    expect(read.merged.map(({ mergedBy, pullRequest, reason }) => ({ mergedBy, pullRequest, reason })))
      .toEqual([{ mergedBy: ['pull-request'], pullRequest: merged, reason: 'pull request #12 merged' }]);
  });

  it('leaves a branch whose name a merged pull request carries at another commit, saying so', () => {
    const { git } = scriptedGit({
      [MERGED_CALL]: said(''),
      [TIPS_CALL]: said('reused\tnew456\n'),
      [countCall('reused')]: said('2\n'),
    });
    const provider: ProviderMerges = { state: 'read', pullRequests: [pull(9, 'reused', 'old123')] };
    const answer = classifyBranches(git, reading(branch('reused', { ahead: 2 })), provider, SETTINGS);
    expect(rows(answer)).toEqual([{
      group: 'not-pushed',
      name: 'reused',
      ticked: false,
      reason: '2 ahead of origin/reused; 2 commits not on any remote; pull request #9 merged at another commit',
    }]);
  });

  it('ticks a branch whose upstream is gone', () => {
    const { git } = scriptedGit({ [MERGED_CALL]: said('') });
    const gone = branch('gone', { gone: true, ahead: null });
    expect(rows(classifyBranches(git, reading(gone), NO_MERGES, SETTINGS)))
      .toEqual([{ group: 'merged', name: 'gone', ticked: true, reason: 'upstream origin/gone is gone' }]);
  });

  it('keeps every reading that holds, in order, and names each in the reason', () => {
    const { git } = scriptedGit({ [MERGED_CALL]: said('all\n'), [TIPS_CALL]: said('all\tfff\n') });
    const provider: ProviderMerges = { state: 'read', pullRequests: [pull(3, 'all', 'fff')] };
    const all = branch('all', { gone: true, ahead: null });
    const [row] = groups(classifyBranches(git, reading(all), provider, SETTINGS)).merged;
    expect(row?.mergedBy).toEqual(['base', 'pull-request', 'gone']);
    expect(row?.reason).toBe('merged into main; pull request #3 merged; upstream origin/all is gone');
  });

  it('puts a merged branch in Merged even when it is ahead of its upstream or old', () => {
    const { git } = scriptedGit({ [MERGED_CALL]: said('old\nahead\n') });
    const old = branch('old', { lastCommit: new Date(NOW.getTime() - 90 * DAY) });
    const ahead = branch('ahead', { ahead: 3 });
    const read = groups(classifyBranches(git, reading(ahead, old), NO_MERGES, SETTINGS));
    expect(read.merged.map((row) => row.branch.name)).toEqual(['ahead', 'old']);
    expect(read.stale).toEqual([]);
    expect(read.notPushed).toEqual([]);
  });
});

describe('classifyBranches: Not pushed', () => {
  it('lists a branch with no upstream, unticked, with the commits it would lose', () => {
    const { git, calls } = scriptedGit({ [MERGED_CALL]: said(''), [countCall('local')]: said('3\n') });
    const local = branch('local', { upstream: null, ahead: null });
    const read = groups(classifyBranches(git, reading(local), NO_MERGES, SETTINGS));
    expect(read.notPushed).toEqual([{
      group: 'not-pushed',
      branch: local,
      ticked: false,
      commits: 3,
      reason: 'no upstream; 3 commits not on any remote',
    }]);
    expect(calls).toContain(countCall('local'));
  });

  it('lists a branch ahead of its upstream and spells one commit singular', () => {
    const { git } = scriptedGit({ [MERGED_CALL]: said(''), [countCall('ahead')]: said('1\n') });
    expect(rows(classifyBranches(git, reading(branch('ahead', { ahead: 1 })), NO_MERGES, SETTINGS))).toEqual([{
      group: 'not-pushed',
      name: 'ahead',
      ticked: false,
      reason: '1 ahead of origin/ahead; 1 commit not on any remote',
    }]);
  });

  it('puts an old branch with unpushed commits in Not pushed rather than Stale', () => {
    const { git } = scriptedGit({ [MERGED_CALL]: said(''), [countCall('both')]: said('2\n') });
    const both = branch('both', { ahead: 2, lastCommit: new Date(NOW.getTime() - 90 * DAY) });
    const read = groups(classifyBranches(git, reading(both), NO_MERGES, SETTINGS));
    expect(read.stale).toEqual([]);
    expect(read.notPushed.map((row) => row.commits)).toEqual([2]);
  });

  it('answers why when git cannot count the commits', () => {
    const { git } = scriptedGit({
      [MERGED_CALL]: said(''),
      [countCall('local')]: refused('fatal: bad revision\nmore\n'),
    });
    const local = branch('local', { upstream: null, ahead: null });
    expect(classifyBranches(git, reading(local), NO_MERGES, SETTINGS))
      .toEqual({ ok: false, detail: 'git rev-list --count local failed: fatal: bad revision' });
  });
});

describe('classifyBranches: Stale', () => {
  it('lists a pushed branch last committed to past cleanup.staleDays, unticked', () => {
    const { git } = scriptedGit({ [MERGED_CALL]: said('') });
    const old = branch('old', { lastCommit: new Date(NOW.getTime() - (45 * DAY) - 5000) });
    const read = groups(classifyBranches(git, reading(old), NO_MERGES, SETTINGS));
    expect(read.stale).toEqual([{ group: 'stale', branch: old, ticked: false, idleDays: 45, reason: 'no commit in 45 days' }]);
  });

  it('does not list a branch exactly cleanup.staleDays old, nor a recent level one', () => {
    const { git } = scriptedGit({ [MERGED_CALL]: said('') });
    const edge = branch('edge', { lastCommit: new Date(NOW.getTime() - 30 * DAY) });
    const recent = branch('recent');
    expect(rows(classifyBranches(git, reading(edge, recent), NO_MERGES, SETTINGS))).toEqual([]);
  });

  it('reads the threshold from the settings', () => {
    const { git } = scriptedGit({ [MERGED_CALL]: said('') });
    const young = branch('young', { lastCommit: new Date(NOW.getTime() - 2 * DAY) });
    expect(rows(classifyBranches(git, reading(young), NO_MERGES, { staleDays: 1, now: NOW })))
      .toEqual([{ group: 'stale', name: 'young', ticked: false, reason: 'no commit in 2 days' }]);
  });
});

describe('classifyBranches: the provider\'s absences', () => {
  const branches = reading(
    branch('done'),
    branch('old', { lastCommit: new Date(NOW.getTime() - 40 * DAY) }),
    branch('local', { upstream: null, ahead: null }),
  );
  const answers = { [MERGED_CALL]: said('done\n'), [countCall('local')]: said('1\n') };

  it('says merged state unknown on every Stale and Not-pushed row when no provider is configured', () => {
    const { git, calls } = scriptedGit(answers);
    const answer = classifyBranches(git, branches, { state: 'none' }, SETTINGS);
    expect(rows(answer)).toEqual([
      { group: 'merged', name: 'done', ticked: true, reason: 'merged into main' },
      { group: 'stale', name: 'old', ticked: false, reason: `no commit in 40 days; ${MERGED_STATE_UNKNOWN}` },
      { group: 'not-pushed', name: 'local', ticked: false, reason: `no upstream; 1 commit not on any remote; ${MERGED_STATE_UNKNOWN}` },
    ]);
    expect(groups(answer).notes).toEqual([]);
    expect(calls).not.toContain(TIPS_CALL);
  });

  it('adds one note and nothing to the rows when the provider is unreachable', () => {
    const { git } = scriptedGit(answers);
    const answer = classifyBranches(git, branches, { state: 'unreachable', detail: 'gh: not logged in' }, SETTINGS);
    expect(groups(answer).notes).toEqual([unreachableNote('gh: not logged in')]);
    expect(rows(answer).map((row) => row.reason)).toEqual([
      'merged into main',
      'no commit in 40 days',
      'no upstream; 1 commit not on any remote',
    ]);
  });

  it('writes the unreachable note as one line naming git alone', () => {
    expect(unreachableNote('gh: not logged in')).toBe(
      'pull request provider unreachable (gh: not logged in); merged pull requests not read, grouped from git alone',
    );
  });

  it('reads no tips when no merged pull request names a listed branch', () => {
    const { git, calls } = scriptedGit(answers);
    const provider: ProviderMerges = { state: 'read', pullRequests: [pull(1, 'elsewhere', 'abc')] };
    groups(classifyBranches(git, branches, provider, SETTINGS));
    expect(calls).not.toContain(TIPS_CALL);
  });
});

describe('classifyBranches: git failures', () => {
  it('notes a base git cannot read, lists nothing as merged into it, and counts without it', () => {
    const { git } = scriptedGit({
      [MERGED_CALL]: refused('fatal: malformed object name refs/heads/main\n'),
      [countCall('local', false)]: said('4\n'),
    });
    const branches = reading(branch('gone', { gone: true, ahead: null }), branch('local', { upstream: null, ahead: null }));
    const answer = classifyBranches(git, branches, NO_MERGES, SETTINGS);
    expect(groups(answer).notes).toEqual([
      baseUnreadNote('main', 'git branch --merged failed: fatal: malformed object name refs/heads/main'),
    ]);
    expect(rows(answer)).toEqual([
      { group: 'merged', name: 'gone', ticked: true, reason: 'upstream origin/gone is gone' },
      { group: 'not-pushed', name: 'local', ticked: false, reason: 'no upstream; 4 commits not on any remote' },
    ]);
  });

  it('answers why when the tips cannot be read', () => {
    const { git } = scriptedGit({ [MERGED_CALL]: said(''), [TIPS_CALL]: refused('fatal: broken\n') });
    const provider: ProviderMerges = { state: 'read', pullRequests: [pull(1, 'feature', 'abc')] };
    expect(classifyBranches(git, reading(branch('feature')), provider, SETTINGS))
      .toEqual({ ok: false, detail: 'git for-each-ref failed: fatal: broken' });
  });
});

describe('readProviderMerges', () => {
  it('answers none without a provider', async () => {
    expect(await readProviderMerges(null)).toEqual({ state: 'none' });
  });

  it('answers the merged pull requests the provider lists', async () => {
    const merged = [pull(4, 'feature', 'abc')];
    const double = createPullRequestsDouble({ listMerged: () => Promise.resolve(merged) });
    expect(await readProviderMerges(double.pulls)).toEqual({ state: 'read', pullRequests: merged });
    expect(double.sent()).toEqual(['listMerged']);
  });

  it('answers unreachable with the first line of what a failing provider said', async () => {
    const double = createPullRequestsDouble({
      listMerged: () => Promise.reject(new Error('\ngh pr list --state merged failed: HTTP 502\nretry later')),
    });
    expect(await readProviderMerges(double.pulls))
      .toEqual({ state: 'unreachable', detail: 'gh pr list --state merged failed: HTTP 502' });
  });
});

describe('classifyBranches over a real clone', () => {
  const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-cleanup-groups-')));
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

  function run(cwd: string, args: readonly string[], extra: Record<string, string> = {}): string {
    const result = spawnSync('git', [...args], { cwd, encoding: 'utf8', env: { ...env, ...extra } });
    if (result.status !== 0) {
      throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
    }
    return result.stdout.trim();
  }

  it('groups merged, squash-merged, gone, stale and unpushed branches from git itself', async () => {
    const remote = join(tempBase, 'remote.git');
    const work = join(tempBase, 'work');
    const old = { GIT_AUTHOR_DATE: '2026-06-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-06-01T00:00:00Z' };
    run(tempBase, ['init', '-q', '--bare', '-b', 'main', remote]);
    run(tempBase, ['clone', '-q', remote, work]);
    run(work, ['commit', '-q', '--allow-empty', '-m', 'first']);
    run(work, ['push', '-q', '-u', 'origin', 'main']);
    run(work, ['remote', 'set-head', 'origin', 'main']);
    // merged: fast-forwarded into a LOCAL main one commit past origin/main.
    run(work, ['switch', '-q', '-c', 'merged']);
    run(work, ['commit', '-q', '--allow-empty', '-m', 'merged work']);
    run(work, ['switch', '-q', 'main']);
    run(work, ['merge', '-q', '--ff-only', 'merged']);
    // squashed: pushed, its work landed on main as another commit.
    run(work, ['switch', '-q', '-c', 'squashed', 'origin/main']);
    run(work, ['commit', '-q', '--allow-empty', '-m', 'squashed work']);
    run(work, ['push', '-q', '-u', 'origin', 'squashed']);
    const squashedTip = run(work, ['rev-parse', 'HEAD']);
    // gone: pushed, deleted remotely, pruned.
    run(work, ['switch', '-q', '-c', 'gone', 'origin/main']);
    run(work, ['commit', '-q', '--allow-empty', '-m', 'gone work']);
    run(work, ['push', '-q', '-u', 'origin', 'gone']);
    run(work, ['push', '-q', 'origin', '--delete', 'gone']);
    run(work, ['fetch', '-q', '--prune']);
    // stale: pushed, level with its upstream, last committed months ago.
    run(work, ['switch', '-q', '-c', 'stale', 'origin/main']);
    run(work, ['commit', '-q', '--allow-empty', '-m', 'old work'], old);
    run(work, ['push', '-q', '-u', 'origin', 'stale']);
    // local: never pushed, two commits of its own on top of the unpushed main.
    run(work, ['switch', '-q', '-c', 'local', 'main']);
    run(work, ['commit', '-q', '--allow-empty', '-m', 'local one']);
    run(work, ['commit', '-q', '--allow-empty', '-m', 'local two']);
    run(work, ['switch', '-q', 'main']);

    const git = createGitRunner(work);
    const read = readBranches(git, { base: null, keep: [] });
    if (!read.ok) {
      throw new Error(read.detail);
    }
    const provider = await readProviderMerges(createPullRequestsDouble({
      listMerged: () => Promise.resolve([pull(7, 'squashed', squashedTip)]),
    }).pulls);
    const answer = classifyBranches(git, read, provider, { staleDays: 30, now: new Date() });

    expect(groups(answer).notes).toEqual([]);
    expect(rows(answer)).toEqual([
      { group: 'merged', name: 'gone', ticked: true, reason: 'upstream origin/gone is gone' },
      { group: 'merged', name: 'merged', ticked: true, reason: 'merged into main' },
      { group: 'merged', name: 'squashed', ticked: true, reason: 'pull request #7 merged' },
      { group: 'stale', name: 'stale', ticked: false, reason: expect.stringMatching(/^no commit in \d+ days$/) as unknown as string },
      { group: 'not-pushed', name: 'local', ticked: false, reason: 'no upstream; 2 commits not on any remote' },
    ]);

    // Control: without the provider's reading the squash-merged branch is
    // pushed, level and recent, so nothing git says would list it.
    const alone = classifyBranches(git, read, { state: 'none' }, { staleDays: 30, now: new Date() });
    expect(rows(alone).map((row) => row.name)).toEqual(['gone', 'merged', 'stale', 'local']);
  });
});
