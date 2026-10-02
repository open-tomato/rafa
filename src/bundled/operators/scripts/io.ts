/**
 * The edge of the `stretch` script: every process it runs and every file
 * it reads goes through one {@link Io}, so the actions are pure over text
 * and the tests hand them a fake. Nothing here imports from `src/`,
 * because `src/bundled/` ships as it is and only its own files travel.
 *
 * @module bundled/operators/scripts/io
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';

/** What a finished process left behind. */
export interface ExecResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Every read and every process the actions use. */
export interface Io {
  /** Runs a command to its end, never through a shell. */
  exec(command: readonly string[], cwd?: string): ExecResult;
  /** A file's text, or `undefined` when it cannot be read. */
  read(path: string): string | undefined;
  /** The names in a directory, or none when it cannot be read. */
  list(dir: string): readonly string[];
  /** A file's modification time in epoch milliseconds, or `undefined`. */
  mtime(path: string): number | undefined;
  /** The current time in epoch milliseconds. */
  now(): number;
  /** The user's home directory. */
  home(): string;
  /** The platform, as `process.platform` names it. */
  platform(): string;
  /** Waits `ms` milliseconds. */
  sleep(ms: number): void;
}

/** The {@link Io} the script runs with: real processes and real files. */
export const realIo: Io = {
  exec(command, cwd) {
    const run = Bun.spawnSync([...command], { cwd, stdout: 'pipe', stderr: 'pipe' });

    return { code: run.exitCode ?? 1, stdout: run.stdout.toString(), stderr: run.stderr.toString() };
  },
  read(path) {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      return undefined;
    }
  },
  list(dir) {
    try {
      return readdirSync(dir);
    } catch {
      return [];
    }
  },
  mtime(path) {
    return existsSync(path)
      ? statSync(path).mtimeMs
      : undefined;
  },
  now: () => Date.now(),
  home: () => homedir(),
  platform: () => process.platform,
  sleep: (ms) => Bun.sleepSync(ms),
};
