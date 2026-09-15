/**
 * What `rafa loop stop`, `pause`, `resume`, `status` and `list` share: the
 * session records they read, the session a line picks, a session's tasks
 * and rough ETA, a session written as a line, and their refusals.
 *
 * `.specs/cli-surface.md`, "Sessions": every `loop start` writes its
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
 * ## A session's tasks
 *
 * {@link readSessionChecklist} reads the tasks of the plan a record names,
 * counted by checkbox as `rafa plan list` counts them
 * (`plan/plan-files.ts`): from the plan's tracker once there is one, and
 * from the plan before then. They are the whole plan's tasks, those every
 * earlier session got through included. A record whose plan and tracker
 * are both gone has none.
 *
 * ## The rough ETA
 *
 * {@link estimateEta}: the time from the session's start to the last task
 * it finished, over the tasks it finished, times the tasks left, open and
 * blocked alike, since the loop retries a blocked task first. The finishes
 * are the effort store's (`effort/store/task-finishes.ts`), read for the
 * record's plan stub from the session's start on. There is no estimate
 * before the session finishes a task. It is rough: the wrap-up and the CI
 * wait are not in it, and the time a run spent paused is, as is the first
 * task's share of the preflight.
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
 * ## Seams
 *
 * {@link LoopSessionSeams}: the branch reader, the pid probe, the signal
 * `stop` sends, the wait and how long `stop` waits. Each left out is the
 * system's own ({@link resolveLoopSeams}).
 */
import type { RafaContext, RafaFlagSpec } from '../../cli/command.js';
import type { PidProbe, SessionChange, SessionRecord } from '../../loop/sessions.js';
import type { PlanTask } from '../../plan/index.js';
import type { TaskCounts } from '../plan/plan-files.js';

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { CommandExit } from '../../cli/command.js';
import { messageOf } from '../../config-sections.js';
import { readTaskFinishes } from '../../effort/store/task-finishes.js';
import {
  isPidAlive,
  isSessionId,
  readSessions,
  runsDir,
  SessionRecordError,
  SessionStateError,
  updateSession,
} from '../../loop/sessions.js';
import { parsePlan } from '../../plan/index.js';
import { trackerPathFor } from '../../utils/tracker.js';
import { isFile, plural } from '../plan/plan-files.js';

/** How long `rafa loop stop` waits for the run it signalled to end. */
export const STOP_WAIT_MS = 30_000;

/** How long `rafa loop stop` waits between two reads of the record. */
export const STOP_POLL_MS = 200;

/** The flag naming a session, by the name the context's flags carry it under. */
export const SESSION_ID_FLAG = 'session-id';

/** The seams the commands reach the system through. See the module note. */
export interface LoopSessionSeams {
  /** The branch checked out at a root; throws when it cannot be read. */
  readonly readBranch?: (root: string) => string;
  /** Whether a pid is alive. `isPidAlive` when left out. */
  readonly isAlive?: PidProbe;
  /** Sends SIGINT to a pid. `process.kill` when left out. */
  readonly interrupt?: (pid: number) => void;
  /** Waits `ms` milliseconds. `Bun.sleep` when left out. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** How long `stop` waits for the run to end. {@link STOP_WAIT_MS} when left out. */
  readonly stopWaitMs?: number;
  /** How long `stop` waits between two reads. {@link STOP_POLL_MS} when left out. */
  readonly pollMs?: number;
}

/** Every seam, each filled in. */
export type ResolvedLoopSeams = Required<LoopSessionSeams>;

