/**
 * Tests for the reading of a session record
 * (`loop/session-record-parse.ts`): a record read back as `sessions.ts`
 * writes one, each refusal naming the file and its problem, every problem
 * of one record in one refusal, and `sessions.ts` re-exporting the
 * readers its callers import.
 *
 * Nothing touches the disk: each case hands `parseSessionRecord` the text
 * and the path it names. The `phase` cases read a record from a rafa older
 * than the field, and one naming a phase this rafa does not know, each
 * beside a control holding a known phase. The per-field cases for `hop`,
 * `worktree`, `steps` and the writes of `phase` stay in `sessions-hop.test.ts`, `sessions-worktree.test.ts` and
 * `sessions-steps.test.ts` and `sessions-phase.test.ts`, beside the
 * writes of each field.
 */
import type { SessionRecord } from './sessions.js';

import { describe, expect, it } from 'bun:test';

import {
  isSessionId,
  parseSessionRecord,
  SESSION_PHASES,
  SESSION_STATES,
  SESSION_STEP_KINDS,
  SessionRecordError,
  sessionPhase,
  sessionSteps,
} from './session-record-parse.js';
import * as sessions from './sessions.js';

/** The id of the record every case reads. */
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

describe('the phase of a record', () => {
  it('lists the phases in the order a run meets them', () => {
    expect(SESSION_PHASES).toEqual(['task', 'wrap-up', 'pull-request', 'ci', 'repair']);
    expect(Object.isFrozen(SESSION_PHASES)).toBe(true);
  });

  it('reads a record from a rafa older than the field as phase task, refusing nothing', () => {
    const older = textWith('phase', undefined);
    expect(older).not.toContain('"phase"');

    const read = parseSessionRecord(older, FILE);

    expect(Object.keys(read)).not.toContain('phase');
    expect(sessionPhase(read)).toBe('task');
    expect(read).toEqual(record());
  });

  it('reads a phase this rafa does not know as task, refusing nothing and keeping no phase key', () => {
    const read = parseSessionRecord(textWith('phase', 'deploy'), FILE);

    expect(Object.keys(read)).not.toContain('phase');
    expect(sessionPhase(read)).toBe('task');
  });

  it.each([['null', null], ['a number', 3], ['an object', { name: 'ci' }]] as const)(
    'reads a phase that is %s as task, refusing nothing',
    (_label, value) => {
      expect(sessionPhase(parseSessionRecord(textWith('phase', value), FILE))).toBe('task');
    },
  );

  it.each(SESSION_PHASES.map((phase) => [phase]))('reads phase %s back as written', (phase) => {
    const read = parseSessionRecord(textWith('phase', phase), FILE);

    expect(read.phase).toBe(phase);
    expect(sessionPhase(read)).toBe(phase);
  });

  it('places phase after task, ahead of the optional fields, when frozen', () => {
    const text = JSON.stringify({ ...record(), worktree: '/work/demo', phase: 'ci' });

    const keys = Object.keys(parseSessionRecord(text, FILE));

    expect(keys.slice(keys.indexOf('task'))).toEqual(['task', 'phase', 'worktree']);
  });

  it('still names the other problems of a record whose phase is unknown, and none for the phase', () => {
    const text = JSON.stringify({ ...record(), pid: 0, phase: 'deploy' });

    const { message } = thrownBy(() => parseSessionRecord(text, FILE)) as SessionRecordError;

    expect(message).toBe(`session record ${FILE}: pid is 0, expected a whole number from 1`);
  });
});

describe('sessions.ts re-exports the reading', () => {
  it('answers the very bindings this module exports, not copies of them', () => {
    expect(sessions.parseSessionRecord).toBe(parseSessionRecord);
    expect(sessions.SessionRecordError).toBe(SessionRecordError);
    expect(sessions.isSessionId).toBe(isSessionId);
    expect(sessions.sessionSteps).toBe(sessionSteps);
    expect(sessions.sessionPhase).toBe(sessionPhase);
    expect(sessions.SESSION_PHASES).toBe(SESSION_PHASES);
    expect(sessions.SESSION_STATES).toBe(SESSION_STATES);
    expect(sessions.SESSION_STEP_KINDS).toBe(SESSION_STEP_KINDS);
  });

  it('refuses through sessions.ts with the error class this module throws', () => {
    expect(() => sessions.parseSessionRecord('[]', FILE)).toThrow(SessionRecordError);
  });
});
