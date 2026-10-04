/**
 * Tests for the events-file reader (`loop/events-file.ts`): the path
 * beside a record, a read from a byte offset answering the whole lines
 * past it and the new offset, a partial last line left unread, a
 * malformed line skipped and counted, and a missing file read as absent.
 *
 * Every file is written under this file's own temporary directory, one
 * fresh file per case. The partial-line and malformed cases each sit
 * beside a control (the same line completed, a well-formed line beside
 * the bad one), so a reader that read every byte, or dropped every
 * line, fails one of the pair.
 */
import type { EventLine } from './events-file.js';

import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { emitLoopEvent, bindEventsFile, unbindEventsFile } from '../start/loop-events.js';

import { eventsFileOf, parseEventLine, readEventsFrom } from './events-file.js';
import { sessionFilePath } from './sessions.js';

const tempRoot = mkdtempSync(join(tmpdir(), 'rafa-loop-events-file-'));
let caseCount = 0;

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

const SESSION_ID = '11111111-2222-4333-8444-555555555555';

/** A fresh file path no earlier case wrote. */
function freshFile(): string {
  caseCount += 1;
  return join(tempRoot, `case-${caseCount}.events.ndjson`);
}

/** One well-formed event line, newline included. */
function line(name: string, data: Record<string, unknown> = {}): string {
  const event: EventLine = { name, summary: `${name} summary`, data, ts: '2026-10-04T10:00:00.000Z' };
  return `${JSON.stringify(event)}\n`;
}

describe('eventsFileOf', () => {
  it('answers the events file beside the record, in the same folder', () => {
    const root = join(tempRoot, 'project');

    const file = eventsFileOf(root, { sessionId: SESSION_ID });

    expect(dirname(file)).toBe(dirname(sessionFilePath(root, SESSION_ID)));
    expect(file.endsWith(`${SESSION_ID}.events.ndjson`)).toBe(true);
  });

  it('refuses a session id the record path refuses', () => {
    expect(() => eventsFileOf(tempRoot, { sessionId: '../escape' })).toThrow('unusable session id');
  });

  it('reads the file the loop writer appends to', () => {
    const root = join(tempRoot, 'written');
    bindEventsFile(root, SESSION_ID);
    try {
      emitLoopEvent({ kind: 'pr', number: 7 });
    } finally {
      unbindEventsFile();
    }

    const result = readEventsFrom(eventsFileOf(root, { sessionId: SESSION_ID }), 0);

    expect(result.kind).toBe('read');
    if (result.kind !== 'read') return;
    expect(result.events.map((event) => [event.name, event.data])).toEqual([['pr', { number: 7 }]]);
    expect(result.malformed).toBe(0);
  });
});

