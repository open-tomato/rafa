/**
 * The loop's per-task tail, read as the loop reads it.
 *
 * `commitFinishedTask` in `start.ts` is what happens after a task's
 * session returns 0: it stages and commits whatever the session left,
 * then marks the tracker line. `utils/commit.ts` owns whether git was
 * asked the right questions, and `tests/commit-refusals.test.ts` owns
 * whether a refusal is a refusal. Neither can say what the TRACKER
 * ends up holding, which is the only thing the next iteration reads.
 *
 * The claim this file exists for is the one shape the loop meets more
 * often than any other and would most quietly get wrong: a task that
 * SUCCEEDED and changed no tracked file. Every plan here has several
 * — a stage that only appends to `progress.txt`, a task whose whole
 * output is a `.plans/` edit or a `/tmp` capture — and all three of
 * those trees are gitignored, so git legitimately answers that there
 * is nothing to commit. That answer must tick the box exactly as a
 * commit does. Block it and the plan stalls on its most ordinary
 * task, forever: `findNextTask` resumes a blocked task FIRST, so the
 * loop would re-dispatch the same session on every run.
 *
 * ## Why the fixtures are repositories
 *
 * Every case below drives a REAL repository under `mkdtemp` through
 * the DEFAULT commit runner, so `nothing-to-commit` is git's own
 * answer about a real ignored write rather than a stub's. Each
 * repository sets its own `core.hooksPath`, `user.email`, `user.name`
 * and `commit.gpgsign`, so this clone's `.githooks` never runs
 * against an index it knows nothing about and no case depends on the
 * machine's global git config. Its `.gitignore` carries exactly the
 * three entries this repo's own carries, and the tracker is planted
 * INSIDE `.plans/` where the loop really keeps it — which is also
 * what makes the tick itself invisible to `git add -A`.
 *
 * One case is stubbed, and only for what no repository can show: what
 * `commitFinishedTask` HANDS its runner. It asserts the runner was
 * hit, because a suite that never checks that is evidence about the
 * default path alone.
 *
 * ## Every case carries its control
 *
 * The claim is a pair of absences — no commit, no history moved — and
 * an absence is satisfied by a helper that commits nothing, ticks
 * everything, or prints nothing at all. So each case varies ONE axis
 * inside its own body and holds the rest fixed:
 *
 *   - the ignored write, against a TRACKED write in the same
 *     repository through the same helper;
 *   - the ticked box, against the pre-edit file reconstructed from
 *     the post-edit one, so a rewrite that retouched a neighbouring
 *     line is a red rather than a byte nobody looked at;
 *   - the loop advancing, against a commit a pre-commit hook refuses,
 *     which must leave the SAME task at the SAME line;
 *   - the operator's no-commit line, against the committed line the
 *     same helper prints for a tracked write.
 *
 * ## The mutation grid
 *
 * Ten mutations of `commitFinishedTask` were driven against this
 * file, NINE of them reddening at least one case. The module was
 * restored bytes-identical afterwards and all 5 cases were green
 * either side; every case below is in the reddened union.
 *
 * The splits that ISOLATE are what the file is shaped for. Ticking
 * the line before the commit runs, and ticking a failed task rather
 * than blocking it, each redden the advance case ALONE — it is the
 * only one that asks what the tracker says after git refused. The
 * first of those two is also why the tick has to come second: it
 * leaves the line ticked before the failure is known, and the
 * blocked write rewrites an unchecked box alone, so a tick written
 * early can never be retracted. Swapping the two operator branches
 * reddens the report case alone, and dropping the task text handed
 * to the runner reddens the stub case alone.
 *
 * The wider legs are wide for one reason each. Marking a successful
 * task blocked, skipping the tracker write altogether, and ticking
 * the line BELOW all redden the same four — every case except the
 * report one, which reads the operator's output and not the file.
 * Treating `nothing-to-commit` as a failure, and pointing the runner
 * at a path that is not the repo root, redden all five.
 *
 * The one leg that reddened NOTHING is recorded rather than dropped,
 * because it is unread here rather than unguarded: dropping the
 * indent from a refused commit's own message changes how git's
 * reason prints, and no case below reads that text. It is
 * `tests/commit-refusals.test.ts`'s claim, not this file's.
 *
 * One leg came back NOT-APPLIED on the first pass, which is the
 * guard earning its place. The four-space blocked write inside this
 * function is a SUBSTRING of the six-space ones the loop's own tail
 * carries, so the target matched three times and had to be
 * re-anchored on the line above it. A leg that silently lands
 * somewhere else reads exactly like a module nothing guards.
 */
