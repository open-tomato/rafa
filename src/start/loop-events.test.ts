/**
 * Cases for the loop's events (`start/loop-events.ts`): each kind's one
 * line, a task text folded onto it, the event written through the active
 * output, the line appended to a bound events file in every output mode
 * and the one warning on a failed append, where a task sits in its
 * tracker, and a task's tokens read from its session log, or null when the
 * log cannot be read.
 */
import type { LoopEvent } from './loop-events.js';

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '../adapters/output/active.js';
import { createEventsOutput } from '../adapters/output/events.js';
import { createJsonOutput } from '../adapters/output/json.js';
import { createTextOutput } from '../adapters/output/text.js';
import { sessionLogDir } from '../effort/collect.js';
import { runsDir } from '../loop/sessions.js';

import {
  bindEventsFile,
  emitLoopEvent,
  eventsFilePath,
  summaryOf,
  taskPosition,
  taskTokens,
  unbindEventsFile,
  unlessText,
} from './loop-events.js';

/** The third task of nine. */
const AT = { index: 3, total: 9 };

/** Each kind of event beside the one line it is printed as. */
const SUMMARIES: readonly (readonly [LoopEvent, string])[] = [
  [{ kind: 'task-start', position: AT, text: 'Group duplicate bugs' }, 'task 3/9 start   "Group duplicate bugs"'],
  [{ kind: 'task-done', position: AT, durationMs: (12 * 60_000) + 4_000, tokens: 340_000 }, 'task 3/9 done    12m  340k tokens'],
  [{ kind: 'task-done', position: AT, durationMs: 40_000, tokens: null }, 'task 3/9 done    1m'],
  [{ kind: 'task-blocked', position: AT, reason: 'session exited 3' }, 'task 3/9 blocked session exited 3'],
  [{ kind: 'wrap-up', phase: 'fragment' }, 'wrap-up          fragment'],
  [{ kind: 'pr', number: 612 }, 'pr #612 opened'],
  [{ kind: 'no-pr', reason: 'no open pull request for feat/x' }, 'no pr            no open pull request for feat/x'],
  [{ kind: 'halt', reason: 'checkout moved' }, 'halt             checkout moved'],
  [
    { kind: 'inherited', file: 'src/parse/parse.test.ts', name: 'parse > drops the last line' },
    'inherited        src/parse/parse.test.ts > parse > drops the last line',
  ],
  [{ kind: 'error', message: 'boom' }, 'error            boom'],
  [
    { kind: 'error', message: '\n  ❌ Task failed (exit 1). Marked as blocked.\n   Run again to retry.\n' },
    'error            ❌ Task failed (exit 1). Marked as blocked.',
  ],
];

describe('summaryOf', () => {
  it.each(SUMMARIES)('prints %o as its line', (event, line) => {
    expect(summaryOf(event)).toBe(line);
  });

  it('keeps a task text holding quotes, backticks and a newline on one line', () => {
    const line = summaryOf({ kind: 'task-start', position: AT, text: 'Fix `a` "b"\n  <!-- blocker -->' });

    expect(line).toBe('task 3/9 start   "Fix `a` \\"b\\" <!-- blocker -->"');
  });

  it.each([
    [{ kind: 'task-blocked', position: AT, reason: 'blocker: suite red\nsecond line of detail\n' }, 'task 3/9 blocked blocker: suite red second line of detail'],
    [{ kind: 'no-pr', reason: 'gh said:\n  not found' }, 'no pr            gh said: not found'],
    [{ kind: 'halt', reason: '\ncheckout moved\n' }, 'halt             checkout moved'],
  ] as const)('folds a multi-line reason onto one line: %o', (event, line) => {
    expect(summaryOf(event)).toBe(line);
  });

  it('pads a two-digit position the same way, one space at least before the rest', () => {
    expect(summaryOf({ kind: 'task-blocked', position: { index: 12, total: 40 }, reason: 'x' })).toBe('task 12/40 blocked x');
  });
});

