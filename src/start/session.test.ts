/**
 * Tests for the session record `loop start` opens and writes to
 * (`start/session.ts`).
 *
 * {@link openRunSession} is driven over a fresh project root under this
 * file's temporary directory per case, with the id, the pid, the clock and
 * the liveness of every record handed in, so no case reads a real process.
 * The record is read back through `readSessions`, and the lines through a
 * sink output set for the case and unset after it.
 *
 * Each refusal sits beside a control: the live record refusing the run
 * beside the same record with its pid gone, and an unreadable record beside
 * the same root with the file removed. A change that cannot be written is
 * read beside the same change written.
 *
 * `start()` calling the session, and the record moving through a spawned
 * `loop start`, is reached by no case here. The close-out of this task
 * records that reading, taken by spawning `loop start` in scratch
 * repositories under a stand-in `claude`.
 */
import type { RunSessionOptions } from './session.js';
import type { SessionRecord } from '../loop/sessions.js';

import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '../adapters/output/active.js';
import { CommandExit } from '../cli/command.js';
import { readSessions, runsDir, sessionFilePath } from '../loop/sessions.js';
import { sinkOutput } from '../tests/output-sinks.js';
import { findNextTask } from '../utils/tracker.js';

import { NOTHING_DISPATCHED, openRunSession } from './session.js';

/** This file's scratch directory. */
const tempRoot = mkdtempSync(join(tmpdir(), 'rafa-start-session-'));

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

let roots = 0;

/** A new, empty project root under {@link tempRoot}. */
function freshRoot(): string {
  roots += 1;
  const root = join(tempRoot, `root-${roots}`);
  mkdirSync(root);
  return root;
}

/** The id every opened session is given. */
const ID = 'session-0200';

/** The clock every opened session starts from. */
const CLOCK = new Date('2026-09-15T12:00:00.000Z');

/** A pid probe answering every pid alive. */
const ALIVE = (): boolean => true;

/** A pid probe answering every pid gone. */
const GONE = (): boolean => false;

/** The options opening a session of the `demo` plan on `feat/demo` under `root`. */
function options(root: string, overrides: Partial<RunSessionOptions> = {}): RunSessionOptions {
  return {
    repoRoot: root,
    planPath: join(root, '.plans', 'PLAN-demo.md'),
    planStub: 'demo',
    branch: 'feat/demo',
    seams: { newSessionId: () => ID, pid: 5151, now: () => CLOCK, isAlive: ALIVE },
    ...overrides,
  };
}

/** A record another run of the `demo` plan left, with `overrides` laid over it. */
function otherRecord(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    sessionId: 'session-0001',
    planStub: 'demo',
    plan: '.plans/PLAN-demo.md',
    branch: 'feat/demo',
    pid: 4242,
    startedAt: '2026-09-15T10:00:00.000Z',
    state: 'running',
    task: null,
    ...overrides,
  };
}

/** Writes a record by hand, as another process would, and answers its path. */
function plantRecord(root: string, value: SessionRecord): string {
  mkdirSync(runsDir(root), { recursive: true });
  const file = sessionFilePath(root, value.sessionId);
  writeFileSync(file, JSON.stringify(value, null, 2));
  return file;
}

/** The one record under `root` with the id {@link ID}, as stored. */
function storedRecord(root: string): SessionRecord | undefined {
  return readSessions(root, { isAlive: ALIVE }).find((session) => session.sessionId === ID);
}

/** Runs `run` with a sink output active, and answers each line it wrote as `level:message`. */
function linesOf(run: () => void): string[] {
  const lines: string[] = [];
  setActiveOutput(sinkOutput({
    info: (message) => {
      lines.push(`info:${message}`);
    },
    warn: (message) => {
      lines.push(`warn:${message}`);
    },
    error: (message) => {
      lines.push(`error:${message}`);
    },
  }));
  try {
    run();
  } finally {
    setActiveOutput(null);
  }
  return lines;
}

/** What `run` threw, failing the case when it threw nothing. */
function thrownBy(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error('expected a throw, and nothing was thrown');
}

