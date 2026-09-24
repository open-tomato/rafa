/**
 * `readWorktrees` over scripted seams, for the listing, every blocker
 * and the default tick, and once over a real repository, so the
 * porcelain spellings and the index the module note measured are read
 * from git itself rather than from this file's script.
 */
import type { WorktreeRead, WorktreeRow, WorktreeSeams } from './worktrees.js';
import type { SessionRecord } from '../loop/sessions.js';
import type { GitResult, GitRunner } from '../pr/git.js';

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import {
  countChanges,
  defaultWorktreeSeams,
  GIT_DIR,
  parseLocks,
  readWorktrees,
  WORKTREE_LIST,
  WORKTREE_STATUS,
} from './worktrees.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-09-24T12:00:00Z');
const OLD = new Date(NOW.getTime() - 30 * DAY);

const REPO = '/repo';
const HOME = '/home/me';
const CLAUDE = `${REPO}/.claude/worktrees`;
const RAFA = `${HOME}/.rafa/worktrees`;

function said(stdout: string): GitResult {
  return { ok: true, stdout, stderr: '' };
}

function refused(stderr: string): GitResult {
  return { ok: false, stdout: '', stderr };
}

/** One `git worktree list --porcelain` block. */
function block(path: string, branch: string | null, ...extra: string[]): string {
  const head = branch === null
    ? 'detached'
    : `branch refs/heads/${branch}`;
  return [`worktree ${path}`, 'HEAD 5158da744601f648211affb9554adc0b7498dadd', head, ...extra, ''].join('\n') + '\n';
}

function listing(...blocks: string[]): string {
  return [block(REPO, 'main'), ...blocks].join('');
}

function record(sessionId: string, branch: string, state: SessionRecord['state']): SessionRecord {
  return { sessionId, planStub: null, plan: 'PLAN.md', branch, pid: 42, startedAt: '2026-09-24T00:00:00Z', state, task: null };
}

/** What one scripted worktree answers. */
interface Checkout {
  readonly status?: GitResult;
  readonly gitDir?: GitResult;
  /** Every path's time; a path left out reads OLD. Null reads as unreadable. */
  readonly times?: Record<string, Date | null>;
  readonly sessions?: readonly SessionRecord[] | Error;
}

interface Script {
  readonly list: GitResult;
  readonly checkouts?: Record<string, Checkout>;
  readonly projectSessions?: readonly SessionRecord[] | Error;
  readonly links?: Record<string, string>;
}

/** Seams answering from `script`, every call written to `log` in order. */
function scripted(script: Script): { seams: WorktreeSeams; log: string[] } {
  const log: string[] = [];
  const checkout = (path: string): Checkout => script.checkouts?.[path] ?? {};
  const seams: WorktreeSeams = {
    git: (args) => {
      log.push(`git ${args.join(' ')}`);
      if (args.join(' ') !== WORKTREE_LIST.join(' ')) throw new Error(`unscripted git call: ${args.join(' ')}`);
      return script.list;
    },
    gitAt: (dir): GitRunner => (args) => {
      log.push(`${dir}: git ${args.join(' ')}`);
      const found = checkout(dir);
      if (args.join(' ') === GIT_DIR.join(' ')) return found.gitDir ?? said(`${REPO}/.git/worktrees/${dir.split('/').pop() ?? ''}\n`);
      if (args.join(' ') === WORKTREE_STATUS.join(' ')) return found.status ?? said('');
      throw new Error(`unscripted git call in ${dir}: ${args.join(' ')}`);
    },
    sessions: (root) => {
      log.push(`sessions ${root}`);
      const answer = root === REPO
        ? script.projectSessions ?? []
        : checkout(root).sessions ?? [];
      if (answer instanceof Error) throw answer;
      return answer;
    },
    modifiedAt: (path) => {
      log.push(`stat ${path}`);
      for (const found of Object.values(script.checkouts ?? {})) {
        const time = found.times?.[path];
        if (time !== undefined) return time;
      }
      return OLD;
    },
    realPath: (path) => script.links?.[path] ?? path,
  };
  return { seams, log };
}

function settings(overrides: Partial<WorktreeRead> = {}): WorktreeRead {
  return { home: HOME, cwd: REPO, projectRoot: REPO, idleDays: 7, now: NOW, mergedBranches: ['done'], ...overrides };
}

