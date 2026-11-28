/**
 * Tests for `rafa loop wait` (`wait.ts`).
 *
 * Every case dispatches the command in a project of its own holding the
 * demo plan (`tests/loop-session-fixtures.ts`), with a session record and
 * an events file planted as the loop writes them: each line is
 * `{ name, summary, data, ts }`, its summary spelled by the writer's own
 * `summaryOf`. The seams read the branch `feat/demo`, probe no real pid,
 * and hand in an awake clock over a fake monotonic and wall clock whose
 * sleep advances one awake minute and runs the case's own hook, so no
 * case sleeps and each counts its polls.
 *
 * Each reason sits beside a control: the default set skips a
 * `task-blocked` line that `--until=blocked` answers on the same file; a
 * suspend of an hour leaves `quiet` waiting for its awake minutes; the
 * note for a missing events file is counted across several polls.
 *
 * The cases of a held stop a `--continue` decision ends (#1672) plant no
 * events: `rafa-run`'s own `createRunDecisions`, bound to the case's
 * events file by `bindEventsFile`, writes them, decided `stop` by a
 * stand-in session or left needing a decision under `--output=json`.
 * The #1544 case reading a held `task-blocked` alone as no ending is
 * their control.
 */
import type { LoopWaitSeams } from './wait.js';
import type { DecisionStop, RunDecisionsOptions } from '@open-tomato/rafa-run/start/continue-run';
import type { LoopEvent } from '@open-tomato/rafa-run/start/loop-events';

import { appendFileSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '@open-tomato/rafa/core/output';
import { sinkOutput } from '@open-tomato/rafa/tests/output-sinks';
import { findNextTask } from '@open-tomato/rafa/utils/tracker';
import { DECISION_NEEDED_EXIT, DECISION_STOP_EXIT, LoopEnd } from '@open-tomato/rafa-run/start/continue-exits';
import { createRunDecisions } from '@open-tomato/rafa-run/start/continue-run';
import { bindEventsFile, eventsFilePath, summaryOf, taskPosition, unbindEventsFile } from '@open-tomato/rafa-run/start/loop-events';
import { retryTaskOf } from '@open-tomato/rafa-run/start/retry-budget';

import { createAwakeClock } from '../../loop/awake-clock.js';
import { WAIT_REASONS } from '../../loop/wait-reasons.js';
import { dispatchInProject, eventsOf } from '../../tests/cli-capture.js';
import {
  DEMO_PLAN_PATH,
  DEMO_TRACKER_PATH,
  LOOP_SUBJECTS,
  PID,
  plantDemoProject,
  plantSession,
  resultEvent,
  SESSION_ID,
  sessionRecord,
} from '../../tests/loop-session-fixtures.js';
import { readLoopEnding } from '../stretch/item-merge.js';

import { createLoopWaitCommand, WAIT_POLL_MS } from './wait.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-loop-wait-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** Nanoseconds in a minute, for the fake monotonic clock. */
const NS_PER_MINUTE = 60_000_000_000n;

/** Milliseconds in a minute, for the fake wall clock. */
const MS_PER_MINUTE = 60_000;

/** The usage line a line refusal names. */
const USAGE = 'Usage: rafa loop wait [-s|--session-id=<id>] [--until=<reasons>] [--timeout=<minutes>]';

/** The line a task held on both absences is printed under, which its run's closing `halt` opens with. */
const HELD_TEXT = 'Task held: its session left neither a report nor a commit';

/** The reason a held task's `task-blocked` gives: the first of its two holds. */
const NO_REPORT_HOLD = 'no report: the session wrote no rafa:report block the loop could read';

/** What `rafa stretch item` printed for a run whose events held no ending (#1544). */
const NO_ENDING = 'it wrote no pr, no-pr, halt or error event';

/** One event of each kind the reasons match, as the loop emits it. */
const EVENTS: Readonly<Record<string, LoopEvent>> = {
  'pr': { kind: 'pr', number: 41 },
  'no-pr': { kind: 'no-pr', reason: 'nothing to push' },
  'halt': { kind: 'halt', reason: 'the halt file is there' },
  'error': { kind: 'error', message: 'boom\nat line 2' },
  'task-blocked': { kind: 'task-blocked', position: { index: 2, total: 4 }, reason: 'budget spent' },
  'task-start': { kind: 'task-start', position: { index: 2, total: 4 }, text: 'Second task' },
  'held task-blocked': { kind: 'task-blocked', position: { index: 2, total: 4 }, reason: NO_REPORT_HOLD },
  'held halt': { kind: 'halt', reason: `${HELD_TEXT}: Second task` },
};

/** The line the events file holds for `event`, newline included. */
function eventLine(event: LoopEvent): string {
  const { kind, ...data } = event;
  return `${JSON.stringify({ name: kind, summary: summaryOf(event), data, ts: '2026-09-15T12:05:00.000Z' })}\n`;
}

/** The planted event of `name`. */
function eventOf(name: string): LoopEvent {
  const event = EVENTS[name];
  if (event === undefined) throw new Error(`no planted event ${name}`);
  return event;
}

/** A case's project, its record planted, and its events file holding `events` unless `null`. */
function projectWith(events: readonly string[] | null, record = sessionRecord()) {
  const project = plantDemoProject(tempBase);
  plantSession(project.root, record);
  const file = eventsFilePath(project.root, record.sessionId);
  if (events !== null) appendFileSync(file, events.map((name) => eventLine(eventOf(name))).join(''));
  return { project, file };
}

/** What one case's clock and sleep saw. */
interface Clocked {
  readonly seams: LoopWaitSeams;
  /** The sleeps the wait asked for, in milliseconds. */
  readonly sleeps: number[];
}

/** What a case hands the clock: a hook run on each sleep, before the next poll, and the minutes it adds. */
interface ClockPlan {
  readonly onSleep?: (sleep: number) => void;
  readonly suspendedOnSleep?: (sleep: number) => number;
  readonly isAlive?: (pid: number) => boolean;
}

/** Seams over a fake clock: each sleep advances one awake minute, plus any suspended minutes the plan adds. */
function clocked(plan: ClockPlan = {}): Clocked {
  let monotonicNs = 0n;
  let wallMs = Date.parse('2026-09-15T12:10:00.000Z');
  const sleeps: number[] = [];
  const seams: LoopWaitSeams = {
    readBranch: () => 'feat/demo',
    isAlive: plan.isAlive ?? (() => true),
    clock: createAwakeClock({ monotonicNs: () => monotonicNs, wallMs: () => wallMs }),
    sleep: (ms) => {
      sleeps.push(ms);
      const suspended = plan.suspendedOnSleep?.(sleeps.length) ?? 0;
      monotonicNs += NS_PER_MINUTE;
      wallMs += MS_PER_MINUTE * (1 + suspended);
      plan.onSleep?.(sleeps.length);
      return Promise.resolve();
    },
  };
  return { seams, sleeps };
}

/** Dispatches `rafa loop wait <words>` in `project` over `seams`. */
function wait(project: ReturnType<typeof plantDemoProject>, words: readonly string[], seams: LoopWaitSeams) {
  return dispatchInProject(['loop', 'wait', ...words], LOOP_SUBJECTS, [createLoopWaitCommand(seams)], project);
}

/** The exit code of a reason, read from the table. */
function exitOf(reason: string): number {
  const row = WAIT_REASONS.find((held) => held.reason === reason);
  if (row === undefined) throw new Error(`no reason ${reason}`);
  return row.exit;
}

describe('rafa loop wait, a reason an event answers', () => {
  it.each([
    ['pr', 'pr', 'rafa· pr #41 opened'],
    ['no-pr', 'no-pr', 'rafa· no pr            nothing to push'],
    ['halt', 'halt', 'rafa· halt             the halt file is there'],
    ['error', 'error', 'rafa· error            boom'],
    ['blocked', 'task-blocked', 'rafa· task 2/4 blocked budget spent'],
  ])('answers --until=%s on a %s line with its rafa· line and exit code', async (reason, name, line) => {
    const { project } = projectWith(['task-start', name]);
    const { seams, sleeps } = clocked();

    const run = await wait(project, [`--until=${reason}`], seams);

    expect(run.stdout).toBe(`${line}\n`);
    expect([run.exitCode, run.stderr]).toEqual([exitOf(reason), '']);
    expect(sleeps).toEqual([]);
  });

  it('holds the exit codes of the spec: 0, 10, 11, 12 and 13 for the event reasons', () => {
    expect(['pr', 'no-pr', 'halt', 'error', 'blocked'].map(exitOf)).toEqual([0, 10, 11, 12, 13]);
  });

  it('answers a pr line appended while it waits, read from the offset the last poll stopped at', async () => {
    const { project, file } = projectWith(['task-start']);
    const { seams, sleeps } = clocked({
      onSleep: (count) => {
        if (count === 2) appendFileSync(file, eventLine(eventOf('pr')));
      },
    });

    const run = await wait(project, [], seams);

    expect(run.stdout).toBe('rafa· pr #41 opened\n');
    expect(run.exitCode).toBe(0);
    expect(sleeps).toEqual([WAIT_POLL_MS, WAIT_POLL_MS]);
  });
});

describe('rafa loop wait, the default set', () => {
  it('passes over a task-blocked line and answers the halt after it, without --until', async () => {
    const { project } = projectWith(['task-start', 'task-blocked', 'halt']);

    const run = await wait(project, [], clocked().seams);

    expect(run.stdout).toBe('rafa· halt             the halt file is there\n');
    expect(run.exitCode).toBe(11);
  });

  it('answers the same file on the task-blocked line under --until=blocked, the control', async () => {
    const { project } = projectWith(['task-start', 'task-blocked', 'halt']);

    const run = await wait(project, ['--until=blocked'], clocked().seams);

    expect(run.stdout).toBe('rafa· task 2/4 blocked budget spent\n');
    expect(run.exitCode).toBe(13);
  });

  it('never answers quiet without asking: no events for ten awake minutes, then the run exits', async () => {
    const { project } = projectWith(['task-start']);
    let alive = true;
    const { seams, sleeps } = clocked({
      isAlive: () => alive,
      onSleep: (count) => {
        if (count === 10) alive = false;
      },
    });

    const run = await wait(project, [], seams);

    expect(run.stdout).toBe(`rafa· exit             session ${SESSION_ID} stopped, pid ${PID} not alive\n`);
    expect(run.exitCode).toBe(14);
    expect(sleeps).toHaveLength(10);
  });
});

describe('rafa loop wait, a run that ends', () => {
  it('answers exit 14 when the record\'s pid is not alive, its record reading stopped', async () => {
    const { project } = projectWith(['task-start']);

    const run = await wait(project, [], clocked({ isAlive: () => false }).seams);

    expect(run.stdout).toBe(`rafa· exit             session ${SESSION_ID} stopped, pid ${PID} not alive\n`);
    expect(run.exitCode).toBe(14);
  });

  it('answers exit when the record reads done though its pid is alive, as a reused pid would be', async () => {
    const { project } = projectWith(['task-start'], sessionRecord({ state: 'done', task: null }));

    const run = await wait(project, [], clocked().seams);

    expect(run.stdout).toBe(`rafa· exit             session ${SESSION_ID} done, pid ${PID} alive\n`);
    expect(run.exitCode).toBe(14);
  });

  it('answers a run that had already ended with the pr line it wrote before it ended', async () => {
    const { project } = projectWith(['task-start', 'pr'], sessionRecord({ state: 'done', task: null }));

    const run = await wait(project, [], clocked({ isAlive: () => false }).seams);

    expect(run.stdout).toBe('rafa· pr #41 opened\n');
    expect(run.exitCode).toBe(0);
  });

  it('reads the events file once more when the run ends, so a pr line written last answers ahead of exit', async () => {
    const { project, file } = projectWith(['task-start']);
    let alive = true;
    const { seams } = clocked({
      isAlive: () => alive,
      onSleep: () => {
        alive = false;
      },
    });
    let reads = 0;
    const readRecord: NonNullable<LoopWaitSeams['readRecord']> = (root, sessionId) => {
      reads += 1;
      // The pr line lands between the poll's events read and its record read.
      if (reads === 2) appendFileSync(file, eventLine(eventOf('pr')));
      const state = alive
        ? 'running'
        : 'stopped';
      return { ...sessionRecord(), sessionId, state };
    };

    const run = await wait(project, [], { ...seams, readRecord });

    expect(run.stdout).toBe('rafa· pr #41 opened\n');
    expect(run.exitCode).toBe(0);
  });

  it('waits past a run that ended when --until leaves exit out, until the timeout', async () => {
    const { project } = projectWith(['task-start'], sessionRecord({ state: 'done', task: null }));
    const { seams, sleeps } = clocked();

    const run = await wait(project, ['--until=pr', '--timeout=2'], seams);

    expect(run.stdout).toBe('rafa· timeout          no reason asked for in 2 awake minutes\n');
    expect(run.exitCode).toBe(16);
    expect(sleeps).toHaveLength(2);
  });
});

describe('rafa loop wait, a run with no events file', () => {
  it('notes the missing file once across every poll, then answers exit when the pid goes', async () => {
    const { project } = projectWith(null);
    let alive = true;
    const { seams, sleeps } = clocked({
      isAlive: () => alive,
      onSleep: (count) => {
        if (count === 3) alive = false;
      },
    });

    const run = await wait(project, [], seams);

    expect(run.stdout).toBe([
      `warn: Session ${SESSION_ID} has no events file at .rafa/runs/${SESSION_ID}.events.ndjson: a run from an`
      + ' older rafa writes none, and no event can answer until one appears.',
      `rafa· exit             session ${SESSION_ID} stopped, pid ${PID} not alive`,
      '',
    ].join('\n'));
    expect(run.exitCode).toBe(14);
    expect(sleeps).toHaveLength(3);
  });

  it('notes nothing for a run whose events file is there, the control', async () => {
    const { project } = projectWith(['task-start']);

    const run = await wait(project, [], clocked({ isAlive: () => false }).seams);

    expect(run.stdout).not.toContain('warn:');
  });
});

describe('rafa loop wait, quiet and the timeout', () => {
  it('answers quiet:3 after three awake minutes with no event, exit 15', async () => {
    const { project } = projectWith(['task-start']);
    const { seams, sleeps } = clocked();

    const run = await wait(project, ['--until=quiet:3'], seams);

    expect(run.stdout).toBe('rafa· quiet            no event for 3 awake minutes\n');
    expect(run.exitCode).toBe(15);
    expect(sleeps).toHaveLength(3);
  });

  it('counts no suspended minute toward quiet, and names the hour spent suspended', async () => {
    const { project } = projectWith(['task-start']);
    const { seams, sleeps } = clocked({
      suspendedOnSleep: (count) => count === 1
        ? 60
        : 0,
    });

    const run = await wait(project, ['--until=quiet:3'], seams);

    expect(run.stdout).toBe('rafa· quiet            no event for 3 awake minutes, 60 minutes more suspended\n');
    expect(sleeps).toHaveLength(3);
  });

  it('counts quiet from the last event read, so a line during the wait restarts the span', async () => {
    const { project, file } = projectWith(['task-start']);
    const { seams, sleeps } = clocked({
      onSleep: (count) => {
        if (count === 2) appendFileSync(file, eventLine(eventOf('task-start')));
      },
    });

    const run = await wait(project, ['--until=quiet:3'], seams);

    expect(run.exitCode).toBe(15);
    expect(sleeps).toHaveLength(5);
  });

  it('gives up with exit 16 once --timeout=4 awake minutes pass with nothing asked for', async () => {
    const { project } = projectWith(['task-start']);
    const { seams, sleeps } = clocked();

    const run = await wait(project, ['--timeout=4'], seams);

    expect(run.stdout).toBe('rafa· timeout          no reason asked for in 4 awake minutes\n');
    expect(run.exitCode).toBe(16);
    expect(sleeps).toHaveLength(4);
  });

  it('answers an event that lands before the timeout, the control', async () => {
    const { project, file } = projectWith(['task-start']);
    const { seams } = clocked({
      onSleep: (count) => {
        if (count === 3) appendFileSync(file, eventLine(eventOf('no-pr')));
      },
    });

    const run = await wait(project, ['--timeout=4'], seams);

    expect(run.exitCode).toBe(10);
  });
});

describe('rafa loop wait, the session', () => {
  it('ends with exit 2 for a --session-id no record is named with', async () => {
    const { project } = projectWith(['pr']);

    const run = await wait(project, ['--session-id=session-0999'], clocked().seams);

    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain('No session record under .rafa/runs/ is named session-0999.');
    expect(run.stdout).toBe('');
  });

  it('ends with exit 2 when no session ever ran on the branch', async () => {
    const { project } = projectWith(['pr'], sessionRecord({ branch: 'feat/other' }));

    const run = await wait(project, [], clocked().seams);

    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain('No session is running on `feat/demo`.');
  });

  it('waits on the session --session-id names, the branch reader never asked', async () => {
    const { project } = projectWith(['pr'], sessionRecord({ branch: 'feat/other' }));
    const { seams } = clocked();

    const run = await wait(project, [`--session-id=${SESSION_ID}`], {
      ...seams,
      readBranch: () => {
        throw new Error('the branch was read');
      },
    });

    expect(run.stdout).toBe('rafa· pr #41 opened\n');
    expect(run.exitCode).toBe(0);
  });

  it('keeps exit 1 for a refusal that is no missing session: two live sessions on the branch', async () => {
    const { project } = projectWith(['pr']);
    plantSession(project.root, sessionRecord({ sessionId: 'session-0600' }));

    const run = await wait(project, [], clocked().seams);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('2 sessions are running on `feat/demo`');
  });
});

describe('rafa loop wait, the line it refuses', () => {
  it.each([
    [['--until=pr,merged'], '--until: unknown reason: \'merged\''],
    [['--until=quiet:0'], '--until: quiet takes a positive whole number of minutes: \'quiet:0\''],
    [['--timeout=0'], '"0" is no timeout, which is a whole number of minutes from 1'],
    [['--timeout=soon'], '"soon" is no timeout, which is a whole number of minutes from 1'],
    [['now'], 'Expected no argument, got 1: now'],
  ])('refuses %p with exit 1, naming what it refuses and the usage', async (words, problem) => {
    const { project } = projectWith(['pr']);

    const run = await wait(project, words, clocked().seams);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toBe(`❌ ${problem}\n${USAGE}\n`);
    expect(run.stdout).toBe('');
  });
});

describe('rafa loop wait --output=json', () => {
  it('gives the reason, the event and the session\'s state as the result data for a pr', async () => {
    const { project } = projectWith(['task-start', 'pr']);

    const run = await wait(project, ['--output=json'], clocked().seams);
    const result = resultEvent(run.stdout);

    expect(run.exitCode).toBe(0);
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      reason: 'pr',
      exitCode: 0,
      line: 'rafa· pr #41 opened',
      event: { name: 'pr', summary: 'pr #41 opened', data: { number: 41 } },
      session: { sessionId: SESSION_ID, state: 'running', pid: PID, pidAlive: true },
      awakeMinutes: 0,
      suspendedMinutes: 0,
    });
  });

  it('writes the result as a wait event for a reason exiting non-zero, the terminal result naming the line', async () => {
    const { project } = projectWith(['task-start'], sessionRecord({ state: 'stopped' }));

    const run = await wait(project, ['--output=json'], clocked({ isAlive: () => false }).seams);
    const events = eventsOf(run.stdout);
    const named = events.find((event) => event.type === 'event');

    expect(run.exitCode).toBe(14);
    expect(named).toMatchObject({
      type: 'event',
      name: 'wait',
      summary: `exit             session ${SESSION_ID} stopped, pid ${PID} not alive`,
      data: { reason: 'exit', exitCode: 14, event: null, session: { state: 'stopped', pidAlive: false } },
    });
    expect(events.at(-1)).toMatchObject({
      type: 'result',
      ok: false,
      error: { code: 'command_exit', message: `rafa· exit             session ${SESSION_ID} stopped, pid ${PID} not alive` },
    });
  });
});

