/**
 * The events-file reader: what `rafa loop wait` reads of a run's events
 * file, `.rafa/runs/<session-id>.events.ndjson`, beside its record. The
 * writer is `start/loop-events.ts`, which appends one JSON line
 * `{ name, summary, data, ts }` per event; {@link eventsFileOf} takes the
 * path from that module's `eventsFilePath`, so reader and writer cannot
 * spell it two ways.
 *
 * ## A read from a byte offset
 *
 * {@link readEventsFrom} reads the file from a byte offset to its end
 * and answers the whole lines past the offset and the offset just after
 * the last of them. A caller following the file passes that offset back
 * on its next read and so sees each line once. Offsets count bytes, not
 * characters, and lines are cut on the newline byte before any decoding,
 * so a character of several bytes is never split.
 *
 * ## A partial last line is left unread
 *
 * The writer appends a line and its newline in one write, but a reader
 * can still land between the two halves of a large append. Bytes past
 * the last newline are therefore not read: the offset answered stops
 * before them, and the next read picks the line up whole.
 *
 * ## A malformed line is skipped and counted
 *
 * A whole line that is not JSON, or is JSON but not an object holding a
 * string `name`, `summary` and `ts` and an object `data`, is skipped and
 * counted in {@link EventsRead.malformed}; the offset still moves past
 * it, so it is never read again. A blank line is malformed too, since
 * the writer never writes one.
 *
 * ## A missing file is absent
 *
 * A run started before the events file existed, or one that has emitted
 * nothing yet, has no file: that reads as `{ kind: 'absent' }` rather
 * than an error. Any other failure to read throws. An offset at or past
 * the file's end answers no lines and the offset unchanged.
 *
 * @module loop/events-file
 */
import type { SessionRecord } from './sessions.js';

import { closeSync, fstatSync, openSync, readSync } from 'node:fs';

import { eventsFilePath } from '../start/loop-events.js';

import { errorCode } from './sessions.js';

/** The newline byte every line of the events file ends with. */
const NEWLINE = 0x0a;

/** One line of the events file, as the writer wrote it. */
export interface EventLine {
  /** The event's kind, such as `pr` or `task-blocked`. */
  readonly name: string;
  /** The one line the event is printed as, without the `rafa· ` prefix. */
  readonly summary: string;
  /** The event's other fields. */
  readonly data: Readonly<Record<string, unknown>>;
  /** When the event was emitted, as an ISO string. */
  readonly ts: string;
}

/** The lines a read found past its offset. */
export interface EventsRead {
  readonly kind: 'read';
  /** The well-formed whole lines past the offset, in file order. */
  readonly events: readonly EventLine[];
  /** The whole lines past the offset that held no event, skipped. */
  readonly malformed: number;
  /** The byte offset just after the last whole line; the next read starts here. */
  readonly offset: number;
}

/** A read of a file that is not there. */
export interface EventsAbsent {
  readonly kind: 'absent';
}

/** What {@link readEventsFrom} answers. */
export type EventsReadResult = EventsRead | EventsAbsent;

/**
 * The events file beside `record` under `<root>/.rafa/runs/`. Throws on
 * a session id the record path would refuse too.
 */
export function eventsFileOf(root: string, record: Pick<SessionRecord, 'sessionId'>): string {
  return eventsFilePath(root, record.sessionId);
}

/** Whether `value` is a non-null object that is not an array. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The event one line holds, or null when it holds none. */
export function parseEventLine(line: string): EventLine | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isPlainObject(value)) return null;
  const { name, summary, data, ts } = value;
  if (typeof name !== 'string' || typeof summary !== 'string' || typeof ts !== 'string') return null;
  if (!isPlainObject(data)) return null;
  return Object.freeze({ name, summary, data: Object.freeze({ ...data }), ts });
}

/** The bytes of the open file `fd` from `offset` to its end, or null when the offset is at or past it. */
function bytesFrom(fd: number, offset: number): Buffer | null {
  const length = fstatSync(fd).size - offset;
  if (length <= 0) return null;
  const buffer = Buffer.alloc(length);
  let filled = 0;
  while (filled < length) {
    const read = readSync(fd, buffer, filled, length - filled, offset + filled);
    if (read === 0) break;
    filled += read;
  }
  return buffer.subarray(0, filled);
}

/** The file's bytes from `offset`, null past its end, or `absent` when it is not there. */
function readTail(file: string, offset: number): Buffer | null | 'absent' {
  let fd: number;
  try {
    fd = openSync(file, 'r');
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return 'absent';
    throw error;
  }
  try {
    return bytesFrom(fd, offset);
  } finally {
    closeSync(fd);
  }
}

/**
 * The whole lines of `file` past the byte `offset`, read as events, and
 * the offset to read from next. See the module note for the partial last
 * line, a malformed line and a missing file. Throws on an offset that is
 * not a whole number of zero or more.
 */
export function readEventsFrom(file: string, offset: number): EventsReadResult {
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new RangeError(`events file: unusable offset ${String(offset)}`);
  }
  const tail = readTail(file, offset);
  if (tail === 'absent') return Object.freeze({ kind: 'absent' });
  const end = tail?.lastIndexOf(NEWLINE) ?? -1;
  if (tail === null || end < 0) {
    return Object.freeze({ kind: 'read', events: Object.freeze([]), malformed: 0, offset });
  }
  const lines = tail
    .subarray(0, end)
    .toString('utf8')
    .split('\n');
  const parsed = lines.map(parseEventLine);
  const events = parsed.filter((event): event is EventLine => event !== null);
  return Object.freeze({
    kind: 'read',
    events: Object.freeze(events),
    malformed: parsed.length - events.length,
    offset: offset + end + 1,
  });
}
