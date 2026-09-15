/**
 * The session record of one `loop start` run: the refusal of a second run
 * of its plan, the record written, and each change the run makes to it,
 * over `loop/sessions.ts`.
 *
 * `start()` opens the session through {@link openRunSession} right after
 * the branch guard lets the run through, before anything else is printed
 * or checked, and hands the session's id to the preflight as its run id.
 * Everything after the open runs inside a `try` whose `finally` calls
 * {@link RunSession.end}, so every way out of the run writes its end.
 *
 * ## What the record says, and when
 *
 *   - **Opened**: `running`, no task, this process's pid, the clock's
 *     time, the plan's stub and its path relative to the project root, and
 *     the branch the guard read.
 *   - **Before each dispatch** ({@link RunSession.taskStarted}): the task's
 *     tracker line counted from 1, and its sentence with the routing
 *     declaration left out, as the dispatch quotes it.
 *   - **When no task is left** ({@link RunSession.wrapUpStarted}): no task,
 *     while the wrap-up and the CI wait run.
 *   - **At the end** ({@link RunSession.end}): `done` once
 *     {@link RunSession.finished} was called, which `start()` does after
 *     the wrap-up and the CI wait come back; `stopped` for every other way
 *     out. Those are a failed, blocked, interrupted or unstored task, a
 *     pause for usage, a store the progress render cannot open, and
 *     anything thrown. A stopped record keeps the task it stopped at.
 *
 * Each change after the open reads the stored record again and changes
 * only its own field, so a `paused` another process wrote is kept by the
 * loop writing its next task (`loop/sessions.ts`).
 *
 * ## The refusals
 *
 * The open throws `CommandExit` (`cli/command.ts`) with exit code 1 and
 * the whole refusal as its message, each ending with
 * `Nothing was checked and nothing was dispatched.`:
 *
 *   - **A record of the plan refuses the run** ({@link sessionRefusal}):
 *     one on another branch, whatever its state, or one on this branch
 *     that reads `running` or `paused`. The refusal names each such
 *     session, its branch, its state, its pid and start, and its record.
 *   - **The records cannot be read, or the new one written**: the runs
 *     directory cannot be listed, a `.json` file there holds no record the
 *     module accepts, or the write fails. A run with no record is one
 *     `loop stop` and `loop status` cannot find, and a record that cannot
 *     be read may be a live session of the plan.
 *
 * An error that is neither a record's nor the system's is thrown as it
 * was, never dressed as a refusal.
 *
 * ## A change after the open never stops the run
 *
 * A task, wrap-up or end that cannot be written is warned about in one
 * line, and the run goes on as it would have. The record is what other
 * commands read about the run, while its work is the tracker's and the
 * store's, both written by then.
 *
 * Every line goes through the active output (`adapters/output/active.ts`).
 * A run that is let through prints nothing here.
 */
import type {
  PidProbe,
  SessionChange,
  SessionConflict,
  SessionDraft,
} from '../loop/sessions.js';
import type { TaskInfo } from '../utils/tracker.js';

import { randomUUID } from 'node:crypto';
import { relative } from 'node:path';

import { activeOutput } from '../adapters/output/active.js';
import { CommandExit } from '../cli/command.js';
import { messageOf } from '../config-sections.js';
import {
  beginSession,
  errorCode,
  runsDir,
  SessionConflictError,
  sessionFilePath,
  SessionRecordError,
  updateSession,
} from '../loop/sessions.js';
import { stripTaskDeclaration } from '../utils/declaration.js';

/** The last line of every refusal the open throws. */
export const NOTHING_DISPATCHED = '   Nothing was checked and nothing was dispatched.';

/** The seams a session is opened through. Each left out is the system's own. */
export interface RunSessionSeams {
  /** Where the session's id comes from. `randomUUID` when left out. */
  readonly newSessionId?: () => string;
  /** The pid the record names. `process.pid` when left out. */
  readonly pid?: number;
  /** The clock `startedAt` is read from. The system clock when left out. */
  readonly now?: () => Date;
  /** Whether a record's pid is alive. `isPidAlive` when left out. */
  readonly isAlive?: PidProbe;
}

/** What {@link openRunSession} opens a session for. */
export interface RunSessionOptions {
  /** The project root: the records go under its `.rafa/runs/`. */
  readonly repoRoot: string;
  /** The plan the run executes, as `start()` resolved it. */
  readonly planPath: string;
  /** The plan's stub, or null for a plan whose file name carries none. */
  readonly planStub: string | null;
  /** The branch the run is on. */
  readonly branch: string;
  readonly seams?: RunSessionSeams;
}

/** An open session, as `start()` writes to it. See the module note. */
export interface RunSession {
  /** The session's id, which is the preflight's run id. */
  readonly id: string;
  /** Writes the task about to be dispatched. */
  taskStarted(taskInfo: Pick<TaskInfo, 'task' | 'lineNum'>): void;
  /** Writes that no task is running, as the wrap-up starts. */
  wrapUpStarted(): void;
  /** Notes that the run reached its end, so {@link RunSession.end} writes `done`. */
  finished(): void;
  /** Writes `done` after {@link RunSession.finished}, and `stopped` otherwise. */
  end(): void;
}