/** The branch checked out at `root`, read by git there. */
function gitBranch(root: string): string {
  return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

/** The seams handed in, each left out filled with the system's own. */
export function resolveLoopSeams(seams: LoopSessionSeams = {}): ResolvedLoopSeams {
  return {
    readBranch: seams.readBranch ?? gitBranch,
    isAlive: seams.isAlive ?? isPidAlive,
    interrupt: seams.interrupt ?? ((pid: number) => {
      process.kill(pid, 'SIGINT');
    }),
    sleep: seams.sleep ?? ((ms: number) => Bun.sleep(ms)),
    stopWaitMs: seams.stopWaitMs ?? STOP_WAIT_MS,
    pollMs: seams.pollMs ?? STOP_POLL_MS,
  };
}

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

/** A refusal with exit code 1 that is not the line's fault. */
export function refusal(...lines: readonly string[]): CommandExit {
  return new CommandExit(1, `❌ ${lines.join('\n   ')}`);
}

/** True for a record that reads `running` or `paused`: its run has not ended. */
export function isLive(record: Pick<SessionRecord, 'state'>): boolean {
  return record.state === 'running' || record.state === 'paused';
}

/** The plan a record names, as a line names it: its stub, or its path when it carries none. */
export function planLabel(record: Pick<SessionRecord, 'planStub' | 'plan'>): string {
  return record.planStub ?? record.plan;
}

/** One session as a line: its id, plan, branch, state, pid and start. */
export function sessionLine(record: SessionRecord): string {
  return `${record.sessionId}: plan \`${planLabel(record)}\` on \`${record.branch}\`, ${record.state},`
    + ` pid ${record.pid}, started ${record.startedAt}`;
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

/** `.rafa/runs/`, as a refusal names it. */
function runsLabel(root: string): string {
  return `${relative(root, runsDir(root))}/`;
}

/** Every record under the root, each with the state it reads as; records that cannot be read are refused. */
export function readRecords(root: string, seams: Pick<ResolvedLoopSeams, 'isAlive'>): readonly SessionRecord[] {
  try {
    return readSessions(root, { isAlive: seams.isAlive });
  } catch (error) {
    if (!(error instanceof SessionRecordError)) throw error;
    throw refusal(`The session records under ${runsLabel(root)} cannot be read.`, messageOf(error));
  }
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
  throw refusal(
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
  throw refusal(
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

/** The checklist a session's plan is tracked in. */
export interface SessionChecklist {
  /** The file read, absolute: the tracker once there is one, the plan before then. */
  readonly file: string;
  /** Its tasks, in file order. */
  readonly tasks: readonly PlanTask[];
}

/** The checklist of the plan a record names, or null when neither its tracker nor the plan is a file. */
export function readSessionChecklist(root: string, record: Pick<SessionRecord, 'plan'>): SessionChecklist | null {
  const plan = join(root, record.plan);
  const file = [trackerPathFor(plan), plan].find((path) => isFile(path));
  if (file === undefined) return null;
  return { file, tasks: parsePlan(readFileSync(file, 'utf8')).tasks };
}

/** The checkbox a checklist holds at a 1-based line, or null when no task is there. */
export function checkboxAt(checklist: SessionChecklist | null, line: number): PlanTask['status'] | null {
  return checklist?.tasks.find((task) => task.lineNum === line - 1)?.status ?? null;
}

/** A session's rough ETA. See the module note. */
export interface SessionEta {
  /** The tasks the session finished, as the store holds them. */
  readonly finished: number;
  /** The tasks left: open and blocked. */
  readonly left: number;
  /** Whole seconds per task finished, from the session's start to its last finish; null before the first. */
  readonly secondsPerTask: number | null;
  /** Whole seconds for the tasks left at that pace; null before the first finish. */
  readonly seconds: number | null;
}

/** The ETA of a session started at `startedAt` whose tasks finished at `finishes`, oldest first, with `counts` left. */
export function estimateEta(startedAt: string, finishes: readonly string[], counts: TaskCounts): SessionEta {
  const left = counts.open + counts.blocked;
  const last = finishes.at(-1);
  if (last === undefined) return { finished: 0, left, secondsPerTask: null, seconds: null };
  const perTask = Math.max(0, Date.parse(last) - Date.parse(startedAt)) / 1000 / finishes.length;
  return { finished: finishes.length, left, secondsPerTask: Math.round(perTask), seconds: Math.round(perTask * left) };
}

/** The times the session's plan's tasks finished from its start on, as the store holds them. */
export function readSessionFinishes(root: string, record: Pick<SessionRecord, 'planStub' | 'startedAt'>): readonly string[] {
  return readTaskFinishes(root, { planStub: record.planStub, since: record.startedAt });
}

/** Seconds as a person reads a rough duration: `under a minute`, `12m`, `2h`, `1h 5m`. */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return 'under a minute';
  const minutes = Math.round(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${minutes}m`;
  return rest === 0
    ? `${hours}h`
    : `${hours}h ${rest}m`;
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
