/**
 * Tests for the optional `decisions` field of a session record
 * (`loop/sessions.ts`): the pass-over list a `--continue` run saves,
 * written by `updateSession` when a change hands one, last and after
 * `steps`, kept by every other change, dropped when the list handed is
 * empty, read back by `parseSessionRecord`, and refused on read when an
 * entry is not one.
 *
 * The key's absence is asserted with `Object.keys` and on the file's
 * text, since bun's `toEqual` reads a key set to undefined as a key left
 * out. Each refusal sits beside a control: the same record holding a
 * well-formed list is read.
 */
import type { SessionDecision, SessionDraft, SessionRecord } from './sessions.js';

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import {
  beginSession,
  parseSessionRecord,
  readSession,
  SessionRecordError,
  sessionDecisions,
  sessionFilePath,
  updateSession,
} from './sessions.js';

/** This file's scratch directory. */
const tempRoot = mkdtempSync(join(tmpdir(), 'rafa-loop-sessions-decisions-'));

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

/** The id every case's record carries. */
const ID = 'session-0900';

/** The path a parse case names as the file it read. */
const FILE = `/nowhere/.rafa/runs/${ID}.json`;

/** The keys a plain record holds, in the order it is written. */
const PLAIN_KEYS = ['sessionId', 'planStub', 'plan', 'branch', 'pid', 'startedAt', 'state', 'task'];

/** A jump and a defer, as a pass-over list saves them. */
const JUMP: SessionDecision = {
  task: { lineNum: 3, task: 'Gate on .env.local' },
  strategy: 'jump',
  reason: 'A person writes .env.local.',
};
const DEFER: SessionDecision = {
  task: { lineNum: 5, task: 'Use the helper' },
  strategy: 'defer',
  reason: 'Needs the helper.',
  after: { lineNum: 4, task: 'Write the helper' },
};

/** A step, so a case can hold `decisions` after `steps`. */
const STEP = {
  kind: 'baseline' as const,
  scope: 'full' as const,
  command: ['bun', 'test'],
  exitCode: 0,
  summary: null,
  failures: [],
  newFailures: [],
};

/** The draft of a `demo` run on `feat/demo`. */
function draft(): SessionDraft {
  return {
    sessionId: ID,
    planStub: 'demo',
    plan: '.rafa/plans/PLAN-demo.md',
    branch: 'feat/demo',
    pid: 4242,
    startedAt: '2026-10-08T11:00:00.000Z',
  };
}

/** A stored record of the `demo` run, with `extra` laid over it, as the file's text. */
function recordText(extra: Record<string, unknown> = {}): string {
  const record: SessionRecord = { ...draft(), state: 'running', task: null };
  return JSON.stringify({ ...record, ...extra });
}

describe('updateSession and the decisions field', () => {
  it('writes no decisions key until a change hands a list', () => {
    const root = freshRoot();
    beginSession(root, draft(), { isAlive: ALIVE });

    const changed = updateSession(root, ID, { state: 'stopped' });

    expect(Object.keys(changed)).toEqual(PLAIN_KEYS);
    expect(readFileSync(sessionFilePath(root, ID), 'utf8')).not.toContain('"decisions"');
    expect(sessionDecisions(changed)).toEqual([]);
  });

  it('writes the list last, after steps, and reads it back', () => {
    const root = freshRoot();
    beginSession(root, draft(), { isAlive: ALIVE });
    updateSession(root, ID, { appendStep: STEP });

    const changed = updateSession(root, ID, { decisions: [JUMP, DEFER] });
    const stored = readSession(root, ID, { isAlive: ALIVE });

    expect(Object.keys(changed)).toEqual([...PLAIN_KEYS, 'steps', 'decisions']);
    expect(sessionDecisions(stored)).toEqual([JUMP, DEFER]);
    expect(Object.isFrozen(stored.decisions)).toBe(true);
  });

  it('keeps the stored list through a change of task, phase and state', () => {
    const root = freshRoot();
    beginSession(root, draft(), { isAlive: ALIVE });
    updateSession(root, ID, { decisions: [JUMP] });

    updateSession(root, ID, { task: { line: 5, text: 'Write the helper' }, phase: 'task' });
    const ended = updateSession(root, ID, { state: 'stopped' });

    expect(sessionDecisions(ended)).toEqual([JUMP]);
  });

  it('replaces the stored list whole, and drops the key for an empty one', () => {
    const root = freshRoot();
    beginSession(root, draft(), { isAlive: ALIVE });
    updateSession(root, ID, { decisions: [JUMP, DEFER] });

    expect(sessionDecisions(updateSession(root, ID, { decisions: [DEFER] }))).toEqual([DEFER]);

    const emptied = updateSession(root, ID, { decisions: [] });

    expect(Object.keys(emptied)).toEqual(PLAIN_KEYS);
    expect(readFileSync(sessionFilePath(root, ID), 'utf8')).not.toContain('"decisions"');
  });

  it('refuses a list holding an entry that is not one, writing nothing', () => {
    const root = freshRoot();
    beginSession(root, draft(), { isAlive: ALIVE });
    updateSession(root, ID, { decisions: [JUMP] });
    const bad = { ...JUMP, strategy: 'retry' } as unknown as SessionDecision;

    expect(() => updateSession(root, ID, { decisions: [bad] })).toThrow('decisions[0].strategy is "retry", expected one of jump, defer');
    expect(sessionDecisions(readSession(root, ID, { isAlive: ALIVE }))).toEqual([JUMP]);
  });
});

