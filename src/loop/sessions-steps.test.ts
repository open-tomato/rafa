/**
 * Tests for the additive `steps` field of a session record
 * (`loop/sessions.ts`): left out of a new record and of one written before
 * the field, read as none by `sessionSteps`, appended through
 * `updateSession`'s `appendStep`, kept by every later write, and refused
 * on read or append when a step is outside its shape.
 *
 * The key's absence is asserted with `Object.keys` and on the file's text,
 * since bun's `toEqual` reads a key set to undefined as a key left out.
 * Each refusal sits beside a control: the same record with a well-formed
 * step is read. The `reason` case appends a step carrying one after a
 * step without, as a run resumed from a 0.35.0 record does. The
 * `errorLines` cases read a new failure's error lines back, and a value
 * that is no list of lines as no lines at all.
 */
import type { SessionDraft, SessionRecord, SessionStep } from './sessions.js';

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import {
  beginSession,
  parseSessionRecord,
  readSession,
  SESSION_STEP_KINDS,
  SessionRecordError,
  sessionFilePath,
  sessionSteps,
  updateSession,
} from './sessions.js';

/** This file's scratch directory. */
const tempRoot = mkdtempSync(join(tmpdir(), 'rafa-loop-sessions-steps-'));

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
const ID = 'session-0479';

/** The path a parse case names as the file it read. */
const FILE = `/nowhere/.rafa/runs/${ID}.json`;

/** The keys a record without a hop, a worktree or a step holds, in the order it is written. */
const PLAIN_KEYS = ['sessionId', 'planStub', 'plan', 'branch', 'pid', 'startedAt', 'state', 'task'];

/** A failing test of the baseline. */
const KNOWN = { file: 'src/a.test.ts', name: 'a > fails' };

/** A failing test new against the baseline. */
const FRESH = { file: 'src/b.test.ts', name: 'b > breaks' };

/** The baseline step every case starts from. */
const BASELINE: SessionStep = {
  kind: 'baseline',
  scope: 'full',
  command: ['bun', 'test', '--reporter=junit', '--reporter-outfile=/tmp/junit.xml'],
  exitCode: 1,
  summary: 'Ran 12 tests across 3 files. [40.00ms]',
  failures: [KNOWN],
  newFailures: [],
};

/** A task step over two files, one failure known and one new. */
const TASK_STEP: SessionStep = {
  kind: 'task',
  scope: ['src/a.test.ts', 'src/b.test.ts'],
  command: ['bun', 'test', '--reporter=junit', '--reporter-outfile=/tmp/junit.xml', './src/a.test.ts', './src/b.test.ts'],
  exitCode: 1,
  summary: null,
  failures: [KNOWN, FRESH],
  newFailures: [FRESH],
};

/** The draft of a `demo` run on `feat/demo`. */
function draft(overrides: Partial<SessionDraft> = {}): SessionDraft {
  return {
    sessionId: ID,
    planStub: 'demo',
    plan: '.rafa/plans/PLAN-demo.md',
    branch: 'feat/demo',
    pid: 4242,
    startedAt: '2026-09-30T09:00:00.000Z',
    ...overrides,
  };
}

/** A stored record of the `demo` run, with `extra` laid over it, as the file's text. */
function recordText(extra: Record<string, unknown> = {}): string {
  const record: SessionRecord = { ...draft(), state: 'running', task: null };
  return JSON.stringify({ ...record, ...extra });
}

/** The record text holding one step: {@link BASELINE} with `overrides` laid over it. */
function stepText(overrides: Record<string, unknown>): string {
  return recordText({ steps: [{ ...BASELINE, ...overrides }] });
}

