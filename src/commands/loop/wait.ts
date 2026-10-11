/**
 * `rafa loop wait [-s|--session-id=<id>] [--until=<reasons>]
 * [--timeout=<minutes>]`: follows one run until a reason asked for
 * happens, prints one line naming it, and exits with that reason's code.
 * It starts no Claude session, so it declares no `spends`.
 *
 * ## The session
 *
 * Picked as `loop status` picks it (`loop-sessions.ts`): the one
 * `--session-id` names, or the one running or paused on the branch
 * checked out at the project root, or, with none of those, the newest one
 * that ran there, so a run that has already ended still answers. The two
 * refusals finding no session ({@link NoSessionRefusal}) end with
 * {@link WAIT_NO_SESSION_EXIT}, 2, in place of their exit code 1; every
 * other refusal of the pick keeps its 1.
 *
 * ## The reasons
 *
 * `--until` is read by `loop/wait-reasons.ts`, whose table
 * ({@link WAIT_REASONS}) the help, the json result and the exit code all
 * read. Left out, it is {@link DEFAULT_WAIT_UNTIL}. An entry it refuses
 * ends with exit code 1, naming the entry.
 *
 * ## One poll
 *
 * Every {@link WAIT_POLL_MS} the wait does three readings, in this order:
 *
 *   1. The events file (`loop/events-file.ts`), read from the byte
 *      offset the last read stopped at, starting from 0, so events the
 *      run wrote before the wait began count too. The first event asked
 *      for, in file order, answers.
 *   2. The record, read again with the state it reads as, and its pid
 *      probed. A run that has ended answers `exit` when asked for; the
 *      events file is read once more first, so a `pr` line written just
 *      before the run ended answers ahead of the end.
 *   3. The awake clock (`loop/awake-clock.ts`): `quiet` when its minutes
 *      since the later of the wait's start and the last event read reach
 *      the span asked for, then `--timeout` when the minutes since the
 *      wait's start reach it. Both count AWAKE minutes, so a machine
 *      suspended over a running loop reads as neither.
 *
 * A run with no events file — one from a rafa older than the file, or a
 * run that has emitted nothing yet — is noted once, as a warning, and
 * the wait goes on: only the record, the quiet span and the timeout can
 * answer until the file appears.
 *
 * ## What it prints
 *
 * One line, prefixed `rafa· ` as the events output prefixes every line it
 * writes, so a watcher matches one prefix: an event's own summary, as the
 * events output printed it during the run, or a line naming `exit`,
 * `quiet` or `timeout`. The `quiet` and `timeout` lines add the minutes
 * spent suspended when the awake clock reports any.
 *
 * ## The json result
 *
 * {@link LoopWaitResult}: the reason, its exit code, the line, the event
 * that answered or null, the session's id, state, pid and whether the pid
 * is alive, and the awake and suspended minutes since the wait began. The
 * dispatcher keeps a command's result payload only for an exit code of 0
 * (`cli/dispatch.ts`), and every reason but `pr` exits non-zero, so json
 * mode writes the result as a named event, `wait`, in every case; the
 * terminal result then holds it as its `data` for `pr`, and for any other
 * reason holds the line as its error's message.
 *
 * ## The macOS gap
 *
 * On macOS the monotonic clock keeps counting through sleep, so there a
 * long sleep reads as awake minutes and can raise a false `quiet` or an
 * early timeout (`loop/awake-clock.ts`). The help says so.
 *
 * ## Seams
 *
 * {@link LoopWaitSeams}: the branch reader, the pid probe, the record
 * read, the awake clock, the sleep between polls and its length. Each
 * left out is the system's own, so no unit test sleeps or probes a pid.
 *
 * @module commands/loop/wait
 */
import type { PickedSession } from './loop-sessions.js';
import type { RafaCommand, RafaContext } from '../../cli/command.js';
import type { AwakeClock, AwakeMark, AwakeReading } from '../../loop/awake-clock.js';
import type { EventLine } from '../../loop/events-file.js';
import type { LoopSessionSeams } from '../../loop/session-readings.js';
import type { PidProbe, SessionRecord, SessionState } from '../../loop/sessions.js';
import type { WaitReason, WaitReasonRow, WaitUntil } from '../../loop/wait-reasons.js';

import { relative } from 'node:path';

