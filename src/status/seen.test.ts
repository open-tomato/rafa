/**
 * Tests for the since-last-command snapshot (`seen.ts`).
 *
 * The idle worktree and Merged cases run over the real repository
 * `../cleanup/scratch-repository.ts` builds, with only the disk's
 * modification times scripted, and every git argv logged so a case can
 * show no fetch or other remote command was run. The session cases run
 * over a planted project (`../tests/loop-session-fixtures.ts`) with a
 * git that answers every command with nothing, so the cleanup half reads
 * empty and the sessions are all there is. The file cases write and read
 * `.rafa/status-seen.json` in a directory of each case's own.
 *
 * Each reading that answers null or `ok: false` sits beside one that
 * does not, so a reader that always failed would fail a case.
 */
import type { SeenInput, SeenSeams, SeenSnapshot } from './seen.js';
import type { ScratchRepository } from '../cleanup/scratch-repository.js';
import type { WorktreeSeams } from '../cleanup/worktrees.js';
import type { GitRunner } from '../pr/git.js';

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { defaultWorktreeSeams } from '../cleanup/index.js';
import { createScratchRepository, SCRATCH_NOW } from '../cleanup/scratch-repository.js';
import { runsDir } from '../loop/sessions.js';
import { plantDemoProject, plantSession, sessionRecord } from '../tests/loop-session-fixtures.js';

import {
  readSeenFile,
  SEEN_FILE,
  SEEN_VERSION,
  seenFilePath,
  takeSeenSnapshot,
  writeSeenFile,
} from './seen.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-status-seen-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The settings every case reads with. */
const CONFIG: SeenInput['config'] = {
  prBase: 'main',
  cleanupKeep: [],
  cleanupStaleDays: 30,
  cleanupWorktreeIdleDays: 7,
};

/** A time past `cleanup.worktreeIdleDays` before {@link SCRATCH_NOW}. */
const OLD = new Date('2026-01-01T00:00:00Z');

/** The git subcommands that reach a remote. */
const REMOTE_COMMANDS: ReadonlySet<string> = new Set(['fetch', 'ls-remote', 'pull', 'push']);

/** A snapshot holding one of everything. */
const SNAPSHOT: SeenSnapshot = {
  version: 1,
  idleWorktrees: ['/repo/.claude/worktrees/a'],
  mergedBranches: ['feat/a', 'feat/b'],
  sessions: {
    'session-0500': { state: 'running', blocked: [6] },
    'session-0600': { state: 'done', blocked: [] },
  },
};

/** A fresh directory standing for a project root. */
function freshRoot(): string {
  return realpathSync(mkdtempSync(join(tempBase, 'root-')));
}

/** A git logging each argv to `log` before handing it to `git`. */
function logged(git: GitRunner, log: string[]): GitRunner {
  return (args) => {
    log.push(args.join(' '));
    return git(args);
  };
}

describe('seenFilePath', () => {
  it('names status-seen.json under the project\'s .rafa directory', () => {
    expect(seenFilePath('/p')).toBe(join('/p', '.rafa', SEEN_FILE));
    expect(SEEN_FILE).toBe('status-seen.json');
    expect(SEEN_VERSION).toBe(1);
  });
});

