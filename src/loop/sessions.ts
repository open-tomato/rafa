/**
 * The session records of `loop start`: one JSON file per run under
 * `<root>/.rafa/runs/`, named by the session's id.
 *
 * `.specs/cli-surface.md`, "Sessions": `loop stop`, `pause`, `resume`,
 * `status` and `list` act on a run through its record, so every
 * `loop start` writes `.rafa/runs/<session-id>.json`. This module reads,
 * judges and writes those files, and prints nothing. `start/session.ts`
 * is where `loop start` calls it.
 *
 * ## The record
 *
 * A {@link SessionRecord}, written as indented JSON:
 *
 *   - `sessionId`: the run's id, the file's name before `.json`.
 *   - `planStub`: the plan's stub, or null for a plan whose file name
 *     carries none, as `PLAN.md` does (`utils/plan-stamp.ts`).
 *   - `plan`: the plan's path relative to the project root. The spec lists
 *     the stub alone; the path is what tells two stubless plans apart.
 *   - `branch`: the branch the run was started on.
 *   - `pid`: the process running the loop.
 *   - `startedAt`: when the run began, as an ISO timestamp.
 *   - `state`: one of {@link SESSION_STATES}.
 *   - `task`: the task running, its 1-based tracker line and its sentence,
 *     or null.
 *
 * ## One session is one `loop start`
 *
 * A session's id is new for every run, and a rerun of a plan never takes
 * over an earlier session's record. The preflight's run id is the session
 * id, and the store refuses a second preflight write under a run id it
 * already holds (`effort/store/preflight.ts`). Measured on 2026-09-15: the
 * second `writePreflightChecks` under one id threw
 * `UNIQUE constraint failed: preflight.run_id, preflight.position`, while
 * a write under another id went in. A rerun reusing its plan's session
 * would halt on that refusal whenever the plan names a prerequisite. So a
 * plan run three times on its branch leaves three records.
 *
 * ## The state a record reads as
 *
 * A record stored as `running` or `paused` whose pid is gone reads as
 * `stopped` ({@link readState}): the run ended without writing its end, as
 * a killed process does. `stopped` and `done` read as stored. A pid is
 * probed with signal 0, which sends nothing: a process that is gone
 * answers `ESRCH`, and one that exists under another user `EPERM`, which
 * reads as alive. A pid the system has handed to an unrelated process
 * since reads as alive too, so such a record keeps refusing its plan until
 * it is deleted; the refusal names its file.
 *
 * ## Uniqueness over plan, session and branch
 *
 * Two records name the same plan when both carry a stub and the stubs are
 * equal, or neither carries one and the paths are equal
 * ({@link samePlan}). A stub names the plan wherever its file sits, as
 * effort attribution reads it. {@link sessionConflicts} refuses a run over
 * each record of its plan that:
 *
 *   - **names another branch**, in whatever state: a plan that has a
 *     branch does not create another. A revised plan is a new stub, and a
 *     new stub has no record.
 *   - **names the run's branch and reads `running` or `paused`**: that
 *     session is running the plan, and a second run on the same tracker
 *     would dispatch its tasks twice.
 *
 * A record of the plan on the run's branch that reads `stopped` or `done`
 * refuses nothing. The rerun is a session of its own under the plan and
 * branch that match, which is the one way a plan runs twice.
 *
 * ## Writes
 *
 * Every write lands whole: the text goes to a temporary file beside the
 * record, whose name does not end in `.json`, and is then linked into
 * place for a new record or renamed over an existing one. The link fails
 * when the name is taken, so {@link beginSession} never overwrites a
 * record. A record is checked as it would be read before it is written,
 * so nothing this module writes is one it refuses to read.
 *
 * {@link beginSession} reads the records and writes the new one with no
 * lock between the two, so two runs of one plan started within that
 * window both go ahead. The loop is single-thread until phase 6, and the
 * window is one directory read.
 *
 * {@link updateSession} reads the stored record again and changes only
 * the fields it is handed, so a state another process wrote, as
 * `loop pause` writes `paused`, survives the loop writing its running
 * task. A key this module does not know is dropped by that write.
 *
 * ## What is refused on read
 *
 * {@link SessionRecordError}, naming the file: text that is no JSON
 * object, a field of the wrong type or outside its set, a pid that is no
 * positive whole number (signal 0 to pid 0 or below would reach a process
 * group), an unparsable `startedAt`, and a `sessionId` that is no plain
 * file name or differs from the file's name. {@link readSessions} reads
 * only names ending in `.json`, and answers no record when the directory
 * does not exist.
 */