import type { TaskCommitRunner } from '../start.js';
import type { CommitAttempt, CommitOptions } from '../utils/commit.js';
import type { TaskInfo } from '../utils/tracker.js';

import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { commitFinishedTask } from '../start.js';
import { findNextTask } from '../utils/tracker.js';

/** The first open task in every planted tracker. */
const FIRST_TASK = 'Capture the three gates into per-run capture files';

/** The next one, which the loop must reach once the first is ticked. */
const SECOND_TASK = 'Add the report that rolls the stored rows up per plan';

/**
 * A tracker with the shape a real plan's has: a title, a stage
 * heading, one already-done task and two open ones.
 *
 * The done line above the open ones is deliberate. It is what makes
 * `- [x] ` a spelling the parser must SKIP rather than one it has
 * never seen, so a tick landing on the wrong line has somewhere
 * wrong to land.
 */
const TRACKER = [
  '# Plan: a throwaway plan',
  '',
  '## Stage: One',
  '',
  '- [x] Add the store the collector writes its rows to',
  `- [ ] ${FIRST_TASK}`,
  `- [ ] ${SECOND_TASK}`,
  '',
].join('\n');

/** The three trees this repo's loop writes to and never commits. */
const IGNORED_TREES = 'progress.txt\n.plans/\n.specs/\n';

/** A hook that refuses, printing its reason the way a gate does. */
const REJECTING_HOOK = '#!/bin/sh\necho "gate says no" >&2\nexit 1\n';

/** What a stubbed runner answers for a tree git saw nothing in. */
const CLEAN_ATTEMPT: CommitAttempt = {
  outcome: 'nothing-to-commit',
  subject: 'chore: capture the three gates into per-run capture files',
  sha: null,
  failedStep: null,
  exitCode: 0,
  message: '',
};

const tempRoot = mkdtempSync(join(tmpdir(), 'ralph-finished-'));

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

let planted = 0;

/** Lines `commitFinishedTask` reported to the operator. */
let logs: string[] = [];

/** Lines it reported as a problem. */
let errors: string[] = [];

/**
 * Captures the helper's own output.
 *
 * Through a spy on `console` and not a `process.stdout.write` patch:
 * vitest replaces the console object, so a stream capture reads zero
 * lines here and every absence assertion below would pass against a
 * helper that reported nothing at all.
 */
beforeEach(() => {
  logs = [];
  errors = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(' '));
  });
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(' '));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Runs git in a repository, reading back rather than through git.ts. */
function inRepo(dir: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
}

/** Writes a file into a repository, creating its directory first. */
function write(dir: string, name: string, body: string): void {
  const target = join(dir, name);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, body, 'utf8');
}

/**
 * A repository ignoring what this repo ignores, with one commit in it.
 *
 * `core.hooksPath` points at a directory of its own, so a hook case
 * plants the hook it is about and inherits none.
 */
function plantRepo(): string {
  planted += 1;
  const dir = join(tempRoot, `repo-${planted}`);
  mkdirSync(join(dir, 'hooks'), { recursive: true });
  inRepo(dir, 'init', '-q', '.');
  inRepo(dir, 'config', 'user.email', 'loop@example.test');
  inRepo(dir, 'config', 'user.name', 'Ralph Loop');
  inRepo(dir, 'config', 'commit.gpgsign', 'false');
  inRepo(dir, 'config', 'core.hooksPath', 'hooks');
  write(dir, '.gitignore', IGNORED_TREES);
  write(dir, 'seed.txt', 'seed\n');
  inRepo(dir, 'add', '-A');
  inRepo(dir, 'commit', '-q', '-m', 'seed');
  return dir;
}