describe('openRunSession, a run let through', () => {
  it('writes the record under the root it is handed, and prints nothing', () => {
    const root = freshRoot();

    let id = '';
    const lines = linesOf(() => {
      id = openRunSession(options(root)).id;
    });

    expect(id).toBe(ID);
    expect(lines).toEqual([]);
    expect(storedRecord(root)).toEqual({
      sessionId: ID,
      planStub: 'demo',
      plan: join('.plans', 'PLAN-demo.md'),
      branch: 'feat/demo',
      pid: 5151,
      startedAt: '2026-09-15T12:00:00.000Z',
      state: 'running',
      task: null,
    });
    expect(sessionFilePath(root, ID).startsWith(tempRoot)).toBe(true);
  });

  it('names each task by its line from 1 and its sentence alone, and no task once the wrap-up starts', () => {
    const root = freshRoot();
    const tracker = '# Plan: demo\n\n- [x] Done\n- [BLOCKED] Second task  {agent=loop-implementer} <!-- blocked: waiting -->\n';
    const taskInfo = findNextTask(tracker);
    if (taskInfo === null) throw new Error('the tracker holds an open task');
    expect([taskInfo.lineNum, taskInfo.task]).toEqual([3, 'Second task  {agent=loop-implementer}']);

    const session = openRunSession(options(root));
    session.taskStarted(taskInfo);
    const whileRunning = storedRecord(root);
    session.wrapUpStarted();

    expect(whileRunning?.task).toEqual({ line: 4, text: 'Second task' });
    expect(whileRunning?.state).toBe('running');
    expect(storedRecord(root)?.task).toBeNull();
  });

  it('writes stopped at the end of a run that never finished, keeping the task it stopped at', () => {
    const root = freshRoot();
    const session = openRunSession(options(root));
    session.taskStarted({ task: 'A task', lineNum: 0 });

    session.end();

    expect(storedRecord(root)).toMatchObject({ state: 'stopped', task: { line: 1, text: 'A task' } });
  });

  it('writes done at the end of a run that finished', () => {
    const root = freshRoot();
    const session = openRunSession(options(root));
    session.wrapUpStarted();

    session.finished();
    session.end();

    expect(storedRecord(root)).toMatchObject({ state: 'done', task: null });
  });

  it('keeps a paused state another process wrote over its record when it names the next task', () => {
    const root = freshRoot();
    const session = openRunSession(options(root));
    session.taskStarted({ task: 'First', lineNum: 2 });
    const beforePause = storedRecord(root);
    plantRecord(root, { ...otherRecord(), ...beforePause, state: 'paused' });

    session.taskStarted({ task: 'Second', lineNum: 3 });

    expect(beforePause).toMatchObject({ state: 'running', task: { line: 3, text: 'First' } });
    expect(storedRecord(root)).toMatchObject({ state: 'paused', task: { line: 4, text: 'Second' } });
  });
});

