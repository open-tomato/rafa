/**
 * `readCleanup` over scripted seams, for the order it reads in, what it
 * passes from one reader to the next and every failure it answers, and
 * `cleanupCounts` over its reading; then once over a real clone of a
 * bare remote, where the same branch is and is not `[gone]` depending
 * on whether the fetch was asked for, so the fetch is shown to change
 * the reading rather than assumed to; and once over the scratch
 * repository's remote-only set, so the rows `readCleanup` hands on are
 * read from git itself.
 *
 * The scripted git throws on a call no case scripted, and by default it
 * answers no branch under `refs/remotes/origin`: a case that scripts
 * none of the remote-only calls past that listing proves none ran.
 */
import type { CleanupSeams, CleanupSettings } from './index.js';
import type { MergedPullRequest, PullRequestSummary } from '../pr/types.js';
import type { GitResult, GitRunner } from '@open-tomato/rafa/core/git';
import type { SessionRecord } from '@open-tomato/rafa/core/loop';

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { runsDir, sessionFilePath } from '@open-tomato/rafa/core/loop';

import { formatClaimMessage } from '../claims/record.js';
import { createPullRequestsDouble } from '../pr/pull-requests-double.js';
import { EVENTS_EXTENSION, eventsFilePath } from '../start/loop-events.js';
import { gitIdentityEnv } from '../tests/git-identity.js';

import { BRANCH_FORMAT } from './branches.js';
import { unreachableNote } from './groups.js';
import { openUnknownNote, openUnreadNote, REMOTE_BRANCH_FORMAT, remoteOnlyReason } from './remote-only.js';
import { createScratchRepository, REMOTE_ONLY_BRANCHES, REMOTE_ONLY_COMMITS, SCRATCH_NOW } from './scratch-repository.js';
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
const SYMBOLIC_REF = 'symbolic-ref --quiet --short refs/remotes/origin/HEAD';
const FOR_EACH_REF = `for-each-ref --format=${BRANCH_FORMAT} refs/heads`;
const MERGED_CALL = 'branch --merged refs/heads/main --format=%(refname:lstrip=2)';
const COUNT_WIP = 'rev-list --count refs/heads/wip --not --remotes refs/heads/main --';
const TIPS_CALL = 'for-each-ref --format=%(refname:lstrip=2)%09%(objectname) refs/heads';
const REMOTES_CALL = `for-each-ref --format=${REMOTE_BRANCH_FORMAT} refs/remotes/origin`;
const HEADS_CALL = 'for-each-ref --format=%(refname:lstrip=2) refs/heads';
const REMOTE_MERGED_CALL = 'for-each-ref --merged=refs/remotes/origin/main --format=%(refname:lstrip=3) refs/remotes/origin';
const WORKTREES_CALL = WORKTREE_LIST.join(' ');

/** A branch on `origin` alone, and the `git cherry` call that counts its commits. */
const ORPHAN = 'orphan';
const CHERRY_ORPHAN = `cherry refs/remotes/origin/main refs/remotes/origin/${ORPHAN}`;

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
  [SYMBOLIC_REF]: said('origin/main\n'),
  [FOR_EACH_REF]: said(BRANCHES),
  [MERGED_CALL]: said('done\n'),
  [COUNT_WIP]: said('2\n'),
  [WORKTREES_CALL]: said(WORKTREES),
  [REMOTES_CALL]: said(''),
};

/** One line of {@link REMOTE_BRANCH_FORMAT} output for a branch, no symbolic ref. */
function remoteRef(name: string, unix: number): string {
  return `${name}\t${String(unix)}\t`;
}

/**
 * The answers of a clone whose `origin` holds `names` beside `main` and
 * the local branches, none of them merged into `origin/main`, and
 * {@link ORPHAN} holding two commits, one with a copy on the base.
 */