import { EVENT_PREFIX, oneLine, padKind } from '../../adapters/output/events.js';
import { CommandExit } from '../../cli/command.js';
import { messageOf } from '../../config-sections.js';
import { createAwakeClock } from '../../loop/awake-clock.js';
import { eventsFileOf, readEventsFrom } from '../../loop/events-file.js';
import {
  refusal,
  resolveLoopSeams,
} from '../../loop/session-readings.js';
import { readSession, SessionRecordError } from '../../loop/sessions.js';
import {
  DEFAULT_WAIT_UNTIL,
  matchEvent,
  matchQuiet,
  matchRecord,
  parseWaitUntil,
  WAIT_NO_SESSION_EXIT,
  WAIT_REASONS,
  WAIT_TIMEOUT_EXIT,
  waitExitCode,
  WaitUntilError,
} from '../../loop/wait-reasons.js';
import { plural } from '../../plan/plan-files.js';
import { expectNoArgument } from '../plan/plan-files.js';

import {
  lineRefusal,
  NoSessionRefusal,
  pickSession,
  sessionIdFlag,
} from './loop-sessions.js';

/** The usage line a refusal names. */
const USAGE = 'rafa loop wait [-s|--session-id=<id>] [--until=<reasons>] [--timeout=<minutes>]';

/** How long the wait sleeps between two polls, in milliseconds. */
export const WAIT_POLL_MS = 5_000;

/** The flag naming the reasons waited for. */
const UNTIL_FLAG = 'until';

/** The flag bounding the wait. */
const TIMEOUT_FLAG = 'timeout';

/** The name of the event json mode writes the result as. */
export const WAIT_EVENT = 'wait';

/** What a wait can end on: a reason, or the timeout. */
export type WaitEnding = WaitReason | 'timeout';

/** The seams the command reaches the system through. See the module note. */
export interface LoopWaitSeams {
  /** The branch checked out at a root; throws when it cannot be read. */
  readonly readBranch?: LoopSessionSeams['readBranch'];
  /** Whether a pid is alive. `isPidAlive` when left out. */
  readonly isAlive?: PidProbe;
  /** One record, with the state it reads as. `readSession` when left out. */
  readonly readRecord?: (root: string, sessionId: string, isAlive: PidProbe) => SessionRecord;
  /** The awake clock. The process's own when left out. */
  readonly clock?: AwakeClock;
  /** Waits `ms` milliseconds. `Bun.sleep` when left out. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** How long to sleep between polls. {@link WAIT_POLL_MS} when left out. */
  readonly pollMs?: number;
}

/** Every seam, each filled in. */
type ResolvedWaitSeams = Required<LoopWaitSeams>;

/** The session a result names: its id, the state it reads as, and its pid. */
export interface WaitSession {
  readonly sessionId: string;
  readonly state: SessionState;
  readonly pid: number;
  readonly pidAlive: boolean;
}

/** What a wait ended on. See the module note. */
export interface LoopWaitResult {
  readonly reason: WaitEnding;
  readonly exitCode: number;
  /** The one line printed, `rafa· ` prefix included. */
  readonly line: string;
  /** The event that answered, or null for `exit`, `quiet` and `timeout`. */
  readonly event: EventLine | null;
  readonly session: WaitSession;
  /** Awake minutes since the wait began. */
  readonly awakeMinutes: number;
  /** Minutes spent suspended since the wait began, `0` when the clock reports none. */
  readonly suspendedMinutes: number;
}

/** The seams handed in, each left out filled with the system's own. */
function resolveWaitSeams(seams: LoopWaitSeams): ResolvedWaitSeams {
  const base = resolveLoopSeams();
  return {
    readBranch: seams.readBranch ?? base.readBranch,
    isAlive: seams.isAlive ?? base.isAlive,
    sleep: seams.sleep ?? base.sleep,
    readRecord: seams.readRecord ?? ((root, sessionId, isAlive) => readSession(root, sessionId, { isAlive })),
    clock: seams.clock ?? createAwakeClock(),
    pollMs: seams.pollMs ?? WAIT_POLL_MS,
  };
}

/** The reasons `--until` asks for, or a refusal of the line naming the entry. */
export function readUntil(context: Pick<RafaContext, 'flags'>): WaitUntil {
  const value = context.flags[UNTIL_FLAG];
  if (value === undefined) return DEFAULT_WAIT_UNTIL;
  if (typeof value !== 'string') throw lineRefusal(`--${UNTIL_FLAG} needs a value: --${UNTIL_FLAG}=<reasons>`, USAGE);
  try {
    return parseWaitUntil(value);
  } catch (error) {
    if (error instanceof WaitUntilError) throw lineRefusal(error.message, USAGE);
    throw error;
  }
}