/** Installs an executable pre-commit hook. */
function plantHook(dir: string, script: string): void {
  const hook = join(dir, 'hooks', 'pre-commit');
  writeFileSync(hook, script, 'utf8');
  chmodSync(hook, 0o755);
}

/** Plants a tracker where the loop keeps one, and answers its path. */
function plantTracker(dir: string): string {
  const trackerPath = join(dir, '.plans', 'PLAN_TRACKER-throwaway.md');
  write(dir, '.plans/PLAN_TRACKER-throwaway.md', TRACKER);
  return trackerPath;
}

/**
 * The task the loop would dispatch next, read the way the loop reads
 * it. Throws rather than answering null, so a fixture that stopped
 * carrying an open task is a red case and not a silently skipped one.
 */
function nextTask(trackerPath: string): TaskInfo {
  const info = findNextTask(readFileSync(trackerPath, 'utf8'));
  if (!info) throw new Error(`no open task in ${trackerPath}`);
  return info;
}

/** One tracker line, by its zero-indexed number. */
function lineAt(trackerPath: string, lineNum: number): string {
  return readFileSync(trackerPath, 'utf8').split('\n')[lineNum] ?? '';
}

/** How many commits the repository holds. */
function commitCount(dir: string): string {
  return inRepo(dir, 'rev-list', '--count', 'HEAD');
}

/** Paths currently in the index, one per line. */
function stagedPaths(dir: string): string {
  return inRepo(dir, 'diff', '--cached', '--name-only');
}

/** Everything in the newest COMMIT, one path per line. */
function committedPaths(dir: string): string {
  return inRepo(dir, 'ls-tree', '-r', '--name-only', 'HEAD');
}

