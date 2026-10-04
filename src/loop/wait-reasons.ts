/**
 * The wait reasons: what `rafa loop wait` waits for, how a reason is
 * asked for on `--until`, and which event or record reading matches
 * which reason. The help text, the json result and the exit code all
 * read {@link WAIT_REASONS}, so the three cannot drift.
 *
 * ## The reasons
 *
 * | Reason | Matches | Exit |
 * | --- | --- | --- |
 * | `pr` | event `pr` | 0 |
 * | `no-pr` | event `no-pr` | 10 |
 * | `halt` | event `halt` | 11 |
 * | `error` | event `error` | 12 |
 * | `blocked` | event `task-blocked` | 13 |
 * | `exit` | the record's pid not alive, or the record reading `stopped` or `done` | 14 |
 * | `quiet:<minutes>` | no event for that many awake minutes | 15 |
 *
 * Two more exits are not reasons: {@link WAIT_TIMEOUT_EXIT} when
 * `--timeout` is reached first, and {@link WAIT_NO_SESSION_EXIT} when no
 * session is found.
 *
 * ## The `--until` parse
 *
 * {@link parseWaitUntil} reads a comma list of reasons. Each entry is
 * trimmed of spaces; an entry that is empty, unknown, a bare `quiet`, or
 * a `quiet:` whose minutes are not a positive whole number is refused
 * with {@link WaitUntilError}, which names the entry. A second `quiet`
 * entry is refused too, since one wait counts one quiet span. A reason
 * named twice counts once. Left out, `--until` is
 * {@link DEFAULT_WAIT_UNTIL}: `pr,no-pr,halt,error,exit`; `blocked` and
 * `quiet` are never in it.
 *
 * ## The match
 *
 * {@link matchEvent} answers the reason one event line matches among
 * those asked for, {@link matchRecord} the reason one record reading
 * matches, and {@link matchQuiet} whether the awake minutes since the
 * last event reach the asked-for quiet span. Each answers `null` when
 * nothing asked for matches.
 *
 * @module loop/wait-reasons
 */
import type { EventLine } from './events-file.js';
import type { SessionState } from './sessions.js';

/** A reason one event line matches. */
export type EventWaitReason = 'pr' | 'no-pr' | 'halt' | 'error' | 'blocked';

/** Every reason `loop wait` can end on. */
export type WaitReason = EventWaitReason | 'exit' | 'quiet';

/** One row of the reasons table. */
export interface WaitReasonRow {
  /** The reason, as `--until` spells it (`quiet` takes `:<minutes>`). */
  readonly reason: WaitReason;
  /** The event name that matches it, or null for a reason no event matches. */
  readonly event: string | null;
  /** What matches it, as the help prints it. */
  readonly matches: string;
  /** The exit code `loop wait` ends with on it. */
  readonly exit: number;
}

/** The reasons table, in the order the help lists it. See the module note. */
export const WAIT_REASONS: readonly WaitReasonRow[] = Object.freeze([
  Object.freeze({ reason: 'pr', event: 'pr', matches: 'event pr', exit: 0 }),
  Object.freeze({ reason: 'no-pr', event: 'no-pr', matches: 'event no-pr', exit: 10 }),
  Object.freeze({ reason: 'halt', event: 'halt', matches: 'event halt', exit: 11 }),
  Object.freeze({ reason: 'error', event: 'error', matches: 'event error', exit: 12 }),
  Object.freeze({ reason: 'blocked', event: 'task-blocked', matches: 'event task-blocked', exit: 13 }),
  Object.freeze({
    reason: 'exit',
    event: null,
    matches: 'the run\'s pid not alive, or its record reading stopped or done',
    exit: 14,
  }),
  Object.freeze({ reason: 'quiet', event: null, matches: 'no event for <minutes> awake minutes', exit: 15 }),
] satisfies readonly WaitReasonRow[]);

/** The exit code when `--timeout` is reached before any asked-for reason. */
export const WAIT_TIMEOUT_EXIT = 16;

/** The exit code when no session is found to wait on. */
export const WAIT_NO_SESSION_EXIT = 2;

/** The prefix of a `quiet:<minutes>` entry. */
const QUIET_PREFIX = 'quiet:';

/** A positive whole number written in decimal digits, no sign and no leading zero. */
const POSITIVE_WHOLE = /^[1-9]\d*$/;