describe('sessionSteps and a record without the field', () => {
  it('writes no steps key for a new record, in the file or the record answered, and reads it as none', () => {
    const root = freshRoot();

    const record = beginSession(root, draft(), { isAlive: ALIVE });
    const text = readFileSync(sessionFilePath(root, ID), 'utf8');

    expect(Object.keys(record)).toEqual(PLAIN_KEYS);
    expect(Object.keys(JSON.parse(text) as object)).toEqual(PLAIN_KEYS);
    expect(text).not.toContain('"steps"');
    expect(sessionSteps(record)).toEqual([]);
  });

  it('reads a record written before the field as holding no step, and one with a step as holding it', () => {
    const before = parseSessionRecord(recordText(), FILE);
    const after = parseSessionRecord(recordText({ steps: [BASELINE] }), FILE);

    expect(Object.keys(before)).toEqual(PLAIN_KEYS);
    expect(sessionSteps(before)).toEqual([]);
    expect(Object.keys(after)).toEqual([...PLAIN_KEYS, 'steps']);
    expect(sessionSteps(after)).toEqual([BASELINE]);
  });

  it('reads a stored empty list as no step, and writes the record back without the key', () => {
    const root = freshRoot();
    const file = sessionFilePath(root, ID);
    mkdirSync(join(root, '.rafa', 'runs'), { recursive: true });
    writeFileSync(file, recordText({ steps: [] }));

    const read = readSession(root, ID, { isAlive: ALIVE });
    const written = updateSession(root, ID, { state: 'done' });

    expect(sessionSteps(read)).toEqual([]);
    expect(Object.keys(written)).toEqual(PLAIN_KEYS);
    expect(readFileSync(file, 'utf8')).not.toContain('"steps"');
  });

  it('names the step kinds in the order a run meets them', () => {
    expect(SESSION_STEP_KINDS).toEqual(['baseline', 'task', 'stage', 'pre-wrap-up']);
  });
});

describe('updateSession and appendStep', () => {
  it('appends each step after the stored ones, writing the list last and reading it back', () => {
    const root = freshRoot();
    beginSession(root, draft(), { isAlive: ALIVE });

    const first = updateSession(root, ID, { appendStep: BASELINE });
    const second = updateSession(root, ID, { appendStep: TASK_STEP });
    const stored = JSON.parse(readFileSync(sessionFilePath(root, ID), 'utf8')) as object;

    expect(sessionSteps(first)).toEqual([BASELINE]);
    expect(sessionSteps(second)).toEqual([BASELINE, TASK_STEP]);
    expect(Object.keys(stored)).toEqual([...PLAIN_KEYS, 'steps']);
    expect(sessionSteps(readSession(root, ID, { isAlive: ALIVE }))).toEqual([BASELINE, TASK_STEP]);
  });

  it('keeps the stored steps through a change of task and state that appends none', () => {
    const root = freshRoot();
    beginSession(root, draft(), { isAlive: ALIVE });
    updateSession(root, ID, { appendStep: BASELINE });

    updateSession(root, ID, { task: { line: 4, text: 'the fourth task' } });
    const ended = updateSession(root, ID, { state: 'done', task: null });

    expect(sessionSteps(ended)).toEqual([BASELINE]);
    expect(sessionSteps(readSession(root, ID, { isAlive: ALIVE }))).toEqual([BASELINE]);
  });

  it('writes a worktree ahead of the steps', () => {
    const root = freshRoot();
    beginSession(root, draft({ worktree: '/work/demo' }), { isAlive: ALIVE });

    const record = updateSession(root, ID, { appendStep: BASELINE });

    expect(Object.keys(record)).toEqual([...PLAIN_KEYS, 'worktree', 'steps']);
  });

  it('answers frozen steps, a later change to the handed step reaching none of them', () => {
    const root = freshRoot();
    beginSession(root, draft(), { isAlive: ALIVE });
    const handed = { ...TASK_STEP, scope: [...TASK_STEP.scope as readonly string[]] };

    const record = updateSession(root, ID, { appendStep: handed });
    handed.scope.push('src/c.test.ts');
    const [step] = sessionSteps(record);

    expect(Object.isFrozen(record.steps)).toBe(true);
    expect(Object.isFrozen(step)).toBe(true);
    expect(Object.isFrozen(step?.failures[0])).toBe(true);
    expect(step?.scope).toEqual(TASK_STEP.scope);
  });

  it('refuses a step outside its shape, writing nothing, and appends its well-formed control', () => {
    const root = freshRoot();
    beginSession(root, draft(), { isAlive: ALIVE });
    updateSession(root, ID, { appendStep: BASELINE });
    const file = sessionFilePath(root, ID);
    const before = readFileSync(file, 'utf8');
    const stray = { ...TASK_STEP, failures: [KNOWN] };

    const append = (): SessionRecord => updateSession(root, ID, { appendStep: stray });

    expect(append).toThrow(SessionRecordError);
    expect(append).toThrow(`not written: steps[1].newFailures names ${JSON.stringify(FRESH)}, which steps[1].failures does not`);
    expect(readFileSync(file, 'utf8')).toBe(before);
    expect(sessionSteps(updateSession(root, ID, { appendStep: TASK_STEP }))).toEqual([BASELINE, TASK_STEP]);
  });
});

