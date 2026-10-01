/**
 * Tests for the `phase` field of a session record (`loop/sessions.ts`):
 * a new record opens without one and reads as `task`, `updateSession`
 * writes a change's phase as its own `"phase": "<value>"` key after `task`,
 * keeps it through changes that name none, and a record a rafa older than
 * the field wrote on disk is read and updated as phase `task`.
 *
 * The key's absence is asserted with `Object.keys` and on the file's text,
 * since bun's `toEqual` reads a key set to undefined as a key left out.
 */
import type { SessionDraft, SessionPhase, SessionRecord } from './sessions.js';

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import {
  beginSession,
  readSession,
  readSessions,
  SESSION_PHASES,
  sessionFilePath,
  sessionPhase,
  updateSession,
} from './sessions.js';

/** This file's scratch directory. */
const tempRoot = mkdtempSync(join(tmpdir(), 'rafa-loop-sessions-phase-'));

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
const ID = 'session-0579';

/** The keys a record without a phase, a hop or a worktree holds, in the order it is written. */
const PLAIN_KEYS = ['sessionId', 'planStub', 'plan', 'branch', 'pid', 'startedAt', 'state', 'task'];

/** The draft of a `demo` run on `feat/demo`, with `overrides` laid over it. */
function draft(overrides: Partial<SessionDraft> = {}): SessionDraft {
  return {
    sessionId: ID,
    planStub: 'demo',
    plan: '.rafa/plans/PLAN-demo.md',
    branch: 'feat/demo',
    pid: 4242,
    startedAt: '2026-10-01T09:00:00.000Z',
    ...overrides,
  };
}

/** The text of the record's file under `root`. */
function fileText(root: string): string {
  return readFileSync(sessionFilePath(root, ID), 'utf8');
}

/**
 * Plants the record a rafa older than the `phase` field writes: indented
 * JSON with no `phase` key, `extra` laid over it.
 */
function plantOlderRecord(root: string, extra: Record<string, unknown> = {}): void {
  const record: SessionRecord = { ...draft(), state: 'running', task: { line: 2, text: 'the second task' } };
  const file = sessionFilePath(root, ID);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ ...record, ...extra }, null, 2)}\n`);
}

describe('beginSession and the phase field', () => {
  it('opens a record with no phase key, which reads as task', () => {
    const root = freshRoot();

    const record = beginSession(root, draft(), { isAlive: ALIVE });

    expect(Object.keys(record)).toEqual(PLAIN_KEYS);
    expect(fileText(root)).not.toContain('"phase"');
    expect(sessionPhase(record)).toBe('task');
  });
});

describe('updateSession and the phase field', () => {
  it.each(SESSION_PHASES.map((phase) => [phase]))('writes phase %s as its own key after task, and reads it back', (phase) => {
    const root = freshRoot();
    beginSession(root, draft(), { isAlive: ALIVE });

    const written = updateSession(root, ID, { phase });

    expect(Object.keys(written)).toEqual([...PLAIN_KEYS, 'phase']);
    expect(fileText(root)).toContain(`\n  "phase": "${phase}"\n`);
    expect(readSession(root, ID, { isAlive: ALIVE }).phase).toBe(phase);
  });

  it('keeps the stored phase through changes of task, state and steps that name none', () => {
    const root = freshRoot();
    beginSession(root, draft(), { isAlive: ALIVE });
    updateSession(root, ID, { phase: 'wrap-up' });

    updateSession(root, ID, { task: { line: 4, text: 'the fourth task' } });
    const ended = updateSession(root, ID, { state: 'done', task: null });

    expect(ended.phase).toBe('wrap-up');
    expect(readSession(root, ID, { isAlive: ALIVE }).phase).toBe('wrap-up');
  });

  it('replaces the stored phase with the one a change names', () => {
    const root = freshRoot();
    beginSession(root, draft(), { isAlive: ALIVE });
    updateSession(root, ID, { phase: 'ci' });

    const repaired = updateSession(root, ID, { phase: 'repair' });

    expect(repaired.phase).toBe('repair');
    expect(fileText(root)).not.toContain('"ci"');
  });

  it('adds no phase key to a record that had none when the change names none', () => {
    const root = freshRoot();
    beginSession(root, draft(), { isAlive: ALIVE });

    const ended = updateSession(root, ID, { state: 'done' });

    expect(Object.keys(ended)).toEqual(PLAIN_KEYS);
    expect(fileText(root)).not.toContain('"phase"');
  });
});

describe('a record from a rafa older than the phase field', () => {
  it('reads as phase task through readSession and readSessions', () => {
    const root = freshRoot();
    plantOlderRecord(root);
    expect(fileText(root)).not.toContain('"phase"');

    const one = readSession(root, ID, { isAlive: ALIVE });
    const all = readSessions(root, { isAlive: ALIVE });

    expect(sessionPhase(one)).toBe('task');
    expect(all.map(sessionPhase)).toEqual(['task']);
    expect(one.task).toEqual({ line: 2, text: 'the second task' });
  });

  it('takes a phase from its first update, keeping every field it held', () => {
    const root = freshRoot();
    plantOlderRecord(root);

    const updated = updateSession(root, ID, { phase: 'wrap-up' });

    expect(updated.phase).toBe('wrap-up');
    expect(updated.task).toEqual({ line: 2, text: 'the second task' });
    expect(updated.state).toBe('running');
    expect(Object.keys(updated)).toEqual([...PLAIN_KEYS, 'phase']);
  });

  it('reads a phase from a later rafa as task, and a write naming none leaves the key out', () => {
    const root = freshRoot();
    plantOlderRecord(root, { phase: 'deploy' });
    expect(fileText(root)).toContain('"phase": "deploy"');

    const read = readSession(root, ID, { isAlive: ALIVE });
    const updated = updateSession(root, ID, { state: 'paused' });

    expect(sessionPhase(read)).toBe('task');
    expect(Object.keys(updated)).toEqual(PLAIN_KEYS);
    expect(fileText(root)).not.toContain('"phase"');
  });

  it('pairs each reading with a control holding a known phase on disk', () => {
    const root = freshRoot();
    const known: SessionPhase = 'pull-request';
    plantOlderRecord(root, { phase: known });

    expect(sessionPhase(readSession(root, ID, { isAlive: ALIVE }))).toBe(known);
  });
});
