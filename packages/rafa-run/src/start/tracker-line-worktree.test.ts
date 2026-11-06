/**
 * Tests for the tracker line (`tracker-line.ts`) over a real git
 * repository with a linked worktree under its `.rafa/worktrees/`, the
 * shape a run's tasks have: the tracker sits in the main checkout's
 * gitignored `.rafa/plans/`, and the session runs in the worktree, which
 * holds no copy of it.
 *
 * First, a dispatch whose `checkout` is the worktree hands a prompt that
 * names the main checkout's tracker by absolute path and no path under
 * the worktree. Then a planted session that appends close-out notes
 * below its task line, as the line asks, leaves `updateTrackerLine`
 * marking that line `[x]` and `findNextTask` answering the following task
 * with no note read as a task.
 */
import type { TaskSessionRunner } from './dispatch.js';

import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { setActiveOutput } from '@open-tomato/rafa/core/output';
import { sinkOutput } from '@open-tomato/rafa/tests/output-sinks';
import { findNextTask, updateTrackerLine } from '@open-tomato/rafa/utils/tracker';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { dispatchTask } from './dispatch.js';
import { TRACKER_PROMPT_PREFIX } from './tracker-line.js';

const FIRST = 'Add the first module';
const SECOND = 'Add the second module';
const TRACKER = `# Plan\n\n- [ ] ${FIRST}\n- [ ] ${SECOND}\n`;
const FIRST_LINE = 2;

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** Runs git in `cwd`. */
function git(cwd: string, args: readonly string[]): void {
  execFileSync('git', [...args], { cwd, stdio: 'ignore', env: { ...process.env, LC_ALL: 'C' } });
}

interface Planted {
  readonly root: string;
  readonly checkout: string;
  readonly trackerPath: string;
}

/** A repository with a worktree under `.rafa/worktrees/`, and a tracker in its `.rafa/plans/`. */
function plantWorktree(): Planted {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'tracker-line-worktree-')));
  roots.push(base);
  const root = join(base, 'repo');
  mkdirSync(root, { recursive: true });
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.email', 'tracker@example.invalid']);
  git(root, ['config', 'user.name', 'tracker']);
  writeFileSync(join(root, '.gitignore'), '.rafa/\n');
  writeFileSync(join(root, 'f.txt'), 'one\n');
  git(root, ['add', '.gitignore', 'f.txt']);
  git(root, ['commit', '-q', '-m', 'one']);
  mkdirSync(join(root, '.rafa', 'worktrees'), { recursive: true });
  mkdirSync(join(root, '.rafa', 'plans'), { recursive: true });
  const checkout = join(root, '.rafa', 'worktrees', 'task-1');
  git(root, ['worktree', 'add', '-q', '-b', 'feat/task-1', checkout]);
  const trackerPath = join(root, '.rafa', 'plans', 'PLAN_TRACKER-demo.md');
  writeFileSync(trackerPath, TRACKER);
  return { root, checkout, trackerPath };
}

describe('the tracker line, for a task dispatched into a linked worktree', () => {
  beforeEach(() => {
    setActiveOutput(sinkOutput({}));
  });

  afterEach(() => {
    setActiveOutput(null);
  });

  /** Dispatches the first task into the worktree, `session` standing in for the spawned session. */
  function dispatchFirst(planted: Planted, session: () => void): ReturnType<typeof dispatchTask> {
    const run: TaskSessionRunner = () => {
      session();
      return Promise.resolve({ exitCode: 0, stdout: '' });
    };
    return dispatchTask({
      taskInfo: { task: FIRST, lineNum: FIRST_LINE, status: 'unchecked' },
      promptContent: 'The loop commits.',
      planContent: TRACKER,
      inject: 'full',
      repoRoot: planted.root,
      checkout: planted.checkout,
      home: join(planted.root, 'home'),
      settingSources: ['project', 'local'],
      serving: null,
      handout: null,
      base: null,
      trackerPath: planted.trackerPath,
      run,
      newSessionId: () => 'session-under-test',
    });
  }

  it('names the main checkout\'s tracker by absolute path and no path under the worktree', async () => {
    const planted = plantWorktree();

    const { prompt } = await dispatchFirst(planted, () => undefined);

    expect(prompt.startsWith('Your scoped task is:')).toBe(true);
    expect(prompt).toContain(`${TRACKER_PROMPT_PREFIX}\`${planted.trackerPath}\``);
    expect(planted.trackerPath.startsWith(planted.checkout)).toBe(false);
    expect(planted.trackerPath).toBe(join(planted.root, '.rafa', 'plans', 'PLAN_TRACKER-demo.md'));
    expect(prompt).not.toContain(planted.checkout);
    // The worktree holds no copy: the tracker is reachable only by the path named.
    expect(() => readFileSync(join(planted.checkout, '.rafa', 'plans', 'PLAN_TRACKER-demo.md'), 'utf8')).toThrow();
  });

  it('marks the task line [x] and answers the following task when the session appended notes below its line', async () => {
    const planted = plantWorktree();
    const notes = [
      '  Close-out: the module landed.',
      '  - [ ] a note that looks like a task but is indented',
      '    more detail on the line below',
    ].join('\n');

    const dispatch = await dispatchFirst(planted, () => {
      const lines = readFileSync(planted.trackerPath, 'utf8').split('\n');
      lines.splice(FIRST_LINE + 1, 0, ...notes.split('\n'));
      writeFileSync(planted.trackerPath, lines.join('\n'));
    });
    expect(dispatch.exitCode).toBe(0);

    updateTrackerLine(planted.trackerPath, FIRST_LINE, 'done');

    const after = readFileSync(planted.trackerPath, 'utf8');
    const lines = after.split('\n');
    expect(lines[FIRST_LINE]).toBe(`- [x] ${FIRST}`);
    expect(lines[FIRST_LINE + 1]).toBe('  Close-out: the module landed.');
    expect(after).toContain(`- [ ] ${SECOND}`);

    const next = findNextTask(after);
    expect(next?.task).toBe(SECOND);
    expect(next?.status).toBe('unchecked');
    expect(next?.lineNum).toBe(lines.indexOf(`- [ ] ${SECOND}`));
  });

  it('would read a note written at the line start as a task, which is why the prompt forbids it', () => {
    const planted = plantWorktree();
    appendFileSync(planted.trackerPath, '- [ ] a note written as a task\n');

    updateTrackerLine(planted.trackerPath, FIRST_LINE, 'done');
    updateTrackerLine(planted.trackerPath, FIRST_LINE + 1, 'done');

    expect(findNextTask(readFileSync(planted.trackerPath, 'utf8'))?.task).toBe('a note written as a task');
  });
});
