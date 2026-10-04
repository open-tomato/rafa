/**
 * `freeLoopHolder` and its two halves over a scripted git and a real
 * scratch directory: git's answers are scripted, as every module of
 * the merge reaches git through the runner it is handed, while the two
 * plan files are written, dated and copied on disk, so the
 * modification-time rule is read from the file system itself.
 */
import type { LoopWorktreeReading, LoopWorktreeSeams } from './merge-loop-worktree.js';
import type { SessionRecord } from '../../loop/sessions.js';
import type { GitResult, GitRunner, WorktreeEntry } from '../../pr/index.js';

import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { WORKTREE_STATUS } from '../../cleanup/worktrees.js';
import { readMergeRefusal } from '../../pr/index.js';

import {
  defaultLoopWorktreeSeams,
  findLoopHolder,
  freeLoopHolder,
  freeLoopHolderBeforeMerge,
  freeLoopWorktree,
  readLoopHolder,
} from './merge-loop-worktree.js';

const BRANCH = 'feat/demo';
const STUB = 'demo';
const PLAN_DIR = '.rafa/plans';
const OLD = new Date('2026-09-01T00:00:00Z');
const NEW = new Date('2026-10-01T00:00:00Z');

const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'merge-loop-worktree-')));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

let fixtures = 0;

/** A fresh main checkout under the scratch directory, and the loop worktree path under it. */
function freshRepo(): { readonly main: string; readonly holder: string } {
  fixtures += 1;
  const main = join(scratch, `repo-${String(fixtures)}`);
  mkdirSync(main, { recursive: true });
  return { main, holder: join(main, '.rafa', 'worktrees', STUB) };
}

function said(stdout: string): GitResult {
  return { ok: true, stdout, stderr: '' };
}

function refused(stderr: string): GitResult {
  return { ok: false, stdout: '', stderr };
}

function entry(path: string, branch: string | null): WorktreeEntry {
  return { path, branch };
}

function record(sessionId: string, branch: string, state: SessionRecord['state'] = 'running'): SessionRecord {
  return { sessionId, planStub: STUB, plan: `PLAN-${STUB}.md`, branch, pid: 4242, startedAt: '2026-10-01T00:00:00Z', state, task: null };
}

function reading(main: string, holder: string, overrides: Partial<LoopWorktreeReading> = {}): LoopWorktreeReading {
  return {
    worktrees: [entry(main, 'main'), entry(holder, BRANCH)],
    branch: BRANCH,
    mainCheckout: main,
    worktreeDir: '.rafa/worktrees',
    planDir: PLAN_DIR,
    liveLoops: [],
    ...overrides,
  };
}

interface Script {
  /** What the holder's status answers; clean when left out. */
  readonly status?: GitResult;
  /** What `git worktree remove` answers; it succeeds when left out. */
  readonly remove?: GitResult;
}

/** Seams over the real disk with git scripted, every git call written to `log`. */
function scripted(script: Script = {}): { readonly seams: LoopWorktreeSeams; readonly log: string[] } {
  const log: string[] = [];
  const real = defaultLoopWorktreeSeams(scratch);
  const seams: LoopWorktreeSeams = {
    ...real,
    git: (args) => {
      log.push(`git ${args.join(' ')}`);
      if (args[0] === 'worktree' && args[1] === 'remove') return script.remove ?? said('');
      throw new Error(`unscripted git call: ${args.join(' ')}`);
    },
    gitAt: (dir): GitRunner => (args) => {
      log.push(`${dir}: git ${args.join(' ')}`);
      if (args.join(' ') === WORKTREE_STATUS.join(' ')) return script.status ?? said('');
      throw new Error(`unscripted git call in ${dir}: ${args.join(' ')}`);
    },
    copyFile: (from, to) => {
      log.push(`copy ${from} -> ${to}`);
      real.copyFile(from, to);
    },
  };
  return { seams, log };
}

/** Writes `text` at `path`, dated `time`. */
function plant(path: string, text: string, time: Date): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
  utimesSync(path, time, time);
}