function withRemoteOnly(...names: string[]): Record<string, GitResult> {
  const remote = ['done', 'here', 'main', 'old', ...names].map((name) => remoteRef(name, OLD));
  return {
    [REMOTES_CALL]: said(`${remote.join('\n')}\n`),
    [HEADS_CALL]: said('done\nhere\nmain\nold\nwip\n'),
    [REMOTE_MERGED_CALL]: said('done\nmain\n'),
    [CHERRY_ORPHAN]: said('- a1\n+ b2\n'),
  };
}

/** The three calls `readClaimBranch` makes for `branch`, answering `message` as its one claim commit. */
function claimCalls(branch: string, message: string): Record<string, GitResult> {
  const tip = 'c'.repeat(40);
  return {
    [`rev-parse --verify --quiet refs/remotes/origin/${branch}^{commit}`]: said(`${tip}\n`),
    [`log -1 --format=%ct ${tip}`]: said(`${String(OLD)}\n`),
    [`log -z --reverse --regexp-ignore-case --fixed-strings --grep=rafa-claim --format=%H%n%B ${tip}`]:
      said(`${'0'.repeat(40)}\n${message}`),
  };
}

function openPull(number: number, headRefName: string): PullRequestSummary {
  return {
    number,
    title: `pull request ${String(number)}`,
    url: `https://example.test/pull/${String(number)}`,
    state: 'open',
    headRefName,
    baseRefName: 'main',
    author: { login: 'someone', isBot: false },
    isCrossRepository: false,
    updatedAt: '2026-09-01T10:00:00Z',
  };
}

/** A provider with no merged pull request whose `list` answers `open`. */
function provider(...open: PullRequestSummary[]): ReturnType<typeof createPullRequestsDouble> {
  return createPullRequestsDouble({
    listMerged: () => Promise.resolve([]),
    list: () => Promise.resolve(open),
  });
}

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

const runRoots: string[] = [];