/** The awake minutes `--timeout` bounds the wait to, or null when it is left out. */
export function readTimeout(context: Pick<RafaContext, 'flags'>): number | null {
  const value = context.flags[TIMEOUT_FLAG];
  if (value === undefined) return null;
  const minutes = typeof value === 'string'
    ? Number(value)
    : Number.NaN;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(minutes)) {
    const spelled = typeof value === 'string'
      ? JSON.stringify(value)
      : `--${TIMEOUT_FLAG} with no value`;
    throw lineRefusal(`${spelled} is no timeout, which is a whole number of minutes from 1`, USAGE);
  }
  return minutes;
}

/** `, <n> minutes more suspended` when the clock reports any, else nothing. */
function suspendedNote(reading: AwakeReading): string {
  const minutes = Math.round(reading.suspendedMinutes);
  return minutes > 0
    ? `, ${plural(minutes, 'minute')} more suspended`
    : '';
}

/** A line the wait prints for a kind no event summary spells: `rafa· <kind>  <text>`. */
function ownLine(kind: string, text: string): string {
  return `${EVENT_PREFIX}${padKind(kind)}${text}`;
}

/** The line an event is printed as: its summary, as the events output prints it. */
export function eventLine(event: Pick<EventLine, 'summary'>): string {
  return `${EVENT_PREFIX}${oneLine(event.summary)}`;
}

/** The line a run that ended is printed as. */
export function exitLine(session: WaitSession): string {
  const pid = session.pidAlive
    ? 'alive'
    : 'not alive';
  return ownLine('exit', `session ${session.sessionId} ${session.state}, pid ${String(session.pid)} ${pid}`);
}

/** The line a quiet span reached is printed as. */
export function quietLine(minutes: number, reading: AwakeReading): string {
  return ownLine('quiet', `no event for ${plural(minutes, 'awake minute')}${suspendedNote(reading)}`);
}

/** The line a timeout reached is printed as. */
export function timeoutLine(minutes: number, reading: AwakeReading): string {
  return ownLine('timeout', `no reason asked for in ${plural(minutes, 'awake minute')}${suspendedNote(reading)}`);
}

/** What a wait follows, fixed once the session is picked. */
interface Following {
  readonly root: string;
  readonly record: SessionRecord;
  readonly file: string;
  readonly until: WaitUntil;
  readonly timeout: number | null;
  readonly start: AwakeMark;
}

/** Where a wait stands between two polls. */
interface Cursor {
  /** The byte offset the next read of the events file starts at. */
  readonly offset: number;
  /** The mark quiet minutes are counted from: the wait's start, or the last event read. */
  readonly quietMark: AwakeMark;
  /** Whether the run's missing events file has been noted. */
  readonly noted: boolean;
}

/** What one poll found: a reason with its event, or nothing yet. */
interface Found {
  readonly reason: WaitEnding;
  readonly event: EventLine | null;
}

/** One poll's answer: what it found, and the cursor the next poll starts from. */
interface Polled {
  readonly cursor: Cursor;
  readonly found: Found | null;
}

/** The note a run with no events file is given once. */
function noEventsNote(following: Following): string {
  const path = relative(following.root, following.file);
  return `Session ${following.record.sessionId} has no events file at ${path}: a run from an older rafa writes none,`
    + ' and no event can answer until one appears.';
}

/** The first of `events` that `until` asks for, with its reason, or null. */
function firstAsked(events: readonly EventLine[], until: WaitUntil): Found | null {
  for (const event of events) {
    const reason = matchEvent(event, until);
    if (reason !== null) return { reason, event };
  }
  return null;
}

/** Reads the events past the cursor's offset; answers the first one asked for and the cursor moved past them. */
function readNewEvents(following: Following, cursor: Cursor, context: RafaContext, seams: ResolvedWaitSeams): Polled {
  const read = readEventsFrom(following.file, cursor.offset);
  if (read.kind === 'absent') {
    if (!cursor.noted) context.output.warn(noEventsNote(following));
    return { cursor: { ...cursor, noted: true }, found: null };
  }
  const moved: Cursor = {
    ...cursor,
    offset: read.offset,
    quietMark: read.events.length > 0
      ? seams.clock.mark()
      : cursor.quietMark,
  };
  return { cursor: moved, found: firstAsked(read.events, following.until) };
}