const closeout = `CLOSEOUT-${STUB}.md`;
const tracker = `PLAN_TRACKER-${STUB}.md`;

describe('readLoopHolder refuses a loop worktree it cannot free', () => {
  it('refuses a dirty worktree, naming its path and what is uncommitted', () => {
    const { main, holder } = freshRepo();
    const { seams } = scripted({ status: said(' M src/a.ts\n?? notes.txt\n') });

    const answer = readLoopHolder(seams, reading(main, holder));

    expect(answer.kind).toBe('refused');
    if (answer.kind !== 'refused') return;
    expect(answer.path).toBe(holder);
    expect(answer.message).toContain(`rafa pr merge refuses: branch ${BRANCH} is checked out in the loop worktree ${holder}`);
    expect(answer.message).toContain('1 uncommitted change, 1 untracked file');
  });

  it('refuses a worktree a live loop holds, naming the loop', () => {
    const { main, holder } = freshRepo();
    const { seams } = scripted();
    const live = [record('sess-live', BRANCH), record('sess-other', 'feat/other')];

    const answer = readLoopHolder(seams, reading(main, holder, { liveLoops: live }));

    expect(answer.kind).toBe('refused');
    if (answer.kind !== 'refused') return;
    expect(answer.message).toContain('loop session sess-live (pid 4242) is running in it');
    expect(answer.message).not.toContain('sess-other');
  });

  it('names a live loop that records the worktree, whatever branch it names', () => {
    const { main, holder } = freshRepo();
    const { seams } = scripted();
    const live = [{ ...record('sess-paused', 'feat/elsewhere', 'paused'), worktree: holder }];

    const answer = readLoopHolder(seams, reading(main, holder, { liveLoops: live }));

    expect(answer.kind).toBe('refused');
    if (answer.kind !== 'refused') return;
    expect(answer.message).toContain('loop session sess-paused (pid 4242) is paused in it');
  });

  it('reads an ended loop record as no loop at all', () => {
    const { main, holder } = freshRepo();
    const { seams } = scripted();

    const answer = readLoopHolder(seams, reading(main, holder, { liveLoops: [record('sess-done', BRANCH, 'stopped')] }));

    expect(answer).toEqual({ kind: 'freeable', path: holder, stub: STUB });
  });

  it('names every reason at once, a live loop and a dirty tree', () => {
    const { main, holder } = freshRepo();
    const { seams } = scripted({ status: said(' M src/a.ts\n M src/b.ts\n') });

    const answer = readLoopHolder(seams, reading(main, holder, { liveLoops: [record('sess-live', BRANCH)] }));

    expect(answer.kind).toBe('refused');
    if (answer.kind !== 'refused') return;
    expect(answer.message).toContain('loop session sess-live (pid 4242) is running in it');
    expect(answer.message).toContain('2 uncommitted changes');
  });

  it('refuses when the status cannot be read, quoting git', () => {
    const { main, holder } = freshRepo();
    const { seams } = scripted({ status: refused('fatal: not a git repository') });

    const answer = readLoopHolder(seams, reading(main, holder));

    expect(answer.kind).toBe('refused');
    if (answer.kind !== 'refused') return;
    expect(answer.message).toContain('its changes could not be read: git status failed: fatal: not a git repository');
  });
});