/** A record's path as a refusal or a warning names it: relative to the project root. */
function recordLabel(repoRoot: string, sessionId: string): string {
  return relative(repoRoot, sessionFilePath(repoRoot, sessionId));
}

/** The line naming one refusing session. */
function conflictLine(repoRoot: string, conflict: SessionConflict): string {
  const { record } = conflict;
  const verb = conflict.reason === 'branch'
    ? 'ran it on'
    : 'is running it on';
  return `   Session ${record.sessionId} ${verb} \`${record.branch}\`: ${record.state}, pid ${record.pid},`
    + ` started ${record.startedAt}; its record is ${recordLabel(repoRoot, record.sessionId)}.`;
}

/**
 * The refusal of a run of `draft`'s plan over the records refusing it:
 * what refuses it, one line per session, what to do, and that nothing was
 * checked. See the module note.
 */
export function sessionRefusal(
  repoRoot: string,
  draft: Pick<SessionDraft, 'planStub' | 'plan' | 'branch'>,
  conflicts: readonly SessionConflict[],
): string {
  const onOtherBranch = conflicts.some((conflict) => conflict.reason === 'branch');
  const running = conflicts.some((conflict) => conflict.reason === 'live');
  const why = [
    onOtherBranch
      ? 'it already has a branch'
      : null,
    running
      ? 'a session is already running it'
      : null,
  ].filter((reason) => reason !== null);

  return [
    `❌ Refusing to run plan \`${draft.planStub ?? draft.plan}\` on \`${draft.branch}\`: ${why.join(', and ')}.`,
    ...conflicts.map((conflict) => conflictLine(repoRoot, conflict)),
    ...onOtherBranch
      ? ['   A plan runs on one branch: check out that branch to run it there, or revise the plan under a new stub.']
      : [],
    ...running
      ? ['   One session runs a plan at a time: let that run end, or interrupt it, then run again.']
      : [],
    NOTHING_DISPATCHED,
  ].join('\n');
}

/** The refusal for an open that threw `error`, or null for an error to throw as it is. */
function openRefusal(repoRoot: string, draft: SessionDraft, error: unknown): string | null {
  if (error instanceof SessionConflictError) return sessionRefusal(repoRoot, draft, error.conflicts);
  const isSystemError = error instanceof Error && errorCode(error) !== null;
  if (!(error instanceof SessionRecordError) && !isSystemError) return null;
  return [
    `❌ Refusing to start: the session records under ${relative(repoRoot, runsDir(repoRoot))}/ cannot be read or written.`,
    `   ${messageOf(error)}`,
    NOTHING_DISPATCHED,
  ].join('\n');
}

/** The session `start()` writes to, over the record of `sessionId`. */
function sessionHandle(repoRoot: string, sessionId: string): RunSession {
  let reachedEnd = false;

  const change = (what: string, patch: SessionChange): void => {
    try {
      updateSession(repoRoot, sessionId, patch);
    } catch (error) {
      activeOutput().warn(`\n⚠️  Session ${sessionId}: ${what} was not written to ${recordLabel(repoRoot, sessionId)}: ${messageOf(error)}`);
    }
  };

  return Object.freeze({
    id: sessionId,
    taskStarted: (taskInfo: Pick<TaskInfo, 'task' | 'lineNum'>) => change('the running task', {
      task: { line: taskInfo.lineNum + 1, text: stripTaskDeclaration(taskInfo.task) },
    }),
    wrapUpStarted: () => change('the end of the tasks', { task: null }),
    finished: () => {
      reachedEnd = true;
    },
    end: () => change('the end of the run', {
      state: reachedEnd
        ? 'done'
        : 'stopped',
    }),
  });
}

/**
 * Opens the session of one `loop start` run: refuses it by throwing
 * `CommandExit` with exit code 1, or writes its record and answers the
 * session. See the module note.
 */
export function openRunSession(options: RunSessionOptions): RunSession {
  const { repoRoot } = options;
  const seams = options.seams ?? {};
  const draft: SessionDraft = {
    sessionId: (seams.newSessionId ?? randomUUID)(),
    planStub: options.planStub,
    plan: relative(repoRoot, options.planPath),
    branch: options.branch,
    pid: seams.pid ?? process.pid,
    startedAt: (seams.now ?? (() => new Date()))().toISOString(),
  };

  try {
    beginSession(repoRoot, draft, { isAlive: seams.isAlive });
  } catch (error) {
    const refusal = openRefusal(repoRoot, draft, error);
    if (refusal === null) throw error;
    throw new CommandExit(1, refusal);
  }
  return sessionHandle(repoRoot, draft.sessionId);
}