describe('a finished task that changed no tracked file', () => {
  it('ticks its tracker line and moves no history', () => {
    const dir = plantRepo();
    const trackerPath = plantTracker(dir);
    const taskInfo = nextTask(trackerPath);
    const head = inRepo(dir, 'rev-parse', 'HEAD');

    // What a session that only recorded a finding leaves behind: two
    // writes the repository is configured never to see.
    write(dir, 'progress.txt', 'a finding\n');
    write(dir, '.plans/scratch.md', 'a note\n');

    const attempt = commitFinishedTask({
      trackerPath,
      taskInfo,
      repoRoot: dir,
    });

    expect(attempt.outcome).toBe('nothing-to-commit');
    expect(attempt.sha).toBeNull();
    expect(attempt.failedStep).toBeNull();
    expect(lineAt(trackerPath, taskInfo.lineNum)).toBe(`- [x] ${FIRST_TASK}`);
    expect(inRepo(dir, 'rev-parse', 'HEAD')).toBe(head);
    expect(commitCount(dir)).toBe('1');
    expect(stagedPaths(dir)).toBe('');

    // The control, along the one axis: the same repository, the same
    // helper, the next task, a change git can see. Without it every
    // assertion above is satisfied by a helper that never commits and
    // by a tracker write that ticks whatever it is handed.
    const second = nextTask(trackerPath);
    write(dir, 'tracked.txt', 'work\n');
    const taken = commitFinishedTask({
      trackerPath,
      taskInfo: second,
      repoRoot: dir,
    });

    expect(taken.outcome).toBe('committed');
    expect(taken.sha).not.toBeNull();
    expect(lineAt(trackerPath, second.lineNum)).toBe(`- [x] ${SECOND_TASK}`);
    expect(commitCount(dir)).toBe('2');
    expect(committedPaths(dir)).toContain('tracked.txt');
    expect(committedPaths(dir)).not.toContain('progress.txt');
  });

  it('rewrites its own line and no other byte', () => {
    const dir = plantRepo();
    const trackerPath = plantTracker(dir);
    const before = readFileSync(trackerPath, 'utf8');
    const taskInfo = nextTask(trackerPath);
    write(dir, 'progress.txt', 'a finding\n');

    commitFinishedTask({ trackerPath, taskInfo, repoRoot: dir });

    const after = readFileSync(trackerPath, 'utf8');

    // The control for the reconstruction below: an edit that never
    // happened reconstructs perfectly, so the difference is asserted
    // first and the identity second.
    expect(after).not.toBe(before);

    const lines = after.split('\n');
    lines[taskInfo.lineNum] = (lines[taskInfo.lineNum] ?? '')
      .replace('- [x]', '- [ ]');
    expect(lines.join('\n')).toBe(before);
  });

  it('lets the loop advance instead of resuming the task', () => {
    const dir = plantRepo();
    const trackerPath = plantTracker(dir);
    const taskInfo = nextTask(trackerPath);
    write(dir, 'progress.txt', 'a finding\n');

    commitFinishedTask({ trackerPath, taskInfo, repoRoot: dir });

    const advanced = nextTask(trackerPath);
    expect(advanced.task).toBe(SECOND_TASK);
    expect(advanced.status).toBe('unchecked');
    expect(advanced.lineNum).toBe(taskInfo.lineNum + 1);

    // The control, along the outcome axis: the same tracker, the same
    // task, a commit a pre-commit hook refuses. That one must leave
    // the SAME task at the SAME line and mark it blocked, which is
    // what says the advance above is the tick rather than the parser
    // walking on regardless.
    const refused = plantRepo();
    plantHook(refused, REJECTING_HOOK);
    const refusedTracker = plantTracker(refused);
    const refusedInfo = nextTask(refusedTracker);
    write(refused, 'tracked.txt', 'work\n');

    const attempt = commitFinishedTask({
      trackerPath: refusedTracker,
      taskInfo: refusedInfo,
      repoRoot: refused,
    });

    expect(attempt.outcome).toBe('failed');

    const resumed = nextTask(refusedTracker);
    expect(resumed.task).toBe(FIRST_TASK);
    expect(resumed.lineNum).toBe(refusedInfo.lineNum);
    expect(resumed.status).toBe('blocked');
    expect(commitCount(refused)).toBe('1');
  });

  it('tells the operator no commit was made', () => {
    const dir = plantRepo();
    const trackerPath = plantTracker(dir);
    const taskInfo = nextTask(trackerPath);
    write(dir, 'progress.txt', 'a finding\n');

    commitFinishedTask({ trackerPath, taskInfo, repoRoot: dir });

    const quiet = logs.join('\n');
    expect(quiet).toContain('Task done');
    expect(quiet).toContain('Nothing to commit');
    expect(quiet).not.toContain('Committed ');
    expect(errors).toEqual([]);

    // The control: a tracked write through the same helper prints the
    // committed line, so the absence above is this outcome and not a
    // helper that reports nothing whatever it did.
    logs.length = 0;
    const second = nextTask(trackerPath);
    write(dir, 'tracked.txt', 'work\n');
    commitFinishedTask({ trackerPath, taskInfo: second, repoRoot: dir });

    const spoken = logs.join('\n');
    expect(spoken).toContain('Committed ');
    expect(spoken).not.toContain('Nothing to commit');
  });

  it('hands the runner the task text and the repo root', () => {
    const dir = plantRepo();
    const trackerPath = plantTracker(dir);
    const taskInfo = nextTask(trackerPath);
    const seen: CommitOptions[] = [];
    const commit: TaskCommitRunner = (options) => {
      seen.push(options);
      return CLEAN_ATTEMPT;
    };

    commitFinishedTask({ trackerPath, taskInfo, repoRoot: dir, commit });

    // The stub was hit, once, with what the loop is supposed to pass.
    // Without this the default path is the only thing under test and
    // the two arguments could be anything at all.
    expect(seen).toHaveLength(1);
    expect(seen[0]?.taskText).toBe(FIRST_TASK);
    expect(seen[0]?.cwd).toBe(dir);

    expect(lineAt(trackerPath, taskInfo.lineNum)).toBe(`- [x] ${FIRST_TASK}`);

    // The control for that tick: no git ran at all, so it cannot have
    // come from a commit the stub quietly let through.
    expect(commitCount(dir)).toBe('1');
    expect(stagedPaths(dir)).toBe('');
  });
});