describe('readLoopHolder leaves every other holder to the existing refusal', () => {
  it('answers none for a holder outside loop.worktreeDir, and readMergeRefusal still refuses it', () => {
    const { main } = freshRepo();
    const elsewhere = join(main, '.claude', 'worktrees', STUB);
    const { seams, log } = scripted();
    const loop = reading(main, elsewhere);

    const answer = readLoopHolder(seams, loop);

    expect(answer).toEqual({ kind: 'none' });
    expect(log).toEqual([]);
    const refusal = readMergeRefusal({
      number: 7,
      branch: BRANCH,
      base: 'main',
      tree: { clean: true, entries: [] },
      merge: { mergeable: 'mergeable', status: 'CLEAN' },
      checks: 'green',
      worktrees: loop.worktrees,
      at: main,
    });
    expect(refusal?.reason).toBe('branch-checked-out');
  });

  it('answers none for a holder nested below a loop worktree rather than one', () => {
    const { main, holder } = freshRepo();
    const { seams } = scripted();

    expect(readLoopHolder(seams, reading(main, holder, {
      worktrees: [entry(main, 'main'), entry(join(holder, 'inner'), BRANCH)],
    }))).toEqual({ kind: 'none' });
  });

  it('answers none when no other checkout holds the branch', () => {
    const { main } = freshRepo();
    const { seams } = scripted();

    expect(readLoopHolder(seams, reading(main, '', { worktrees: [entry(main, BRANCH)] }))).toEqual({ kind: 'none' });
  });

  it('reads loop.worktreeDir from the main checkout, a value of its own included', () => {
    const { main } = freshRepo();
    const holder = join(main, '..', 'trees', STUB);
    const { seams } = scripted();

    const answer = readLoopHolder(seams, reading(main, holder, { worktreeDir: '../trees' }));

    expect(answer).toEqual({ kind: 'freeable', path: holder, stub: STUB });
  });
});

describe('freeLoopWorktree copies the plan files, then removes the worktree', () => {
  it('copies both files into the main checkout and removes the worktree after them', () => {
    const { main, holder } = freshRepo();
    plant(join(holder, PLAN_DIR, closeout), 'closeout from the loop\n', NEW);
    plant(join(holder, PLAN_DIR, tracker), 'tracker from the loop\n', NEW);
    const { seams, log } = scripted();

    const outcome = freeLoopWorktree(seams, reading(main, holder), { path: holder, stub: STUB });

    expect(outcome.ok).toBe(true);
    expect(readFileSync(join(main, PLAN_DIR, closeout), 'utf8')).toBe('closeout from the loop\n');
    expect(readFileSync(join(main, PLAN_DIR, tracker), 'utf8')).toBe('tracker from the loop\n');
    expect(log).toEqual([
      `copy ${join(holder, PLAN_DIR, closeout)} -> ${join(main, PLAN_DIR, closeout)}`,
      `copy ${join(holder, PLAN_DIR, tracker)} -> ${join(main, PLAN_DIR, tracker)}`,
      `git worktree remove ${holder}`,
    ]);
    if (!outcome.ok) return;
    expect(outcome.line).toBe(
      `Freed the ended loop worktree ${holder} holding ${BRANCH}: ${closeout} copied and ${tracker} copied`
        + ` into ${join(main, PLAN_DIR)}, then the worktree removed.`,
    );
  });

  it('keeps a main-checkout file with a later modification time', () => {
    const { main, holder } = freshRepo();
    plant(join(holder, PLAN_DIR, closeout), 'closeout from the loop\n', OLD);
    plant(join(holder, PLAN_DIR, tracker), 'tracker from the loop\n', OLD);
    plant(join(main, PLAN_DIR, tracker), 'tracker edited in main\n', NEW);
    const { seams } = scripted();

    const outcome = freeLoopWorktree(seams, reading(main, holder), { path: holder, stub: STUB });

    expect(outcome.ok).toBe(true);
    expect(readFileSync(join(main, PLAN_DIR, tracker), 'utf8')).toBe('tracker edited in main\n');
    expect(readFileSync(join(main, PLAN_DIR, closeout), 'utf8')).toBe('closeout from the loop\n');
    if (!outcome.ok) return;
    expect(outcome.files.map((file) => file.outcome)).toEqual(['copied', 'kept']);
    expect(outcome.line).toContain(`${tracker} kept (the main checkout's is newer)`);
  });

  it('overwrites a main-checkout file older than the loop worktree\'s, the control for the case above', () => {
    const { main, holder } = freshRepo();
    plant(join(holder, PLAN_DIR, tracker), 'tracker from the loop\n', NEW);
    plant(join(main, PLAN_DIR, tracker), 'stale tracker in main\n', OLD);
    const { seams } = scripted();

    const outcome = freeLoopWorktree(seams, reading(main, holder), { path: holder, stub: STUB });

    expect(outcome.ok).toBe(true);
    expect(readFileSync(join(main, PLAN_DIR, tracker), 'utf8')).toBe('tracker from the loop\n');
  });

  it('names a file the loop worktree never wrote, and still removes it', () => {
    const { main, holder } = freshRepo();
    plant(join(holder, PLAN_DIR, tracker), 'tracker from the loop\n', NEW);
    const { seams, log } = scripted();

    const outcome = freeLoopWorktree(seams, reading(main, holder), { path: holder, stub: STUB });

    expect(outcome.ok).toBe(true);
    expect(existsSync(join(main, PLAN_DIR, closeout))).toBe(false);
    expect(log.at(-1)).toBe(`git worktree remove ${holder}`);
    if (!outcome.ok) return;
    expect(outcome.line).toContain(`${closeout} absent`);
  });

  it('reports a failed remove as a refusal, quoting git, with the copies named', () => {
    const { main, holder } = freshRepo();
    plant(join(holder, PLAN_DIR, closeout), 'closeout from the loop\n', NEW);
    const { seams } = scripted({ remove: refused(`fatal: '${holder}' contains modified or untracked files, use --force to delete it`) });

    const outcome = freeLoopWorktree(seams, reading(main, holder), { path: holder, stub: STUB });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.message).toContain(`rafa pr merge refuses: the loop worktree ${holder} holding ${BRANCH} could not be removed, so nothing was merged.`);
    expect(outcome.message).toContain('contains modified or untracked files');
    expect(outcome.message).toContain(`${closeout} copied`);
    expect(outcome.message).toContain(`git worktree remove ${holder}`);
  });

  it('refuses without removing when a copy fails', () => {
    const { main, holder } = freshRepo();
    plant(join(holder, PLAN_DIR, closeout), 'closeout from the loop\n', NEW);
    const { seams, log } = scripted();
    const failing: LoopWorktreeSeams = {
      ...seams,
      copyFile: () => {
        throw new Error('EACCES: permission denied');
      },
    };

    const outcome = freeLoopWorktree(failing, reading(main, holder), { path: holder, stub: STUB });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.message).toContain(`${closeout} could not be copied into ${join(main, PLAN_DIR)}: EACCES: permission denied`);
    expect(outcome.message).toContain('the worktree was left in place');
    expect(log.filter((line) => line.startsWith('git worktree remove'))).toEqual([]);
  });
});

