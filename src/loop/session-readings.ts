/**
 * The session readings any folder may take, the library half of
 * `../commands/loop/loop-sessions.ts`: the session records under a root
 * with the state each reads as, whether a record's run has ended, a
 * session written as a line, a session's tasks and rough ETA, a rough
 * duration as a person reads it, and the seams those reach the system
 * through.
 *
 * Nothing here reads a command's context, its arguments or its flags,
 * and nothing here imports from `src/commands/`. The command half keeps
 * what does: the `--session-id` flag, the session a line picks, the
 * refusals of a line, the write to a picked session's record, and how
 * `rafa loop status` and `list` write a phase and an ETA.
 *
 * From the CLI surface spec, "Sessions": every `loop start` writes its
 * record to `.rafa/runs/<session-id>.json` (`sessions.ts`), and a reader
 * reaches a run through that record alone. Every record is read with
 * the state it reads as (`readState`), so a record whose pid is gone
 * reads `stopped`.
 *
 * ## A session's tasks
 *
 * {@link readSessionChecklist} reads the tasks of the plan a record names,
 * counted by checkbox as `rafa plan list` counts them
 * (`../plan/plan-files.ts`): from the plan's tracker once there is one, and
 * from the plan before then. They are the whole plan's tasks, those every
 * earlier session got through included. A record whose plan and tracker
 * are both gone has none.
 *
 * ## The rough ETA
 *
 * {@link estimateEta}: the time from the session's start to the last task
 * it finished, over the tasks it finished, times the tasks left, open and
 * blocked alike, since the loop retries a blocked task first. The finishes
 * are the effort store's (`../effort/store/task-finishes.ts`), read for the
 * record's plan stub from the session's start on. There is no estimate
 * before the session finishes a task. It is rough: the wrap-up and the CI
 * wait are not in it, and the time a run spent paused is, as is the first
 * task's share of the preflight.
 *
 * ## The refusal
 *
 * {@link refusal} is a `CommandExit` (`../cli/command.ts`) with exit code
 * 1 and a message opening `❌ `, for a problem that is not the line's
 * fault. It sits here because {@link readRecords} throws one for records
 * that cannot be read, to a command and to any other reader alike; the
 * command half builds its own refusals on it.
 *
 * ## Seams
 *
 * {@link LoopSessionSeams}: the branch reader, the pid probe, the signal
 * `stop` sends, the wait and how long `stop` waits. Each left out is the
 * system's own ({@link resolveLoopSeams}).
 */
import type { PidProbe, SessionRecord } from './sessions.js';
import type { PlanTask } from '../plan/index.js';
import type { TaskCounts } from '../plan/plan-files.js';

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { CommandExit } from '../cli/command.js';
import { messageOf } from '../config-sections.js';
import { readTaskFinishes } from '../effort/store/task-finishes.js';
import { parsePlan } from '../plan/index.js';
import { isFile } from '../plan/plan-files.js';
import { trackerPathFor } from '../utils/tracker.js';

import { isPidAlive, readSessions, runsDir, SessionRecordError } from './sessions.js';

/** How long `rafa loop stop` waits for the run it signalled to end. */
export const STOP_WAIT_MS = 30_000;

/** How long `rafa loop stop` waits between two reads of the record. */
export const STOP_POLL_MS = 200;

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

/** `.rafa/runs/`, as a refusal names it. */
export function runsLabel(root: string): string {
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

/** The checklist a session's plan is tracked in. */
export interface SessionChecklist {
  /** The file read, absolute: the tracker once there is one, the plan before then. */
  readonly file: string;
  /** Its tasks, in file order. */
  readonly tasks: readonly PlanTask[];
  /**
   * Its lines, on the `split('\n')` a task's `lineNum` counts in, so the
   * line a task sits on is `lines[task.lineNum]`. A reader wanting what
   * a line trails that the model does not hold — a blocker comment,
   * which `rafa loop status` prints — reads it here rather than reading the
   * file a second time.
   */
  readonly lines: readonly string[];
}

/** The checklist of the plan a record names, or null when neither its tracker nor the plan is a file. */
export function readSessionChecklist(root: string, record: Pick<SessionRecord, 'plan'>): SessionChecklist | null {
  const plan = join(root, record.plan);
  const file = [trackerPathFor(plan), plan].find((path) => isFile(path));
  if (file === undefined) return null;
  const content = readFileSync(file, 'utf8');
  return { file, tasks: parsePlan(content).tasks, lines: content.split('\n') };
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
