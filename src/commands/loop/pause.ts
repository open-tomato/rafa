/**
 * `rafa loop pause`: pauses a running session once the task it is running
 * ends.
 *
 * ## What it does
 *
 * It picks a session reading `running` or `paused` (`loop-sessions.ts`)
 * and writes `paused` to its record, and does nothing else: no signal, no
 * tracker line. The loop reads its record between tasks (`start/pause.ts`),
 * so the running task ends as it would have, committed, marked and
 * stored, and the run then holds before the next task, marking nothing,
 * until `rafa loop resume` writes `running` or `rafa loop stop` ends it.
 * While the task still runs the record keeps naming it; once the run holds,
 * it names none.
 *
 * The write moves only a record storing `running`, so a run that writes its
 * end between the read and the write keeps that end (`loop/sessions.ts`).
 * A session already paused is left as it is, and the command exits 0.
 *
 * ## What it writes
 *
 * In json mode the terminal result's `data` holds `session`, the record as
 * written, or as read when nothing changed, and `changed`. Text mode
 * writes what the run will do, and what to type next.
 *
 * ## Refusals
 *
 * Exit code 1: the refusals `loop-sessions.ts` names, and a session that
 * reads `stopped` or `done`.
 */
import type { LoopSessionSeams, ResolvedLoopSeams } from './loop-sessions.js';
import type { RafaCommand, RafaContext } from '../../cli/command.js';
import type { SessionRecord } from '../../loop/sessions.js';

import { expectNoArgument } from '../plan/plan-files.js';

import {
  isLive,
  pickSession,
  refusal,
  resolveLoopSeams,
  sessionIdFlag,
  writeSession,
} from './loop-sessions.js';

/** The usage line a refusal names. */
const USAGE = 'rafa loop pause [-s|--session-id=<id>]';

/** What one pause did. */
export interface PauseResult {
  readonly session: SessionRecord;
  readonly changed: boolean;
}

/** The lines text mode writes. */
export function renderPause(result: PauseResult): string[] {
  const { session } = result;
  if (!result.changed) return [`Session ${session.sessionId} is already paused; nothing changed.`];
  const when = session.task === null
    ? `Paused session ${session.sessionId}: it holds before its next task.`
    : `Pausing session ${session.sessionId} once its running task ends: line ${session.task.line}, ${session.task.text}`;
  return [when, '  Nothing is marked. `rafa loop resume` goes on, and `rafa loop stop` ends the run.'];
}

/** Pauses the session the line picks. See the module note. */
async function runPause(context: RafaContext, seams: ResolvedLoopSeams): Promise<void> {
  expectNoArgument(context.args, USAGE);
  const { root, record } = pickSession(context, USAGE, 'live', seams);
  if (!isLive(record)) {
    throw refusal(`Session ${record.sessionId} reads ${record.state}: no run is left to pause.`);
  }
  const result: PauseResult = record.state === 'paused'
    ? { session: record, changed: false }
    : { session: writeSession(root, record, { state: 'paused', onlyFrom: ['running'] }), changed: true };

  if (context.outputMode === 'json') {
    context.output.result(result);
    return;
  }
  for (const line of renderPause(result)) context.output.info(line);
}

/** The command, reaching the system through `seams`. See the module note. */
export function createLoopPauseCommand(seams: LoopSessionSeams = {}): RafaCommand {
  const resolved = resolveLoopSeams(seams);
  const command: RafaCommand = {
    name: 'loop pause',
    subject: 'loop',
    action: 'pause',
    summary: 'pause a running session once the task it is running ends',
    description: 'Writes `paused` to the record of a running session. The loop reads its record between'
      + ' tasks, so the running task ends, is committed and is marked as it would have been, and the run'
      + ' then holds before its next task, marking nothing, until `rafa loop resume` goes on or'
      + ' `rafa loop stop` ends the run. A session already paused is left as it is. With `--output=json`'
      + ' the session record and whether it changed are the data of the terminal result event.',
    args: [],
    flags: [sessionIdFlag('to pause')],
    examples: [
      {
        cmd: 'rafa loop pause',
        note: 'Pauses the session running on the branch checked out here once its running task ends.',
      },
      {
        cmd: 'rafa loop pause -s 9185b41c-65f7-4dd6-a0c1-6494c4028f0f',
        note: 'Pauses that session, whatever branch is checked out.',
      },
    ],
    outputs: ['text', 'json'],
    run: async (context) => runPause(context, resolved),
  };
  return Object.freeze(command);
}

export default createLoopPauseCommand();