describe('freeLoopHolder', () => {
  it('frees a clean, ended loop worktree and answers its line', () => {
    const { main, holder } = freshRepo();
    plant(join(holder, PLAN_DIR, closeout), 'closeout\n', NEW);
    plant(join(holder, PLAN_DIR, tracker), 'tracker\n', NEW);
    const { seams } = scripted();

    const outcome = freeLoopHolder(seams, reading(main, holder));

    expect(outcome.kind).toBe('freed');
    if (outcome.kind !== 'freed') return;
    expect(outcome.line).toStartWith(`Freed the ended loop worktree ${holder}`);
  });

  it('answers the refusal and copies nothing for a dirty one', () => {
    const { main, holder } = freshRepo();
    plant(join(holder, PLAN_DIR, closeout), 'closeout\n', NEW);
    const { seams, log } = scripted({ status: said(' M src/a.ts\n') });

    const outcome = freeLoopHolder(seams, reading(main, holder));

    expect(outcome.kind).toBe('refused');
    expect(log.filter((line) => line.startsWith('copy') || line.startsWith('git worktree remove'))).toEqual([]);
    expect(existsSync(join(main, PLAN_DIR, closeout))).toBe(false);
  });

  it('answers a failed remove as refused', () => {
    const { main, holder } = freshRepo();
    const { seams } = scripted({ remove: refused('fatal: cannot remove a locked working tree') });

    const outcome = freeLoopHolder(seams, reading(main, holder));

    expect(outcome.kind).toBe('refused');
    if (outcome.kind !== 'refused') return;
    expect(outcome.message).toContain('fatal: cannot remove a locked working tree');
  });

  it('answers none for a holder outside loop.worktreeDir', () => {
    const { main } = freshRepo();
    const { seams } = scripted();

    expect(freeLoopHolder(seams, reading(main, join(scratch, 'elsewhere', STUB)))).toEqual({ kind: 'none' });
  });
});