/** The record read again, or a refusal when it cannot be. */
function readRecordOrRefuse(following: Following, seams: ResolvedWaitSeams): SessionRecord {
  const { sessionId } = following.record;
  try {
    return seams.readRecord(following.root, sessionId, seams.isAlive);
  } catch (error) {
    if (!(error instanceof SessionRecordError)) throw error;
    throw refusal(`Session ${sessionId}: its record cannot be read any more.`, messageOf(error));
  }
}

/** One poll: the events, then the record, then the clock. See the module note. */
function poll(following: Following, before: Cursor, context: RafaContext, seams: ResolvedWaitSeams): Polled {
  const fromEvents = readNewEvents(following, before, context, seams);
  if (fromEvents.found !== null) return fromEvents;
  const { cursor } = fromEvents;

  const record = readRecordOrRefuse(following, seams);
  if (matchRecord({ state: record.state, pidAlive: seams.isAlive(record.pid) }, following.until) !== null) {
    const last = readNewEvents(following, cursor, context, seams);
    return { cursor: last.cursor, found: last.found ?? { reason: 'exit', event: null } };
  }

  if (matchQuiet(seams.clock.since(cursor.quietMark).awakeMinutes, following.until) !== null) {
    return { cursor, found: { reason: 'quiet', event: null } };
  }
  const { timeout } = following;
  if (timeout !== null && seams.clock.since(following.start).awakeMinutes >= timeout) {
    return { cursor, found: { reason: 'timeout', event: null } };
  }
  return { cursor, found: null };
}

/** The line a wait that ended on `found` prints. */
function lineOf(found: Found, following: Following, session: WaitSession, reading: AwakeReading): string {
  if (found.event !== null) return eventLine(found.event);
  if (found.reason === 'exit') return exitLine(session);
  if (found.reason === 'quiet') return quietLine(following.until.quietMinutes ?? 0, reading);
  return timeoutLine(following.timeout ?? 0, reading);
}

/** The result a wait that ended on `found` gives. */
function resultOf(found: Found, following: Following, seams: ResolvedWaitSeams): LoopWaitResult {
  const record = readRecordOrRefuse(following, seams);
  const session: WaitSession = {
    sessionId: record.sessionId,
    state: record.state,
    pid: record.pid,
    pidAlive: seams.isAlive(record.pid),
  };
  const reading = seams.clock.since(following.start);
  return {
    reason: found.reason,
    exitCode: found.reason === 'timeout'
      ? WAIT_TIMEOUT_EXIT
      : waitExitCode(found.reason),
    line: lineOf(found, following, session, reading),
    event: found.event,
    session,
    awakeMinutes: reading.awakeMinutes,
    suspendedMinutes: reading.suspendedMinutes,
  };
}

/** The session the line picks, a session it cannot find ending with {@link WAIT_NO_SESSION_EXIT}. */
function pickOrNoSession(context: RafaContext, seams: ResolvedWaitSeams): PickedSession {
  try {
    return pickSession(context, USAGE, 'live-or-newest', {
      ...resolveLoopSeams(),
      readBranch: seams.readBranch,
      isAlive: seams.isAlive,
    });
  } catch (error) {
    if (error instanceof NoSessionRefusal) throw new CommandExit(WAIT_NO_SESSION_EXIT, error.message);
    throw error;
  }
}

/**
 * Follows the session the line picks until a reason asked for happens,
 * and answers what it ended on. Reads the line before anything else.
 * See the module note.
 */
export async function runLoopWait(context: RafaContext, seams: LoopWaitSeams = {}): Promise<LoopWaitResult> {
  expectNoArgument(context.args, USAGE);
  const until = readUntil(context);
  const timeout = readTimeout(context);
  const resolved = resolveWaitSeams(seams);
  const { root, record } = pickOrNoSession(context, resolved);
  const start = resolved.clock.mark();
  const following: Following = { root, record, file: eventsFileOf(root, record), until, timeout, start };
  let cursor: Cursor = { offset: 0, quietMark: start, noted: false };
  for (;;) {
    const polled = poll(following, cursor, context, resolved);
    if (polled.found !== null) return resultOf(polled.found, following, resolved);
    cursor = polled.cursor;
    await resolved.sleep(resolved.pollMs);
  }
}

