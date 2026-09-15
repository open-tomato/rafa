/**
 * `rafa loop resume`: lets a paused session go on.
 *
 * ## What it does
 *
 * It picks a session reading `running` or `paused` (`loop-sessions.ts`),
 * preferring none over the other, since a branch pairs with one live
 * session, and writes `running` to its record. A run holding between
 * tasks reads that within one wait (`start/pause.ts`) and goes on with its
 * next task. A run whose pause has not taken effect, its task still
 * running, carries on past that task as if it had never been paused.
 *
 * The write moves only a record storing `paused` (`loop/sessions.ts`). A
 * session already running is left as it is, and the command exits 0.
 *
 * A session reading `stopped` or `done` has no run left to resume: its
 * process has ended, and until phase 6 no command starts one in the
 * background. The refusal names the `rafa loop start` line that runs its
 * plan again, as a session of its own.
 *
 * ## What it writes
 *
 * In json mode the terminal result's `data` holds `session`, the record as
 * written, or as read when nothing changed, and `changed`. Text mode
 * writes one line.
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
const USAGE = 'rafa loop resume [-s|--session-id=<id>]';

/** What one resume did. */
export interface ResumeResult {
  readonly session: SessionRecord;
  readonly changed: boolean;
}

/** The lines text mode writes. */
export function renderResume(result: ResumeResult): string[] {
  const { session } = result;
  if (!result.changed) return [`Session ${session.sessionId} is running, not paused; nothing changed.`];
  return [session.task === null
    ? `Resumed session ${session.sessionId}: it goes on with its next task.`
    : `Resumed session ${session.sessionId}: it goes on past its running task, line ${session.task.line}, ${session.task.text}`];
}

/** Resumes the session the line picks. See the module note. */
async function runResume(context: RafaContext, seams: ResolvedLoopSeams): Promise<void> {
  expectNoArgument(context.args, USAGE);
  const { root, record } = pickSession(context, USAGE, 'live', seams);
  if (!isLive(record)) {
    throw refusal(
      `Session ${record.sessionId} reads ${record.state}: its run has ended, so there is nothing to resume.`,
      `\`rafa loop start --plan=${record.plan}\` runs its plan again as a new session, its blocked tasks first.`,
    );
  }
  const result: ResumeResult = record.state === 'running'
    ? { session: record, changed: false }
    : { session: writeSession(root, record, { state: 'running', onlyFrom: ['paused'] }), changed: true };

  if (context.outputMode === 'json') {
    context.output.result(result);
    return;
  }
  for (const line of renderResume(result)) context.output.info(line);
}

/** The command, reaching the system through `seams`. See the module note. */
export function createLoopResumeCommand(seams: LoopSessionSeams = {}): RafaCommand {
  const resolved = resolveLoopSeams(seams);
  const command: RafaCommand = {
    name: 'loop resume',
    subject: 'loop',
    action: 'resume',
    summary: 'resume a paused session from its next task',
    description: 'Writes `running` to the record of a paused session, so a run holding between tasks goes'
      + ' on with its next one, and a run whose running task has not ended yet carries on past it as if'
      + ' never paused. A session already running is left as it is. A session that has ended is not'
      + ' resumed: `rafa loop start` runs its plan again as a new session. With `--output=json` the session'
      + ' record and whether it changed are the data of the terminal result event.',
    args: [],
    flags: [sessionIdFlag('to resume')],
    examples: [
      {
        cmd: 'rafa loop resume',
        note: 'Resumes the session paused on the branch checked out here.',
      },
      {
        cmd: 'rafa loop resume --session-id=9185b41c-65f7-4dd6-a0c1-6494c4028f0f',
        note: 'Resumes that session, whatever branch is checked out.',
      },
    ],
    outputs: ['text', 'json'],
    run: async (context) => runResume(context, resolved),
  };
  return Object.freeze(command);
}

export default createLoopResumeCommand();
