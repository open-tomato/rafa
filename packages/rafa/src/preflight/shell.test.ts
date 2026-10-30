/**
 * Unit tests for `shell.ts`: the spawn over a real `/bin/sh` in a
 * temporary directory, the process-group kill over a real group and over
 * stand-ins whose `kill` records the fallback, and the stream reader over
 * streams built in the test.
 */
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { collect, killGroup, SHELL, spawnShell } from './shell.js';

let scratch: string;

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-shell-')));
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** The environment every spawn here runs with: a `PATH` reaching the system tools. */
function scratchEnv(extra: Record<string, string> = {}): Record<string, string> {
  return { PATH: '/usr/bin:/bin', HOME: scratch, ...extra };
}

/** True while a process with `pid` exists. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Polls `condition` every 20 ms until it holds or `limitMs` passes; answers whether it held. */
async function eventually(condition: () => boolean, limitMs: number): Promise<boolean> {
  const until = Date.now() + limitMs;
  while (Date.now() < until) {
    if (condition()) return true;
    await Bun.sleep(20);
  }
  return condition();
}

/** A stand-in for {@link killGroup}: a pid, and a `kill` that records each signal it is handed. */
interface RecordingProcess {
  readonly pid: number;
  readonly kill: (signal?: number | string) => void;
  readonly signals: readonly unknown[];
}

/** A {@link RecordingProcess} for `pid`. */
function recordingProcess(pid: number): RecordingProcess {
  const signals: unknown[] = [];
  return {
    pid,
    kill: (signal) => {
      signals.push(signal);
    },
    signals,
  };
}

describe('SHELL', () => {
  it('names the shell by its absolute path', () => {
    expect(SHELL).toBe('/bin/sh');
  });
});

describe('spawnShell', () => {
  it('pipes both streams when asked, in the cwd and the environment handed in', async () => {
    const proc = spawnShell('pwd; echo "$SHELL_MARK"; echo oops >&2; exit 3', {
      cwd: scratch,
      env: scratchEnv({ SHELL_MARK: 'marked' }),
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      collect(proc.stdout).text,
      collect(proc.stderr).text,
    ]);

    expect(exitCode).toBe(3);
    expect(stdout).toBe(`${scratch}\nmarked\n`);
    expect(stderr).toBe('oops\n');
  });

  it('leaves an ignored stream with no reader', async () => {
    const proc = spawnShell('echo thrown away', { cwd: scratch, env: scratchEnv(), stdout: 'ignore', stderr: 'pipe' });
    const stderr = await collect(proc.stderr).text;

    expect(await proc.exited).toBe(0);
    expect(proc.stdout).toBeUndefined();
    expect(stderr).toBe('');
  });

  it('runs the command where a file it writes lands in the cwd', async () => {
    const proc = spawnShell('echo written > marker.txt', { cwd: scratch, env: scratchEnv(), stdout: 'ignore', stderr: 'ignore' });

    expect(await proc.exited).toBe(0);
    expect(readFileSync(join(scratch, 'marker.txt'), 'utf8')).toBe('written\n');
  });

  it('closes stdin, so cat ends at once', async () => {
    const started = Date.now();
    const proc = spawnShell('cat; echo "cat ended $?"', { cwd: scratch, env: scratchEnv(), stdout: 'pipe', stderr: 'ignore' });
    const stdout = await collect(proc.stdout).text;

    expect(await proc.exited).toBe(0);
    expect(stdout).toBe('cat ended 0\n');
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('makes the shell the leader of its own process group', async () => {
    const proc = spawnShell('ps -o pgid= -p $$', { cwd: scratch, env: scratchEnv(), stdout: 'pipe', stderr: 'ignore' });
    const stdout = await collect(proc.stdout).text;

    expect(await proc.exited).toBe(0);
    expect(Number(stdout.trim())).toBe(proc.pid);
  });

  it('throws when the shell cannot be started in the cwd', () => {
    const gone = join(scratch, 'gone');

    expect(existsSync(gone)).toBe(false);
    expect(() => spawnShell('true', { cwd: gone, env: scratchEnv(), stdout: 'ignore', stderr: 'ignore' })).toThrow();
  });
});

describe('killGroup', () => {
  it('kills the whole group, so a grandchild dies with the shell', async () => {
    const pidFile = join(scratch, 'grandchild.pid');
    const proc = spawnShell(`sleep 30 & echo $! > '${pidFile}'; wait`, {
      cwd: scratch,
      env: scratchEnv(),
      stdout: 'ignore',
      stderr: 'ignore',
    });

    expect(await eventually(() => existsSync(pidFile) && readFileSync(pidFile, 'utf8').trim() !== '', 2000)).toBe(true);
    const grandchild = Number(readFileSync(pidFile, 'utf8').trim());
    expect(isAlive(grandchild)).toBe(true);

    killGroup(proc);

    expect(await proc.exited).toBe(137);
    expect(await eventually(() => !isAlive(grandchild), 2000)).toBe(true);
  });

  it('takes a group with no process left as no error, and does not fall back to the shell', async () => {
    const done = spawnShell('true', { cwd: scratch, env: scratchEnv(), stdout: 'ignore', stderr: 'ignore' });
    await done.exited;
    const stand = recordingProcess(done.pid);

    expect(() => {
      killGroup(stand);
    }).not.toThrow();
    expect(stand.signals).toEqual([]);
  });

  it('falls back to killing the shell on any refusal but ESRCH', () => {
    // `process.kill` refuses a NaN pid with ERR_INVALID_ARG_TYPE before any signal is sent.
    const stand = recordingProcess(Number.NaN);

    killGroup(stand);

    expect(stand.signals).toEqual(['SIGKILL']);
  });
});

describe('collect', () => {
  it('reads a stream to its end, joining its chunks', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('first '));
        controller.enqueue(encoder.encode('second'));
        controller.close();
      },
    });

    expect(await collect(stream).text).toBe('first second');
  });

  it('stops reading a stream that never ends, keeping what was read', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('kept'));
      },
    });
    const collected = collect(stream);
    await Bun.sleep(20);

    collected.stop();

    expect(await collected.text).toBe('kept');
  });
});