/** A reason as `--until` spells it. */
function spelled(row: WaitReasonRow): string {
  return row.reason === 'quiet'
    ? 'quiet:<minutes>'
    : row.reason;
}

/** The reasons and their exit codes, as the help lists them. */
function reasonsText(): string {
  return WAIT_REASONS.map((row) => `\`${spelled(row)}\`, ${row.matches}, exits ${String(row.exit)}`).join('; ');
}

/** The command's description, its reasons and exit codes read from {@link WAIT_REASONS}. */
function description(): string {
  return 'Follows a loop run until a reason `--until` asks for happens, then prints one `rafa·` line naming it'
    + ' and exits with that reason\'s code. It reads the run\'s events file, `.rafa/runs/<session-id>.events.ndjson`,'
    + ' from its first line, so a run that has already ended still answers, and reads the run\'s record and'
    + ` probes its pid every ${String(WAIT_POLL_MS / 1000)} seconds. The reasons: ${reasonsText()}.`
    + ` \`--timeout\` reached exits ${String(WAIT_TIMEOUT_EXIT)}, and a session it cannot find exits`
    + ` ${String(WAIT_NO_SESSION_EXIT)}. Without \`--until\` it waits for \`${DEFAULT_WAIT_UNTIL.reasons.join(',')}\`;`
    + ' `blocked` and `quiet` are never in that set. Quiet minutes and the timeout count time the machine is'
    + ' awake, so a suspended laptop never reads as a stuck loop; on macOS the clock keeps counting through'
    + ' sleep, so there a long sleep can raise a false `quiet` or an early timeout. A run with no events file,'
    + ' from an older rafa, is noted once, and only `exit`, `quiet` and the timeout can answer for it. Without'
    + ' `--session-id` it waits on the session running on the branch checked out at the project root, or the'
    + ' newest one that ran there. With `--output=json` the reason, the event, the session\'s state and the'
    + ` minutes are the data of a \`${WAIT_EVENT}\` event, and of the terminal result when it exits 0.`;
}

/** The command, reaching the system through `seams`. See the module note. */
export function createLoopWaitCommand(seams: LoopWaitSeams = {}): RafaCommand {
  const command: RafaCommand = {
    name: 'loop wait',
    subject: 'loop',
    action: 'wait',
    summary: 'wait on a session until a reason --until names happens',
    description: description(),
    args: [],
    flags: [
      sessionIdFlag('to wait on'),
      {
        name: UNTIL_FLAG,
        description: `The reasons to wait for, a comma list of ${WAIT_REASONS.map((row) => spelled(row)).join(', ')}.`
          + ` \`${DEFAULT_WAIT_UNTIL.reasons.join(',')}\` when it is left out.`,
        type: 'string',
      },
      {
        name: TIMEOUT_FLAG,
        description: `How many awake minutes to wait before giving up with exit code ${String(WAIT_TIMEOUT_EXIT)}.`
          + ' No limit when it is left out.',
        type: 'string',
      },
    ],
    examples: [
      {
        cmd: 'rafa loop wait',
        note: 'Waits on the session of the branch checked out here until it opens a PR, ends without one, halts,'
          + ' fails or exits.',
      },
      {
        cmd: 'rafa loop wait --session-id=9185b41c-65f7-4dd6-a0c1-6494c4028f0f --until=blocked,exit,quiet:30',
        note: 'Wakes on a blocked task, the run\'s end, or 30 awake minutes with no event.',
      },
      {
        cmd: 'rafa loop wait --timeout=60 --output=json',
        note: 'Waits up to an hour awake, then writes the reason, the event and the session\'s state as a wait event.',
      },
    ],
    outputs: ['text', 'json'],
    run: async (context) => {
      const result = await runLoopWait(context, seams);
      if (context.outputMode === 'json') {
        context.output.emit({
          type: 'event',
          name: WAIT_EVENT,
          summary: result.line.slice(EVENT_PREFIX.length),
          data: result as unknown as Readonly<Record<string, unknown>>,
          ts: new Date().toISOString(),
        });
        if (result.exitCode === 0) context.output.result(result);
        else throw new CommandExit(result.exitCode, result.line);
        return;
      }
      context.output.info(result.line);
      if (result.exitCode !== 0) throw new CommandExit(result.exitCode);
    },
  };
  return Object.freeze(command);
}

export default createLoopWaitCommand();