/** The rows, or a throw naming why none were read. */
function rows(seams: WorktreeSeams, read: WorktreeRead = settings()): readonly WorktreeRow[] {
  const reading = readWorktrees(seams, read);
  if (!reading.ok) throw new Error(reading.detail);
  return reading.worktrees;
}

/** The one row read from a listing of the main worktree and `path`. */
function onlyRow(checkout: Checkout, path = `${CLAUDE}/a`, branch: string | null = 'done', ...extra: string[]): WorktreeRow {
  const { seams } = scripted({ list: said(listing(block(path, branch, ...extra))), checkouts: { [path]: checkout } });
  const [row, ...rest] = rows(seams);
  expect(rest).toEqual([]);
  if (row === undefined) throw new Error('no row read');
  return row;
}

describe('parseLocks', () => {
  it('reads a lock with a reason, one without, and leaves an unlocked worktree out', () => {
    const stdout = listing(
      block('/w/b', 'b', 'locked in use by x'),
      block('/w/c', 'c', 'locked'),
      block('/w/d', null, 'prunable gitdir file points to non-existent location'),
    );
    expect([...parseLocks(stdout)]).toEqual([['/w/b', 'in use by x'], ['/w/c', '']]);
  });
});

describe('countChanges', () => {
  it('counts untracked paths apart from every other status line', () => {
    expect(countChanges(' M f\nA  g\n?? new\n?? other/\n')).toEqual({ changed: 2, untracked: 2 });
  });

  it('reads an empty status as clean', () => {
    expect(countChanges('')).toEqual({ changed: 0, untracked: 0 });
  });
});

describe('readWorktrees: the listing', () => {
  it('answers what git said when it refuses the listing', () => {
    const { seams } = scripted({ list: refused('fatal: not a git repository\n') });
    expect(readWorktrees(seams, settings())).toEqual({
      ok: false,
      detail: 'git worktree list failed: fatal: not a git repository',
    });
  });

  it('answers no worktree for an empty listing', () => {
    const { seams } = scripted({ list: said('') });
    expect(readWorktrees(seams, settings())).toEqual({ ok: true, worktrees: [] });
  });

  it('lists only the worktrees under the two directories, never the main one', () => {
    const { seams } = scripted({
      list: said(listing(
        block(`${CLAUDE}/a`, 'a'),
        block('/elsewhere/wt', 'e'),
        block(`${REPO}/.claude/worktreesX/y`, 'y'),
        block(`${CLAUDE}/deep/er`, 'deep'),
        block(`${RAFA}/pr-3`, 'pr'),
        block(`${REPO}/.claude/worktrees`, 'root'),
      )),
    });
    expect(rows(seams).map((row) => row.path)).toEqual([`${CLAUDE}/a`, `${CLAUDE}/deep/er`, `${RAFA}/pr-3`]);
  });

  it('takes the repository from the first block, wherever the command runs', () => {
    const { seams } = scripted({ list: said(listing(block(`${CLAUDE}/a`, 'a'))) });
    expect(rows(seams, settings({ cwd: '/somewhere/else' })).map((row) => row.path)).toEqual([`${CLAUDE}/a`]);
  });

  it('matches the home through the path it resolves to', () => {
    const { seams } = scripted({
      list: said(listing(block('/private/home/me/.rafa/worktrees/pr-1', 'pr'))),
      links: { [`${HOME}/.rafa/worktrees`]: '/private/home/me/.rafa/worktrees' },
    });
    expect(rows(seams).map((row) => row.path)).toEqual(['/private/home/me/.rafa/worktrees/pr-1']);
  });
});

describe('readWorktrees: the default tick', () => {
  it('ticks a clean worktree whose branch is in Merged', () => {
    const row = onlyRow({});
    expect(row).toEqual({
      path: `${CLAUDE}/a`,
      branch: 'done',
      lastModified: OLD,
      branchMerged: true,
      blockers: [],
      tickable: true,
      ticked: true,
      reason: 'clean; branch done is merged',
    });
  });

  it('leaves a clean worktree whose branch is not in Merged tickable but unticked', () => {
    const row = onlyRow({}, `${CLAUDE}/a`, 'wip');
    expect([row.tickable, row.ticked, row.branchMerged, row.reason])
      .toEqual([true, false, false, 'clean; branch wip is not merged']);
  });

  it('leaves a clean detached worktree unticked', () => {
    const row = onlyRow({}, `${CLAUDE}/a`, null);
    expect([row.tickable, row.ticked, row.reason]).toEqual([true, false, 'clean; detached HEAD']);
  });
});