describe('rafa loop wait, a held stop (#1544)', () => {
  it('reads a run whose events end on the held task-blocked as no ending, the control the case below reverses', async () => {
    const { project } = projectWith(['task-start', 'held task-blocked']);

    const run = await wait(project, [], clocked({ isAlive: () => false }).seams);

    expect(run.stdout).toBe(`rafa· exit             session ${SESSION_ID} stopped, pid ${PID} not alive\n`);
    expect(run.exitCode).toBe(exitOf('exit'));
    expect(readLoopEnding(project.root, SESSION_ID)).toMatchObject({ kind: 'none', reason: expect.stringContaining(NO_ENDING) });
  });

  it('answers task-start, the held task-blocked and its halt on the halt: the held reason once, and the halt\'s exit code', async () => {
    const { project } = projectWith(['task-start', 'held task-blocked', 'held halt']);

    const run = await wait(project, [], clocked({ isAlive: () => false }).seams);

    expect(run.stdout).toBe(`rafa· halt             ${HELD_TEXT}: Second task\n`);
    expect(run.stdout.split(HELD_TEXT)).toHaveLength(2);
    expect([run.exitCode, run.stderr]).toEqual([exitOf('halt'), '']);
    const ending = readLoopEnding(project.root, SESSION_ID);
    expect(ending).toEqual({ kind: 'halt', reason: `${HELD_TEXT}: Second task` });
    expect(JSON.stringify(ending)).not.toContain(NO_ENDING);
  });

  it('gives the json result once for the same file, its one wait event and its terminal error naming the held line', async () => {
    const { project } = projectWith(['task-start', 'held task-blocked', 'held halt']);

    const run = await wait(project, ['--output=json'], clocked({ isAlive: () => false }).seams);
    const events = eventsOf(run.stdout);

    expect(run.exitCode).toBe(exitOf('halt'));
    expect(events.filter((event) => event.type === 'event')).toHaveLength(1);
    expect(events.find((event) => event.type === 'event')).toMatchObject({
      name: 'wait',
      data: { reason: 'halt', exitCode: exitOf('halt'), event: { name: 'halt', data: { reason: `${HELD_TEXT}: Second task` } } },
    });
    expect(events.at(-1)).toMatchObject({
      type: 'result',
      ok: false,
      error: { code: 'command_exit', message: `rafa· halt             ${HELD_TEXT}: Second task` },
    });
  });
});