import {
  linkSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { messageOf } from '../config-sections.js';
import { scopeAt } from '../project/scope.js';
import { isStampableStub } from '../utils/plan-stamp.js';

/** The states a session record holds, in the spec's order. */
export const SESSION_STATES = Object.freeze(['running', 'paused', 'stopped', 'done'] as const);

/** One of {@link SESSION_STATES}. */
export type SessionState = (typeof SESSION_STATES)[number];

/** The directory the records are kept in, under a project's `.rafa/`. */
export const RUNS_DIR = 'runs';

/** What a record's file name ends in. */
const RECORD_EXTENSION = '.json';

/** A session id usable as a file name: no separator, no leading dot. */
const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** The task a session is running. */
export interface SessionTask {
  /** The task's line in the tracker, counted from 1. */
  readonly line: number;
  /** The task's sentence, its routing declaration left out. */
  readonly text: string;
}

/** One `loop start` run, as its record holds it. See the module note. */
export interface SessionRecord {
  readonly sessionId: string;
  readonly planStub: string | null;
  readonly plan: string;
  readonly branch: string;
  readonly pid: number;
  readonly startedAt: string;
  readonly state: SessionState;
  readonly task: SessionTask | null;
}

/** What a new record is made from; it opens `running`, with no task. */
export type SessionDraft = Omit<SessionRecord, 'state' | 'task'>;

/** What {@link updateSession} changes. A field left out keeps its stored value. */
export interface SessionChange {
  readonly state?: SessionState;
  readonly task?: SessionTask | null;
}

/** Answers whether a process with this pid exists. */
export type PidProbe = (pid: number) => boolean;

/** The seams a read goes through. */
export interface SessionReadSeams {
  /** Whether a pid is alive. {@link isPidAlive} when left out. */
  readonly isAlive?: PidProbe;
}

/** Why a record of the plan refuses a run: its branch, or its live session. */
export type SessionConflictReason = 'branch' | 'live';

/** A record refusing a run, and why. */
export interface SessionConflict {
  readonly reason: SessionConflictReason;
  readonly record: SessionRecord;
}

/** A record file that cannot be read, or holds no record this module accepts. */
export class SessionRecordError extends Error {
  /** The record's path. */
  readonly file: string;

  constructor(file: string, problem: string) {
    super(`session record ${file}: ${problem}`);
    this.name = 'SessionRecordError';
    this.file = file;
  }
}

/** A run {@link beginSession} refused, over the records that refuse it. */
export class SessionConflictError extends Error {
  readonly conflicts: readonly SessionConflict[];

  constructor(conflicts: readonly SessionConflict[]) {
    const named = conflicts.map((conflict) => `${conflict.record.sessionId} (${conflict.reason})`);
    super(`the plan's sessions refuse the run: ${named.join(', ')}`);
    this.name = 'SessionConflictError';
    this.conflicts = conflicts;
  }
}

/** True when the text can name a record file. */
export function isSessionId(value: string): boolean {
  return SESSION_ID_PATTERN.test(value);
}

/** `<root>/.rafa/runs`. */
export function runsDir(root: string): string {
  return join(scopeAt(root).dir, RUNS_DIR);
}

/** `<root>/.rafa/runs/<sessionId>.json`. Throws on an id {@link isSessionId} refuses. */
export function sessionFilePath(root: string, sessionId: string): string {
  if (!isSessionId(sessionId)) {
    throw new Error(`session record: unusable session id ${JSON.stringify(sessionId)}`);
  }
  return join(runsDir(root), `${sessionId}${RECORD_EXTENSION}`);
}

/** A value as a problem names it. */
function describeValue(value: unknown): string {
  return value === undefined
    ? 'missing'
    : JSON.stringify(value) ?? String(value);
}

/** An own field of a parsed object, never one its prototype answers. */
function field(fields: object, key: string): unknown {
  return Object.hasOwn(fields, key)
    ? (fields as Record<string, unknown>)[key]
    : undefined;
}

/** True for a plain object, as `JSON.parse` makes one. */
function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True for a whole number from 1. */
function isPositiveWhole(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/** True for a string holding more than whitespace. */
function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/** The problem with a record's `task`, or null. */
function taskProblem(task: unknown): string | null {
  if (task === null) return null;
  if (!isObject(task)) return `task is ${describeValue(task)}, expected null or an object`;
  if (!isPositiveWhole(field(task, 'line'))) {
    return `task.line is ${describeValue(field(task, 'line'))}, expected a whole number from 1`;
  }
  return isText(field(task, 'text'))
    ? null
    : `task.text is ${describeValue(field(task, 'text'))}, expected a non-empty string`;
}

/** The problem with a record's `sessionId`, read from `file`, or null. */
function sessionIdProblem(sessionId: unknown, file: string): string | null {
  if (typeof sessionId !== 'string' || !isSessionId(sessionId)) {
    return `sessionId is ${describeValue(sessionId)}, expected a plain file name`;
  }
  return basename(file) === `${sessionId}${RECORD_EXTENSION}`
    ? null
    : `sessionId ${JSON.stringify(sessionId)} is not the file's name`;
}

/** The problem with a record's `planStub`, or null. */
function planStubProblem(planStub: unknown): string | null {
  return planStub === null || (typeof planStub === 'string' && isStampableStub(planStub))
    ? null
    : `planStub is ${describeValue(planStub)}, expected null or a plan stub`;
}

/** The problem with each text field that holds no text. */
function textProblems(fields: object): string[] {
  return ['plan', 'branch']
    .filter((key) => !isText(field(fields, key)))
    .map((key) => `${key} is ${describeValue(field(fields, key))}, expected a non-empty string`);
}

/** Every problem with a parsed record read from `file`. */
function recordProblems(fields: object, file: string): string[] {
  const pid = field(fields, 'pid');
  const startedAt = field(fields, 'startedAt');
  const state = field(fields, 'state');
  const problems = [
    sessionIdProblem(field(fields, 'sessionId'), file),
    planStubProblem(field(fields, 'planStub')),
    ...textProblems(fields),
    isPositiveWhole(pid)
      ? null
      : `pid is ${describeValue(pid)}, expected a whole number from 1`,
    typeof startedAt === 'string' && !Number.isNaN(Date.parse(startedAt))
      ? null
      : `startedAt is ${describeValue(startedAt)}, expected a timestamp`,
    (SESSION_STATES as readonly unknown[]).includes(state)
      ? null
      : `state is ${describeValue(state)}, expected one of ${SESSION_STATES.join(', ')}`,
    taskProblem(field(fields, 'task')),
  ];
  return problems.filter((problem): problem is string => problem !== null);
}

/** A frozen record of fields already checked, in the order it is written. */
function freezeRecord(fields: object): SessionRecord {
  const task = field(fields, 'task');
  return Object.freeze({
    sessionId: field(fields, 'sessionId') as string,
    planStub: field(fields, 'planStub') as string | null,
    plan: field(fields, 'plan') as string,
    branch: field(fields, 'branch') as string,
    pid: field(fields, 'pid') as number,
    startedAt: field(fields, 'startedAt') as string,
    state: field(fields, 'state') as SessionState,
    task: isObject(task)
      ? Object.freeze({ line: field(task, 'line') as number, text: field(task, 'text') as string })
      : null,
  });
}

/**
 * Reads a record out of the text of `file`, or throws
 * {@link SessionRecordError} naming every problem. See the module note.
 */
export function parseSessionRecord(text: string, file: string): SessionRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new SessionRecordError(file, `holds no JSON: ${messageOf(error)}`);
  }
  if (!isObject(parsed)) throw new SessionRecordError(file, 'holds no JSON object');

  const problems = recordProblems(parsed, file);
  if (problems.length > 0) throw new SessionRecordError(file, problems.join('; '));
  return freezeRecord(parsed);
}

