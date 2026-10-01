/**
 * The session records of `loop start`: one JSON file per run under
 * `<root>/.rafa/runs/`, named by the session's id.
 *
 * `.rafa/specs/cli-surface.md`, "Sessions": `loop stop`, `pause`, `resume`,
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
 *   - `phase`: where the run is, one of {@link SESSION_PHASES}: `task`
 *     while it works its plan's tasks, then `wrap-up`, `pull-request`,
 *     `ci` and `repair`. The field is additive, as `steps` is: a record
 *     written before it, and a new record, carry no `phase` key, and
 *     {@link sessionPhase} reads such a record as `task`. A phase this
 *     rafa does not know, as a later rafa may write, is no problem on
 *     read and reads as `task` too; it is left out of the record read,
 *     so the next write of the record carries no `phase` key. It is
 *     written as its own `"phase": "<value>"` key, as `state` is, which
 *     the zsh prompt plugin's patterns over the file's text rely on
 *     (`extras/zsh/rafa-prompt/`). Once written, every later write keeps
 *     it until a change names another ({@link SessionChange}'s `phase`).
 *   - `hop`: only on a run started with `loop start --roadmap` while a
 *     `rafa next --roadmap` hop is away, the hop record as
 *     `.rafa/hop.json` held it when the run began
 *     (`src/next/hop-record.ts`, `start/session.ts`). A record of any
 *     other run carries no `hop` key at all, never one set to null, so
 *     such a record is written byte for byte as it was before the field.
 *     Once written, every later write of the record keeps it as it is.
 *   - `worktree`: only on a run whose checkout is a linked worktree rather
 *     than the project root, as a `loop start --as-worktree` run's is, the
 *     absolute path of that worktree (`start/session.ts`). A run in the
 *     main checkout carries no `worktree` key at all, as it carries no
 *     `hop`, and every later write keeps the path as it is.
 *   - `steps`: the suite steps the runner has recorded for the run, oldest
 *     first, each a {@link SessionStep}. The field is additive: a record
 *     written before it, and a run that has recorded no step, carry no
 *     `steps` key at all, and {@link sessionSteps} reads such a record as
 *     holding none. A stored `steps: []` reads the same way and is written
 *     back without the key. Steps are only ever appended
 *     ({@link SessionChange}'s `appendStep`); every later write keeps them.
 *
 * ## Steps
 *
 * A {@link SessionStep} is one suite run the runner made for the run:
 *
 *   - `kind`: one of {@link SESSION_STEP_KINDS}, `baseline` at the plan's
 *     first dispatch, `task` after a task commits, `stage` after a stage's
 *     last task, `pre-wrap-up` before the wrap-up.
 *   - `scope`: `affected`, `module` or `full` (`TEST_SCOPES`,
 *     `utils/declaration.ts`), or the list of files and folders run, which
 *     may be empty.
 *   - `command`: the argv spawned, `bun` first, never empty.
 *   - `exitCode`: the command's exit code, a whole number.
 *   - `summary`: Bun's `Ran N tests across M files.` line, or null when it
 *     printed none.
 *   - `failures`: the failing tests, each a file and a full test name
 *     (`SuiteFailure`, `suite/run.ts`).
 *   - `newFailures`: those of `failures` that are new against the
 *     baseline; every one of them is also in `failures`, compared by file
 *     and name.
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
 * A change handed `onlyFrom` is refused with {@link SessionStateError},
 * writing nothing, when the state stored is none of those. `loop pause`
 * moves only a `running` record and `loop resume` only a `paused` one, so
 * a run that writes its end between such a command's read and its write
 * keeps that end. The window left is the one between this module's own
 * read and its rename, which holds no lock either.
 *
 * ## Reading a record
 *
 * The record's field readers and {@link parseSessionRecord} live in
 * `loop/session-record-parse.ts`, whose note lists what is refused on
 * read. This module re-exports what a caller reads from there, so
 * `./sessions.js` stays the one import a record's reader needs.
 */
import type { SessionPhase, SessionState, SessionStepKind } from './session-record-parse.js';
import type { HopRecord } from '../next/hop-record.js';
import type { SuiteFailure } from '../suite/run.js';
import type { TestScope } from '../utils/declaration.js';