/** A `rafa:decision` block deciding `stop`, as the decision session answers it. */
const STOP_DECISION = ['```rafa:decision', 'strategy: stop', 'reason: "The task text is wrong."', '```', ''].join('\n');

/** The demo tracker's `[BLOCKED]` second task, held on nothing but its absences, as `finishCleanExit` answers it. */
function heldStop(trackerPath: string): DecisionStop {
  const content = readFileSync(trackerPath, 'utf8');
  const taskInfo = findNextTask(content);
  if (taskInfo === null) throw new Error('the demo tracker holds no open task');
  return {
    kind: 'clean-exit',
    taskInfo,
    retryTask: retryTaskOf(taskInfo, content),
    finished: {
      attempt: { outcome: 'nothing-to-commit', subject: 's', sha: null, failedStep: null, exitCode: null, message: '' },
      holds: [NO_REPORT_HOLD, 'no commit: the task changed no tracked file'],
    },
    stopEvent: { kind: 'task-blocked', position: taskPosition(content, taskInfo.lineNum), reason: NO_REPORT_HOLD },
  };
}

/**
 * Writes the events file of a `--continue` run on `project` that meets
 * the held stop with its retries spent, through the run's own
 * `createRunDecisions` bound to that file: decided `stop` by the session,
 * or left needing a decision under `--output=json`. Answers the run's exit code.
 */