describe('the housekeeping half of the reading', () => {
  let repo: ScratchRepository;

  beforeAll(() => {
    repo = createScratchRepository();
  });

  afterAll(() => {
    repo.dispose();
  });

  /** Seams over the scratch repository: git logged, the disk's times scripted by `modifiedAt`. */
  function scratchSeams(modifiedAt: (path: string) => Date | null, log: string[] = []): SeenSeams {
    return {
      worktreeSeams: (cwd): WorktreeSeams => {
        const real = defaultWorktreeSeams(cwd);
        return { ...real, git: logged(real.git, log), gitAt: (dir) => logged(real.gitAt(dir), log), modifiedAt };
      },
      isAlive: () => false,
      now: () => SCRATCH_NOW,
    };
  }

  /** The snapshot of the scratch clone over `seams`, failing the case when it was not taken. */
  async function snapshotOf(seams: SeenSeams): Promise<SeenSnapshot> {
    const reading = await takeSeenSnapshot({ root: repo.clone, home: repo.home, config: CONFIG }, seams);
    if (!reading.ok) throw new Error(`no snapshot: ${reading.detail}`);
    return reading.snapshot;
  }

  it('names the idle worktrees by path, where none is idle when all were touched today', async () => {
    const oneOld = await snapshotOf(scratchSeams((path) => (path.includes('wt-clean')
      ? OLD
      : SCRATCH_NOW)));
    const allOld = await snapshotOf(scratchSeams(() => OLD));
    const noneOld = await snapshotOf(scratchSeams(() => SCRATCH_NOW));

    expect(oneOld.idleWorktrees).toEqual([repo.worktrees.clean]);
    expect(allOld.idleWorktrees).toEqual([repo.worktrees.clean, repo.worktrees.dirty, repo.worktrees.locked].sort());
    expect(noneOld.idleWorktrees).toEqual([]);
  });

  it('names the branches git reads as merged, sorted, and not the squash merge only a provider reads', async () => {
    const snapshot = await snapshotOf(scratchSeams(() => SCRATCH_NOW));

    expect(snapshot.mergedBranches).toContain('merged');
    expect(snapshot.mergedBranches).toContain('wt-clean');
    expect(snapshot.mergedBranches).not.toContain('squashed');
    expect(snapshot.mergedBranches).not.toContain('stale');
    expect(snapshot.mergedBranches).toEqual([...snapshot.mergedBranches].sort());
    expect(snapshot.version).toBe(1);
  });

  it('runs no fetch nor any other git command that reaches a remote, where it does run git', async () => {
    const log: string[] = [];

    await snapshotOf(scratchSeams(() => SCRATCH_NOW, log));

    expect(log).toContain('worktree list --porcelain');
    expect(log.filter((argv) => REMOTE_COMMANDS.has(argv.split(' ')[0] ?? ''))).toEqual([]);
  });
});

describe('the sessions half of the reading', () => {
  /** Worktree seams whose git answers every command with nothing, so no branch or worktree is listed. */
  const quietGit: GitRunner = () => ({ ok: true, stdout: '', stderr: '' });
  const quietSeams = (): WorktreeSeams => ({
    git: quietGit,
    gitAt: () => quietGit,
    sessions: () => [],
    modifiedAt: () => SCRATCH_NOW,
    realPath: (path) => path,
  });

  it('holds each session\'s state and its checklist\'s blocked lines, a live record whose pid is gone reading stopped', async () => {
    const project = plantDemoProject(tempBase);
    plantSession(project.root, sessionRecord({ sessionId: 'session-0500', pid: 7171 }));
    plantSession(project.root, sessionRecord({ sessionId: 'session-0550', pid: 8181, startedAt: '2026-09-15T12:30:00.000Z' }));
    plantSession(project.root, sessionRecord({
      sessionId: 'session-0600',
      planStub: 'gone',
      plan: '.plans/PLAN-gone.md',
      state: 'done',
      task: null,
      startedAt: '2026-09-15T13:00:00.000Z',
    }));

    const reading = await takeSeenSnapshot(
      { root: project.root, home: project.home, config: CONFIG },
      { worktreeSeams: quietSeams, isAlive: (pid) => pid === 7171, now: () => SCRATCH_NOW },
    );

    expect(reading).toEqual({
      ok: true,
      snapshot: {
        version: 1,
        idleWorktrees: [],
        mergedBranches: [],
        sessions: {
          'session-0500': { state: 'running', blocked: [6] },
          'session-0550': { state: 'stopped', blocked: [6] },
          'session-0600': { state: 'done', blocked: [] },
        },
      },
    });
  });

  it('holds no session for a project with no runs directory', async () => {
    const project = plantDemoProject(tempBase);

    const reading = await takeSeenSnapshot(
      { root: project.root, home: project.home, config: CONFIG },
      { worktreeSeams: quietSeams, now: () => SCRATCH_NOW },
    );

    expect(reading.ok && reading.snapshot.sessions).toEqual({});
  });

  it('answers ok false naming the file when a record cannot be read, never throwing', async () => {
    const project = plantDemoProject(tempBase);
    mkdirSync(runsDir(project.root), { recursive: true });
    const damaged = join(runsDir(project.root), 'session-0700.json');
    writeFileSync(damaged, '{ not json');

    const reading = await takeSeenSnapshot(
      { root: project.root, home: project.home, config: CONFIG },
      { worktreeSeams: quietSeams, now: () => SCRATCH_NOW },
    );

    expect(reading.ok).toBe(false);
    if (reading.ok) return;
    expect(reading.detail).toContain(damaged);
  });

  it('answers ok false with git\'s words when git refuses the listing', async () => {
    const project = plantDemoProject(tempBase);
    const refusing: GitRunner = () => ({ ok: false, stdout: '', stderr: 'fatal: not a git repository (or any of the parent directories): .git' });

    const reading = await takeSeenSnapshot(
      { root: project.root, home: project.home, config: CONFIG },
      { worktreeSeams: () => ({ ...quietSeams(), git: refusing, gitAt: () => refusing }), now: () => SCRATCH_NOW },
    );

    expect(reading.ok).toBe(false);
    if (reading.ok) return;
    expect(reading.detail).toContain('not a git repository');
  });
});

