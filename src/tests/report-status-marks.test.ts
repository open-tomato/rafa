/**
 * A task's own report against the loop's mark, driven the way the loop
 * drives it: a dispatch (`start/dispatch.ts`), through the commit
 * (`start/commit.ts`), through the store (`report/record.ts`).
 *
 * `commit.test.ts` stubs the commit runner and never dispatches or
 * stores. `tests/finished-task.test.ts` drives a real repository but
 * hands `commitFinishedTask` a fixed `taskInfo` rather than a dispatch.
 * `tests/task-report.test.ts` drives the whole `rafa start` command over
 * a stand-in `claude` on a child PATH. This file sits between the last
 * two: a real repository and a real `.rafa/effort/effort.sqlite`, but
 * the session itself is a stub `run` handed straight to `dispatchTask`,
 * so no process is spawned and no case needs a `claude` on `PATH`.
 *
 * `runCase` is what `start()` does for one task after `dispatchTask`
 * answers: read what the report holds the task back on, commit and mark
 * (`finishCleanExit`), then store the report under the outcome that
 * answered (`storeTaskReport`). The stub session writes one tracked file
 * as its "work", so the commit this exercises is a real one and not
 * `nothing-to-commit`.
 *
 * Rule under test (`start.ts`'s module note, and Finding 1 of the prompt
 * audit): a clean exit is `blocked` — committed first, then marked
 * `[BLOCKED]` — when the report says `status: blocked` or lists a
 * blocker, whatever its status says, and `done` otherwise. `findNextTask`
 * resumes a blocked task FIRST, so a blocked mark is read back here as
 * the concrete way the run stops: the next read of the tracker answers
 * the SAME task, at the SAME line, still open. The stored `task_reports`
 * row carries the report's own `status` beside that outcome, and the two
 * can disagree — a session that wrote `status: done` next to a blocker
 * is stored `done` beside `blocked` — which is exactly the row the third
 * case below reads back.
 */
import type { CapturedSession } from '../utils/claude.js';

import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database } from 'bun:sqlite';
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';

import { setActiveOutput } from '../adapters/output/active.js';
import { sqliteStorePath } from '../effort/store/sqlite.js';
import { finishCleanExit } from '../start/commit.js';
import { dispatchTask, storeTaskReport } from '../start/dispatch.js';
import { findNextTask } from '../utils/tracker.js';

import { sinkOutput } from './output-sinks.js';

/** A fence, kept out of the template literals. */
const FENCE = '```';

/** The one task every planted repo opens with. */
const TASK = 'Add the status-versus-outcome fixture module';

/** The plan `dispatchTask` is handed; `inject: 'full'` sends it whole. */
const PLAN = ['# Plan: a throwaway plan', '', `- [ ] ${TASK}`, ''].join('\n');

/** The task's zero-indexed line in {@link PLAN}. */
const TASK_LINE = 2;

/** A session output ending with a report holding `lines`. */
function outputWith(...lines: string[]): string {
  return ['Work finished.', '', `${FENCE}rafa:report`, ...lines, FENCE, ''].join('\n');
}

/** Claims `status: blocked`, with no blocker listed. */
const STATUS_BLOCKED = outputWith('status: blocked', 'blockers: []');

/** Claims `done`, beside one listed blocker. */
const DONE_WITH_BLOCKER = outputWith(
  'status: done',
  'blockers:',
  '  - what: "LINEAR_API_KEY unset"',
);

/** Claims `done` with nothing held back: the control. */
const CLEAN = outputWith('status: done', 'blockers: []');

const tempRoot = mkdtempSync(join(tmpdir(), 'rafa-report-status-marks-'));
let planted = 0;

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

/**
 * Silences the loop: `start/dispatch.ts` and `start/commit.ts` write
 * through the active output, set to one that drops every line and put
 * back to the default after each case.
 */
beforeEach(() => {
  setActiveOutput(sinkOutput({}));
});

afterEach(() => {
  setActiveOutput(null);
});

/** Runs git in a repository, reading back rather than through git.ts. */
function inRepo(dir: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
}

/** The tracker path every planted repo keeps, inside the ignored `.plans/`. */
function trackerPathOf(dir: string): string {
  return join(dir, '.plans', 'PLAN_TRACKER-report-status.md');
}

/**
 * A fresh repository ignoring `progress.txt`, `.plans/` and `.rafa/` —
 * the store's own directory — with one seed commit and its tracker
 * planted inside the ignored `.plans/`. Real git, no stub, as
 * `tests/finished-task.test.ts` plants one.
 */
function plantRepo(): string {
  planted += 1;
  const dir = join(tempRoot, `repo-${planted}`);
  mkdirSync(dir, { recursive: true });
  inRepo(dir, 'init', '-q', '.');
  inRepo(dir, 'config', 'user.email', 'loop@example.test');
  inRepo(dir, 'config', 'user.name', 'Rafa Loop');
  inRepo(dir, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(dir, '.gitignore'), 'progress.txt\n.plans/\n.rafa/\n', 'utf8');
  writeFileSync(join(dir, 'seed.txt'), 'seed\n', 'utf8');
  inRepo(dir, 'add', '-A');
  inRepo(dir, 'commit', '-q', '-m', 'seed');

  mkdirSync(join(dir, '.plans'), { recursive: true });
  writeFileSync(trackerPathOf(dir), PLAN, 'utf8');
  return dir;
}

/** One tracker line, by its zero-indexed number. */
function lineAt(dir: string, lineNum: number): string {
  return readFileSync(trackerPathOf(dir), 'utf8').split('\n')[lineNum] ?? '';
}