describe('parseSessionRecord and the steps field', () => {
  it.each([
    ['a named scope', { scope: 'module' }],
    ['a list of paths', { scope: ['src/suite', 'src/loop/sessions.test.ts'] }],
    ['an empty list of paths', { scope: [] }],
    ['a negative exit code', { exitCode: -1 }],
    ['a new failure the failures hold', { failures: [KNOWN, FRESH], newFailures: [FRESH] }],
    ['the interrupted mark', { exitCode: 130, summary: null, interrupted: true }],
  ])('reads a step holding %s', (_label, overrides) => {
    const [step] = sessionSteps(parseSessionRecord(stepText(overrides), FILE));

    expect(step).toEqual({ ...BASELINE, ...overrides } as SessionStep);
  });

  it.each([
    ['steps set to null', recordText({ steps: null }), 'steps is null, expected a list of steps'],
    ['steps set to an object', recordText({ steps: {} }), 'steps is {}, expected a list of steps'],
    ['a step that is no object', recordText({ steps: [7] }), 'steps[0] is 7, expected a step'],
    ['an unknown kind', stepText({ kind: 'nightly' }), 'steps[0].kind is "nightly", expected one of baseline, task, stage, pre-wrap-up'],
    ['an unknown scope', stepText({ scope: 'everything' }), 'steps[0].scope is "everything", expected one of affected, module, full or a list of paths'],
    ['a scope with an empty path', stepText({ scope: ['src', ''] }), 'steps[0].scope is ["src",""], expected'],
    ['an empty command', stepText({ command: [] }), 'steps[0].command is [], expected a non-empty list of arguments'],
    ['a command as one string', stepText({ command: 'bun test' }), 'steps[0].command is "bun test", expected'],
    ['a fractional exit code', stepText({ exitCode: 1.5 }), 'steps[0].exitCode is 1.5, expected a whole number'],
    ['a missing exit code', stepText({ exitCode: undefined }), 'steps[0].exitCode is missing, expected a whole number'],
    ['a summary that is a number', stepText({ summary: 3 }), 'steps[0].summary is 3, expected null or a string'],
    ['a failure without a name', stepText({ failures: [{ file: 'src/a.test.ts' }] }), 'steps[0].failures is'],
    ['new failures set to null', stepText({ newFailures: null }), 'steps[0].newFailures is null, expected a list of failing tests'],
    ['a new failure the failures lack', stepText({ newFailures: [FRESH] }), 'steps[0].newFailures names'],
    ['interrupted set to false', stepText({ interrupted: false }), 'steps[0].interrupted is false, expected true or no key'],
    ['interrupted set to null', stepText({ interrupted: null }), 'steps[0].interrupted is null, expected true or no key'],
  ])('refuses %s, naming the step and its field', (_label, text, problem) => {
    const read = (): SessionRecord => parseSessionRecord(text, FILE);

    expect(read).toThrow(SessionRecordError);
    expect(read).toThrow(problem);
  });

  it('writes the interrupted mark last on the step holding it, and no key on any other', () => {
    const root = freshRoot();
    beginSession(root, draft(), { isAlive: ALIVE });
    const stopped: SessionStep = { ...TASK_STEP, exitCode: 130, newFailures: [], interrupted: true };

    updateSession(root, ID, { appendStep: BASELINE });
    const record = updateSession(root, ID, { appendStep: stopped });
    const stored = JSON.parse(readFileSync(sessionFilePath(root, ID), 'utf8')) as { steps: object[] };

    expect(sessionSteps(record)).toEqual([BASELINE, stopped]);
    expect(Object.keys(stored.steps[0] ?? {})).not.toContain('interrupted');
    expect(Object.keys(stored.steps[1] ?? {}).at(-1)).toBe('interrupted');
    expect(sessionSteps(readSession(root, ID, { isAlive: ALIVE }))[1]?.interrupted).toBe(true);
  });

  it('writes reason as its own key right after scope, keeps it on later writes, and adds none to a step without', () => {
    const root = freshRoot();
    beginSession(root, draft(), { isAlive: ALIVE });
    const fallback: SessionStep = { ...TASK_STEP, scope: 'affected', reason: 'fallback' };

    updateSession(root, ID, { appendStep: BASELINE });
    updateSession(root, ID, { appendStep: fallback });
    const record = updateSession(root, ID, { phase: 'wrap-up' });
    const stored = JSON.parse(readFileSync(sessionFilePath(root, ID), 'utf8')) as { steps: object[] };

    expect(sessionSteps(record)).toEqual([BASELINE, fallback]);
    expect(Object.keys(stored.steps[0] ?? {})).not.toContain('reason');
    expect(Object.keys(stored.steps[1] ?? {}).slice(0, 3)).toEqual(['kind', 'scope', 'reason']);
    expect(sessionSteps(readSession(root, ID, { isAlive: ALIVE }))[1]?.reason).toBe('fallback');
  });

  it('writes a new failure\'s error lines after its name, reads them back frozen, and adds no key to a failure without', () => {
    const root = freshRoot();
    beginSession(root, draft(), { isAlive: ALIVE });
    const printed = { ...FRESH, errorLines: ['UndeclaredSpendError: spends through claude', 'second line'] };
    const step: SessionStep = { ...TASK_STEP, newFailures: [printed] };

    const record = updateSession(root, ID, { appendStep: step });
    const stored = JSON.parse(readFileSync(sessionFilePath(root, ID), 'utf8')) as { steps: { failures: object[]; newFailures: object[] }[] };
    const [read] = sessionSteps(readSession(root, ID, { isAlive: ALIVE }));

    expect(sessionSteps(record)).toEqual([step]);
    expect(Object.keys(stored.steps[0]?.newFailures[0] ?? {})).toEqual(['file', 'name', 'errorLines']);
    expect(stored.steps[0]?.failures.map((failure) => Object.keys(failure))).toEqual([['file', 'name'], ['file', 'name']]);
    expect(read?.newFailures).toEqual([printed]);
    expect(Object.isFrozen(read?.newFailures[0]?.errorLines)).toBe(true);
  });

  it.each([
    ['a string', 'error: boom'],
    ['null', null],
    ['an empty list', []],
    ['a list holding a number', ['error: boom', 3]],
  ])('reads error lines set to %s as none, refusing nothing', (_label, errorLines) => {
    const text = stepText({ failures: [KNOWN, FRESH], newFailures: [{ ...FRESH, errorLines }] });

    const [step] = sessionSteps(parseSessionRecord(text, FILE));

    expect(Object.keys(step?.newFailures[0] ?? {})).toEqual(['file', 'name']);
    // Control: the same failure with a list of lines keeps it.
    const kept = stepText({ failures: [KNOWN, FRESH], newFailures: [{ ...FRESH, errorLines: ['error: boom'] }] });
    expect(sessionSteps(parseSessionRecord(kept, FILE))[0]?.newFailures[0]?.errorLines).toEqual(['error: boom']);
  });

  it('names the place of a bad step after good ones', () => {
    const text = recordText({ steps: [BASELINE, TASK_STEP, { ...BASELINE, kind: 'stage', exitCode: 'one' }] });

    expect(() => parseSessionRecord(text, FILE)).toThrow('steps[2].exitCode is "one", expected a whole number');
  });
});
