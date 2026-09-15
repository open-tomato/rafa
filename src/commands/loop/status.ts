/**
 * `rafa loop status`: one session, with its tasks done over total and a
 * rough ETA.
 *
 * ## What it reads
 *
 * The session the line picks (`loop-sessions.ts`): the one `--session-id`
 * names, or the one running or paused on the branch checked out at the
 * project root, or, with none of those, the newest session that ran on
 * that branch. Its record gives the state it reads as, the pid, the start
 * and the task it names. The plan's tracker gives the tasks done, blocked
 * and open over the whole plan, read from the plan itself before the run
 * made its tracker, and nothing when neither file is there.
 *
 * A session reading `running` or `paused` also gets its rough ETA from the
 * effort store (`loop-sessions.ts`, "The rough ETA"). A store that cannot
 * be read is warned about, and the status is given without one. A session
 * that has ended gets none.
 *
 * A record reading `paused` while it still names a task has a pause that
 * has not taken effect: the run holds once that task ends, and the status
 * says so.
 *
 * ## What it writes
 *
 * In json mode the terminal result's `data` holds `session`, the record;
 * `checklist`, the file the tasks were counted from, absolute, or null;
 * `tasks`, the counts, or null; and `eta`, or null. Text mode writes the
 * session's line, then one line each for its tasks, its task and its ETA.
 *
 * ## Refusals
 *
 * Exit code 1: the refusals `loop-sessions.ts` names.
 */
import type { LoopSessionSeams, ResolvedLoopSeams, SessionEta } from './loop-sessions.js';
import type { RafaCommand, RafaContext } from '../../cli/command.js';
import type { SessionRecord } from '../../loop/sessions.js';
import type { TaskCounts } from '../plan/plan-files.js';

import { messageOf } from '../../config-sections.js';
import { countTasks, expectNoArgument, formatCounts } from '../plan/plan-files.js';

import {
  estimateEta,
  etaLine,
  isLive,
  pickSession,
  readSessionChecklist,
  readSessionFinishes,
  resolveLoopSeams,
  sessionIdFlag,
  sessionLine,
} from './loop-sessions.js';

/** The usage line a refusal names. */
const USAGE = 'rafa loop status [-s|--session-id=<id>]';

/** One session's status. See the module note. */
export interface SessionStatus {
  readonly session: SessionRecord;
  readonly checklist: string | null;
  readonly tasks: TaskCounts | null;
  readonly eta: SessionEta | null;
}

/** The lines text mode writes for a status. */
export function renderStatus(status: SessionStatus): string[] {
  const { session, tasks, eta } = status;
  const { task } = session;
  const pending = session.state === 'paused' && task !== null
    ? ' (the run holds once it ends)'
    : '';
  return [
    `Session ${sessionLine(session)}`,
    tasks === null
      ? `  Tasks: neither \`${session.plan}\` nor its tracker is there to count`
      : `  Tasks: ${formatCounts(tasks)}`,
    ...task === null
      ? []
      : [`  Task: line ${task.line}, ${task.text}${pending}`],
    ...eta === null
      ? []
      : [`  ${etaLine(eta)}`],
  ];
}

/** Shows the session the line picks. See the module note. */
async function runStatus(context: RafaContext, seams: ResolvedLoopSeams): Promise<void> {
  expectNoArgument(context.args, USAGE);
  const { root, record } = pickSession(context, USAGE, 'live-or-newest', seams);
  const checklist = readSessionChecklist(root, record);
  const tasks = checklist === null
    ? null
    : countTasks(checklist.tasks);

  let eta: SessionEta | null = null;
  if (tasks !== null && isLive(record)) {
    try {
      eta = estimateEta(record.startedAt, readSessionFinishes(root, record), tasks);
    } catch (error) {
      context.output.warn(`The effort store cannot be read, so the status has no ETA: ${messageOf(error)}`);
    }
  }

  const status: SessionStatus = { session: record, checklist: checklist?.file ?? null, tasks, eta };
  if (context.outputMode === 'json') {
    context.output.result(status);
    return;
  }
  for (const line of renderStatus(status)) context.output.info(line);
}

/** The command, reaching the system through `seams`. See the module note. */
export function createLoopStatusCommand(seams: LoopSessionSeams = {}): RafaCommand {
  const resolved = resolveLoopSeams(seams);
  const command: RafaCommand = {
    name: 'loop status',
    subject: 'loop',
    action: 'status',
    summary: 'show a session: its state, tasks done over total and a rough ETA',
    description: 'Reads a session record and its plan\'s tracker: the state, the pid, the start, the task'
      + ' it names, and the tasks done, blocked and open over the whole plan. A running or paused session'
      + ' also gets a rough ETA from the effort store: the time from its start to the last task it'
      + ' finished, per task finished, times the open and blocked tasks left, and none before its first'
      + ' task finishes. Without `--session-id` it shows the session running on the branch checked out at'
      + ' the project root, or the newest one that ran there. With `--output=json` the record, the counts'
      + ' and the ETA are the data of the terminal result event.',
    args: [],
    flags: [sessionIdFlag('to show')],
    examples: [
      {
        cmd: 'rafa loop status',
        note: 'Shows the session on the branch checked out here: its state, tasks done over total and ETA.',
      },
      {
        cmd: 'rafa loop status --session-id=9185b41c-65f7-4dd6-a0c1-6494c4028f0f --output=json',
        note: 'Writes that session\'s record, task counts and ETA as the data of the result event.',
      },
    ],
    outputs: ['text', 'json'],
    run: async (context) => runStatus(context, resolved),
  };
  return Object.freeze(command);
}

export default createLoopStatusCommand();