describe('emitLoopEvent', () => {
  afterEach(() => {
    setActiveOutput(null);
  });

  it('writes one rafa· line through the active events output', () => {
    const chunks: string[] = [];
    setActiveOutput(createEventsOutput({ stream: { write: (chunk) => chunks.push(chunk) } }), 'events');

    emitLoopEvent({ kind: 'halt', reason: 'checkout moved' });

    expect(chunks).toEqual(['rafa· halt             checkout moved\n']);
  });

  it('writes the event with its kind as name and its fields as data under json', () => {
    const chunks: string[] = [];
    const now = () => new Date('2026-10-01T12:00:00.000Z');
    setActiveOutput(createJsonOutput({ stream: { write: (chunk) => chunks.push(chunk) } }), 'json');

    emitLoopEvent({ kind: 'pr', number: 612 }, now);

    expect(chunks.map((chunk) => JSON.parse(chunk) as unknown)).toEqual([
      { type: 'event', name: 'pr', summary: 'pr #612 opened', data: { number: 612 }, ts: '2026-10-01T12:00:00.000Z' },
    ]);
  });
});

describe('the events file', () => {
  const made: string[] = [];
  const now = () => new Date('2026-10-01T12:00:00.000Z');
  const SESSION = 'b12d026c-62a4-4bd7-96e7-c11d22909aa9';

  afterEach(() => {
    unbindEventsFile();
    setActiveOutput(null);
    for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  /** A scratch project root, removed after the case. */
  function scratchRoot(): string {
    const root = mkdtempSync(join(tmpdir(), 'rafa-loop-events-file-'));
    made.push(root);
    return root;
  }

  /** The events file's lines, each parsed. */
  function linesOf(file: string): unknown[] {
    return readFileSync(file, 'utf8')
      .trimEnd()
      .split('\n')
      .map((line) => JSON.parse(line) as unknown);
  }

  it('names the file beside the record under .rafa/runs', () => {
    const root = scratchRoot();

    expect(eventsFilePath(root, SESSION)).toBe(join(runsDir(root), `${SESSION}.events.ndjson`));
    expect(() => eventsFilePath(root, '../x')).toThrow(/unusable session id/);
  });

  it('appends one line per event under text, which prints none of them', () => {
    const root = scratchRoot();
    const printed: string[] = [];
    setActiveOutput(createTextOutput({ verbosity: 0, stream: { write: (chunk) => printed.push(chunk) } }), 'text');
    const file = bindEventsFile(root, SESSION);

    emitLoopEvent({ kind: 'pr', number: 612 }, now);
    emitLoopEvent({ kind: 'error', message: 'boom\nstack' }, now);

    expect(printed).toEqual([]);
    expect(linesOf(file)).toEqual([
      { name: 'pr', summary: 'pr #612 opened', data: { number: 612 }, ts: '2026-10-01T12:00:00.000Z' },
      { name: 'error', summary: 'error            boom', data: { message: 'boom\nstack' }, ts: '2026-10-01T12:00:00.000Z' },
    ]);
  });

  it('appends the same object the events output receives, minus type', () => {
    const root = scratchRoot();
    const printed: string[] = [];
    setActiveOutput(createEventsOutput({ stream: { write: (chunk) => printed.push(chunk) } }), 'events');
    const file = bindEventsFile(root, SESSION);

    emitLoopEvent({ kind: 'halt', reason: 'checkout moved' }, now);

    expect(printed).toEqual(['rafa· halt             checkout moved\n']);
    expect(linesOf(file)).toEqual([
      { name: 'halt', summary: 'halt             checkout moved', data: { reason: 'checkout moved' }, ts: '2026-10-01T12:00:00.000Z' },
    ]);
  });

  it('appends nothing once unbound, and nothing before a bind', () => {
    const root = scratchRoot();
    setActiveOutput(createTextOutput({ verbosity: 0, stream: { write: () => true } }), 'text');
    const file = eventsFilePath(root, SESSION);

    emitLoopEvent({ kind: 'pr', number: 1 }, now);
    expect(existsSync(file)).toBe(false);

    bindEventsFile(root, SESSION);
    emitLoopEvent({ kind: 'pr', number: 2 }, now);
    unbindEventsFile();
    emitLoopEvent({ kind: 'pr', number: 3 }, now);

    expect(linesOf(file)).toEqual([expect.objectContaining({ data: { number: 2 } })]);
  });

  it('warns once on a failed write, never throws, and still emits every event', () => {
    const root = scratchRoot();
    // The runs folder is a file, so the folder cannot be made nor the line appended.
    mkdirSync(join(runsDir(root), '..'), { recursive: true });
    writeFileSync(runsDir(root), 'not a folder');
    const printed: string[] = [];
    const warnings: string[] = [];
    setActiveOutput(createEventsOutput({ stream: { write: (chunk) => printed.push(chunk) } }), 'events');
    const file = bindEventsFile(root, SESSION, (line) => warnings.push(line));

    emitLoopEvent({ kind: 'pr', number: 1 }, now);
    emitLoopEvent({ kind: 'halt', reason: 'x' }, now);

    expect(printed).toHaveLength(2);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toStartWith(`rafa: cannot write the events file ${file}: `);
    expect(warnings[0]).toEndWith('\n');
    expect(warnings[0]?.trimEnd()).not.toContain('\n');
  });

  it('warns again on a new binding after a failed one', () => {
    const root = scratchRoot();
    mkdirSync(join(runsDir(root), '..'), { recursive: true });
    writeFileSync(runsDir(root), 'not a folder');
    const warnings: string[] = [];
    setActiveOutput(createTextOutput({ verbosity: 0, stream: { write: () => true } }), 'text');

    bindEventsFile(root, SESSION, (line) => warnings.push(line));
    emitLoopEvent({ kind: 'pr', number: 1 }, now);
    bindEventsFile(root, SESSION, (line) => warnings.push(line));
    emitLoopEvent({ kind: 'pr', number: 2 }, now);

    expect(warnings).toHaveLength(2);
  });

  it('appends successfully as a control for the failed-write case', () => {
    const root = scratchRoot();
    const warnings: string[] = [];
    setActiveOutput(createTextOutput({ verbosity: 0, stream: { write: () => true } }), 'text');
    const file = bindEventsFile(root, SESSION, (line) => warnings.push(line));

    emitLoopEvent({ kind: 'pr', number: 1 }, now);

    expect(warnings).toEqual([]);
    expect(linesOf(file)).toHaveLength(1);
  });
});

describe('taskPosition', () => {
  it('counts the task line, from zero as the tracker does, among every task of the tracker', () => {
    const tracker = '# Stage: one\n\n- [x] first\n- [ ] second\n- [ ] third\n';

    expect(taskPosition(tracker, 3)).toEqual({ index: 2, total: 3 });
  });
});

describe('taskTokens', () => {
  const made: string[] = [];

  afterEach(() => {
    for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('answers null when the session log cannot be read', async () => {
    expect(await taskTokens('/nonexistent-checkout', 'no-such-session', '/nonexistent-home')).toBeNull();
  });

  it('sums the input, cache creation and output tokens the session log records', async () => {
    const home = mkdtempSync(join(tmpdir(), 'rafa-loop-events-'));
    made.push(home);
    const checkout = '/scratch/checkout';
    const dir = sessionLogDir(checkout, home);
    mkdirSync(dir, { recursive: true });
    const usage = { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 3, cache_read_input_tokens: 5000 };
    writeFileSync(join(dir, 'abc.jsonl'), `${JSON.stringify({ type: 'assistant', message: { model: 'm', usage } })}\n`);

    expect(await taskTokens(checkout, 'abc', home)).toBe(123);
  });
});

describe('unlessText', () => {
  afterEach(() => {
    setActiveOutput(null);
  });

  it('skips a reading only an event needs in text mode, which prints no event', async () => {
    let calls = 0;
    setActiveOutput(createTextOutput({ verbosity: 0, stream: { write: () => true } }), 'text');

    const answer = await unlessText(async () => {
      calls += 1;
      return 612;
    });

    expect(answer).toBeNull();
    expect(calls).toBe(0);
  });

  it.each(['events', 'json'] as const)('makes the reading in %s mode', async (mode) => {
    const stream = { write: () => true };
    const output = mode === 'json'
      ? createJsonOutput({ stream })
      : createEventsOutput({ stream });
    setActiveOutput(output, mode);

    expect(await unlessText(async () => 612)).toBe(612);
  });
});