describe('readWorktrees: what blocks a tick', () => {
  it('blocks a worktree with uncommitted and untracked changes, even on a merged branch', () => {
    const row = onlyRow({ status: said(' M f\n?? new\n?? two\n') });
    expect(row.blockers).toEqual([{ kind: 'dirty', reason: '1 uncommitted change, 2 untracked files' }]);
    expect([row.tickable, row.ticked, row.reason]).toEqual([false, false, '1 uncommitted change, 2 untracked files']);
  });

  it('blocks a worktree holding untracked files alone', () => {
    expect(onlyRow({ status: said('?? new\n') }).blockers)
      .toEqual([{ kind: 'dirty', reason: '1 untracked file' }]);
  });

  it('blocks a locked worktree, naming the lock\'s reason when it has one', () => {
    expect(onlyRow({}, `${CLAUDE}/a`, 'done', 'locked in use by x').blockers)
      .toEqual([{ kind: 'locked', reason: 'locked: in use by x' }]);
    expect(onlyRow({}, `${CLAUDE}/a`, 'done', 'locked').blockers)
      .toEqual([{ kind: 'locked', reason: 'locked' }]);
  });

  it('blocks the worktree the command runs from, and one it runs inside', () => {
    for (const cwd of [`${CLAUDE}/a`, `${CLAUDE}/a/src/deep`]) {
      const { seams } = scripted({ list: said(listing(block(`${CLAUDE}/a`, 'done'), block(`${CLAUDE}/ab`, 'done'))) });
      const [a, ab] = rows(seams, settings({ cwd }));
      expect(a?.blockers).toEqual([{ kind: 'current', reason: 'rafa cleanup runs from it' }]);
      expect(ab?.tickable).toBe(true);
    }
  });

  it('matches the working directory through the path it resolves to', () => {
    const { seams } = scripted({
      list: said(listing(block(`${CLAUDE}/a`, 'done'))),
      links: { '/var/link': `${CLAUDE}/a` },
    });
    expect(rows(seams, settings({ cwd: '/var/link' }))[0]?.blockers.map((blocker) => blocker.kind)).toEqual(['current']);
  });

  it('blocks a worktree whose own records hold a live session, and ignores a stopped one', () => {
    const row = onlyRow({ sessions: [record('s1', 'done', 'running'), record('s0', 'done', 'stopped')] });
    expect(row.blockers).toEqual([{ kind: 'session', reason: 'loop session s1 is running in it' }]);
  });

  it('blocks a worktree whose branch a live session under the project root names', () => {
    const path = `${CLAUDE}/a`;
    const { seams } = scripted({
      list: said(listing(block(path, 'done'), block(`${CLAUDE}/b`, 'other'))),
      projectSessions: [record('s2', 'done', 'paused'), record('s3', 'other', 'done'), record('s4', 'main', 'running')],
    });
    const [a, b] = rows(seams);
    expect(a?.blockers).toEqual([{ kind: 'session', reason: 'loop session s2 is paused in it' }]);
    expect(b?.blockers).toEqual([]);
  });

  it('reads the project root\'s records once for every worktree', () => {
    const { seams, log } = scripted({ list: said(listing(block(`${CLAUDE}/a`, 'a'), block(`${CLAUDE}/b`, 'b'))) });
    rows(seams);
    expect(log.filter((entry) => entry === `sessions ${REPO}`)).toHaveLength(1);
  });

  it('blocks every worktree when the project root\'s records cannot be read', () => {
    const { seams } = scripted({
      list: said(listing(block(`${CLAUDE}/a`, 'done'), block(`${CLAUDE}/b`, null))),
      projectSessions: new Error('session record x.json: holds no JSON object'),
    });
    for (const row of rows(seams)) {
      expect(row.blockers).toEqual([{
        kind: 'unreadable',
        reason: `the session records under ${REPO}/.rafa/runs could not be read: session record x.json: holds no JSON object`,
      }]);
    }
  });

  it('blocks a worktree whose own records cannot be read', () => {
    const row = onlyRow({ sessions: new Error('cannot be listed') });
    expect(row.blockers.map((blocker) => blocker.kind)).toEqual(['unreadable']);
    expect(row.ticked).toBe(false);
  });

  it('blocks a worktree modified within the idle days, by the newest time it reads', () => {
    const path = `${CLAUDE}/a`;
    const twoDays = new Date(NOW.getTime() - 2 * DAY - 1000);
    const row = onlyRow({ times: { [`${REPO}/.git/worktrees/a/logs/HEAD`]: twoDays } }, path);
    expect(row.lastModified).toEqual(twoDays);
    expect(row.blockers).toEqual([{ kind: 'recent', reason: 'modified 2 days ago, within cleanup.worktreeIdleDays (7)' }]);
  });

  it('reads a worktree modified within the day as modified today', () => {
    const row = onlyRow({ times: { [`${CLAUDE}/a`]: new Date(NOW.getTime() - 60_000) } });
    expect(row.blockers).toEqual([{ kind: 'recent', reason: 'modified today, within cleanup.worktreeIdleDays (7)' }]);
  });

  it('lets a worktree through once exactly the idle days have passed', () => {
    const row = onlyRow({ times: { [`${REPO}/.git/worktrees/a/index`]: new Date(NOW.getTime() - 7 * DAY) } });
    expect(row.blockers).toEqual([]);
  });

  it('reads the directory and the three administrative files, before the status', () => {
    const { seams, log } = scripted({ list: said(listing(block(`${CLAUDE}/a`, 'done'))) });
    rows(seams);
    const admin = `${REPO}/.git/worktrees/a`;
    const own = log.filter((entry) => entry.startsWith(`${CLAUDE}/a: `) || entry.startsWith('stat '));
    expect(own).toEqual([
      `${CLAUDE}/a: git ${GIT_DIR.join(' ')}`,
      `stat ${CLAUDE}/a`,
      `stat ${admin}/HEAD`,
      `stat ${admin}/logs/HEAD`,
      `stat ${admin}/index`,
      `${CLAUDE}/a: git ${WORKTREE_STATUS.join(' ')}`,
    ]);
  });

  it('blocks a worktree whose times cannot be read', () => {
    const admin = `${REPO}/.git/worktrees/a`;
    const times = Object.fromEntries([`${CLAUDE}/a`, `${admin}/HEAD`, `${admin}/logs/HEAD`, `${admin}/index`]
      .map((path) => [path, null]));
    const row = onlyRow({ times });
    expect(row.lastModified).toBeNull();
    expect(row.blockers).toEqual([{
      kind: 'unreadable',
      reason: `when it was last modified could not be read: no modification time could be read under ${CLAUDE}/a or ${admin}`,
    }]);
  });

  it('blocks a worktree whose administrative directory git will not name', () => {
    const row = onlyRow({ gitDir: refused('fatal: cannot change to \'/gone\'\n') });
    expect(row.blockers).toEqual([{
      kind: 'unreadable',
      reason: 'when it was last modified could not be read: git rev-parse --absolute-git-dir failed: fatal: cannot change to \'/gone\'',
    }]);
  });

  it('blocks a worktree whose status git will not read', () => {
    const row = onlyRow({ status: refused('fatal: this operation must be run in a work tree\n') });
    expect(row.blockers).toEqual([{
      kind: 'unreadable',
      reason: 'its changes could not be read: git status failed: fatal: this operation must be run in a work tree',
    }]);
  });

  it('names every blocker that holds, in one order, on one line', () => {
    const path = `${CLAUDE}/a`;
    const { seams } = scripted({
      list: said(listing(block(path, 'done', 'locked'))),
      checkouts: {
        [path]: {
          status: said('?? new\n'),
          sessions: [record('s1', 'done', 'running')],
          times: { [path]: NOW },
        },
      },
    });
    const [row] = rows(seams, settings({ cwd: path }));
    expect(row?.blockers.map((blocker) => blocker.kind)).toEqual(['dirty', 'locked', 'current', 'session', 'recent']);
    expect(row?.reason).toBe([
      '1 untracked file',
      'locked',
      'rafa cleanup runs from it',
      'loop session s1 is running in it',
      'modified today, within cleanup.worktreeIdleDays (7)',
    ].join('; '));
  });
});