describe('readSeenFile and writeSeenFile', () => {
  it('reads back what was written, creating .rafa and leaving no temporary file', () => {
    const root = freshRoot();

    writeSeenFile(root, SNAPSHOT);

    expect(readSeenFile(root)).toEqual(SNAPSHOT);
    expect(readdirSync(dirname(seenFilePath(root)))).toEqual([SEEN_FILE]);
    expect(readFileSync(seenFilePath(root), 'utf8').endsWith('}\n')).toBe(true);
  });

  it('overwrites the snapshot a previous command wrote', () => {
    const root = freshRoot();
    writeSeenFile(root, SNAPSHOT);
    const next: SeenSnapshot = { ...SNAPSHOT, idleWorktrees: [], sessions: {} };

    writeSeenFile(root, next);

    expect(readSeenFile(root)).toEqual(next);
  });

  it('answers null for a missing file', () => {
    const root = freshRoot();

    expect(existsSync(seenFilePath(root))).toBe(false);
    expect(readSeenFile(root)).toBeNull();
  });

  it.each([
    ['holds no JSON', '{ "version": 1, '],
    ['holds an array', '[]'],
    ['names another version', JSON.stringify({ ...SNAPSHOT, version: 2 })],
    ['names no version', JSON.stringify({ ...SNAPSHOT, version: undefined })],
    ['holds a path that is no string', JSON.stringify({ ...SNAPSHOT, idleWorktrees: [3] })],
    ['holds no merged list', JSON.stringify({ ...SNAPSHOT, mergedBranches: undefined })],
    ['holds sessions as an array', JSON.stringify({ ...SNAPSHOT, sessions: [] })],
    ['holds a session in an unknown state', JSON.stringify({ ...SNAPSHOT, sessions: { s: { state: 'lost', blocked: [] } } })],
    ['holds a blocked line that is no line number', JSON.stringify({ ...SNAPSHOT, sessions: { s: { state: 'done', blocked: [0] } } })],
  ])('answers null for a file that %s', (_what, text) => {
    const root = freshRoot();
    writeSeenFile(root, SNAPSHOT);
    expect(readSeenFile(root)).not.toBeNull();

    writeFileSync(seenFilePath(root), text);

    expect(readSeenFile(root)).toBeNull();
  });
});