async function decidedHeldRun(project: ReturnType<typeof plantDemoProject>, mode: 'text' | 'json'): Promise<number> {
  const trackerPath = join(project.root, DEMO_TRACKER_PATH);
  const options: RunDecisionsOptions = {
    continueArgs: { on: true, directive: null, forceWrapUp: false },
    repoRoot: project.root,
    checkout: project.root,
    trackerPath,
    planPath: join(project.root, DEMO_PLAN_PATH),
    settings: { loopContinueCriteria: '.rafa/continue-criteria.md', loopContinueCriteriaMode: 'extend', loopForceWrapUpMaxNewFailures: false },
    settingSources: ['project', 'local'],
    session: { decisionsChanged: () => undefined },
    retries: { retry: () => false, left: () => 0, lastRefusal: () => 'spent' },
    isInterrupted: () => false,
    seed: [],
    spawn: () => Promise.resolve({ exitCode: 0, stdout: STOP_DECISION }),
    mode: () => mode,
  };
  setActiveOutput(sinkOutput({}));
  bindEventsFile(project.root, SESSION_ID);
  try {
    await createRunDecisions(options).atStop(heldStop(trackerPath));
  } catch (error) {
    if (error instanceof LoopEnd) return error.exitCode;
    throw error;
  } finally {
    unbindEventsFile();
    setActiveOutput(null);
  }
  throw new Error('the held stop did not end the run');
}