describe('openRunSession, a run refused', () => {
  it('refuses a second run of a plan a session is running, naming it, and writes nothing', () => {
    const root = freshRoot();
    plantRecord(root, otherRecord());

    const error = thrownBy(() => openRunSession(options(root)));

    expect(error).toBeInstanceOf(CommandExit);
    expect((error as CommandExit).exitCode).toBe(1);
    expect((error as CommandExit).message).toBe([
      '❌ Refusing to run plan `demo` on `feat/demo`: a session is already running it.',
      '   Session session-0001 is running it on `feat/demo`: running, pid 4242, started 2026-09-15T10:00:00.000Z;'
      + ` its record is ${join('.rafa', 'runs', 'session-0001.json')}.`,
      '   One session runs a plan at a time: let that run end, or interrupt it, then run again.',
      NOTHING_DISPATCHED,
    ].join('\n'));
    expect(readdirSync(runsDir(root))).toEqual(['session-0001.json']);
  });

  it('lets the same run through once the pid of that session is gone', () => {
    const root = freshRoot();
    plantRecord(root, otherRecord());

    openRunSession(options(root, {
      seams: { newSessionId: () => ID, pid: 5151, now: () => CLOCK, isAlive: GONE },
    }));

    expect(readdirSync(runsDir(root)).sort()).toEqual(['session-0001.json', `${ID}.json`]);
  });

  it('names both reasons when the plan has another branch and a session running it', () => {
    const root = freshRoot();
    plantRecord(root, otherRecord({ sessionId: 'session-0000', branch: 'feat/old', state: 'done', startedAt: '2026-09-14T09:00:00.000Z' }));
    plantRecord(root, otherRecord({ state: 'paused' }));

    const { message } = thrownBy(() => openRunSession(options(root))) as CommandExit;

    expect(message.split('\n')).toEqual([
      '❌ Refusing to run plan `demo` on `feat/demo`: it already has a branch, and a session is already running it.',
      '   Session session-0000 ran it on `feat/old`: done, pid 4242, started 2026-09-14T09:00:00.000Z;'
      + ` its record is ${join('.rafa', 'runs', 'session-0000.json')}.`,
      '   Session session-0001 is running it on `feat/demo`: paused, pid 4242, started 2026-09-15T10:00:00.000Z;'
      + ` its record is ${join('.rafa', 'runs', 'session-0001.json')}.`,
      '   A plan runs on one branch: check out that branch to run it there, or revise the plan under a new stub.',
      '   One session runs a plan at a time: let that run end, or interrupt it, then run again.',
      NOTHING_DISPATCHED,
    ]);
  });

  it('names a plan with no stub by its path', () => {
    const root = freshRoot();
    plantRecord(root, otherRecord({ planStub: null, plan: 'PLAN.md', branch: 'feat/old', state: 'stopped' }));

    const { message } = thrownBy(() => openRunSession(options(root, {
      planStub: null,
      planPath: join(root, 'PLAN.md'),
    }))) as CommandExit;

    expect(message.split('\n')[0]).toBe('❌ Refusing to run plan `PLAN.md` on `feat/demo`: it already has a branch.');
  });

  it('refuses when a record cannot be read, naming the file, and runs once it is gone', () => {
    const root = freshRoot();
    const broken = join(runsDir(root), 'broken.json');
    mkdirSync(runsDir(root), { recursive: true });
    writeFileSync(broken, '{');

    const error = thrownBy(() => openRunSession(options(root))) as CommandExit;

    expect(error.exitCode).toBe(1);
    const lines = error.message.split('\n');
    expect(lines[0]).toBe(`❌ Refusing to start: the session records under ${join('.rafa', 'runs')}/ cannot be read or written.`);
    expect(lines[1]).toStartWith(`   session record ${broken}: holds no JSON: `);
    expect(lines.slice(2)).toEqual([NOTHING_DISPATCHED]);
    expect(readdirSync(runsDir(root))).toEqual(['broken.json']);

    rmSync(broken);
    expect(openRunSession(options(root)).id).toBe(ID);
  });

  it('refuses when the record cannot be written, naming the system error', () => {
    const root = freshRoot();
    plantRecord(root, otherRecord({ sessionId: ID, planStub: 'other', state: 'done' }));

    const { exitCode, message } = thrownBy(() => openRunSession(options(root))) as CommandExit;

    expect(exitCode).toBe(1);
    expect(message.split('\n')[1]).toContain('EEXIST');
  });

  it('throws an error that is neither a record problem nor a system one as it was', () => {
    const root = freshRoot();

    const error = thrownBy(() => openRunSession(options(root, {
      seams: { newSessionId: () => '../escape', pid: 5151, now: () => CLOCK, isAlive: ALIVE },
    })));

    expect(error).not.toBeInstanceOf(CommandExit);
    expect((error as Error).message).toBe('session record: unusable session id "../escape"');
  });
});

describe('a change after the open', () => {
  it('warns in one line when the record is gone, throws nothing, and writes it while it is there', () => {
    const root = freshRoot();
    const session = openRunSession(options(root));
    const writtenLines = linesOf(() => session.taskStarted({ task: 'Kept', lineNum: 0 }));
    rmSync(sessionFilePath(root, ID));

    const lines = linesOf(() => {
      session.taskStarted({ task: 'Lost', lineNum: 1 });
      session.end();
    });

    const label = join('.rafa', 'runs', `${ID}.json`);
    expect(writtenLines).toEqual([]);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toStartWith(`warn:\n⚠️  Session ${ID}: the running task was not written to ${label}: session record `);
    expect(lines[1]).toStartWith(`warn:\n⚠️  Session ${ID}: the end of the run was not written to ${label}: session record `);
  });
});
