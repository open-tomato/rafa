/**
 * `rafa loop stop`: ends a running session now, the task it is running
 * marked `[BLOCKED]`.
 *
 * ## What it does
 *
 * It picks a session reading `running` or `paused` (`loop-sessions.ts`)
 * and sends SIGINT to the pid its record names. This command marks
 * nothing: the loop answers the signal (`src/start.ts`). It passes it on
 * to the Claude session it is running (`utils/claude.ts`), marks that
 * task `[BLOCKED]`, stores its report and ends, writing `stopped` to the
 * record. A run held by a pause ends within one read of its record
 * (`start/pause.ts`), with no task marked.
 *
 * The command then reads the record every `STOP_POLL_MS` milliseconds
 * until it reads `stopped` or `done`, for at most `STOP_WAIT_MS`, both in
 * `loop-sessions.ts`. Once it does, it reads the line of the task the
 * record ended at in the plan's tracker, and says what the line holds:
 * `[BLOCKED]` for a task the stop interrupted, `[x]` for one that finished
 * before the signal landed. A record ending with no task was running none.
 *
 * A run that has not ended by then is no refusal. The signal was sent, and
 * the run ends once the step it is in returns, which for the wrap-up or
 * the CI wait can be minutes. That is warned about, and the command exits
 * 0. A pid gone before the signal is sent reads `stopped` on the next
 * read, as a record whose pid is gone does.
 *
 * ## What it writes
 *
 * In json mode the terminal result's `data` holds `session`, the record
 * as last read; `ended`, whether it reads `stopped` or `done`; and `task`,
 * the task it ended at with its tracker line's `checkbox` (`unchecked`,
 * `blocked`, `done`, or null for a line holding no task), or null. Text
 * mode writes the same as lines, and the warning at `warn`.
 *
 * ## Refusals
 *
 * Exit code 1, before any signal: the refusals `loop-sessions.ts` names,
 * a session that reads `stopped` or `done`, and a signal the system
 * refuses for any reason but the pid being gone. A record that cannot be
 * read after the signal is refused too, the signal having been sent.
 */
import type { LoopSessionSeams, ResolvedLoopSeams, SessionChecklist } from './loop-sessions.js';
import type { RafaCommand, RafaContext } from '../../cli/command.js';
import type { SessionRecord } from '../../loop/sessions.js';
import type { PlanTask } from '../../plan/index.js';

import { messageOf } from '../../config-sections.js';
import { errorCode, readSession, SessionRecordError } from '../../loop/sessions.js';
import { expectNoArgument } from '../plan/plan-files.js';

import {
  checkboxAt,
  isLive,
  pickSession,
  planLabel,
  readSessionChecklist,
  refusal,
  resolveLoopSeams,
  sessionIdFlag,
} from './loop-sessions.js';

/** The usage line a refusal names. */
const USAGE = 'rafa loop stop [-s|--session-id=<id>]';

/** The task a stopped session ended at, and what its tracker line holds. */
export interface StoppedTask {
  /** The task's tracker line, counted from 1. */
  readonly line: number;
  /** Its sentence, as the record holds it. */
  readonly text: string;
  /** The line's checkbox, or null when the tracker holds no task there. */
  readonly checkbox: PlanTask['status'] | null;
}

/** What one stop did. See the module note. */
export interface StopResult {
  readonly session: SessionRecord;
  readonly ended: boolean;
  readonly task: StoppedTask | null;
}

/** Sends SIGINT to the session's pid; a pid already gone is no refusal. */
function signalRun(record: SessionRecord, interrupt: ResolvedLoopSeams['interrupt']): void {
  try {
    interrupt(record.pid);
  } catch (error) {
    if (errorCode(error) === 'ESRCH') return;
    throw refusal(`SIGINT could not be sent to session ${record.sessionId}, pid ${record.pid}.`, messageOf(error));
  }
}

/** The record read again, refused when it cannot be, the signal having been sent. */
function readAfterSignal(root: string, record: SessionRecord, seams: ResolvedLoopSeams): SessionRecord {
  try {
    return readSession(root, record.sessionId, { isAlive: seams.isAlive });
  } catch (error) {
    if (!(error instanceof SessionRecordError)) throw error;
    throw refusal(`SIGINT was sent to session ${record.sessionId}, pid ${record.pid}, and its record cannot be read again.`, messageOf(error));
  }
}