/** The names of the events in `file`, in order. */
function namesIn(file: string): readonly string[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => (JSON.parse(line) as { readonly name: string }).name);
}

describe('rafa loop wait, a held stop a --continue decision ends (#1672)', () => {
  it.each([
    ['decided stop by the session', 'text', DECISION_STOP_EXIT, 'decision'],
    ['needing a decision under --output=json', 'json', DECISION_NEEDED_EXIT, 'decision-needed'],
  ] as const)('answers the run %s on its halt: the held reason once, and the halt\'s exit code', async (_path, mode, runExit, opening) => {
    const project = plantDemoProject(tempBase);
    plantSession(project.root, sessionRecord());

    expect(await decidedHeldRun(project, mode)).toBe(runExit);
    expect(namesIn(eventsFilePath(project.root, SESSION_ID))).toEqual([opening, 'task-blocked', 'halt']);

    const run = await wait(project, [], clocked({ isAlive: () => false }).seams);

    expect(run.stdout).toBe(`rafa· halt             ${HELD_TEXT}: Second task\n`);
    expect(run.stdout.split(HELD_TEXT)).toHaveLength(2);
    expect([run.exitCode, run.stderr]).toEqual([exitOf('halt'), '']);
    expect(readLoopEnding(project.root, SESSION_ID)).toEqual({ kind: 'halt', reason: `${HELD_TEXT}: Second task` });
  });
});

describe('rafa loop wait --help', () => {
  it('lists every reason with its exit code, the timeout and no-session codes, and the macOS gap', () => {
    const { description } = createLoopWaitCommand();

    for (const row of WAIT_REASONS) expect(description).toContain(`exits ${String(row.exit)}`);
    expect(description).toContain('`quiet:<minutes>`');
    expect(description).toContain('`--timeout` reached exits 16');
    expect(description).toContain('a session it cannot find exits 2');
    expect(description).toContain('on macOS the clock keeps counting through sleep');
    expect(createLoopWaitCommand().spends).toBeUndefined();
  });
});
