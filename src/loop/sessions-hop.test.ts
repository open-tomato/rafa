/**
 * Tests for the optional `hop` field of a session record
 * (`loop/sessions.ts`): written by `beginSession` only when the draft
 * carries one, kept by `updateSession`, read back by `parseSessionRecord`,
 * and refused on read when its value is not a hop record.
 *
 * The key's absence is asserted with `Object.keys` and on the file's text,
 * since bun's `toEqual` reads a key set to undefined as a key left out.
 * Each refusal sits beside a control: a record with a hop record in the
 * field is read, the same record with a value that is not one is refused.
 */
import type { SessionDraft, SessionRecord } from './sessions.js';
import type { HopRecord } from '../next/hop-record.js';

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
const tempRoot = mkdtempSync(join(tmpdir(), 'rafa-loop-sessions-hop-'));

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
const ID = 'session-0001';

/** The path a parse case names as the file it read. */
const FILE = `/nowhere/.rafa/runs/${ID}.json`;

/** The keys a record without a hop holds, in the order it is written. */
const PLAIN_KEYS = ['sessionId', 'planStub', 'plan', 'branch', 'pid', 'startedAt', 'state', 'task'];

/** An away hop from epic 11 on board 10 to #118 in epic 21 on board 20. */
const AWAY_HOP: HopRecord = {
  kind: 'blocker',
  home: { board: 10, epic: 11 },
  from: { board: 10, epic: 11 },
  blocked: 210,
  target: 118,
  targetEpic: 21,
  targetBoard: 20,
  state: 'away',
  pullRequest: null,
  startedAt: '2026-09-28T10:00:00.000Z',
};

/** The draft of a `demo` run on `feat/demo`, with `overrides` laid over it. */
function draft(overrides: Partial<SessionDraft> = {}): SessionDraft {
  return {
    sessionId: ID,
    planStub: 'demo',
    plan: '.plans/PLAN-demo.md',
    branch: 'feat/demo',
    pid: 4242,
    startedAt: '2026-09-28T11:00:00.000Z',
    ...overrides,
  };
}

/** A stored record of the `demo` run, with `extra` laid over it, as the file's text. */
function recordText(extra: Record<string, unknown> = {}): string {
  const record: SessionRecord = { ...draft(), state: 'running', task: null };
  return JSON.stringify({ ...record, ...extra });
}

describe('beginSession and the hop field', () => {
  it('writes no hop key for a draft that carries none, in the file or the record answered', () => {
    const root = freshRoot();

    const record = beginSession(root, draft(), { isAlive: ALIVE });

    expect(Object.keys(record)).toEqual(PLAIN_KEYS);
    expect(Object.keys(JSON.parse(readFileSync(sessionFilePath(root, ID), 'utf8')) as object)).toEqual(PLAIN_KEYS);
    expect(readFileSync(sessionFilePath(root, ID), 'utf8')).not.toContain('"hop"');
  });

  it('writes the hop last for a draft that carries one, and reads it back whole', () => {
    const root = freshRoot();

    const record = beginSession(root, draft({ hop: AWAY_HOP }), { isAlive: ALIVE });
    const stored = readSession(root, ID, { isAlive: ALIVE });

    expect(Object.keys(record)).toEqual([...PLAIN_KEYS, 'hop']);
    expect(record.hop).toEqual(AWAY_HOP);
    expect(stored.hop).toEqual(AWAY_HOP);
    expect(Object.keys(stored.hop ?? {})).toEqual(Object.keys(AWAY_HOP));
  });

  it('answers a record frozen through its hop and the hop\'s places', () => {
    const root = freshRoot();

    const record = beginSession(root, draft({ hop: AWAY_HOP }), { isAlive: ALIVE });

    expect(Object.isFrozen(record.hop)).toBe(true);
    expect(Object.isFrozen(record.hop?.home)).toBe(true);
    expect(Object.isFrozen(record.hop?.from)).toBe(true);
  });
});

describe('updateSession and the hop field', () => {
  it('keeps the stored hop through a change of task and state', () => {
    const root = freshRoot();
    beginSession(root, draft({ hop: AWAY_HOP }), { isAlive: ALIVE });

    updateSession(root, ID, { task: { line: 3, text: 'the third task' } });
    const ended = updateSession(root, ID, { state: 'done', task: null });

    expect(ended.hop).toEqual(AWAY_HOP);
    expect(readSession(root, ID, { isAlive: ALIVE }).hop).toEqual(AWAY_HOP);
  });

  it('adds no hop key to a record that had none', () => {
    const root = freshRoot();
    beginSession(root, draft(), { isAlive: ALIVE });

    const ended = updateSession(root, ID, { state: 'done' });

    expect(Object.keys(ended)).toEqual(PLAIN_KEYS);
  });
});

describe('parseSessionRecord and the hop field', () => {
  it('reads a record with no hop key as one without the key', () => {
    expect(Object.keys(parseSessionRecord(recordText(), FILE))).toEqual(PLAIN_KEYS);
  });

  it('reads a hop record in the field, a dry one included', () => {
    const dry: HopRecord = { ...AWAY_HOP, kind: 'dry', blocked: null, target: null };

    expect(parseSessionRecord(recordText({ hop: AWAY_HOP }), FILE).hop).toEqual(AWAY_HOP);
    expect(parseSessionRecord(recordText({ hop: dry }), FILE).hop).toEqual(dry);
  });

  it.each([
    ['null', null, 'hop is null, expected a hop record'],
    ['an empty object', {}, 'hop is {}, expected a hop record'],
    ['a blocker hop with no target', { ...AWAY_HOP, target: null }, 'expected a hop record'],
    ['a hop in a state outside its set', { ...AWAY_HOP, state: 'gone' }, 'expected a hop record'],
  ])('refuses a hop key holding %s, naming the field', (_label, hop, problem) => {
    const read = (): SessionRecord => parseSessionRecord(recordText({ hop }), FILE);

    expect(read).toThrow(SessionRecordError);
    expect(read).toThrow(problem);
  });
});
