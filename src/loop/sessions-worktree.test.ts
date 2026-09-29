/**
 * Tests for the optional `worktree` field of a session record
 * (`loop/sessions.ts`): written by `beginSession` only when the draft
 * carries one, last and after `hop`, kept by `updateSession`, read back by
 * `parseSessionRecord`, and refused on read when its value is no absolute
 * path.
 *
 * The key's absence is asserted with `Object.keys` and on the file's text,
 * since bun's `toEqual` reads a key set to undefined as a key left out.
 * Each refusal sits beside a control: the same record with an absolute
 * path in the field is read.
 */
import type { SessionDraft, SessionRecord } from './sessions.js';

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
  sessionFilePath,
  updateSession,
} from './sessions.js';

/** This file's scratch directory. */
const tempRoot = mkdtempSync(join(tmpdir(), 'rafa-loop-sessions-worktree-'));

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
const ID = 'session-0370';

/** The path a parse case names as the file it read. */
const FILE = `/nowhere/.rafa/runs/${ID}.json`;

/** The worktree every case that carries one names. */
const WORKTREE = '/work/project/.rafa/worktrees/demo';

/** The keys a record without a hop or a worktree holds, in the order it is written. */
const PLAIN_KEYS = ['sessionId', 'planStub', 'plan', 'branch', 'pid', 'startedAt', 'state', 'task'];

/** The draft of a `demo` run on `feat/demo`, with `overrides` laid over it. */
function draft(overrides: Partial<SessionDraft> = {}): SessionDraft {
  return {
    sessionId: ID,
    planStub: 'demo',
    plan: '.rafa/plans/PLAN-demo.md',
    branch: 'feat/demo',
    pid: 4242,
    startedAt: '2026-09-29T11:00:00.000Z',
    ...overrides,
  };
}

/** A stored record of the `demo` run, with `extra` laid over it, as the file's text. */
function recordText(extra: Record<string, unknown> = {}): string {
  const record: SessionRecord = { ...draft(), state: 'running', task: null };
  return JSON.stringify({ ...record, ...extra });
}

describe('beginSession and the worktree field', () => {
  it('writes no worktree key for a draft that carries none, in the file or the record answered', () => {
    const root = freshRoot();

    const record = beginSession(root, draft(), { isAlive: ALIVE });
    const text = readFileSync(sessionFilePath(root, ID), 'utf8');

    expect(Object.keys(record)).toEqual(PLAIN_KEYS);
    expect(Object.keys(JSON.parse(text) as object)).toEqual(PLAIN_KEYS);
    expect(text).not.toContain('"worktree"');
  });

  it('writes the worktree last for a draft that carries one, and reads it back', () => {
    const root = freshRoot();

    const record = beginSession(root, draft({ worktree: WORKTREE }), { isAlive: ALIVE });
    const stored = readSession(root, ID, { isAlive: ALIVE });

    expect(Object.keys(record)).toEqual([...PLAIN_KEYS, 'worktree']);
    expect(record.worktree).toBe(WORKTREE);
    expect(stored.worktree).toBe(WORKTREE);
    expect(JSON.parse(readFileSync(sessionFilePath(root, ID), 'utf8'))).toMatchObject({ worktree: WORKTREE });
  });

  it('refuses a draft whose worktree is a relative path, writing nothing', () => {
    const root = freshRoot();

    const begin = (): SessionRecord => beginSession(root, draft({ worktree: '.rafa/worktrees/demo' }), { isAlive: ALIVE });

    expect(begin).toThrow('worktree is ".rafa/worktrees/demo", expected an absolute path');
    expect(() => readFileSync(sessionFilePath(root, ID), 'utf8')).toThrow('ENOENT');
  });
});

describe('updateSession and the worktree field', () => {
  it('keeps the stored worktree through a change of task and state', () => {
    const root = freshRoot();
    beginSession(root, draft({ worktree: WORKTREE }), { isAlive: ALIVE });

    updateSession(root, ID, { task: { line: 3, text: 'the third task' } });
    const ended = updateSession(root, ID, { state: 'done', task: null });

    expect(ended.worktree).toBe(WORKTREE);
    expect(readSession(root, ID, { isAlive: ALIVE }).worktree).toBe(WORKTREE);
  });

  it('adds no worktree key to a record that had none', () => {
    const root = freshRoot();
    beginSession(root, draft(), { isAlive: ALIVE });

    const ended = updateSession(root, ID, { state: 'done' });

    expect(Object.keys(ended)).toEqual(PLAIN_KEYS);
  });
});

describe('parseSessionRecord and the worktree field', () => {
  it('reads a record with no worktree key as one without the key, and an absolute path in the field', () => {
    expect(Object.keys(parseSessionRecord(recordText(), FILE))).toEqual(PLAIN_KEYS);
    expect(parseSessionRecord(recordText({ worktree: WORKTREE }), FILE).worktree).toBe(WORKTREE);
  });

  it.each([
    ['null', null, 'worktree is null, expected an absolute path'],
    ['an empty string', '', 'worktree is "", expected an absolute path'],
    ['a relative path', 'worktrees/demo', 'worktree is "worktrees/demo", expected an absolute path'],
    ['a number', 7, 'worktree is 7, expected an absolute path'],
  ])('refuses a worktree key holding %s, naming the field', (_label, worktree, problem) => {
    const read = (): SessionRecord => parseSessionRecord(recordText({ worktree }), FILE);

    expect(read).toThrow(SessionRecordError);
    expect(read).toThrow(problem);
  });
});
