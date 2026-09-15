/**
 * The loop's hold between tasks while its session record reads `paused`.
 *
 * `rafa loop pause` writes `paused` to the record of a running session and
 * does nothing else (`commands/loop/pause.ts`). The loop reads the record
 * between tasks through {@link holdWhilePaused}: `start()` calls it at the
 * top of each turn of its loop, before it reads the tracker for the next
 * task. So the running task's commit, mark, stored report and triage all
 * come first, and nothing is marked. A pause written before the first task
 * holds the run before that task, and one written after the last task
 * holds it before the wrap-up.
 *
 * ## While it holds
 *
 * On reading `paused` it writes `task: null` to the record, since no task
 * runs while it holds, and says so in one `info` line. It then reads the
 * record again every {@link PAUSE_POLL_MS} milliseconds, and ends:
 *
 *   - **`resumed`** once the record stores any state but `paused`, as
 *     `rafa loop resume` writes `running`, saying so in one `info` line;
 *   - **`interrupted`** once `isInterrupted` answers true, before or after
 *     a wait. The loop's SIGINT handler makes it answer true, so
 *     `rafa loop stop` ends a held run within one wait, and the run's end
 *     writes `stopped`.
 *
 * A run whose record does not read `paused` gets `not-paused` at once,
 * and nothing is written or printed. The state read is the one stored:
 * the record's pid is the run's own, so liveness is not asked.
 *
 * ## A record it cannot read
 *
 * A record that cannot be read, before the hold or during it, is warned
 * about in one line, and the hold ends as `unreadable`: the run goes on as
 * a run that is not paused. That is the rule `start/session.ts` keeps for
 * every change after the open: the record is what other commands read
 * about the run, and a problem with it never stops the run's work. A
 * `task: null` that cannot be written is warned about the same way, and
 * the hold goes on.
 *
 * Every line goes through the active output (`adapters/output/active.ts`).
 */
import type { SessionState } from '../loop/sessions.js';

import { activeOutput } from '../adapters/output/active.js';
import { messageOf } from '../config-sections.js';
import { readSession, updateSession } from '../loop/sessions.js';

/** How long a held loop waits between two reads of its record. */
export const PAUSE_POLL_MS = 1_000;

/** How a hold ended. See the module note. */
export type PauseHoldOutcome = 'not-paused' | 'resumed' | 'interrupted' | 'unreadable';

/** The seams a hold waits through. Each left out is the system's own. */
export interface PauseHoldSeams {
  /** Waits `ms` milliseconds. `Bun.sleep` when left out. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** How long to wait between two reads. {@link PAUSE_POLL_MS} when left out. */
  readonly pollMs?: number;
}

/** What {@link holdWhilePaused} holds. */
export interface PauseHoldOptions {
  /** The project root the record sits under. */
  readonly repoRoot: string;
  /** The run's session id. */
  readonly sessionId: string;
  /** Whether the run was interrupted; read before and after every wait. */
  readonly isInterrupted: () => boolean;
  readonly seams?: PauseHoldSeams;
}

/** The pid probe the hold reads its own record with: the pid is the run's own. */
const OWN_PID = (): boolean => true;

/** The state the record stores, or null, warned about, when it cannot be read. */
function storedState(repoRoot: string, sessionId: string): SessionState | null {
  try {
    return readSession(repoRoot, sessionId, { isAlive: OWN_PID }).state;
  } catch (error) {
    activeOutput().warn(`\n⚠️  Session ${sessionId}: its record cannot be read between tasks, so the run goes on unpaused: ${messageOf(error)}`);
    return null;
  }
}

/** Writes that no task runs while the hold lasts, warning when it cannot. */
function clearTask(repoRoot: string, sessionId: string): void {
  try {
    updateSession(repoRoot, sessionId, { task: null });
  } catch (error) {
    activeOutput().warn(`\n⚠️  Session ${sessionId}: that no task runs while paused was not written: ${messageOf(error)}`);
  }
}

/**
 * Holds the run while its record reads `paused`, and answers how the hold
 * ended. See the module note.
 */
export async function holdWhilePaused(options: PauseHoldOptions): Promise<PauseHoldOutcome> {
  const { repoRoot, sessionId, isInterrupted } = options;
  const sleep = options.seams?.sleep ?? ((ms: number) => Bun.sleep(ms));
  const pollMs = options.seams?.pollMs ?? PAUSE_POLL_MS;

  const first = storedState(repoRoot, sessionId);
  if (first === null) return 'unreadable';
  if (first !== 'paused') return 'not-paused';

  clearTask(repoRoot, sessionId);
  activeOutput().info(`\n⏸️  Session ${sessionId} is paused before its next task: \`rafa loop resume\` goes on, and \`rafa loop stop\` ends the run.`);
  while (true) {
    if (isInterrupted()) return 'interrupted';
    await sleep(pollMs);
    if (isInterrupted()) return 'interrupted';
    const state = storedState(repoRoot, sessionId);
    if (state === null) return 'unreadable';
    if (state !== 'paused') {
      activeOutput().info(`▶️  Session ${sessionId} resumed.`);
      return 'resumed';
    }
  }
}