describe('findLoopHolder', () => {
  it('names the loop worktree holding the branch, clean or not, sending no git call', () => {
    const { main, holder } = freshRepo();
    const { seams, log } = scripted();

    expect(findLoopHolder(seams, reading(main, holder))).toEqual({ path: holder, stub: STUB });
    expect(log).toEqual([]);
  });

  it('answers null for a holder outside loop.worktreeDir and for no holder', () => {
    const { main, holder } = freshRepo();
    const { seams } = scripted();

    expect(findLoopHolder(seams, reading(main, join(scratch, 'elsewhere', STUB)))).toBeNull();
    expect(findLoopHolder(seams, reading(main, holder, { worktrees: [entry(main, 'main')] }))).toBeNull();
  });
});

describe('freeLoopHolderBeforeMerge reads the loop sessions from disk', () => {
  /** The reading without its live loops, which the step reads itself. */
  function place(main: string, holder: string): Omit<LoopWorktreeReading, 'liveLoops'> {
    const { worktrees, branch, mainCheckout, worktreeDir, planDir } = reading(main, holder);
    return { worktrees, branch, mainCheckout, worktreeDir, planDir };
  }

  /** A record file under `<main>/.rafa/runs/`, written as `text`. */
  function plantRecord(main: string, name: string, text: string): void {
    mkdirSync(join(main, '.rafa', 'runs'), { recursive: true });
    writeFileSync(join(main, '.rafa', 'runs', name), text);
  }

  it('refuses a worktree whose loop record reads running with its pid alive', () => {
    const { main, holder } = freshRepo();
    plantRecord(main, 'sess-live.json', JSON.stringify(record('sess-live', BRANCH)));
    const { seams, log } = scripted();

    const outcome = freeLoopHolderBeforeMerge(seams, place(main, holder), { root: main, isAlive: () => true });

    expect(outcome.kind).toBe('refused');
    if (outcome.kind !== 'refused') return;
    expect(outcome.message).toContain('loop session sess-live (pid 4242) is running in it');
    expect(log.some((line) => line.startsWith('git worktree remove'))).toBe(false);
  });

  it('frees the same worktree once the record\'s pid is gone, the control for the case above', () => {
    const { main, holder } = freshRepo();
    plantRecord(main, 'sess-live.json', JSON.stringify(record('sess-live', BRANCH)));
    const { seams, log } = scripted();

    const outcome = freeLoopHolderBeforeMerge(seams, place(main, holder), { root: main, isAlive: () => false });

    expect(outcome.kind).toBe('freed');
    expect(log).toContain(`git worktree remove ${holder}`);
  });

  it('refuses when a loop worktree holds the branch and a session record cannot be read', () => {
    const { main, holder } = freshRepo();
    plantRecord(main, 'broken.json', '{ not json');
    const { seams } = scripted();

    const outcome = freeLoopHolderBeforeMerge(seams, place(main, holder), { root: main });

    expect(outcome.kind).toBe('refused');
    if (outcome.kind !== 'refused') return;
    expect(outcome.message).toContain(`checked out in the loop worktree ${holder}, and whether a loop still runs in it could not be read`);
  });

  it('answers none over the same unreadable record when no loop worktree holds the branch', () => {
    const { main } = freshRepo();
    plantRecord(main, 'broken.json', '{ not json');
    const { seams } = scripted();

    const outcome = freeLoopHolderBeforeMerge(seams, place(main, join(scratch, 'elsewhere', STUB)), { root: main });

    expect(outcome).toEqual({ kind: 'none' });
  });
});