afterAll(() => {
  for (const root of runRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** One finished record of `plan-a`, started on `day` of September 2026. */
function finishedRecord(sessionId: string, day: string): SessionRecord {
  return {
    sessionId,
    planStub: 'plan-a',
    plan: '.plans/PLAN-plan-a.md',
    branch: 'feat/plan-a',
    pid: 2_000_000_000,
    startedAt: `2026-09-${day}T12:00:00.000Z`,
    state: 'done',
    task: null,
  };
}

/** A project of its own whose `.rafa/runs/` holds `old` with its events file and the newer `new`. */
function plantedRuns(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-cleanup-index-runs-')));
  runRoots.push(root);
  mkdirSync(runsDir(root), { recursive: true });
  for (const entry of [finishedRecord('old', '01'), finishedRecord('new', '02')]) {
    writeFileSync(sessionFilePath(root, entry.sessionId), `${JSON.stringify(entry)}\n`);
  }
  writeFileSync(eventsFilePath(root, 'old'), '{}\n');
  return root;
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
    worktreeDir: '.rafa/worktrees',
    ...overrides,
  };
}

describe('readCleanup over scripted seams', () => {
  it('fetches first, then reads the three branch groups and the worktrees', async () => {
    const { seams, log } = scripted();
    const reading = await readCleanup(seams, settings());
    if (!reading.ok) throw new Error(reading.detail);

    expect(log).toEqual([FETCH, SYMBOLIC_REF, FOR_EACH_REF, MERGED_CALL, COUNT_WIP, WORKTREES_CALL, REMOTES_CALL]);
    expect(reading.fetched).toBe(true);
    expect(reading.base).toBe('main');
    expect(reading.merged.map((row) => [row.branch.name, row.reason])).toEqual([['done', 'merged into main']]);
    expect(reading.stale.map((row) => [row.branch.name, row.reason])).toEqual([['old', 'no commit in 90 days; merged state unknown']]);
    expect(reading.notPushed.map((row) => [row.branch.name, row.commits])).toEqual([['wip', 2]]);
    expect(reading.remoteOnly).toEqual([]);
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

  it('unticks the Merged branch a worktree that cannot be ticked holds, naming it', async () => {
    const { seams } = scripted();
    const recentA: CleanupSeams = {
      ...seams,
      modifiedAt: (path) => (path.includes('worktrees/a')
        ? NOW
        : new Date(NOW.getTime() - 30 * DAY)),
    };
    const reading = await readCleanup(recentA, settings());
    if (!reading.ok) throw new Error(reading.detail);

    expect(reading.worktrees.map((row) => [row.path, row.tickable])).toEqual([[`${CLAUDE}/a`, false], [`${CLAUDE}/b`, true]]);
    expect(reading.merged.map((row) => [row.branch.name, row.ticked, row.reason])).toEqual([
      ['done', false, 'merged into main; checked out in a (recent)'],
    ]);
  });

  it('runs no fetch when it is not asked for, as rafa doctor reads', async () => {
    const { seams, log } = scripted();
    const reading = await readCleanup(seams, settings({ fetch: false }));
    if (!reading.ok) throw new Error(reading.detail);

    expect(log).not.toContain(FETCH);
    expect(log[0]).toBe(SYMBOLIC_REF);
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

describe('readCleanup remote-only branches', () => {
  it('asks no provider and says nothing when origin holds no branch of its own', async () => {
    const pulls = provider();
    const { seams, log } = scripted({ [TIPS_CALL]: said('') }, pulls.pulls);
    const reading = await readCleanup(seams, settings());
    if (!reading.ok) throw new Error(reading.detail);

    expect(reading.remoteOnly).toEqual([]);
    expect(reading.notes).toEqual([]);
    expect(pulls.sent()).toEqual(['listMerged']);
    expect(log.at(-1)).toBe(REMOTES_CALL);
  });

  it('lists the unmerged branch only on origin, unticked, with its counts against the groups\' base', async () => {
    const pulls = provider();
    const { seams, log } = scripted({ [TIPS_CALL]: said(''), ...withRemoteOnly(ORPHAN) }, pulls.pulls);
    const reading = await readCleanup(seams, settings());
    if (!reading.ok) throw new Error(reading.detail);

    expect(reading.remoteOnly).toEqual([{
      group: 'remote-only',
      name: ORPHAN,
      lastCommit: new Date(OLD * 1000),
      commits: 2,
      uncopied: 1,
      ticked: false,
      reason: remoteOnlyReason(1, 2, 'main'),
    }]);
    expect(reading.notes).toEqual([]);
    expect(pulls.sent()).toEqual(['listMerged', 'list']);
    expect(log.slice(log.indexOf(WORKTREES_CALL) + 1))
      .toEqual([REMOTES_CALL, HEADS_CALL, SYMBOLIC_REF, REMOTE_MERGED_CALL, CHERRY_ORPHAN]);
  });

  it('leaves the three branch groups and the worktrees as they read without it', async () => {
    const without = await readCleanup(scripted({}, provider().pulls).seams, settings());
    const withIt = await readCleanup(scripted(withRemoteOnly(ORPHAN), provider().pulls).seams, settings());
    if (!without.ok) throw new Error(without.detail);
    if (!withIt.ok) throw new Error(withIt.detail);

    expect(withIt.remoteOnly.map((row) => row.name)).toEqual([ORPHAN]);
    expect(withIt.merged).toEqual(without.merged);
    expect(withIt.stale).toEqual(without.stale);
    expect(withIt.notPushed).toEqual(without.notPushed);
    expect(withIt.worktrees).toEqual(without.worktrees);
  });

  it('leaves out the head of an open pull request', async () => {
    // Control: the same script lists the branch with no open pull request, two cases up.
    const { seams, log } = scripted(withRemoteOnly(ORPHAN), provider(openPull(7, ORPHAN)).pulls);
    const reading = await readCleanup(seams, settings());
    if (!reading.ok) throw new Error(reading.detail);

    expect(reading.remoteOnly).toEqual([]);
    expect(reading.notes).toEqual([]);
    expect(log).not.toContain(CHERRY_ORPHAN);
  });

  it('hands cleanup.keep on, so a kept branch only on origin is not listed', async () => {
    const { seams } = scripted(withRemoteOnly(ORPHAN, 'release/1'), provider().pulls);
    const reading = await readCleanup(seams, settings({ keep: ['release/*'] }));
    if (!reading.ok) throw new Error(reading.detail);

    // Unkept, `release/1` would reach a `git cherry` this script holds no answer for, and throw.
    expect(reading.remoteOnly.map((row) => row.name)).toEqual([ORPHAN]);
  });

  it('lists nothing with no provider, and says in one note how many it withheld', async () => {
    const { seams, log } = scripted(withRemoteOnly(ORPHAN, 'other'));
    const reading = await readCleanup(seams, settings());
    if (!reading.ok) throw new Error(reading.detail);

    expect(reading.remoteOnly).toEqual([]);
    expect(reading.notes).toEqual([openUnknownNote(2)]);
    expect(log).not.toContain(CHERRY_ORPHAN);
  });

  it('puts its note after the fetch\'s and the groups\' and ahead of the run records\'', async () => {
    const root = plantedRuns();
    const broken = join(root, '.rafa', 'runs', 'broken.json');
    writeFileSync(broken, 'not json');
    const pulls = createPullRequestsDouble({
      listMerged: () => Promise.reject(new Error('HTTP 502')),
      list: () => Promise.reject(new Error('HTTP 503\nmore')),
    });
    const { seams } = scripted({ [FETCH]: refused('fatal: no route\n'), ...withRemoteOnly(ORPHAN) }, pulls.pulls);
    const reading = await readCleanup(seams, settings({ projectRoot: root }));
    if (!reading.ok) throw new Error(reading.detail);

    expect(reading.notes.slice(0, 3)).toEqual([
      fetchFailedNote('fatal: no route'),
      unreachableNote('HTTP 502'),
      openUnreadNote(1, 'HTTP 503'),
    ]);
    expect(reading.notes).toHaveLength(4);
    expect(reading.notes[3]).toStartWith(`run records: skipped ${broken}: `);
    expect(reading.remoteOnly).toEqual([]);
  });

  it('lists a claim branch this device holds only when the settings name the device', async () => {
    const claimed = 'feat/rafa-12-thing';
    const answers = {
      ...withRemoteOnly(claimed),
      ...claimCalls(claimed, formatClaimMessage({ action: 'claim', issue: 12, store: 'store-here' })),
      [`cherry refs/remotes/origin/main refs/remotes/origin/${claimed}`]: said('+ a1\n'),
    };
    const device = { storeId: 'store-here', replacedIds: [] };

    const named = await readCleanup(scripted(answers, provider().pulls).seams, settings({ device }));
    const unnamed = await readCleanup(scripted(answers, provider().pulls).seams, settings());
    if (!named.ok) throw new Error(named.detail);
    if (!unnamed.ok) throw new Error(unnamed.detail);

    expect(named.remoteOnly.map((row) => row.name)).toEqual([claimed]);
    expect(unnamed.remoteOnly).toEqual([]);
    expect(unnamed.notes).toEqual([]);
  });

  it('passes on a remote listing git refuses, after the worktrees were read', async () => {
    const { seams, log } = scripted({ [REMOTES_CALL]: refused('fatal: bad ref\n') });

    expect(await readCleanup(seams, settings()))
      .toEqual({ ok: false, detail: 'git for-each-ref refs/remotes/origin failed: fatal: bad ref' });
    expect(log).toContain(WORKTREES_CALL);
  });
});

describe('readCleanup run records', () => {
  it('lists the older finished record of a plan, with its events file, and keeps the newest', async () => {
    const root = plantedRuns();
    const { seams } = scripted();
    const reading = await readCleanup(seams, settings({ projectRoot: root }));
    if (!reading.ok) throw new Error(reading.detail);

    const dir = join(root, '.rafa', 'runs');
    expect(reading.runs.map((row) => [row.sessionId, row.path, row.eventsPath, row.plan, row.ticked])).toEqual([
      ['old', join(dir, 'old.json'), join(dir, `old${EVENTS_EXTENSION}`), 'plan-a', true],
    ]);
    expect(reading.notes).toEqual([]);
  });

  it('control: a project with no .rafa/runs/ lists no record and says nothing', async () => {
    const { seams } = scripted();
    const reading = await readCleanup(seams, settings());
    if (!reading.ok) throw new Error(reading.detail);

    expect(reading.runs).toEqual([]);
    expect(reading.notes).toEqual([]);
  });

  it('carries a record it cannot read as a note after the groups\' notes', async () => {
    const root = plantedRuns();
    const broken = join(root, '.rafa', 'runs', 'broken.json');
    writeFileSync(broken, 'not json');
    const { seams } = scripted();
    const reading = await readCleanup(seams, settings({ projectRoot: root }));
    if (!reading.ok) throw new Error(reading.detail);

    expect(reading.notes).toHaveLength(1);
    expect(reading.notes[0]).toStartWith(`run records: skipped ${broken}: `);
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
      remoteOnly: [],
      runs: [],
      notes: [],
    })).toEqual({ merged: 0, stale: 0, notPushed: 0, worktrees: 0 });
  });

  it('leaves the remote-only branches out, as rafa doctor and rafa status print', async () => {
    const { seams } = scripted(withRemoteOnly(ORPHAN), provider().pulls);
    const reading = await readCleanup(seams, settings());
    if (!reading.ok) throw new Error(reading.detail);

    expect(reading.remoteOnly).toHaveLength(1);
    expect(cleanupCounts(reading)).toEqual({ merged: 1, stale: 1, notPushed: 1, worktrees: 2 });
  });

  it('leaves the run records out, as rafa doctor and rafa status print', async () => {
    const root = plantedRuns();
    const { seams } = scripted();
    const reading = await readCleanup(seams, settings({ projectRoot: root }));
    if (!reading.ok) throw new Error(reading.detail);

    expect(reading.runs).toHaveLength(1);
    expect(cleanupCounts(reading)).toEqual({ merged: 1, stale: 1, notPushed: 1, worktrees: 2 });
  });
});

describe('readCleanup over a real clone', () => {
  const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-cleanup-index-')));
  const env = {
    ...process.env,
    LC_ALL: 'C',
    GIT_CONFIG_GLOBAL: '/dev/null',
    ...gitIdentityEnv(),
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
      .toEqual([['gone', 'upstream origin/gone is gone; main does not reach its tip', false]]);
    expect(fetched.notes).toEqual([]);
  });
});

describe('readCleanup over the scratch repository\'s remote-only set', () => {
  const scratch = createScratchRepository({ remoteOnly: true });

  afterAll(() => {
    scratch.dispose();
  });

  function scratchSettings(): CleanupSettings {
    return settings({
      fetch: false,
      base: null,
      now: SCRATCH_NOW,
      home: scratch.home,
      cwd: scratch.clone,
      projectRoot: scratch.clone,
    });
  }

  it('lists the unmerged and the copied branch with their counts, never stretch/9', async () => {
    const reading = await readCleanup(defaultCleanupSeams(scratch.clone, provider().pulls), scratchSettings());
    if (!reading.ok) throw new Error(reading.detail);

    expect(reading.remoteOnly.map((row) => [row.name, row.commits, row.uncopied, row.ticked])).toEqual([
      [REMOTE_ONLY_BRANCHES.copied, REMOTE_ONLY_COMMITS, 0, false],
      [REMOTE_ONLY_BRANCHES.unmerged, REMOTE_ONLY_COMMITS, REMOTE_ONLY_COMMITS, false],
    ]);
    expect(reading.notes).toEqual([]);
  });

  it('control: the same clone with no provider lists none and counts the two it withheld', async () => {
    const reading = await readCleanup(defaultCleanupSeams(scratch.clone, null), scratchSettings());
    if (!reading.ok) throw new Error(reading.detail);

    expect(reading.remoteOnly).toEqual([]);
    expect(reading.notes).toContain(openUnknownNote(2));
  });
});
