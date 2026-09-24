/**
 * Tests for the `timeoutMs` option of `createGhRunner`
 * (`src/adapters/tracker/github.ts`), over stand-in executables written to
 * a scratch directory: one that sleeps past the deadline and one that
 * answers inside it. They live apart from `github.test.ts`, which is
 * already past the line cap.
 *
 * The sleeping stand-in writes its pid before it sleeps, so a case can ask
 * the system whether that process still runs once the runner answered. It
 * sleeps as a child of the shell, not by `exec`, so the `sleep` outlives
 * the killed shell holding its pipes: the case where waiting on the pipes
 * would wait out the whole sleep.
 *
 * Both stand-ins are run once in `beforeAll`, the sleeper with `warm` so it
 * exits before sleeping. Measured on macOS on 2026-09-24: the first exec of
 * a freshly written script took about 300ms against about 1ms for the
 * second, so an unwarmed sleeper could be killed by the deadline before it
 * wrote its pid.
 *
 * Driven on 2026-09-24, `github.ts` restored byte-identical (sha256)
 * after each: ignoring `timeoutMs`, not killing at the deadline, and
 * waiting on the pipes after the kill each reddened the deadline case
 * alone, the last two on the time it took (about 2s, the whole sleep).
 */
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { createGhRunner } from './github.js';

/** How long the sleeping stand-in sleeps, in seconds. */
const SLEEP_SECONDS = 2;

/** The deadline the cases set, in milliseconds. */
const TIMEOUT_MS = 200;

/** True when a process with `pid` still runs. */
function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe('the gh runner with a timeout', () => {
  let tempDir = '';
  let sleeper = '';
  let pidFile = '';
  let quick = '';

  beforeAll(async () => {
    tempDir = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-gh-timeout-')));
    sleeper = join(tempDir, 'sleeping-gh');
    pidFile = join(tempDir, 'sleeper.pid');
    quick = join(tempDir, 'quick-gh');
    writeFileSync(sleeper, [
      '#!/bin/sh',
      'if [ "$1" = warm ]; then exit 0; fi',
      `printf "%s" "$$" > '${pidFile}'`,
      'printf "started\\n"',
      `sleep ${SLEEP_SECONDS}`,
      'printf "woke\\n"',
      '',
    ].join('\n'));
    writeFileSync(quick, [
      '#!/bin/sh',
      'for arg in "$@"; do printf "arg=%s\\n" "$arg"; done',
      'printf "to stderr\\n" >&2',
      '',
    ].join('\n'));
    chmodSync(sleeper, 0o755);
    chmodSync(quick, 0o755);
    await createGhRunner({ cwd: tempDir, command: sleeper })(['warm']);
    await createGhRunner({ cwd: tempDir, command: quick })([]);
  });

  afterAll(() => {
    if (tempDir !== '') rmSync(tempDir, { recursive: true, force: true });
  });

  it('kills a command still running at the deadline and answers ok false naming the timeout', async () => {
    rmSync(pidFile, { force: true });
    const run = createGhRunner({ cwd: tempDir, command: sleeper, timeoutMs: TIMEOUT_MS });

    const started = performance.now();
    const result = await run(['pr', 'view']);
    const elapsed = performance.now() - started;

    expect(result).toEqual({
      ok: false,
      stdout: '',
      stderr: `${sleeper} in ${tempDir} timed out after ${TIMEOUT_MS}ms and was killed`,
    });
    expect(elapsed).toBeGreaterThanOrEqual(TIMEOUT_MS - 5);
    expect(elapsed).toBeLessThan(SLEEP_SECONDS * 1000 / 2);
    const pid = Number(readFileSync(pidFile, 'utf8'));
    expect(pid).toBeGreaterThan(0);
    expect(isRunning(pid)).toBe(false);
  });

  it('runs the same sleeping command to its end with no timeout', async () => {
    // Control: the stand-in does sleep past the deadline, and is running while it does.
    rmSync(pidFile, { force: true });
    const pending = createGhRunner({ cwd: tempDir, command: sleeper })([]);
    await Bun.sleep(TIMEOUT_MS);
    const pid = Number(readFileSync(pidFile, 'utf8'));
    const runningMidway = isRunning(pid);

    const started = performance.now();
    const result = await pending;
    const remaining = performance.now() - started;

    expect(runningMidway).toBe(true);
    expect(result).toEqual({ ok: true, stdout: 'started\nwoke\n', stderr: '' });
    expect(remaining).toBeGreaterThan(SLEEP_SECONDS * 1000 / 2);
  });

  it('answers a command that ends inside the deadline as it would with none', async () => {
    const run = createGhRunner({ cwd: tempDir, command: quick, timeoutMs: SLEEP_SECONDS * 1000 });

    const result = await run(['auth', 'status']);

    expect(result).toEqual({ ok: true, stdout: 'arg=auth\narg=status\n', stderr: 'to stderr\n' });
  });
});