/** The system's code on a thrown error, such as `ENOENT`, or null when it carries none. */
export function errorCode(error: unknown): string | null {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : null;
}

/**
 * Whether a process with this pid exists, by signal 0; false for a pid
 * that is no positive whole number, which is never signalled. See the
 * module note.
 */
export function isPidAlive(pid: number): boolean {
  if (!isPositiveWhole(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) === 'EPERM';
  }
}

/** The state a record reads as: `running` or `paused` with its pid gone reads `stopped`. */
export function readState(record: SessionRecord, isAlive: PidProbe = isPidAlive): SessionState {
  if (record.state === 'stopped' || record.state === 'done') return record.state;
  return isAlive(record.pid)
    ? record.state
    : 'stopped';
}

/** Reads one record file, any failure a {@link SessionRecordError}. */
function readRecordFile(file: string): SessionRecord {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    throw new SessionRecordError(file, `cannot be read: ${messageOf(error)}`);
  }
  return parseSessionRecord(text, file);
}

/** The names in the runs directory, or none when it does not exist. */
function recordNames(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return [];
    throw new SessionRecordError(dir, `cannot be listed: ${messageOf(error)}`);
  }
}

/** Oldest first, by start, then by id. */
function byStart(a: SessionRecord, b: SessionRecord): number {
  return Date.parse(a.startedAt) - Date.parse(b.startedAt) || a.sessionId.localeCompare(b.sessionId);
}

