/**
 * Tests for the session records of `loop start` (`loop/sessions.ts`).
 *
 * Every record is read from and written under this file's own temporary
 * directory, one fresh project root per case that writes, and every
 * liveness a case depends on goes through the `isAlive` seam. The
 * `isPidAlive` cases alone signal real processes: this one, which exists;
 * a child that has exited, which does not; and pid 1, which exists under
 * another user unless the suite runs as root. Pids 0 and below are refused
 * before any signal.
 *
 * Each refusal sits beside a control differing only in what it refuses: a
 * live record of the plan beside the same record with its pid gone, a
 * record on another branch beside the same record on the run's branch,
 * and a change that would make a record unreadable beside the file it
 * leaves as it was.
 */
import type { SessionDraft, SessionRecord, SessionState } from './sessions.js';

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import {
  beginSession,
  errorCode,
  isPidAlive,
  isSessionId,
  parseSessionRecord,
  readSessions,
  readState,
  runsDir,
  samePlan,
  SESSION_STATES,
  SessionConflictError,
  sessionConflicts,
  sessionFilePath,
  SessionRecordError,
  updateSession,
} from './sessions.js';

/** This file's scratch directory. */
const tempRoot = mkdtempSync(join(tmpdir(), 'rafa-loop-sessions-'));

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

/** A pid probe answering every pid alive. */
const ALIVE = (): boolean => true;

/** A pid probe answering every pid gone. */
const GONE = (): boolean => false;

/** The id of the record most cases read. */
const ID = 'session-0001';

/** The path a parse case names as the file it read. */
const FILE = `/nowhere/.rafa/runs/${ID}.json`;

