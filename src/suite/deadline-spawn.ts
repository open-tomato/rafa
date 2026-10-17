/**
 * A {@link SuiteSpawner} with a deadline: `createDeadlineSpawner(timeoutMs)`
 * spawns the argv as {@link spawnSuite} does, stdin and stdout ignored and
 * stderr piped, but as the leader of its own process group
 * (`detached: true`), and kills that whole group with SIGKILL once
 * `timeoutMs` has passed, as `killGroup` in `src/preflight/run.ts` does:
 * the signal goes to `-pid`, and any refusal but `ESRCH` (no process left
 * in the group) falls back to `proc.kill`. A process that exits first has
 * its timer cleared, so nothing is left armed.
 *
 * The answer carries `timedOut: true` only when the timer fired while the
 * process had neither exited nor been signalled; a killed run is a failed
 * run. Measured on bun 1.3.14: a group killed with SIGKILL resolves
 * `proc.exited` with 137 (128 + 9), so the exit code is nonzero, and its
 * stderr pipe closed with the group. Reading stderr is still stopped at the
 * deadline, so a process that left the group holding the pipe open cannot
 * keep the answer waiting; what was read until then is kept.
 *
 * {@link spawnSuite}, the default spawner, keeps no deadline: the loop's
 * steps use it. This one is for a caller that runs a test it did not
 * choose, such as `rafa bug recheck`.
 */
import type { SuiteSpawner, SuiteSpawnOptions, SuiteSpawnResult } from './run.js';

/** Spawns `argv` as the leader of a new process group; see the module note. */
function spawnGroup(argv: readonly string[], options: SuiteSpawnOptions) {
  return Bun.spawn([...argv], {
    cwd: options.cwd,
    env: { ...options.env },
    stdin: 'ignore',
    stdout: 'ignore',
    stderr: 'pipe',
    detached: true,
  });
}

/** A spawned group's leader, as {@link spawnGroup} answers it. */
type GroupProcess = ReturnType<typeof spawnGroup>;

/** True for the error `kill` throws when no process is left to signal. */
function isNoSuchProcess(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ESRCH';
}

/**
 * Sends SIGKILL to the process group `proc` leads. A group with no
 * process left is no error; any other refusal falls back to the leader.
 */
function killGroup(proc: GroupProcess): void {
  try {
    process.kill(-proc.pid, 'SIGKILL');
  } catch (error) {
    if (!isNoSuchProcess(error)) proc.kill('SIGKILL');
  }
}

/** A stream being read to its end, and the call that stops reading it early. */
interface Collected {
  readonly text: Promise<string>;
  readonly stop: () => void;
}

/** Reads `stream` to its end, or until `stop`, keeping what was read. */
function collect(stream: ReadableStream<Uint8Array>): Collected {
  const reader = stream.getReader();
  const read = async (): Promise<string> => {
    const chunks: Uint8Array[] = [];
    let next = await reader.read();
    while (!next.done) {
      chunks.push(next.value);
      next = await reader.read();
    }
    return Buffer.concat(chunks).toString('utf8');
  };
  // A cancel that rejects leaves a stream errored, and the read above
  // rejects with that error, so the rejection is not lost by ignoring it here.
  const stop = () => {
    reader.cancel().catch(() => undefined);
  };
  return { text: read(), stop };
}

/**
 * A {@link SuiteSpawner} that kills the process group it spawned once
 * `timeoutMs` has passed, answering `timedOut: true` for it, and clears
 * its timer when the process exits first. See the module note. Throws a
 * `RangeError` for a `timeoutMs` that is not a positive finite number.
 */
export function createDeadlineSpawner(timeoutMs: number): SuiteSpawner {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError(`createDeadlineSpawner: timeoutMs must be a positive number, got ${timeoutMs}`);
  }
  return async (argv: readonly string[], options: SuiteSpawnOptions): Promise<SuiteSpawnResult> => {
    const proc = spawnGroup(argv, options);
    const stderr = collect(proc.stderr);
    let timedOut = false;
    const deadline = setTimeout(() => {
      timedOut = proc.exitCode === null && proc.signalCode === null;
      killGroup(proc);
      stderr.stop();
    }, timeoutMs);
    try {
      const exitCode = await proc.exited;
      const text = await stderr.text;
      return Object.freeze({ exitCode, stderr: text, timedOut });
    } finally {
      clearTimeout(deadline);
    }
  };
}