/**
 * Every record under `<root>/.rafa/runs/`, each with the state it reads as
 * ({@link readState}), oldest first. Throws {@link SessionRecordError} for
 * the first file that holds no record.
 */
export function readSessions(root: string, seams: SessionReadSeams = {}): readonly SessionRecord[] {
  const dir = runsDir(root);
  const isAlive = seams.isAlive ?? isPidAlive;
  const records = recordNames(dir)
    .filter((name) => name.endsWith(RECORD_EXTENSION))
    .map((name) => readRecordFile(join(dir, name)))
    .map((record) => Object.freeze({ ...record, state: readState(record, isAlive) }));
  return Object.freeze(records.sort(byStart));
}

/** Whether two records name the same plan. See the module note. */
export function samePlan(
  a: Pick<SessionRecord, 'planStub' | 'plan'>,
  b: Pick<SessionRecord, 'planStub' | 'plan'>,
): boolean {
  if (a.planStub !== null || b.planStub !== null) return a.planStub === b.planStub;
  return a.plan === b.plan;
}

/**
 * The records refusing a run of `candidate`'s plan on `candidate`'s
 * branch, in the order handed in. `records` carry the state they read as,
 * as {@link readSessions} answers them. See the module note.
 */
export function sessionConflicts(
  records: readonly SessionRecord[],
  candidate: Pick<SessionRecord, 'planStub' | 'plan' | 'branch'>,
): readonly SessionConflict[] {
  return records
    .filter((record) => samePlan(record, candidate))
    .flatMap((record): SessionConflict[] => {
      if (record.branch !== candidate.branch) return [{ reason: 'branch', record }];
      return record.state === 'running' || record.state === 'paused'
        ? [{ reason: 'live', record }]
        : [];
    });
}

/** Throws unless the record would be read back as written. */
function checkRecord(record: SessionRecord, file: string): void {
  const problems = recordProblems(record, file);
  if (problems.length > 0) throw new SessionRecordError(file, `not written: ${problems.join('; ')}`);
}

/** Writes the record whole: linked into place when new, renamed over the old one otherwise. */
function writeRecordFile(file: string, record: SessionRecord, isNew: boolean): void {
  checkRecord(record, file);
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`);
  try {
    if (isNew) linkSync(temporary, file);
    else renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
}

/**
 * Opens a session: refuses it with {@link SessionConflictError} when a
 * record of its plan does ({@link sessionConflicts}), and otherwise writes
 * its record, `running` with no task, and answers it. Throws
 * {@link SessionRecordError} when a record cannot be read, and the
 * system's error when the new one cannot be written, its id's file
 * already existing included.
 */
export function beginSession(
  root: string,
  draft: SessionDraft,
  seams: SessionReadSeams = {},
): SessionRecord {
  const file = sessionFilePath(root, draft.sessionId);
  const record = freezeRecord({ ...draft, state: 'running', task: null });

  const conflicts = sessionConflicts(readSessions(root, seams), record);
  if (conflicts.length > 0) throw new SessionConflictError(conflicts);

  writeRecordFile(file, record, true);
  return record;
}

/**
 * Changes the stored record of a session, reading it again first, and
 * answers the record written. Throws {@link SessionRecordError} when the
 * record cannot be read or the change would make it one that cannot be.
 */
export function updateSession(root: string, sessionId: string, change: SessionChange): SessionRecord {
  const file = sessionFilePath(root, sessionId);
  const stored = readRecordFile(file);
  const record = freezeRecord({
    ...stored,
    state: change.state ?? stored.state,
    task: change.task === undefined
      ? stored.task
      : change.task,
  });
  writeRecordFile(file, record, false);
  return record;
}
