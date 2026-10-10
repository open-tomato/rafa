/**
 * What `rafa loop stop`, `pause`, `resume`, `status`, `list` and `wait`
 * share that reads a command's context or flags, or writes for one: the
 * `--session-id` flag, the session a line picks, the write to a picked
 * session's record, a phase and an ETA as `status` and `list` write
 * them, and the refusals of a line. This is the command half; the
 * library half, `../../loop/session-readings.ts`, holds the readings
 * that take none of those (the records under a root, a session's tasks
 * and rough ETA, a session written as a line, the seams and the plain
 * {@link refusal}), and every importer takes them from there: this file
 * re-exports none of them.
 *
 * From the CLI surface spec, "Sessions": every `loop start` writes its
 * record to `.rafa/runs/<session-id>.json` (`loop/sessions.ts`), and these
 * commands reach a run through that record alone. Single-thread is the
 * only mode until phase 6, so a plan runs in one session at a time.
 *
 * ## The session a line picks
 *
 * `--session-id=<id>`, aliased `-s`, names a record by its id. Without
 * it, the session is paired with the branch checked out at the project
 * root, as `git rev-parse --abbrev-ref HEAD` reads it there: the record
 * naming that branch that reads `running` or `paused`. `status` alone
 * falls back on the newest record naming the branch when none does, so it
 * still answers for a run that has ended. Two such live records, which two
 * plans running on one branch make, refuse a line naming neither.
 *
 * Every record is read with the state it reads as (`readState`), so a
 * record whose pid is gone reads `stopped`.
 *
 * ## Refusals
 *
 * Each is a `CommandExit` with exit code 1 and a message opening `❌ `.
 * A line at fault names the usage line: an argument, and a `--session-id`
 * typed with no value or naming no usable id. The others do not: no
 * record with that id, a branch that cannot be read, no session paired
 * with the branch or two of them, records that cannot be read, and a
 * session in a state the action does not act on.
 *
 * The two refusals finding no session to act on — no record with that
 * id, and no session paired with the branch — are a
 * {@link NoSessionRefusal}, still exit code 1, so `loop wait` can end
 * them with its own code for no session without reading their words.
 */
import type { RafaContext, RafaFlagSpec } from '../../cli/command.js';
import type {
  ResolvedLoopSeams,
  SessionChecklist,
  SessionEta,
} from '../../loop/session-readings.js';
import type { SessionChange, SessionPhase, SessionRecord } from '../../loop/sessions.js';
import type { PlanTask } from '../../plan/index.js';
import type { TaskCounts } from '../../plan/plan-files.js';

import { CommandExit } from '../../cli/command.js';
import { messageOf } from '../../config-sections.js';
import {
  formatDuration,
  isLive,
  readRecords,
  refusal,
  runsLabel,
  sessionLine,
} from '../../loop/session-readings.js';
import {
  isSessionId,
  SessionRecordError,
  sessionPhase,
  SessionStateError,
  updateSession,
} from '../../loop/sessions.js';
import { plural } from '../../plan/plan-files.js';

/** The flag naming a session, by the name the context's flags carry it under. */
export const SESSION_ID_FLAG = 'session-id';

/** The `--session-id` flag, as an action reading one declares it; `what` says what the session is for. */
export function sessionIdFlag(what: string): RafaFlagSpec {
  return {
    name: SESSION_ID_FLAG,
    description: `The session ${what}, by the id its record under \`.rafa/runs/\` is named with.`
      + ' Without it, the session running on the branch checked out at the project root.',
    type: 'string',
    aliases: ['s'],
  };
}

/** A refusal of the line with exit code 1: the problem, then the usage line. */
export function lineRefusal(problem: string, usage: string): CommandExit {
  return new CommandExit(1, `❌ ${problem}\nUsage: ${usage}`);
}

/** The refusal of a line naming no session there is: exit code 1, as {@link refusal} gives. See the module note. */
export class NoSessionRefusal extends CommandExit {
  constructor(...lines: readonly string[]) {
    super(1, `❌ ${lines.join('\n   ')}`);
    this.name = 'NoSessionRefusal';
  }
}

/** The project root the dispatcher resolved, which it resolves for every `loop` action. */
export function projectRoot(context: RafaContext): string {
  if (context.project === null) throw new Error('rafa loop runs inside a project, and was handed none');
  return context.project.root;
}

/** The id `--session-id` names, or undefined when the line leaves the flag out. */
export function readSessionIdFlag(context: RafaContext, usage: string): string | undefined {
  const value = context.flags[SESSION_ID_FLAG];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim() === '') {
    throw lineRefusal(`--${SESSION_ID_FLAG} needs a value: --${SESSION_ID_FLAG}=<id>`, usage);
  }
  if (!isSessionId(value)) {
    throw lineRefusal(`--${SESSION_ID_FLAG} is ${JSON.stringify(value)}, which no session record is named with`, usage);
  }
  return value;
}

/** The branch checked out at the root, or a refusal saying to name the session instead. */
function readBranchOrRefuse(root: string, readBranch: ResolvedLoopSeams['readBranch']): string {
  try {
    return readBranch(root);
  } catch (error) {
    throw refusal(
      'The branch checked out at the project root cannot be read, so no session is paired with it.',
      messageOf(error).split('\n')[0] ?? '',
      `Name the session with --${SESSION_ID_FLAG}; \`rafa loop list\` lists the running ones.`,
    );
  }
}

