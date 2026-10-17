/**
 * Tests for the deadline spawner (`src/suite/deadline-spawn.ts`). Each
 * case spawns a real `/bin/sh` child: one that sleeps past the deadline
 * and is killed, one that exits before it. The timer's handle is read
 * through spies on `setTimeout` and `clearTimeout`, which call through.
 */
import type { Mock } from 'bun:test';

import { tmpdir } from 'node:os';

import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';

import { createDeadlineSpawner } from './deadline-spawn.js';

/** The environment each child runs in. */
const ENV = { PATH: '/usr/bin:/bin' };

/** The deadline of every case, in milliseconds. */
const DEADLINE_MS = 300;

/** How long the sleeping child would run unkilled, in seconds. */
const SLEEP_SECONDS = 20;

/** True when a process of `pid` is still there to signal. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** How long a killed process may take to be reaped before it counts as alive, in milliseconds. */
const REAP_GRACE_MS = 2000;

/** How often {@link isGone} looks again, in milliseconds. */
const REAP_POLL_MS = 20;

/**
 * True once `pid` is gone, read again until {@link REAP_GRACE_MS} has
 * passed: a killed process stays signalable as a zombie until reaped.
 */
async function isGone(pid: number): Promise<boolean> {
  const until = Date.now() + REAP_GRACE_MS;
  while (isAlive(pid)) {
    if (Date.now() > until) return false;
    await Bun.sleep(REAP_POLL_MS);
  }
  return true;
}

/** The handle the call to `setTimeout` with `delay` returned, from the spy's record. */
function handleOf(spy: Mock<typeof setTimeout>, delay: number): unknown {
  const index = spy.mock.calls.findIndex((call) => call[1] === delay);
  return index === -1
    ? undefined
    : spy.mock.results[index]?.value;
}

describe('createDeadlineSpawner', () => {
  let setSpy: Mock<typeof setTimeout>;
  let clearSpy: Mock<typeof clearTimeout>;

  beforeEach(() => {
    setSpy = spyOn(globalThis, 'setTimeout');
    clearSpy = spyOn(globalThis, 'clearTimeout');
  });

  afterEach(() => {
    setSpy.mockRestore();
    clearSpy.mockRestore();
  });

  it('kills a child that sleeps past the deadline, with its whole group, and answers timedOut', async () => {
    const pidFile = `${tmpdir()}/deadline-spawn-${process.pid}-${Date.now()}.pid`;
    const spawn = createDeadlineSpawner(DEADLINE_MS);
    const started = Date.now();
    // The shell starts a background sleep (a grandchild in the same
    // group), records its pid, writes to stderr and then sleeps itself.
    const script = `sleep ${SLEEP_SECONDS} & echo $! > ${pidFile}; echo before >&2; sleep ${SLEEP_SECONDS}`;
    const result = await spawn(['/bin/sh', '-c', script], { cwd: tmpdir(), env: ENV });
    const elapsed = Date.now() - started;

    expect(result.timedOut).toBe(true);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toBe('before\n');
    expect(elapsed).toBeGreaterThanOrEqual(DEADLINE_MS);
    expect(elapsed).toBeLessThan(SLEEP_SECONDS * 1000);
    const grandchild = Number((await Bun.file(pidFile).text()).trim());
    expect(grandchild).toBeGreaterThan(0);
    expect(await isGone(grandchild)).toBe(true);
    await Bun.file(pidFile).delete();
  });

  it('answers timedOut false for a child that exits first, and clears its timer', async () => {
    const spawn = createDeadlineSpawner(DEADLINE_MS);
    const result = await spawn(['/bin/sh', '-c', 'echo done >&2; exit 3'], { cwd: tmpdir(), env: ENV });

    expect(result).toEqual({ exitCode: 3, stderr: 'done\n', timedOut: false });
    const handle = handleOf(setSpy, DEADLINE_MS);
    // Control: the deadline's timer was armed, so the clear below is of it.
    expect(handle).toBeDefined();
    expect(clearSpy.mock.calls.some((call) => call[0] === handle)).toBe(true);
  });

  it('refuses a deadline that is not a positive number', () => {
    expect(() => createDeadlineSpawner(0)).toThrow(RangeError);
    expect(() => createDeadlineSpawner(Number.NaN)).toThrow(RangeError);
    // Control: a positive deadline is taken.
    expect(typeof createDeadlineSpawner(1)).toBe('function');
  });
});