describe('parseSessionRecord and the decisions field', () => {
  it('reads a record with no decisions key as holding none, and a well-formed list in the field', () => {
    expect(Object.keys(parseSessionRecord(recordText(), FILE))).toEqual(PLAIN_KEYS);
    expect(sessionDecisions(parseSessionRecord(recordText({ decisions: [JUMP, DEFER] }), FILE))).toEqual([JUMP, DEFER]);
  });

  it('reads a stored empty list as none, written back without the key', () => {
    expect(Object.keys(parseSessionRecord(recordText({ decisions: [] }), FILE))).toEqual(PLAIN_KEYS);
  });

  it('keeps a task\'s ordinal, the copy of its text it names, and reads one saved without it as it was', () => {
    const second = { ...JUMP, task: { lineNum: 9, task: 'Run the suite', ordinal: 2 } };

    expect(sessionDecisions(parseSessionRecord(recordText({ decisions: [second, JUMP] }), FILE))).toEqual([second, JUMP]);
    expect(sessionDecisions(parseSessionRecord(recordText({ decisions: [JUMP] }), FILE))[0]?.task).toEqual({ lineNum: 3, task: 'Gate on .env.local' });
  });

  it('keeps line 0, the tracker\'s first line', () => {
    const first = { ...JUMP, task: { lineNum: 0, task: 'First' } };

    expect(sessionDecisions(parseSessionRecord(recordText({ decisions: [first] }), FILE))).toEqual([first]);
  });

  it.each([
    ['null', null, 'decisions is null, expected a list of decisions'],
    ['a mapping', { strategy: 'jump' }, 'decisions is {"strategy":"jump"}, expected a list of decisions'],
    ['an entry that is no object', ['jump'], 'decisions[0] is "jump", expected a decision'],
    ['an unknown strategy', [{ ...JUMP, strategy: 'stop' }], 'decisions[0].strategy is "stop", expected one of jump, defer'],
    ['a blank reason', [{ ...JUMP, reason: ' ' }], 'decisions[0].reason is " ", expected a non-empty string'],
    ['a task with no text', [{ ...JUMP, task: { lineNum: 3, task: '' } }], 'decisions[0].task.task is "", expected a non-empty string'],
    ['a negative line', [{ ...JUMP, task: { lineNum: -1, task: 'x' } }], 'decisions[0].task.lineNum is -1, expected a whole number from 0'],
    ['a fractional line', [{ ...JUMP, task: { lineNum: 1.5, task: 'x' } }], 'decisions[0].task.lineNum is 1.5, expected a whole number from 0'],
    ['a defer with no after', [{ ...DEFER, after: undefined }], 'decisions[0].after is missing, expected the task a defer waits on'],
    ['a jump with an after', [{ ...JUMP, after: DEFER.after }], 'decisions[0].after is {"lineNum":4,"task":"Write the helper"}, expected no key on a jump'],
    ['an after with no line', [{ ...DEFER, after: { task: 'x' } }], 'decisions[0].after.lineNum is missing, expected a whole number from 0'],
    ['an ordinal of 0', [{ ...JUMP, task: { lineNum: 3, task: 'x', ordinal: 0 } }], 'decisions[0].task.ordinal is 0, expected a whole number from 1'],
    ['a quoted ordinal', [{ ...DEFER, after: { lineNum: 4, task: 'x', ordinal: '2' } }], 'decisions[0].after.ordinal is "2", expected a whole number from 1'],
  ])('refuses a decisions key holding %s, naming the field', (_label, decisions, problem) => {
    const read = (): SessionRecord => parseSessionRecord(recordText({ decisions }), FILE);

    expect(read).toThrow(SessionRecordError);
    expect(read).toThrow(problem);
  });
});
