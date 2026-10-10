/**
 * `rafa loop status`: one session, with its tasks done over total and a
 * rough ETA. This is the command half: the blocked tasks of a checklist
 * and the blocker each trails are read by its library half,
 * `../../loop/blocked-tasks.ts`, which any folder may take.
 *
 * ## What it reads
 *
 * The session the line picks (`loop-sessions.ts`): the one `--session-id`
 * names, or the one running or paused on the branch checked out at the
 * project root, or, with none of those, the newest session that ran on
 * that branch. Its record gives the state it reads as, the pid, the start
 * and the task it names. The plan's tracker gives the tasks done, blocked
 * and open over the whole plan, read from the plan itself before the run
 * made its tracker, and nothing when neither file is there. The phase the
 * run is in sits beside the tasks done over total (`phasedCounts`,
 * `loop-sessions.ts`): `task`, `wrap-up`, `pull-request`, `ci` or
 * `repair`, and `task` for a record from a rafa older than the field.
 *
 * A session reading `running` or `paused` also gets its rough ETA from the
 * effort store (`loop/session-readings.ts`, "The rough ETA"). A store that
 * cannot be read is warned about, and the status is given without one. A
 * session that has ended gets none.
 *
 * A record reading `paused` while it still names a task has a pause that
 * has not taken effect: the run holds once that task ends, and the status
 * says so.
 *
 * ## The blockers
 *
 * Every `- [BLOCKED]` line of that checklist is shown with the blocker
 * comment it trails, which is what the run wrote when the task ended
 * blocked (`blockedTasks`, `loop/blocked-tasks.ts`, "The blockers"). A
 * line that trails none, or a blank one, reads as none, and the status
 * says so rather than showing a blocked task with nothing under it.
 *
 * ## What it writes
 *
 * In json mode the terminal result's `data` holds `session`, the record;
 * `phase`, the phase it reads as, `task` for a record that carries none;
 * `checklist`, the file the tasks were counted from, absolute, or null;
 * `tasks`, the counts, or null; `blocked`, one entry per blocked task,
 * empty without one; and `eta`, or null. Text mode writes the session's
 * line, then its tasks with its phase, then two lines per blocked task, then one line
 * each for its task and its ETA.
 *
 * ## Refusals
 *
 * Exit code 1: the refusals `loop-sessions.ts` names.
 */
import type { RafaCommand, RafaContext } from '../../cli/command.js';
import type { BlockedTask } from '../../loop/blocked-tasks.js';
import type { LoopSessionSeams, ResolvedLoopSeams, SessionEta } from '../../loop/session-readings.js';
import type { SessionPhase, SessionRecord } from '../../loop/sessions.js';
import type { TaskCounts } from '../../plan/plan-files.js';

import { messageOf } from '../../config-sections.js';
import { blockedTasks } from '../../loop/blocked-tasks.js';
import {
  estimateEta,
  isLive,
  readSessionChecklist,
  readSessionFinishes,
  resolveLoopSeams,
  sessionLine,
} from '../../loop/session-readings.js';
import { sessionPhase } from '../../loop/sessions.js';
import { countTasks } from '../../plan/plan-files.js';
import { expectNoArgument } from '../plan/plan-files.js';

import {
  etaLine,
  phasedCounts,
  phaseNote,
  pickSession,
  sessionIdFlag,
} from './loop-sessions.js';

/** The usage line a refusal names. */
const USAGE = 'rafa loop status [-s|--session-id=<id>]';

/** What a blocked task whose line trails no comment is shown with. */
const NO_BLOCKER = 'the line trails no blocker comment';

/** One session's status. See the module note. */
export interface SessionStatus {
  readonly session: SessionRecord;
  /** The phase the session reads as: its record's, or `task` when the record carries none. */
  readonly phase: SessionPhase;
  readonly checklist: string | null;
  readonly tasks: TaskCounts | null;
  readonly blocked: readonly BlockedTask[];
  readonly eta: SessionEta | null;
}

/** The lines one blocked task writes: its own, then its blocker, indented and one line per line of it. */
function blockedLines(blocked: BlockedTask): string[] {
  return [
    `  Blocked: line ${String(blocked.line)}, ${blocked.text}`,
    ...(blocked.blocker ?? NO_BLOCKER).split('\n').map((line) => `    ${line}`),
  ];
}

/** The lines text mode writes for a status. */
export function renderStatus(status: SessionStatus): string[] {
  const { session, tasks, blocked, eta } = status;
  const { task } = session;
  const pending = session.state === 'paused' && task !== null
    ? ' (the run holds once it ends)'
    : '';
  return [
    `Session ${sessionLine(session)}`,
    tasks === null
      ? `  Tasks: neither \`${session.plan}\` nor its tracker is there to count ${phaseNote(session)}`
      : `  Tasks: ${phasedCounts(tasks, session)}`,
    ...blocked.flatMap(blockedLines),
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

  const status: SessionStatus = {
    session: record,
    phase: sessionPhase(record),
    checklist: checklist?.file ?? null,
    tasks,
    blocked: blockedTasks(checklist),
    eta,
  };
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
      + ' it names, the tasks done, blocked and open over the whole plan, and beside them the phase the'
      + ' run is in: task, wrap-up, pull-request, ci or repair. A running or paused session'
      + ' also gets a rough ETA from the effort store: the time from its start to the last task it'
      + ' finished, per task finished, times the open and blocked tasks left, and none before its first'
      + ' task finishes. Every blocked task of the checklist is shown with the blocker comment its line'
      + ' trails, which is what the run wrote when that task ended blocked. Without `--session-id` it shows the session running on the branch checked out at'
      + ' the project root, or the newest one that ran there. With `--output=json` the record, the counts'
      + ' and the ETA are the data of the terminal result event.',
    args: [],
    flags: [sessionIdFlag('to show')],
    examples: [
      {
        cmd: 'rafa loop status',
        note: 'Shows the session on the branch checked out here: its state, tasks done over total, phase and ETA.',
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
