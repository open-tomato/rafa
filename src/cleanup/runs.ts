/**
 * Reading the run records `rafa cleanup` may list: the session records
 * `loop start` leaves under `<root>/.rafa/runs/` (`src/loop/sessions.ts`),
 * each with its events file, `<session-id>.events.ndjson`, when one sits
 * beside it (`src/start/loop-events.ts`).
 *
 * This module prints nothing and removes nothing. It reads the directory
 * and the records from the disk, and probes a pid only through
 * {@link RunSeams.isAlive}, so a unit test plants files in a directory of
 * its own and scripts which pids are alive.
 *
 * ## Which records are listed
 *
 * Every record, oldest first, except:
 *
 *   - **a live one**: it reads `running` or `paused` ({@link readState}: a
 *     record stored so whose pid is gone reads `stopped`). A `running`
 *     record's loop is writing it; a `paused` one's loop waits for
 *     `loop resume`, which reads it. A record stored `running` whose pid
 *     is gone is a run that ended without writing its end, and is listed
 *     like a finished one.
 *   - **the newest of its plan**: among the plan's records that are not
 *     live, the one that started last (`startedAt`, then the session id,
 *     the order `readSessions` sorts by). A plan is its `planStub`, or its
 *     `plan` path when the stub is null, as `samePlan` reads it. That
 *     record is what `rafa loop status` and `readSession` still answer
 *     after the cleanup, so every plan keeps one.
 *
 * Every listed row is ticked by default.
 *
 * ## Why it answers rather than throws
 *
 * As `./branches.ts` explains, the cleanup readings answer rather than
 * throw. A missing directory lists nothing and says nothing: no run was
 * ever recorded. A directory that cannot be listed answers no row and one
 * note. A file named `*.json` that holds no record answers a note and is
 * not listed: its plan cannot be read, so whether it is the newest of
 * its plan cannot be either.
 */
import type { PidProbe, SessionRecord } from '../loop/sessions.js';

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { messageOf } from '../config-sections.js';
import { RECORD_EXTENSION } from '../loop/session-record-parse.js';
import { errorCode, isPidAlive, parseSessionRecord, readState, runsDir } from '../loop/sessions.js';
import { EVENTS_EXTENSION } from '../start/loop-events.js';

/** The states a live loop's record reads as. */
const LIVE_STATES: ReadonlySet<string> = new Set(['running', 'paused']);

/** One run record that may be removed. */
export interface RunRow {
  /** The run's session id, the record's file name before `.json`. */
  readonly sessionId: string;
  /** The record's absolute path. */
  readonly path: string;
  /** The run's events file, or null when none sits beside the record. */
  readonly eventsPath: string | null;
  /** The plan the run ran: its stub, or its path when it carries none. */
  readonly plan: string;
  /** When the run began, as the record holds it: an ISO timestamp. */
  readonly startedAt: string;
  /** True for every row; see the module note. */
  readonly ticked: boolean;
}

/** What {@link readRunRecords} answers. Never a throw. */
export interface RunsReading {
  /** The removable records, oldest first. */
  readonly runs: readonly RunRow[];
  /** One-line notes about what could not be read; empty when everything was. */
  readonly notes: readonly string[];
}

/** What {@link readRunRecords} reads through. */
export interface RunSeams {
  /** Whether a pid is alive. `isPidAlive` when left out. */
  readonly isAlive?: PidProbe;
}

/** A record read, and the file it was read from. */
interface ReadRecord {
  readonly file: string;
  readonly record: SessionRecord;
}

/**
 * The removable run records under `runsDir(root)`, by the rules in the
 * module note.
 */
export function readRunRecords(root: string, seams: RunSeams = {}): RunsReading {
  const dir = runsDir(root);
  const isAlive = seams.isAlive ?? isPidAlive;

  let names: string[];
  try {
    names = readdirSync(dir);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return { runs: [], notes: [] };
    return { runs: [], notes: [`run records: cannot list ${dir}: ${messageOf(error)}`] };
  }

  const notes: string[] = [];
  const finished: ReadRecord[] = [];
  for (const name of names.filter((entry) => entry.endsWith(RECORD_EXTENSION)).sort()) {
    const file = join(dir, name);
    const read = readRecord(file);
    if (typeof read === 'string') {
      notes.push(read);
      continue;
    }
    if (!LIVE_STATES.has(readState(read, isAlive))) finished.push({ file, record: read });
  }

  const sorted = [...finished].sort((a, b) => byStart(a.record, b.record));
  const newest = new Map<string, ReadRecord>();
  for (const entry of sorted) newest.set(planKey(entry.record), entry);
  const kept = new Set(newest.values());

  const runs = sorted
    .filter((entry) => !kept.has(entry))
    .map((entry) => runRow(dir, entry));
  return { runs, notes };
}

/** The record in `file`, or the note saying why it holds none. */
function readRecord(file: string): SessionRecord | string {
  try {
    return parseSessionRecord(readFileSync(file, 'utf8'), file);
  } catch (error) {
    return `run records: skipped ${file}: ${messageOf(error)}`;
  }
}

/** The key two records of one plan share; the prefix keeps a stub apart from a path. */
function planKey(record: SessionRecord): string {
  return record.planStub === null
    ? `plan:${record.plan}`
    : `stub:${record.planStub}`;
}

/** Oldest first, by start, then by id, as `readSessions` sorts. */
function byStart(a: SessionRecord, b: SessionRecord): number {
  return Date.parse(a.startedAt) - Date.parse(b.startedAt) || a.sessionId.localeCompare(b.sessionId);
}

/** One listed record's row. */
function runRow(dir: string, entry: ReadRecord): RunRow {
  const { record } = entry;
  const events = join(dir, `${record.sessionId}${EVENTS_EXTENSION}`);
  return {
    sessionId: record.sessionId,
    path: entry.file,
    eventsPath: existsSync(events)
      ? events
      : null,
    plan: record.planStub ?? record.plan,
    startedAt: record.startedAt,
    ticked: true,
  };
}