/** How many commits the repository holds. */
function commitCount(dir: string): number {
  return Number(inRepo(dir, 'rev-list', '--count', 'HEAD'));
}

/** One `task_reports` row's status beside its outcome, read straight off the store. */
function taskReportRow(dir: string, sessionId: string): { status: string | null; outcome: string } | null {
  const db = new Database(sqliteStorePath(dir), { readonly: true });
  try {
    const row = db.query<{ status: string | null; outcome: string }, [string]>(
      'SELECT status, outcome FROM task_reports WHERE session_id = ?',
    ).get(sessionId);
    return row ?? null;
  } finally {
    db.close();
  }
}

/**
 * Dispatches the fixture task under a stub session that writes one
 * TRACKED file as its "work" and answers `output`, then settles it
 * exactly as `start()` does after a clean exit: reads what the report
 * holds the task back on, commits and marks the tracker
 * (`finishCleanExit`), and stores the report under the outcome that
 * answered (`storeTaskReport`).
 */
async function runCase(dir: string, sessionId: string, output: string) {
  const trackerPath = trackerPathOf(dir);
  const taskInfo = findNextTask(readFileSync(trackerPath, 'utf8'));
  if (taskInfo === null) throw new Error('the fixture tracker holds no open task');

  const dispatch = await dispatchTask({
    taskInfo,
    promptContent: 'The loop stages and commits on your behalf.',
    planContent: PLAN,
    inject: 'full',
    repoRoot: dir,
    home: join(dir, 'home'),
    settingSources: ['project', 'local'],
    serving: null,
    newSessionId: () => sessionId,
    run: (): Promise<CapturedSession> => {
      writeFileSync(join(dir, 'work.txt'), 'work\n', 'utf8');
      return Promise.resolve({ exitCode: 0, stdout: output });
    },
  });

  const finished = finishCleanExit({
    trackerPath,
    taskInfo,
    repoRoot: dir,
    output: dispatch.output,
  });

  const stored = await storeTaskReport({
    repoRoot: dir,
    planStub: 'report-status',
    dispatch: {
      sessionId: dispatch.sessionId,
      taskText: dispatch.taskText,
      output: dispatch.output,
      declaration: dispatch.declaration,
      flags: dispatch.flags,
    },
    outcome: finished.outcome,
    learning: null,
  });

  return { dispatch, finished, stored };
}

describe('a clean exit whose report holds the task', () => {
  it.each([
    ['status: blocked, blockers empty', STATUS_BLOCKED, 'blocked'],
    ['done, one blocker listed', DONE_WITH_BLOCKER, 'done'],
  ])('commits, marks [BLOCKED] and stops for a report saying %s', async (_label, output, claimedStatus) => {
    const dir = plantRepo();
    const before = commitCount(dir);

    const { dispatch, finished, stored } = await runCase(dir, 'session-blocked', output);

    // Committed: the stub session's tracked file really landed in git,
    // never `nothing-to-commit`.
    expect(finished.attempt.outcome).toBe('committed');
    expect(commitCount(dir)).toBe(before + 1);

    // Marked [BLOCKED], and the outcome the loop stores the report
    // under agrees with the mark.
    expect(lineAt(dir, TASK_LINE)).toBe(`- [BLOCKED] ${TASK}`);
    expect(finished.outcome).toBe('blocked');

    // The run stops here: `start.ts` returns on any outcome but `done`,
    // and `findNextTask` resumes a blocked task FIRST, so the next read
    // of the tracker answers the very same task at the very same line,
    // still open — the concrete shape "the run stopped" takes on disk.
    expect(finished.outcome).not.toBe('done');
    const resumed = findNextTask(readFileSync(trackerPathOf(dir), 'utf8'));
    expect(resumed).toMatchObject({ task: TASK, lineNum: TASK_LINE, status: 'blocked' });

    // The report's own status is stored beside the loop's outcome.
    expect(stored).toBe(true);
    expect(taskReportRow(dir, dispatch.sessionId)).toEqual({ status: claimedStatus, outcome: 'blocked' });
  });

  it('stores a status/outcome disagreement for a done report that lists a blocker', async () => {
    const dir = plantRepo();

    const { dispatch } = await runCase(dir, 'session-disagree', DONE_WITH_BLOCKER);

    // The session's claim and the loop's outcome are two different
    // readings, and here they disagree: the session wrote `done`, but
    // its own blocker held the task back, so the loop's outcome is
    // `blocked`. Both are kept, side by side, on the one row.
    const row = taskReportRow(dir, dispatch.sessionId);
    expect(row).toEqual({ status: 'done', outcome: 'blocked' });
    expect(row?.status).not.toBe(row?.outcome);
  });
});

describe('a clean exit whose report holds nothing back', () => {
  it('commits, ticks [x], and stores a row where status and outcome agree', async () => {
    const dir = plantRepo();
    const before = commitCount(dir);

    const { dispatch, finished, stored } = await runCase(dir, 'session-clean', CLEAN);

    expect(finished.attempt.outcome).toBe('committed');
    expect(commitCount(dir)).toBe(before + 1);
    expect(lineAt(dir, TASK_LINE)).toBe(`- [x] ${TASK}`);
    expect(finished.outcome).toBe('done');

    // The run goes on: no open or blocked task is left for this plan.
    expect(findNextTask(readFileSync(trackerPathOf(dir), 'utf8'))).toBeNull();

    // The control for the disagreement above: a report that holds
    // nothing back is stored with its claim and the outcome the same.
    expect(stored).toBe(true);
    const row = taskReportRow(dir, dispatch.sessionId);
    expect(row).toEqual({ status: 'done', outcome: 'done' });
    expect(row?.status).toBe(row?.outcome);
  });
});