describe('readWorktrees over a real repository', () => {
  const tempBase = mkdtempSync(join(tmpdir(), 'rafa-cleanup-worktrees-'));

  afterAll(() => {
    rmSync(tempBase, { recursive: true, force: true });
  });

  function git(cwd: string, ...args: string[]): string {
    const result = spawnSync('git', args, {
      cwd,
      encoding: 'utf8',
      env: {
        ...process.env,
        LC_ALL: 'C',
        GIT_AUTHOR_NAME: 'Test',
        GIT_AUTHOR_EMAIL: 'test@example.com',
        GIT_COMMITTER_NAME: 'Test',
        GIT_COMMITTER_EMAIL: 'test@example.com',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_NOSYSTEM: '1',
      },
    });
    if (result.status !== 0) {
      throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
    }
    return result.stdout;
  }

  it('reads the listing, the locks, the changes and the times from git itself, leaving the index alone', () => {
    // tempBase is spelled through /var on macOS, which git resolves to /private/var.
    const repo = join(tempBase, 'repo');
    const home = join(tempBase, 'home');
    mkdirSync(repo);
    git(repo, 'init', '-q', '-b', 'main');
    writeFileSync(join(repo, 'f'), 'a\n');
    git(repo, 'add', 'f');
    git(repo, 'commit', '-q', '-m', 'first');
    git(repo, 'worktree', 'add', '-q', '-b', 'done', '.claude/worktrees/clean');
    git(repo, 'worktree', 'add', '-q', '-b', 'dirty', '.claude/worktrees/dirty');
    writeFileSync(join(repo, '.claude/worktrees/dirty/new'), 'x\n');
    git(repo, 'worktree', 'add', '-q', '-b', 'held', '.claude/worktrees/locked');
    git(repo, 'worktree', 'lock', '--reason', 'in use', '.claude/worktrees/locked');
    git(repo, 'worktree', 'add', '-q', '-b', 'pr', join(home, '.rafa', 'worktrees', 'pr-7'));
    git(repo, 'worktree', 'add', '-q', '-b', 'mine', join(tempBase, 'mine'));

    // Date the clean worktree's index and tracked file back, so a status
    // that refreshes the index would rewrite it.
    const clean = join(repo, '.claude/worktrees/clean');
    const index = git(clean, 'rev-parse', '--absolute-git-dir').trim() + '/index';
    const past = new Date('2026-01-01T00:00:00Z');
    utimesSync(index, past, past);
    utimesSync(join(clean, 'f'), past, past);

    const later = new Date(Date.now() + 30 * DAY);
    const reading = readWorktrees(defaultWorktreeSeams(repo), {
      home,
      cwd: repo,
      projectRoot: repo,
      idleDays: 7,
      now: later,
      mergedBranches: ['done'],
    });

    if (!reading.ok) throw new Error(reading.detail);
    const real = realpathSync(tempBase);
    // Git lists linked worktrees in the order it reads `.git/worktrees/`,
    // which APFS does not sort (measured: pr-7 came first), so sort by path.
    const read = reading.worktrees.map(({ path, branch, ticked, reason }) => ({ path, branch, ticked, reason }));
    expect([...read].sort((a, b) => a.path.localeCompare(b.path))).toEqual([
      { path: join(real, 'home/.rafa/worktrees/pr-7'), branch: 'pr', ticked: false, reason: 'clean; branch pr is not merged' },
      { path: join(real, 'repo/.claude/worktrees/clean'), branch: 'done', ticked: true, reason: 'clean; branch done is merged' },
      { path: join(real, 'repo/.claude/worktrees/dirty'), branch: 'dirty', ticked: false, reason: '1 untracked file' },
      { path: join(real, 'repo/.claude/worktrees/locked'), branch: 'held', ticked: false, reason: 'locked: in use' },
    ]);
    expect(statSync(index).mtime).toEqual(past);

    // Control: the same index under a plain status is rewritten, so the
    // reading above could have failed.
    git(clean, 'status', '--porcelain');
    expect(statSync(index).mtime).not.toEqual(past);

    // With the clock now, every worktree was just made, so each is recent.
    const now = readWorktrees(defaultWorktreeSeams(repo), {
      home, cwd: repo, projectRoot: repo, idleDays: 7, now: new Date(), mergedBranches: ['done'],
    });
    if (!now.ok) throw new Error(now.detail);
    expect(now.worktrees.every((row) => row.blockers.some((blocker) => blocker.kind === 'recent'))).toBe(true);
  });
});