/** A record of the `demo` plan on `feat/demo`, with `overrides` laid over it. */
function record(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    sessionId: ID,
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

/** A draft of the `demo` plan on `feat/demo`, with `overrides` laid over it. */
function draft(overrides: Partial<SessionDraft> = {}): SessionDraft {
  return {
    sessionId: 'session-0100',
    planStub: 'demo',
    plan: '.plans/PLAN-demo.md',
    branch: 'feat/demo',
    pid: 4343,
    startedAt: '2026-09-15T11:00:00.000Z',
    ...overrides,
  };
}

/** Writes `text` as `<root>/.rafa/runs/<name>` and answers its path. */
function plantFile(root: string, name: string, text: string): string {
  mkdirSync(runsDir(root), { recursive: true });
  const file = join(runsDir(root), name);
  writeFileSync(file, text);
  return file;
}

/** Writes a record as its own id's file and answers its path. */
function plantRecord(root: string, value: SessionRecord): string {
  return plantFile(root, `${value.sessionId}.json`, JSON.stringify(value, null, 2));
}

/** The text of the default record with one field replaced, or left out when `value` is undefined. */
function textWith(key: string, value: unknown): string {
  const fields = Object.fromEntries(Object.entries(record()).filter(([name]) => name !== key));
  return JSON.stringify(value === undefined
    ? fields
    : { ...fields, [key]: value });
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

describe('parseSessionRecord', () => {
  it('reads a record back as the module writes one, frozen', () => {
    const written = record({ planStub: null, plan: 'PLAN.md', state: 'paused', task: { line: 3, text: 'A task' } });

    const read = parseSessionRecord(`${JSON.stringify(written, null, 2)}\n`, FILE);

    expect(read).toEqual(written);
    expect(Object.isFrozen(read)).toBe(true);
    expect(Object.isFrozen(read.task)).toBe(true);
  });

  const refusals: readonly (readonly [string, string, string])[] = [
    ['text that is no JSON', '{', 'holds no JSON: '],
    ['a JSON array', '[]', 'holds no JSON object'],
    ['a JSON null', 'null', 'holds no JSON object'],
    ['a missing branch', textWith('branch', undefined), 'branch is missing, expected a non-empty string'],
    ['a blank plan', textWith('plan', '  '), 'plan is "  ", expected a non-empty string'],
    ['a state outside the set', textWith('state', 'finished'), 'state is "finished", expected one of running, paused, stopped, done'],
    ['pid 0', textWith('pid', 0), 'pid is 0, expected a whole number from 1'],
    ['a negative pid', textWith('pid', -1), 'pid is -1, expected a whole number from 1'],
    ['a fractional pid', textWith('pid', 1.5), 'pid is 1.5, expected a whole number from 1'],
    ['a pid written as text', textWith('pid', '4242'), 'pid is "4242", expected a whole number from 1'],
    ['an unparsable start', textWith('startedAt', 'yesterday'), 'startedAt is "yesterday", expected a timestamp'],
    ['a session id holding a separator', textWith('sessionId', '../escape'), 'sessionId is "../escape", expected a plain file name'],
    ['a session id other than the file name', textWith('sessionId', 'session-0002'), 'sessionId "session-0002" is not the file\'s name'],
    ['a stub no stamp can carry', textWith('planStub', 'has space'), 'planStub is "has space", expected null or a plan stub'],
    ['a task that is text', textWith('task', 'x'), 'task is "x", expected null or an object'],
    ['a task on line 0', textWith('task', { line: 0, text: 'x' }), 'task.line is 0, expected a whole number from 1'],
    ['a task with no text', textWith('task', { line: 1, text: '' }), 'task.text is "", expected a non-empty string'],
  ];

  it.each(refusals)('refuses %s, naming the file', (_label, text, problem) => {
    const error = thrownBy(() => parseSessionRecord(text, FILE));

    expect(error).toBeInstanceOf(SessionRecordError);
    expect((error as SessionRecordError).file).toBe(FILE);
    expect((error as SessionRecordError).message).toStartWith(`session record ${FILE}: `);
    expect((error as SessionRecordError).message).toContain(problem);
  });

  it('names every problem of one record in one refusal', () => {
    const text = JSON.stringify({ ...record(), pid: 0, state: 'gone' });

    const { message } = thrownBy(() => parseSessionRecord(text, FILE)) as SessionRecordError;

    expect(message).toBe(`session record ${FILE}: pid is 0, expected a whole number from 1;`
      + ' state is "gone", expected one of running, paused, stopped, done');
  });
});

describe('isSessionId and sessionFilePath', () => {
  it('accepts a uuid and refuses a separator, a leading dot and a blank', () => {
    expect(isSessionId('9185b41c-65f7-4dd6-a0c1-6494c4028f0f')).toBe(true);
    expect(['../x', 'a/b', '.hidden', '', ' '].map(isSessionId)).toEqual([false, false, false, false, false]);
  });

  it('resolves every path under the root it is handed', () => {
    const root = freshRoot();

    expect(runsDir(root)).toBe(join(root, '.rafa', 'runs'));
    expect(sessionFilePath(root, ID)).toBe(join(root, '.rafa', 'runs', `${ID}.json`));
    expect(sessionFilePath(root, ID).startsWith(tempRoot)).toBe(true);
    expect(() => sessionFilePath(root, '../escape')).toThrow('session record: unusable session id "../escape"');
  });
});

describe('isPidAlive', () => {
  it('answers true for this process and false for a child that has exited', () => {
    const child = spawnSync('/usr/bin/true');

    expect(isPidAlive(process.pid)).toBe(true);
    expect(isPidAlive(child.pid)).toBe(false);
  });

  it('answers true for pid 1, a process this user may not signal', () => {
    expect(isPidAlive(1)).toBe(true);
  });

  it('answers false for a pid naming a process group or no process, and signals nothing', () => {
    expect([0, -1, 1.5, Number.NaN].map(isPidAlive)).toEqual([false, false, false, false]);
  });
});

describe('errorCode', () => {
  it('reads the code a system error carries, and null for any other thrown value', () => {
    const missing = thrownBy(() => readFileSync(join(tempRoot, 'no-such-file')));

    expect(errorCode(missing)).toBe('ENOENT');
    expect([new Error('plain'), 'text', null, { code: 7 }].map(errorCode)).toEqual([null, null, null, null]);
  });
});

describe('readState', () => {
  const readings: readonly (readonly [SessionState, boolean, SessionState])[] = [
    ['running', true, 'running'],
    ['running', false, 'stopped'],
    ['paused', true, 'paused'],
    ['paused', false, 'stopped'],
    ['stopped', true, 'stopped'],
    ['stopped', false, 'stopped'],
    ['done', true, 'done'],
    ['done', false, 'done'],
  ];

  it.each(readings)('reads %s with its pid alive %p as %s', (stored, alive, expected) => {
    const probed: number[] = [];
    const probe = (pid: number): boolean => {
      probed.push(pid);
      return alive;
    };

    expect(readState(record({ state: stored }), probe)).toBe(expected);
    expect(probed).toEqual(stored === 'running' || stored === 'paused'
      ? [4242]
      : []);
  });

  it('holds the four states of the spec, in its order', () => {
    expect(SESSION_STATES).toEqual(['running', 'paused', 'stopped', 'done']);
  });
});

describe('readSessions', () => {
  it('answers no record, and creates nothing, when the runs directory does not exist', () => {
    const root = freshRoot();

    expect(readSessions(root, { isAlive: ALIVE })).toEqual([]);
    expect(existsSync(join(root, '.rafa'))).toBe(false);
  });

  it('reads each .json record oldest first, with the state it reads as, and no other file', () => {
    const root = freshRoot();
    plantRecord(root, record({ sessionId: 'a', startedAt: '2026-09-15T10:01:00.000Z', pid: 7 }));
    plantRecord(root, record({ sessionId: 'b', startedAt: '2026-09-15T10:02:00.000Z', pid: 1 }));
    plantRecord(root, record({ sessionId: 'c', startedAt: '2026-09-15T10:00:00.000Z', state: 'done' }));
    plantFile(root, 'notes.txt', 'not a record');
    plantFile(root, 'd.json.99.tmp', '{');

    const read = readSessions(root, { isAlive: (pid) => pid === 1 });

    expect(read.map((session) => [session.sessionId, session.state])).toEqual([
      ['c', 'done'],
      ['a', 'stopped'],
      ['b', 'running'],
    ]);
    expect(readFileSync(sessionFilePath(root, 'a'), 'utf8')).toContain('"state": "running"');
  });

  it('orders records started at the same moment by id', () => {
    const root = freshRoot();
    plantRecord(root, record({ sessionId: 'z' }));
    plantRecord(root, record({ sessionId: 'm' }));

    expect(readSessions(root, { isAlive: ALIVE }).map((session) => session.sessionId)).toEqual(['m', 'z']);
  });

  it('refuses a file holding no record, naming it', () => {
    const root = freshRoot();
    plantRecord(root, record());
    const broken = plantFile(root, 'broken.json', '{');

    const error = thrownBy(() => readSessions(root, { isAlive: ALIVE }));

    expect(error).toBeInstanceOf(SessionRecordError);
    expect((error as SessionRecordError).file).toBe(broken);
  });

  it('refuses a directory named as a record', () => {
    const root = freshRoot();
    mkdirSync(join(runsDir(root), 'folder.json'), { recursive: true });

    const error = thrownBy(() => readSessions(root, { isAlive: ALIVE }));

    expect(error).toBeInstanceOf(SessionRecordError);
    expect((error as SessionRecordError).message).toContain('folder.json: cannot be read: ');
  });
});

describe('samePlan', () => {
  const pairs: readonly (readonly [string, string | null, string, string | null, string, boolean])[] = [
    ['one stub at two paths', 'demo', '.plans/PLAN-demo.md', 'demo', '.rafa/plans/PLAN-demo.md', true],
    ['two stubs', 'demo', '.plans/PLAN-demo.md', 'other', '.plans/PLAN-demo.md', false],
    ['a stub and none', 'demo', 'PLAN.md', null, 'PLAN.md', false],
    ['no stub at one path', null, 'PLAN.md', null, 'PLAN.md', true],
    ['no stub at two paths', null, 'PLAN.md', null, '.rafa/plans/PLAN.md', false],
  ];

  it.each(pairs)('answers %s', (_label, stubA, planA, stubB, planB, same) => {
    expect(samePlan({ planStub: stubA, plan: planA }, { planStub: stubB, plan: planB })).toBe(same);
    expect(samePlan({ planStub: stubB, plan: planB }, { planStub: stubA, plan: planA })).toBe(same);
  });
});

describe('sessionConflicts', () => {
  const candidate = { planStub: 'demo', plan: '.plans/PLAN-demo.md', branch: 'feat/demo' };

  it.each([...SESSION_STATES])('refuses over a record of the plan on another branch reading %s', (state) => {
    const other = record({ branch: 'feat/old', state });

    expect(sessionConflicts([other], candidate)).toEqual([{ reason: 'branch', record: other }]);
  });

  it.each<SessionState>(['running', 'paused'])('refuses over a record of the plan on its branch reading %s', (state) => {
    const live = record({ state });

    expect(sessionConflicts([live], candidate)).toEqual([{ reason: 'live', record: live }]);
  });

  it.each<SessionState>(['stopped', 'done'])('lets a run through over a record of the plan on its branch reading %s', (state) => {
    expect(sessionConflicts([record({ state })], candidate)).toEqual([]);
  });

  it('lets a run through over records of other plans, whatever their branch and state', () => {
    const others = [record({ planStub: 'other', branch: 'feat/old' }), record({ planStub: 'other' })];

    expect(sessionConflicts(others, candidate)).toEqual([]);
  });

  it('answers every conflict in the order handed in', () => {
    const records = [record({ sessionId: 'x', branch: 'feat/old', state: 'done' }), record({ sessionId: 'y' })];

    expect(sessionConflicts(records, candidate).map((conflict) => conflict.reason)).toEqual(['branch', 'live']);
  });
});

describe('beginSession', () => {
  it('writes a running record with no task, whole, creating the runs directory, and answers it', () => {
    const root = freshRoot();

    const begun = beginSession(root, draft(), { isAlive: ALIVE });

    const expected = { ...draft(), state: 'running', task: null };
    expect(begun).toEqual(expected as SessionRecord);
    expect(readdirSync(runsDir(root))).toEqual(['session-0100.json']);
    expect(readFileSync(sessionFilePath(root, 'session-0100'), 'utf8')).toBe(`${JSON.stringify(expected, null, 2)}\n`);
  });

  it('refuses a run a live record of its plan refuses, and writes nothing', () => {
    const root = freshRoot();
    const live = record();
    plantRecord(root, live);

    const error = thrownBy(() => beginSession(root, draft(), { isAlive: ALIVE }));

    expect(error).toBeInstanceOf(SessionConflictError);
    expect((error as SessionConflictError).conflicts).toEqual([{ reason: 'live', record: live }]);
    expect((error as SessionConflictError).message).toBe('the plan\'s sessions refuse the run: session-0001 (live)');
    expect(readdirSync(runsDir(root))).toEqual([`${ID}.json`]);
  });

  it('lets the same run through once the pid of that record is gone', () => {
    const root = freshRoot();
    plantRecord(root, record());

    beginSession(root, draft(), { isAlive: GONE });

    expect(readdirSync(runsDir(root)).sort()).toEqual([`${ID}.json`, 'session-0100.json']);
  });

  it('refuses a run on another branch over a record of the plan that is done', () => {
    const root = freshRoot();
    plantRecord(root, record({ state: 'done' }));

    const error = thrownBy(() => beginSession(root, draft({ branch: 'feat/new' }), { isAlive: GONE }));

    expect((error as SessionConflictError).conflicts.map((conflict) => conflict.reason)).toEqual(['branch']);
    expect(readdirSync(runsDir(root))).toEqual([`${ID}.json`]);
  });

  it('never overwrites a record under the same id, and leaves no temporary file', () => {
    const root = freshRoot();
    const planted = plantRecord(root, record({ sessionId: 'session-0100', planStub: 'other', state: 'done' }));
    const before = readFileSync(planted, 'utf8');

    const error = thrownBy(() => beginSession(root, draft(), { isAlive: ALIVE }));

    expect(errorCode(error)).toBe('EEXIST');
    expect(readFileSync(planted, 'utf8')).toBe(before);
    expect(readdirSync(runsDir(root))).toEqual(['session-0100.json']);
  });

  it('refuses a draft it could not read back before touching the disk', () => {
    const root = freshRoot();

    const error = thrownBy(() => beginSession(root, draft({ pid: 0 }), { isAlive: ALIVE }));

    expect(error).toBeInstanceOf(SessionRecordError);
    expect((error as SessionRecordError).message).toContain('not written: pid is 0');
    expect(existsSync(join(root, '.rafa'))).toBe(false);
  });

  it('refuses an id naming a path outside the runs directory as no record problem', () => {
    const root = freshRoot();

    const error = thrownBy(() => beginSession(root, draft({ sessionId: '../escape' }), { isAlive: ALIVE }));

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(SessionRecordError);
    expect(existsSync(join(root, '.rafa'))).toBe(false);
  });
});

describe('updateSession', () => {
  it('keeps a state another process wrote while writing the task', () => {
    const root = freshRoot();
    plantRecord(root, record({ state: 'paused' }));

    const updated = updateSession(root, ID, { task: { line: 5, text: 'The next task' } });

    expect(updated).toEqual(record({ state: 'paused', task: { line: 5, text: 'The next task' } }));
    expect(parseSessionRecord(readFileSync(sessionFilePath(root, ID), 'utf8'), sessionFilePath(root, ID))).toEqual(updated);
  });

  it('keeps the task while writing the state, and clears it when handed null', () => {
    const root = freshRoot();
    plantRecord(root, record({ task: { line: 2, text: 'A task' } }));

    expect(updateSession(root, ID, { state: 'stopped' }).task).toEqual({ line: 2, text: 'A task' });
    expect(updateSession(root, ID, { task: null })).toEqual(record({ state: 'stopped', task: null }));
  });

  it('refuses a record that is gone', () => {
    const root = freshRoot();

    const error = thrownBy(() => updateSession(root, ID, { state: 'done' }));

    expect(error).toBeInstanceOf(SessionRecordError);
    expect((error as SessionRecordError).message).toContain('cannot be read: ');
  });

  it('refuses a change that would make the record unreadable, leaving the file as it was', () => {
    const root = freshRoot();
    const file = plantRecord(root, record());
    const before = readFileSync(file, 'utf8');

    const error = thrownBy(() => updateSession(root, ID, { task: { line: 0, text: 'x' } }));

    expect((error as SessionRecordError).message).toContain('not written: task.line is 0');
    expect(readFileSync(file, 'utf8')).toBe(before);
    expect(readdirSync(runsDir(root))).toEqual([`${ID}.json`]);
  });
});
