/**
 * The process seam every step runs git and the suite through, so a test
 * hands in a fake and records each argv.
 *
 * {@link spawnProcess} answers 124 when its timeout passes (the child is
 * killed first, and the code `timeout(1)` uses stands in for the signal
 * exit) and 127 when the program cannot be started, as a shell does.
 */

/** What one process came to. */
export interface ProcessResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** How to run one process. */
export interface ProcessOptions {
  readonly cwd: string;
  /** Kill the process after this many milliseconds; no limit when absent. */
  readonly timeoutMs?: number;
  /** The environment; the current one when absent. */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

/** Runs one process and answers how it ended. */
export type ProcessRunner = (argv: readonly string[], options: ProcessOptions) => Promise<ProcessResult>;

/** The exit code of a process killed at its timeout. */
export const TIMEOUT_EXIT = 124;

/** The exit code of a program that could not be started. */
export const NOT_FOUND_EXIT = 127;

/** {@link ProcessRunner} over `Bun.spawn`, capturing stdout and stderr. */
export const spawnProcess: ProcessRunner = async (argv, options) => {
  let child: Bun.Subprocess<'ignore', 'pipe', 'pipe'>;
  try {
    child = Bun.spawn([...argv], { cwd: options.cwd, env: options.env ?? process.env, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
  } catch (error) {
    return { exitCode: NOT_FOUND_EXIT, stdout: '', stderr: error instanceof Error
      ? error.message
      : String(error) };
  }
  let timedOut = false;
  const timer = options.timeoutMs === undefined
    ? undefined
    : setTimeout(() => {
      timedOut = true;
      child.kill();
    }, options.timeoutMs);
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (timer !== undefined) clearTimeout(timer);
  return { exitCode: timedOut
    ? TIMEOUT_EXIT
    : exitCode, stdout, stderr };
};
