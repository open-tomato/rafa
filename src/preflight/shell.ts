/**
 * The three parts of a shell run that have a deadline: {@link spawnShell}
 * starts `/bin/sh -c <command>` as the leader of its own process group,
 * {@link killGroup} kills that group, and {@link collect} reads a piped
 * stream to its end or until it is stopped.
 *
 * `runShellProbe` in `run.ts` runs a preflight probe with them, piping
 * stderr only; a caller that wants the command's output as well pipes
 * stdout too. Each rule below was measured on bun 1.3.14, and the probe's
 * own rules are in `run.ts`'s module note.
 *
 *   - **stdin is closed.** It is `ignore`, which is `/dev/null`: `cat`
 *     exits 0 at once and `read` answers 1.
 *   - **The shell is named by its absolute path**, {@link SHELL}. Bun
 *     looks a bare command up on the `PATH` handed to the child, and throws
 *     when it is not there (`Executable not found in $PATH: "sh"`).
 *   - **Each stream is piped or ignored, as the caller asks.** A piped
 *     stream is a `ReadableStream`; an ignored one is `/dev/null` and its
 *     field is `undefined`.
 *   - **The group, not the shell, is killed.** The shell leads a group of
 *     its own (`detached`), and {@link killGroup} sends SIGKILL to `-pid`.
 *     Killing the shell alone leaves a child it started holding the pipe,
 *     and a read of that pipe waits for the child. A group with no process
 *     left answers `ESRCH`, which is no error; any other refusal falls back
 *     to killing the shell. A killed shell answers 128 plus the signal, 137
 *     for SIGKILL.
 *   - **Reading can be stopped**, keeping what was read, so a process
 *     outside the group that holds a pipe cannot keep a caller waiting past
 *     its deadline.
 */
import type { Subprocess } from 'bun';

/** The shell a command runs through, by absolute path; see the module note. */
export const SHELL = '/bin/sh';

/** What a spawned shell's output stream is: read through a pipe, or thrown away. */
export type ShellStream = 'pipe' | 'ignore';

/** Where a shell runs, with what, and which of its output streams are piped. */
export interface ShellSpawnOptions<Out extends ShellStream, Err extends ShellStream> {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly stdout: Out;
  readonly stderr: Err;
}

/** A shell as {@link spawnShell} answers it: stdin closed, each output stream as asked. */
export type ShellProcess<Out extends ShellStream = ShellStream, Err extends ShellStream = ShellStream> = Subprocess<
  'ignore',
  Out,
  Err
>;

/**
 * Spawns `/bin/sh -c <command>` in `options.cwd` with `options.env`,
 * stdin closed, as the leader of its own process group; see the module
 * note. Throws when the shell cannot be started, as `Bun.spawn` does.
 */
export function spawnShell<Out extends ShellStream, Err extends ShellStream>(
  command: string,
  options: ShellSpawnOptions<Out, Err>,
): ShellProcess<Out, Err> {
  return Bun.spawn([SHELL, '-c', command], {
    cwd: options.cwd,
    env: { ...options.env },
    stdin: 'ignore',
    stdout: options.stdout,
    stderr: options.stderr,
    detached: true,
  });
}

/** True for the error `kill` throws when no process is left to signal. */
function isNoSuchProcess(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ESRCH';
}

/**
 * Sends SIGKILL to the process group `proc` leads. A group with no
 * process left is no error; any other refusal falls back to the shell.
 */
export function killGroup(proc: Pick<ShellProcess, 'pid' | 'kill'>): void {
  try {
    process.kill(-proc.pid, 'SIGKILL');
  } catch (error) {
    if (!isNoSuchProcess(error)) proc.kill('SIGKILL');
  }
}

/** A stream being read to its end, and the call that stops reading it early. */
export interface Collected {
  readonly text: Promise<string>;
  readonly stop: () => void;
}

/** Reads `stream` to its end, or until `stop`, keeping what was read. */
export function collect(stream: ReadableStream<Uint8Array>): Collected {
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