/** Which session a line without an id picks: a live one, or for `status` the newest when none is. */
export type SessionPick = 'live' | 'live-or-newest';

/** The session a line picked, and the project root its record sits under. */
export interface PickedSession {
  readonly root: string;
  readonly record: SessionRecord;
}

/** The session the branch at the root pairs with. See the module note. */
function pairedSession(root: string, records: readonly SessionRecord[], pick: SessionPick, seams: ResolvedLoopSeams): SessionRecord {
  const branch = readBranchOrRefuse(root, seams.readBranch);
  const onBranch = records.filter((record) => record.branch === branch);
  const live = onBranch.filter(isLive);
  if (live.length > 1) {
    throw refusal(
      `${live.length} sessions are running on \`${branch}\`; name one with --${SESSION_ID_FLAG}:`,
      ...live.map((record) => sessionLine(record)),
    );
  }
  const newest = pick === 'live-or-newest'
    ? onBranch.at(-1)
    : undefined;
  const paired = live[0] ?? newest;
  if (paired !== undefined) return paired;
  throw new NoSessionRefusal(
    `No session is running on \`${branch}\`.`,
    `\`rafa loop list\` lists the running sessions, and --${SESSION_ID_FLAG} names one.`,
  );
}

/**
 * The session a line picks: the one `--session-id` names, or the one the
 * branch pairs with. Reads the flag before anything else. See the module
 * note.
 */
export function pickSession(context: RafaContext, usage: string, pick: SessionPick, seams: ResolvedLoopSeams): PickedSession {
  const sessionId = readSessionIdFlag(context, usage);
  const root = projectRoot(context);
  const records = readRecords(root, seams);
  if (sessionId === undefined) return { root, record: pairedSession(root, records, pick, seams) };

  const record = records.find((held) => held.sessionId === sessionId);
  if (record !== undefined) return { root, record };
  throw new NoSessionRefusal(
    `No session record under ${runsLabel(root)} is named ${sessionId}.`,
    '`rafa loop list` lists the running sessions.',
  );
}

/**
 * Writes `change` to a picked session's record, refusing when the record
 * changed state since it was read or cannot be written.
 */
export function writeSession(root: string, record: SessionRecord, change: SessionChange): SessionRecord {
  try {
    return updateSession(root, record.sessionId, change);
  } catch (error) {
    if (error instanceof SessionStateError) {
      throw refusal(`Session ${record.sessionId} now stores ${error.state}, where it read ${record.state}; nothing was written.`);
    }
    if (error instanceof SessionRecordError) {
      throw refusal(`Session ${record.sessionId}: its record cannot be written.`, messageOf(error));
    }
    throw error;
  }
}

/**
 * The phase a session's run is in, as `status` and `list` write it beside a
 * count: `(phase wrap-up)`.
 *
 * A running record whose phase reads `task` and whose `task` is null, over
 * a plan whose every task is ticked, reads `wrap-up`: the loop has left
 * its last task and not yet written the wrap-up phase, so `task` would say
 * a task runs when none is left (#577). Any other record, and a record read
 * with no counts, reads the phase it holds.
 *
 * @param record - The session record, or the fields of it the reading needs.
 * @param counts - The plan's task counts, or none when nothing was there to count.
 */
export function phaseNote(
  record: Pick<SessionRecord, 'phase' | 'state' | 'task'>,
  counts: TaskCounts | null = null,
): string {
  return `(phase ${notedPhase(record, counts)})`;
}

/** The phase {@link phaseNote} writes; see its note. */
function notedPhase(record: Pick<SessionRecord, 'phase' | 'state' | 'task'>, counts: TaskCounts | null): SessionPhase {
  const phase = sessionPhase(record);
  const everyTaskTicked = counts !== null && counts.total > 0 && counts.done === counts.total;
  return phase === 'task' && record.state === 'running' && record.task === null && everyTaskTicked
    ? 'wrap-up'
    : phase;
}

/** A session's counts with its phase beside the tasks done over total. See the module note and {@link phaseNote}. */
export function phasedCounts(counts: TaskCounts, record: Pick<SessionRecord, 'phase' | 'state' | 'task'>): string {
  return `${counts.done}/${counts.total} done ${phaseNote(record, counts)}, ${counts.blocked} blocked, ${counts.open} open`;
}

/** The checkbox a checklist holds at a 1-based line, or null when no task is there. */
export function checkboxAt(checklist: SessionChecklist | null, line: number): PlanTask['status'] | null {
  return checklist?.tasks.find((task) => task.lineNum === line - 1)?.status ?? null;
}

/** The ETA as the line `status` writes. */
export function etaLine(eta: SessionEta): string {
  if (eta.left === 0) return 'ETA: no task left';
  if (eta.seconds === null || eta.secondsPerTask === null) return 'ETA: none until the session finishes a task';
  const total = eta.seconds < 60
    ? 'under a minute'
    : `about ${formatDuration(eta.seconds)}`;
  return `ETA: ${total} for ${plural(eta.left, 'task')} left,`
    + ` at ${formatDuration(eta.secondsPerTask)} per task over the ${plural(eta.finished, 'task')} this session finished`;
}