/** What `--until` asks for. */
export interface WaitUntil {
  /** The reasons asked for, in table order, each once; `quiet` is in it when a quiet span is. */
  readonly reasons: readonly WaitReason[];
  /** The quiet span in awake minutes, or null when `quiet` is not asked for. */
  readonly quietMinutes: number | null;
}

/** The reasons `--until` asks for when left out. */
export const DEFAULT_WAIT_UNTIL: WaitUntil = Object.freeze({
  reasons: Object.freeze(['pr', 'no-pr', 'halt', 'error', 'exit'] satisfies WaitReason[]),
  quietMinutes: null,
});

/** An `--until` entry refused; {@link WaitUntilError.entry} is the entry as written. */
export class WaitUntilError extends Error {
  /** The entry refused, as written on the command line. */
  readonly entry: string;

  constructor(entry: string, why: string) {
    super(`--until: ${why}: '${entry}'`);
    this.name = 'WaitUntilError';
    this.entry = entry;
  }
}

/** The row of `reason`. */
function rowOf(reason: WaitReason): WaitReasonRow {
  const row = WAIT_REASONS.find((candidate) => candidate.reason === reason);
  if (row === undefined) throw new Error(`wait reasons: no row for ${reason}`);
  return row;
}

/** The exit code `loop wait` ends with on `reason`. */
export function waitExitCode(reason: WaitReason): number {
  return rowOf(reason).exit;
}

/** Whether `entry` names a reason taking no argument. */
function isPlainReason(entry: string): entry is Exclude<WaitReason, 'quiet'> {
  return WAIT_REASONS.some((row) => row.reason === entry && row.reason !== 'quiet');
}

/** The minutes of a `quiet:<minutes>` entry, or throws naming it. */
function quietMinutesOf(entry: string, written: string): number {
  const minutes = entry.slice(QUIET_PREFIX.length);
  const value = Number(minutes);
  if (!POSITIVE_WHOLE.test(minutes) || !Number.isSafeInteger(value)) {
    throw new WaitUntilError(written, 'quiet takes a positive whole number of minutes');
  }
  return value;
}

/**
 * The reasons `raw` asks for, or {@link DEFAULT_WAIT_UNTIL} when it is
 * left out. Throws {@link WaitUntilError} naming the first entry refused.
 * See the module note.
 */
export function parseWaitUntil(raw: string | undefined): WaitUntil {
  if (raw === undefined) return DEFAULT_WAIT_UNTIL;
  const asked = new Set<WaitReason>();
  let quietMinutes: number | null = null;
  for (const written of raw.split(',')) {
    const entry = written.trim();
    if (entry === '') throw new WaitUntilError(written, 'empty entry');
    if (isPlainReason(entry)) {
      asked.add(entry);
      continue;
    }
    if (entry === 'quiet') throw new WaitUntilError(written, 'quiet needs minutes, as quiet:<minutes>');
    if (!entry.startsWith(QUIET_PREFIX)) throw new WaitUntilError(written, 'unknown reason');
    if (quietMinutes !== null) throw new WaitUntilError(written, 'quiet asked for twice');
    quietMinutes = quietMinutesOf(entry, written);
    asked.add('quiet');
  }
  const reasons = WAIT_REASONS.map((row) => row.reason).filter((reason) => asked.has(reason));
  return Object.freeze({ reasons: Object.freeze(reasons), quietMinutes });
}

/** The reason `event` matches among those `until` asks for, or null. */
export function matchEvent(event: Pick<EventLine, 'name'>, until: WaitUntil): EventWaitReason | null {
  const row = WAIT_REASONS.find((candidate) => candidate.event === event.name);
  if (row === undefined || !until.reasons.includes(row.reason)) return null;
  return row.reason as EventWaitReason;
}

/** One reading of a run's record: the state it reads as and whether its pid is alive. */
export interface RecordReading {
  readonly state: SessionState;
  readonly pidAlive: boolean;
}

/** `exit` when `until` asks for it and the run has ended by `reading`, else null. */
export function matchRecord(reading: RecordReading, until: WaitUntil): 'exit' | null {
  if (!until.reasons.includes('exit')) return null;
  const ended = !reading.pidAlive || reading.state === 'stopped' || reading.state === 'done';
  return ended
    ? 'exit'
    : null;
}

/** `quiet` when `until` asks for a quiet span and `awakeMinutes` reach it, else null. */
export function matchQuiet(awakeMinutes: number, until: WaitUntil): 'quiet' | null {
  if (until.quietMinutes === null) return null;
  return awakeMinutes >= until.quietMinutes
    ? 'quiet'
    : null;
}