describe('readEventsFrom', () => {
  it('answers a missing file as absent', () => {
    expect(readEventsFrom(freshFile(), 0)).toEqual({ kind: 'absent' });
  });

  it('answers an empty file as read, with no lines and the offset unchanged', () => {
    const file = freshFile();
    writeFileSync(file, '');

    expect(readEventsFrom(file, 0)).toEqual({ kind: 'read', events: [], malformed: 0, offset: 0 });
  });

  it('answers every whole line from offset 0 and the offset at the file end', () => {
    const file = freshFile();
    const content = line('task-start') + line('pr', { number: 3 });
    writeFileSync(file, content);

    const result = readEventsFrom(file, 0);

    expect(result).toEqual({
      kind: 'read',
      events: [
        { name: 'task-start', summary: 'task-start summary', data: {}, ts: '2026-10-04T10:00:00.000Z' },
        { name: 'pr', summary: 'pr summary', data: { number: 3 }, ts: '2026-10-04T10:00:00.000Z' },
      ],
      malformed: 0,
      offset: Buffer.byteLength(content),
    });
  });

  it('answers only the lines past the offset, so a follower sees each line once', () => {
    const file = freshFile();
    writeFileSync(file, line('task-start'));
    const first = readEventsFrom(file, 0);
    if (first.kind !== 'read') throw new Error('expected a read');
    appendFileSync(file, line('task-done'));

    const second = readEventsFrom(file, first.offset);
    const third = second.kind === 'read'
      ? readEventsFrom(file, second.offset)
      : second;

    expect(first.events.map((event) => event.name)).toEqual(['task-start']);
    expect(second.kind === 'read' && second.events.map((event) => event.name)).toEqual(['task-done']);
    expect(third.kind === 'read' && third.events).toEqual([]);
  });

  it('counts the offset in bytes, past a line holding characters of several bytes', () => {
    const file = freshFile();
    const wide = line('halt', { reason: 'rafa· stopped — ✓' });
    writeFileSync(file, wide + line('pr'));

    const result = readEventsFrom(file, Buffer.byteLength(wide));

    expect(Buffer.byteLength(wide)).toBeGreaterThan(wide.length);
    expect(result.kind === 'read' && result.events.map((event) => event.name)).toEqual(['pr']);
  });

  it('leaves a partial last line unread, with the offset before it', () => {
    const file = freshFile();
    const whole = line('task-start');
    const partial = line('pr').slice(0, 20);
    writeFileSync(file, whole + partial);

    const result = readEventsFrom(file, 0);

    expect(result).toEqual({
      kind: 'read',
      events: [parseEventLine(whole.trimEnd()) as EventLine],
      malformed: 0,
      offset: Buffer.byteLength(whole),
    });
  });

  it('reads the partial line whole once its newline arrives (control)', () => {
    const file = freshFile();
    const whole = line('task-start');
    const rest = line('pr');
    writeFileSync(file, whole + rest.slice(0, 20));
    const before = readEventsFrom(file, 0);
    if (before.kind !== 'read') throw new Error('expected a read');
    appendFileSync(file, rest.slice(20));

    const after = readEventsFrom(file, before.offset);

    expect(after).toEqual({
      kind: 'read',
      events: [parseEventLine(rest.trimEnd()) as EventLine],
      malformed: 0,
      offset: Buffer.byteLength(whole + rest),
    });
  });

  it('answers no lines and the offset unchanged when the only line is partial', () => {
    const file = freshFile();
    writeFileSync(file, '{"name":"pr"');

    expect(readEventsFrom(file, 0)).toEqual({ kind: 'read', events: [], malformed: 0, offset: 0 });
  });

  it('skips and counts a malformed line, reading the well-formed lines around it', () => {
    const file = freshFile();
    const content = `${line('task-start')}not json\n${line('pr')}`;
    writeFileSync(file, content);

    const result = readEventsFrom(file, 0);

    expect(result.kind === 'read' && result.events.map((event) => event.name)).toEqual(['task-start', 'pr']);
    expect(result.kind === 'read' && result.malformed).toBe(1);
    expect(result.kind === 'read' && result.offset).toBe(Buffer.byteLength(content));
  });

  it('counts JSON that holds no event, and a blank line, as malformed', () => {
    const file = freshFile();
    const content = [
      '[]',
      '"pr"',
      '{"name":"pr","summary":"s","ts":"t"}',
      '{"name":1,"summary":"s","data":{},"ts":"t"}',
      '{"name":"pr","summary":"s","data":[],"ts":"t"}',
      '',
      '',
    ].join('\n');
    writeFileSync(file, content);

    const result = readEventsFrom(file, 0);

    expect(result).toEqual({ kind: 'read', events: [], malformed: 6, offset: Buffer.byteLength(content) });
  });

  it('does not read a malformed line again on the next read', () => {
    const file = freshFile();
    writeFileSync(file, 'garbage\n');
    const first = readEventsFrom(file, 0);
    if (first.kind !== 'read') throw new Error('expected a read');
    appendFileSync(file, line('halt'));

    const second = readEventsFrom(file, first.offset);

    expect(first.malformed).toBe(1);
    expect(second.kind === 'read' && second.malformed).toBe(0);
    expect(second.kind === 'read' && second.events.map((event) => event.name)).toEqual(['halt']);
  });

  it('answers no lines and the offset unchanged for an offset past the file end', () => {
    const file = freshFile();
    writeFileSync(file, line('pr'));

    expect(readEventsFrom(file, 10_000)).toEqual({ kind: 'read', events: [], malformed: 0, offset: 10_000 });
  });

  it('refuses an offset that is negative or not whole', () => {
    const file = freshFile();
    writeFileSync(file, line('pr'));

    expect(() => readEventsFrom(file, -1)).toThrow('unusable offset -1');
    expect(() => readEventsFrom(file, 1.5)).toThrow('unusable offset 1.5');
  });

  it('throws a read failure other than a missing file', () => {
    expect(() => readEventsFrom(tempRoot, 0)).toThrow();
  });
});