/** The record once it reads `stopped` or `done`, or as last read when the wait runs out. */
async function waitForEnd(root: string, record: SessionRecord, seams: ResolvedLoopSeams): Promise<SessionRecord> {
  let waited = 0;
  while (true) {
    const read = readAfterSignal(root, record, seams);
    if (!isLive(read) || waited >= seams.stopWaitMs) return read;
    await seams.sleep(seams.pollMs);
    waited += seams.pollMs;
  }
}

/** The task a record ended at, with what the checklist holds at its line. */
function stoppedTask(record: SessionRecord, checklist: SessionChecklist | null): StoppedTask | null {
  if (record.task === null) return null;
  return { line: record.task.line, text: record.task.text, checkbox: checkboxAt(checklist, record.task.line) };
}

/** What a stopped task's line holds, as a sentence. */
function taskSentence(task: StoppedTask): string {
  const at = `The task at line ${task.line}`;
  if (task.checkbox === 'blocked') return `${at} is marked [BLOCKED]: ${task.text}`;
  if (task.checkbox === 'done') return `${at} finished before the signal landed, and stays [x]: ${task.text}`;
  if (task.checkbox === 'unchecked') return `${at} still reads [ ]: ${task.text}`;
  return `The tracker holds no task at line ${task.line}: ${task.text}`;
}

/** The lines text mode writes for a run that ended. */
export function renderStop(result: StopResult): string[] {
  const { session, task } = result;
  return [
    `Session ${session.sessionId} ended ${session.state}: plan \`${planLabel(session)}\` on \`${session.branch}\`.`,
    `  ${task === null
      ? 'No task was running, so none was marked.'
      : taskSentence(task)}`,
    ...session.state === 'stopped'
      ? [`  \`rafa loop start --plan=${session.plan}\` runs the plan again, its blocked tasks first.`]
      : [],
  ];
}

/** Stops the session the line picks, and writes what became of it. See the module note. */
async function runStop(context: RafaContext, seams: ResolvedLoopSeams): Promise<void> {
  expectNoArgument(context.args, USAGE);
  const { root, record } = pickSession(context, USAGE, 'live', seams);
  if (!isLive(record)) {
    throw refusal(`Session ${record.sessionId} reads ${record.state}: no run is left to stop.`);
  }

  signalRun(record, seams.interrupt);
  const session = await waitForEnd(root, record, seams);
  const ended = !isLive(session);
  const result: StopResult = {
    session,
    ended,
    task: ended
      ? stoppedTask(session, readSessionChecklist(root, session))
      : null,
  };

  if (context.outputMode === 'json') {
    context.output.result(result);
    return;
  }
  if (!ended) {
    context.output.warn(`SIGINT was sent to session ${record.sessionId}, pid ${record.pid}, and its record still reads`
      + ` ${session.state} after ${seams.stopWaitMs / 1000}s: the run ends once the step it is in returns.`
      + ' `rafa loop status` reads it.');
    return;
  }
  for (const line of renderStop(result)) context.output.info(line);
}

/** The command, reaching the system through `seams`. See the module note. */
export function createLoopStopCommand(seams: LoopSessionSeams = {}): RafaCommand {
  const resolved = resolveLoopSeams(seams);
  const command: RafaCommand = {
    name: 'loop stop',
    subject: 'loop',
    action: 'stop',
    summary: 'stop a running session now, the task it is running marked [BLOCKED]',
    description: 'Sends SIGINT to the loop running a session. The loop passes it on to the task session'
      + ' it is running, marks that task `[BLOCKED]`, stores its report and ends, its record then reading'
      + ' `stopped`; a paused run ends with no task marked. The command waits up to 30 seconds for the'
      + ' record to say so, then names the task the run ended at and what its tracker line holds. A run'
      + ' still in its wrap-up or CI wait after that is warned about, since it ends once that step returns.'
      + ' Running the plan again with `rafa loop start` retries the blocked task first. With'
      + ' `--output=json` the session, whether it ended and its task are the data of the terminal result'
      + ' event.',
    args: [],
    flags: [sessionIdFlag('to stop')],
    examples: [
      {
        cmd: 'rafa loop stop',
        note: 'Stops the session running on the branch checked out here, marking its running task [BLOCKED].',
      },
      {
        cmd: 'rafa loop stop --session-id=9185b41c-65f7-4dd6-a0c1-6494c4028f0f --output=json',
        note: 'Stops that session, and writes the record it ended with as the data of the result event.',
      },
    ],
    outputs: ['text', 'json'],
    run: async (context) => runStop(context, resolved),
  };
  return Object.freeze(command);
}

export default createLoopStopCommand();