import {
  linkSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import { messageOf } from '../config-sections.js';
import { scopeAt } from '../project/scope.js';

import {
  freezeRecord,
  isPositiveWhole,
  isSessionId,
  parseSessionRecord,
  RECORD_EXTENSION,
  recordProblems,
  SessionRecordError,
  sessionSteps,
  stepProblems,
} from './session-record-parse.js';

export type { SessionPhase, SessionState, SessionStepKind } from './session-record-parse.js';
export {
  isSessionId,
  parseSessionRecord,
  SESSION_PHASES,
  SESSION_STATES,
  SESSION_STEP_KINDS,
  SessionRecordError,
  sessionPhase,
  sessionSteps,
} from './session-record-parse.js';

/** The directory the records are kept in, under a project's `.rafa/`. */
export const RUNS_DIR = 'runs';

/** The task a session is running. */
export interface SessionTask {
  /** The task's line in the tracker, counted from 1. */
  readonly line: number;
  /** The task's sentence, its routing declaration left out. */
  readonly text: string;
}

/** One suite run the runner recorded for a session. See the module note. */
export interface SessionStep {
  readonly kind: SessionStepKind;
  /** A named scope, or the files and folders run. */
  readonly scope: TestScope | readonly string[];
  /** The argv spawned, `bun` first. */
  readonly command: readonly string[];
  readonly exitCode: number;
  /** Bun's summary line, or null when it printed none. */
  readonly summary: string | null;
  readonly failures: readonly SuiteFailure[];
  /** Those of {@link SessionStep.failures} new against the baseline. */
  readonly newFailures: readonly SuiteFailure[];
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
  /** Where the run is; left out of a record from before the field. Read it with {@link sessionPhase}. */
  readonly phase?: SessionPhase;
  /** The away hop the run was started under; left out of every other run's record. See the module note. */
  readonly hop?: HopRecord;
  /** The linked worktree the run's checkout is; left out of a run in the main checkout. See the module note. */
  readonly worktree?: string;
  /** The suite steps recorded, oldest first; left out while there are none. Read it with {@link sessionSteps}. */
  readonly steps?: readonly SessionStep[];
}

/** What a new record is made from; it opens `running`, with no task, no phase and no step. */
export type SessionDraft = Omit<SessionRecord, 'state' | 'task' | 'phase' | 'steps'>;

/** What {@link updateSession} changes. A field left out keeps its stored value. */
export interface SessionChange {
  readonly state?: SessionState;
  readonly task?: SessionTask | null;
  /** The phase the run is now in. */
  readonly phase?: SessionPhase;
  /** A step appended after the stored ones. */
  readonly appendStep?: SessionStep;
  /**
   * The stored states the change acts on. Any other refuses it with
   * {@link SessionStateError}, writing nothing. Every state when left out.
   */
  readonly onlyFrom?: readonly SessionState[];
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

/** A change {@link updateSession} refused: the record stores a state the change does not act on. */
export class SessionStateError extends Error {
  /** The record's path. */
  readonly file: string;
  /** The state the record stores. */
  readonly state: SessionState;

  constructor(file: string, state: SessionState, onlyFrom: readonly SessionState[]) {
    const acted = onlyFrom.length === 0
      ? 'no state'
      : onlyFrom.join(' or ');
    super(`session record ${file}: stores ${state}, and the change acts on ${acted} alone`);
    this.name = 'SessionStateError';
    this.file = file;
    this.state = state;
  }
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

/**
 * The record of `sessionId` under `<root>/.rafa/runs/`, with the state it
 * reads as ({@link readState}). Throws {@link SessionRecordError} when its
 * file is not there or holds no record, and the error
 * {@link sessionFilePath} throws for an id it refuses.
 */
export function readSession(root: string, sessionId: string, seams: SessionReadSeams = {}): SessionRecord {
  const record = readRecordFile(sessionFilePath(root, sessionId));
  return Object.freeze({ ...record, state: readState(record, seams.isAlive ?? isPidAlive) });
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
 * answers the record written; a change's `appendStep` goes after the
 * stored steps. Throws {@link SessionRecordError} when the
 * record cannot be read or the change would make it one that cannot be,
 * and {@link SessionStateError} when it stores a state the change's
 * `onlyFrom` leaves out.
 */
export function updateSession(root: string, sessionId: string, change: SessionChange): SessionRecord {
  const file = sessionFilePath(root, sessionId);
  const stored = readRecordFile(file);
  if (change.onlyFrom !== undefined && !change.onlyFrom.includes(stored.state)) {
    throw new SessionStateError(file, stored.state, change.onlyFrom);
  }
  const appended = change.appendStep === undefined
    ? []
    : stepProblems(change.appendStep, `steps[${sessionSteps(stored).length}]`);
  if (appended.length > 0) throw new SessionRecordError(file, `not written: ${appended.join('; ')}`);
  const record = freezeRecord({
    ...stored,
    state: change.state ?? stored.state,
    task: change.task === undefined
      ? stored.task
      : change.task,
    phase: change.phase ?? stored.phase,
    steps: change.appendStep === undefined
      ? sessionSteps(stored)
      : [...sessionSteps(stored), change.appendStep],
  });
  writeRecordFile(file, record, false);
  return record;
}
